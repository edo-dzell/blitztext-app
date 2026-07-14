// Zentraler Reducer eines Workflows: idle → aufnehmen → transkribieren → (umschreiben) → fertig | fehler.
// Treue Portierung der Orchestrierung aus den macOS-Workflow-Klassen (TranscriptionWorkflow,
// TextImprovementWorkflow, …). Alle Kollaborateure sind injizierte Ports → ohne echtes Netz/OS testbar.
//
// V2 (Strang C): Der Runner kennt keine festen Workflow-Ids mehr. Er bekommt die aufgelöste
// WorkflowDefinition (rewrites/promptModus/model/temperature) plus das Provider-Default-Chatmodell
// in der RunInput. Modell/Temperatur/Prompt kommen damit aus der Definition statt aus hartem Code —
// die vier eingebauten Workflows liefern über ihre Seeds exakt die alten Werte (Verhalten unverändert).

import { promptKennungFuer, type WorkflowDefinition } from '@shared/workflows'
import type { TranscriptionProvider } from '@main/transcription/cloud-provider'
import type { RewriteProvider } from '@main/rewrite/cloud-provider'
import type { resolveSystemPrompt, RewriteSettings } from '@main/rewrite/prompt-builder'
import { kapsleTranskript, entferneTranskriptMarken } from '@main/rewrite/prompt-builder'
import type { TreueDetektor } from '@main/rewrite/treue-detektor'
import { klassifiziere, type FehlerArt } from '@main/workflow/fehler-klassifikation'
import { mitRetry } from '@main/workflow/retry'

export interface RecordingResult {
  audio: Blob
  durationSeconds: number
}

/** Mikrofon-Aufnahme. Echte Implementierung (MediaRecorder) ist HITL/Windows; im Test ein Fake. */
export interface Recorder {
  start(): void
  stop(): Promise<RecordingResult>
  /** Aufnahme beenden und verwerfen, ohne ein Ergebnis zu liefern (Abbruch). */
  discard(): void
}

interface QualityPort {
  shouldRejectRecording(durationSeconds: number): boolean
  cleanedTranscript(text: string): string
  // rohtextAus säubert intern und prüft auf Artefakt — kein cleanedTranscript davor nötig.
  rohtextAus(raw: string, recordingSeconds: number): string | null
}

export interface WorkflowRunnerDeps {
  recorder: Recorder
  transcription: TranscriptionProvider
  rewrite: RewriteProvider
  resolveSystemPrompt: typeof resolveSystemPrompt
  quality: QualityPort
  /**
   * Treue-Detektor (v0.4.5, ADR-0018): prüft NACH dem Umschreiben deterministisch, ob das Modell das
   * Diktat beantwortet/umgedeutet hat (statt es zu bearbeiten). Trifft er zu → Teil-Erfolg (Rohtext
   * retten) statt falschen Text einzufügen. Optional — fehlt er, bleibt das Verhalten unverändert.
   */
  treueDetektor?: TreueDetektor
  /**
   * Watchdog-Backstop: startet einen Timer und ruft `onTimeout`, wenn ein Anbieter-Aufruf hängt;
   * gibt eine Abbruchfunktion zurück. Ohne Angabe: 90 s via setTimeout. Im Test injizierbar.
   */
  starteWatchdog?: (onTimeout: () => void) => () => void
  /**
   * Aufnahme-Watchdog (W1-A, P0): eigener Backstop für die Phase `aufnehmen`. Stirbt der Recorder-
   * Renderer, während `recorder.stop()` auf 'recorder:result'/'recorder:error' wartet, löst nichts die
   * wartenden Listener auf → Phase `aufnehmen` hinge für immer (`beschaeftigt()` bliebe true). Dieser
   * Timer bricht den Hänger ab. Bewusst getrennt vom Anbieter-Watchdog und großzügiger (der Nutzer
   * hält evtl. minutenlang gedrückt). Ohne Angabe: AUFNAHME_WATCHDOG_MS via setTimeout. Im Test injizierbar.
   */
  starteAufnahmeWatchdog?: (onTimeout: () => void) => () => void
  /**
   * A2: additiver „Dauert länger …"-Timer für die Phasen `transkribieren`/`umschreiben`. Rein kosmetisch
   * — feuert `onTimeout`, wenn die aktuelle Phase ungewöhnlich lange läuft, damit der Runner eine zweite
   * `onPhase`-Emission mit `dauertLaenger: true` senden kann. Stört NICHT den 90s-Anbieter-Watchdog oder
   * `mitRetry`. Ohne Angabe: DAUERT_LAENGER_MS via setTimeout. Im Test injizierbar.
   */
  starteZwischenmeldungsTimer?: (onTimeout: () => void) => () => void
  /** Backoff-Verzögerung zwischen netzwerk-Retries; injizierbar für Tests (Default echte Verzögerung). */
  sleep?: (ms: number) => Promise<void>
}

export interface RunInput {
  /** Aufgelöste Workflow-Definition (rewrites/promptModus/model/temperature). */
  def: WorkflowDefinition
  /** Provider-Default-Chatmodell für def.model === '' (custom Workflows ohne eigenes Modell). */
  chatModell: string
  language?: string
  customTerms?: string[]
  rewriteSettings?: RewriteSettings
}

/**
 * Telemetrie des letzten abgeschlossenen Laufs (Strang D). Bewusst NICHT durch den Phasen-Kanal
 * geleitet (kein Leak sensibler Texte über die Status-Pille; Phasen bleiben byte-stabil). Die
 * Sitzung liest dies nach einem 'fertig' und ergänzt die Modellnamen aus der Provider-Config.
 */
export interface RunMetrik {
  workflowId: string
  dauerSekunden: number
  rohtext: string
  endtext: string
  usage?: { promptTokens: number; completionTokens: number }
  /** true, wenn ein Umschreibe-Schritt (Chat) lief — sonst reine Transkription. */
  umgeschrieben: boolean
  /**
   * Kennung des Prompt-Stands, der den Endtext erzeugt hat (V5, `promptKennungFuer` in
   * shared/workflows.ts). NUR bei Umschreib-Workflows gesetzt (rewrite lief) — reine Transkription
   * hat keinen System-Prompt und bleibt `undefined`.
   */
  promptKennung?: string
}

// Fehler-Art (CONTEXT.md) ist im fehler-klassifikation-Modul definiert (aufnahme | konfiguration |
// netzwerk | anbieter) und wird hier re-exportiert — die Phase trägt `art: FehlerArt`. 'aufnahme' bleibt
// ein Urteil des Runners (zu kurz/Artefakt); die übrigen bestimmt der Klassifizierer aus dem Anbieter-Fehler.
export type { FehlerArt }

// Warum es zum Teil-Erfolg kam (CONTEXT.md): ein Umschreib-Fehler (Anbieter scheiterte), ein
// Treue-Befund (das Modell hat das Diktat beantwortet, v0.4.5) ODER der Anbieter hat die Antwort am
// Token-Limit abgeschnitten (finish_reason='length', W1-D). Alle drei retten den Rohtext, aber die
// Sitzung meldet sie unterschiedlich (siehe sitzung.ts).
export type TeilErfolgGrund = 'umschreibfehler' | 'beantwortet' | 'abgeschnitten'

export type WorkflowPhase =
  | { status: 'idle' }
  | { status: 'aufnehmen' }
  // A4a: `istWiederholung` markiert additiv einen Lauf, der über erneutVersuchen() (W3-B, gehaltenes
  // Audio) erneut ab Transkription gestartet wurde — Pille/Tray können das sichtbar machen. KEIN neuer
  // Status (bricht keine bestehenden switch-Exhaustiveness-Checks), nur ein optionales Zusatzfeld.
  // A2: `dauertLaenger` markiert additiv, dass dieselbe Phase ungewöhnlich lange läuft (Zwischenmeldung
  // nach DAUERT_LAENGER_MS) — ebenfalls KEIN neuer Status, nur ein zweiter transition()-Aufruf mit
  // geändertem Flag.
  | { status: 'transkribieren'; istWiederholung?: boolean; dauertLaenger?: boolean }
  | { status: 'umschreiben'; istWiederholung?: boolean; dauertLaenger?: boolean }
  | { status: 'fertig'; text: string }
  | { status: 'teilErfolg'; rohtext: string; warnung: string; grund: TeilErfolgGrund }
  | { status: 'fehler'; art: FehlerArt; message: string }

export interface WorkflowRunner {
  readonly phase: WorkflowPhase
  /** Telemetrie des letzten 'fertig'-Laufs (Strang D); null, solange keiner abgeschlossen ist. */
  readonly letzteMetrik: RunMetrik | null
  onPhase?: (phase: WorkflowPhase) => void
  start(input: RunInput): void
  stop(): Promise<WorkflowPhase>
  /** Abbruch in Aufnahme/Transkription/Umschreiben: bricht laufende Anbieter-Aufrufe ab, still nach idle. */
  abbrechen(): void
  /**
   * W3-B (Audio-Retry): true, wenn ein Lauf an einem transienten Fehler (netzwerk/anbieter) bzw. einem
   * Teil-Erfolg scheiterte UND das aufgenommene Audio noch flüchtig im Speicher liegt → ein erneuter
   * Versuch ab Transkription ist möglich, OHNE neu zu diktieren.
   */
  kannErneutVersuchen(): boolean
  /**
   * W3-B: Verarbeitet das zuletzt gehaltene Audio erneut ab der Transkription (kein Recorder-Neustart,
   * kein neues Diktat). No-Op (gibt die aktuelle Phase zurück), wenn kein Audio gehalten wird — etwa
   * nach einem 'fertig' (das Audio wurde verworfen) oder im Leerlauf. NIE auf Disk, NIE in den Verlauf.
   */
  erneutVersuchen(): Promise<WorkflowPhase>
}

// Beide Aufnahme-Guards (zu kurz / Artefakt) melden denselben Text wie das macOS-Original.
const NO_RECORDING_ERROR = 'Keine Aufnahme erkannt.'
// Aufnahme-Watchdog-Frist (W1-A): großzügig, da der Nutzer im Halten-Modus minutenlang aufnehmen darf.
// Rein als Backstop gegen einen toten Renderer gedacht, nicht als Aufnahme-Längenlimit.
const AUFNAHME_WATCHDOG_MS = 10 * 60_000
// Nutzergerichtete Meldung, wenn die Aufnahme-Phase in den Watchdog läuft (toter Renderer o. Ä.).
const AUFNAHME_TIMEOUT_ERROR = 'Zeitüberschreitung bei der Aufnahme.'
// A2: additiver „Dauert länger …"-Timer (20-30s) für transkribieren/umschreiben — komplett eigener
// Mechanismus, NICHT mit dem 90s-Anbieter-Watchdog (starteWatchdog) zu verwechseln. Rein kosmetisch:
// feuert nur eine zweite onPhase-Emission mit dauertLaenger:true, keine Wirkung auf den Kontrollfluss.
const DAUERT_LAENGER_MS = 25_000
// Interner Grund-Vermerk für den Treue-Abbruch (die nutzergerichtete Meldung baut die Sitzung aus `grund`).
const BEANTWORTET_WARNUNG = 'Endtext wirkt wie eine Antwort auf das Diktat, nicht wie dessen Bearbeitung.'
// Interner Grund-Vermerk, wenn der Anbieter am Token-Limit abgeschnitten hat (finish_reason='length').
const ABGESCHNITTEN_WARNUNG = 'Umschreiben wurde vom Modell abgeschnitten (Token-Limit erreicht).'

// Steuerzeichen-Filter (MAL-1, Security-P1, W2-B): Modell-/Transkriptions-Output geht ungefiltert in
// Zwischenablage + Auto-Paste. Landet der Fokus in einem Terminal, können eingebettete Escape-Sequenzen
// dort ausgeführt werden (Terminal-Escape-Injection — z. B. Titel-Änderungen, in bestimmten Terminals
// sogar Tastatur-Einspeisung). CSI beginnt mit ESC '[' und endet am ersten Byte 0x40–0x7E; OSC beginnt
// mit ESC ']' und endet an BEL (\x07) oder ST (ESC '\'). Beide werden komplett entfernt, nicht nur das
// ESC-Byte — sonst bliebe der Sequenzkörper (z. B. Farbcodes) als sichtbarer Text-Müll zurück.
const CSI_ODER_OSC = /\x1b(?:\[[0-9:;<=>?]*[ -/]*[\x40-\x7e]|\][\s\S]*?(?:\x07|\x1b\\))/g
// Verbleibende C0-Steuerzeichen (0x00–0x1F) außer \n (0x0A) und \t (0x09), \r (0x0D, separat behandelt),
// plus DEL (0x7F). C1-Bereich (U+0080–U+009F) und die Unicode-Zeilentrenner U+2028/U+2029 werden
// separat per Codepoint-Escape gefiltert (kein rohes Steuerzeichen im Quelltext).
const RESTLICHE_C0_UND_DEL = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g
const C1_UND_ZEILENTRENNER = /[\u0080-\u009f\u2028\u2029]/g

/**
 * Entfernt Terminal-Escape-Sequenzen und sonstige Steuerzeichen aus Modell-/Transkriptions-Output,
 * bevor er in die Zwischenablage/Auto-Paste geht (MAL-1). Legitimer Text (Umlaute, Emoji, normale
 * Interpunktion, \n/\t, mehrzeiliger Text) bleibt unverändert — reine Funktion, keine Seiteneffekte.
 */
export function entferneSteuerzeichen(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(CSI_ODER_OSC, '')
    .replace(RESTLICHE_C0_UND_DEL, '')
    .replace(C1_UND_ZEILENTRENNER, '')
}

export function createWorkflowRunner(deps: WorkflowRunnerDeps): WorkflowRunner {
  let phase: WorkflowPhase = { status: 'idle' }
  let input: RunInput | null = null
  let letzteMetrik: RunMetrik | null = null
  // Abbruch-Steuerung pro Lauf: Controller bricht die in-flight fetch ab; `abgebrochen` markiert einen
  // manuellen Abbruch, damit der Catch still nach idle führt statt einen Fehler zu melden.
  let controller: AbortController | null = null
  let abgebrochen = false
  // W3-B (Audio-Retry): das zuletzt aufgenommene Audio wird NUR flüchtig im Speicher gehalten, solange
  // ein erneuter Versuch sinnvoll ist (transienter Fehler / Teil-Erfolg). Bei 'fertig' oder Aufnahme-
  // Fehler (nichts Brauchbares) wird es verworfen. NIE auf Disk, NIE in den Verlauf (Datenschutz).
  let letzteAufnahme: RecordingResult | null = null
  // A2: Generation-Zähler gegen Fehlfeuern des Zwischenmeldungs-Timers in eine längst verlassene Phase
  // (analog sitzung.ts `laufGeneration`). Zentral in transition() erhöht — dort laufen ALLE Statuswechsel
  // durch, das ist der einzige Ort, an dem der Guard zuverlässig ist.
  let zwischenmeldungGeneration = 0

  const starteWatchdog =
    deps.starteWatchdog ??
    ((onTimeout: () => void) => {
      const t = setTimeout(onTimeout, 90_000)
      return () => clearTimeout(t)
    })

  const starteAufnahmeWatchdog =
    deps.starteAufnahmeWatchdog ??
    ((onTimeout: () => void) => {
      const t = setTimeout(onTimeout, AUFNAHME_WATCHDOG_MS)
      return () => clearTimeout(t)
    })

  const starteZwischenmeldungsTimer =
    deps.starteZwischenmeldungsTimer ??
    ((onTimeout: () => void) => {
      const t = setTimeout(onTimeout, DAUERT_LAENGER_MS)
      return () => clearTimeout(t)
    })

  const runner: WorkflowRunner = {
    get phase() {
      return phase
    },
    get letzteMetrik() {
      return letzteMetrik
    },
    start(next) {
      input = next
      abgebrochen = false
      // W3-B: ein frisches Diktat macht ein zuvor gehaltenes Audio gegenstandslos → verwerfen.
      letzteAufnahme = null
      transition({ status: 'aufnehmen' })
      deps.recorder.start()
    },
    abbrechen() {
      // Wirkt in Aufnahme, Transkription und Umschreiben; in Terminal-/Leerlauf-Phasen ein No-Op.
      if (
        phase.status !== 'aufnehmen' &&
        phase.status !== 'transkribieren' &&
        phase.status !== 'umschreiben'
      ) {
        return
      }
      abgebrochen = true
      if (phase.status === 'aufnehmen') {
        // discard() darf die idle-Transition nicht killen (W1-A, P0): ein zerstörtes Recorder-Fenster
        // ließe send() sonst werfen → Runner bliebe „beschäftigt". Der Adapter schluckt bereits, hier
        // doppelt defensiv (auch für abweichende Recorder-Implementierungen/Tests).
        try {
          deps.recorder.discard()
        } catch {
          /* ignorieren — die stille Rückkehr nach idle hat Vorrang */
        }
      } else {
        controller?.abort(new DOMException('Abbruch durch Nutzer.', 'AbortError'))
      }
      transition({ status: 'idle' })
    },
    async stop() {
      // Phantom-Stop-Schutz: stop() ist nur in der Aufnahme-Phase sinnvoll. Wird es ohne laufende
      // Aufnahme aufgerufen (Dispatcher/Sitzung-Desync bei langem Umschreiben: ein verworfener
      // zweiter Start hinterlässt im Dispatcher einen „aktiven" Chord, dessen Loslassen einen Stop
      // ohne Aufnahme auslöst), no-op statt einen zweiten recorder.stop() abzusetzen — der sonst im
      // Renderer 'Keine aktive Aufnahme' wirft → ungefangene Ablehnung → blockierender Fehlerdialog.
      if (phase.status !== 'aufnehmen') return phase

      // Aufnahme-Watchdog (W1-A, P0): deckt die Phase `aufnehmen`, in der wir auf recorder.stop() warten.
      // Stirbt der Renderer, ohne dass der Adapter den wartenden stop() auflöst, hinge dieser Await für
      // immer (Phase `aufnehmen`, `beschaeftigt()` bliebe true). Der Watchdog löst das Rennen selbst auf
      // (eigenes reject), damit wir NICHT davon abhängen, dass recorder.stop()/discard() den Hänger bricht.
      let istAufnahmeTimeout = false
      let feuereAufnahmeTimeout: () => void = () => {}
      const aufnahmeTimeoutPromise = new Promise<never>((_resolve, reject) => {
        feuereAufnahmeTimeout = () =>
          reject(new DOMException(AUFNAHME_TIMEOUT_ERROR, 'TimeoutError'))
      })
      // Unhandled-Rejection vermeiden, falls der stop() vor dem Watchdog gewinnt.
      aufnahmeTimeoutPromise.catch(() => {})
      const stoppeAufnahmeWatchdog = starteAufnahmeWatchdog(() => {
        istAufnahmeTimeout = true
        // Renderer defensiv anstoßen (fire-and-forget, nie werfend); der Hänger wird ohnehin per race gelöst.
        try {
          deps.recorder.discard()
        } catch {
          /* ignorieren — das reject unten ist maßgeblich */
        }
        feuereAufnahmeTimeout()
      })

      let recording: RecordingResult
      try {
        recording = await Promise.race([deps.recorder.stop(), aufnahmeTimeoutPromise])
      } catch (err) {
        // Aufnahme-Watchdog gefeuert → Hänger als 'aufnahme'-Timeout melden (Notification statt Prozesstod).
        if (istAufnahmeTimeout) {
          return transition({ status: 'fehler', art: 'aufnahme', message: AUFNAHME_TIMEOUT_ERROR })
        }
        // Recorder-Fehler sauber als 'fehler' melden statt als uncaught exception durchzureichen.
        // Manueller Abbruch (discard → AbortError) ist bereits nach idle gegangen → still bleiben.
        if (abgebrochen) return phase
        const message = err instanceof Error ? err.message : String(err)
        return transition({ status: 'fehler', art: 'aufnahme', message })
      } finally {
        stoppeAufnahmeWatchdog()
      }
      if (deps.quality.shouldRejectRecording(recording.durationSeconds)) {
        // Aufnahme-Fehler: nichts Brauchbares zum Wiederholen → kein gehaltenes Audio.
        letzteAufnahme = null
        return transition({ status: 'fehler', art: 'aufnahme', message: NO_RECORDING_ERROR })
      }

      // W3-B: Audio ab hier flüchtig halten (verwertbare Aufnahme). Ein späterer transienter Fehler /
      // Teil-Erfolg lässt einen Retry ab Transkription zu; ein 'fertig' verwirft es wieder (abschluss()).
      letzteAufnahme = recording
      // stop() ist immer ein FRISCHER Lauf — istWiederholung bleibt hier default false.
      return verarbeiteAufnahme(recording)
    },
    kannErneutVersuchen() {
      return letzteAufnahme !== null
    },
    async erneutVersuchen() {
      // No-Op ohne gehaltenes Audio: nach 'fertig' (verworfen), Aufnahme-Fehler oder im Leerlauf.
      if (letzteAufnahme === null) return phase
      // Frisches Diktat entfällt — direkt ab Transkription mit dem gehaltenen Audio.
      abgebrochen = false
      // A4a: dies IST der Wiederholungs-Pfad — Pille/Tray sollen das während Transkription/Umschreiben
      // sichtbar machen. Reine Anzeige: Protokoll/Verlauf/Metrik bleiben unverändert (kein Nicht-Ziel-Bruch).
      return verarbeiteAufnahme(letzteAufnahme, true)
    }
  }

  // Transkription → (Umschreiben) → Abschluss/Teil-Erfolg/Fehler. Wird von stop() (frisches Audio) und
  // von erneutVersuchen() (gehaltenes Audio, W3-B) geteilt. Setzt einen frischen AbortController +
  // Anbieter-Watchdog pro Durchlauf, damit auch ein Retry sauber abbrechbar/watchdog-gesichert ist.
  // `istWiederholung` (A4a, additiv): true nur, wenn dieser Durchlauf über erneutVersuchen() kam — geht
  // NUR in die Phasen-Anzeige (transition), NICHT in Metrik/Verlauf/Protokoll.
  async function verarbeiteAufnahme(
    recording: RecordingResult,
    istWiederholung = false
  ): Promise<WorkflowPhase> {
    abgebrochen = false
    controller = new AbortController()
    let istTimeout = false
    const stoppeWatchdog = starteWatchdog(() => {
      istTimeout = true
      controller?.abort(new DOMException('Zeitüberschreitung beim Anbieter.', 'TimeoutError'))
    })

    const signal = controller.signal
    // Nur transiente netzwerk-Fehler wiederholen — nie Abbruch/Watchdog-Timeout (sonst Doppel-Audio,
    // und der abgebrochene Controller ließe den nächsten Versuch ohnehin sofort scheitern).
    const retrybar = (fehler: unknown): boolean => {
      if (abgebrochen || istTimeout) return false
      if (fehler instanceof Error && (fehler.name === 'AbortError' || fehler.name === 'TimeoutError')) {
        return false
      }
      return klassifiziere(fehler, { istWatchdogTimeout: false }) === 'netzwerk'
    }
    const retryOpts = { versuche: 2, backoffMs: 300, retrybar, sleep: deps.sleep }

    // --- Transkriptions-Phase: Audio → Rohtext (oder null bei leerer/artefaktiger Transkription). ---
    // Reine Gliederung von verarbeiteAufnahme; Logik/Reihenfolge/Fehlerpfade unverändert. Nutzt die
    // Closure-Werte (signal/retryOpts/input) direkt; wirft weiter an die try/catch-Orchestrierung.
    async function transkribiere(): Promise<string | null> {
      transition({ status: 'transkribieren', istWiederholung })
      // A2: additiver Zwischenmeldungs-Timer — MUSS gestoppt werden, sobald die Phase verlassen wird
      // (Erfolg, Fehler, Abbruch), sonst Leak/Fehlfeuern in eine andere Phase (finally deckt alle Pfade ab).
      const stoppeZwischenmeldung = starteZwischenmeldung('transkribieren', istWiederholung)
      try {
        // Eigennamen nur bei ausreichend langer Aufnahme mitschicken (≥ 0,9 s), wie im Original.
        const vocabularyHints = recording.durationSeconds >= 0.9 ? input?.customTerms ?? [] : []
        const raw = await mitRetry(
          () =>
            deps.transcription.transcribe(recording.audio, {
              language: input?.language,
              vocabularyHints,
              signal
            }),
          retryOpts
        )
        return deps.quality.rohtextAus(raw, recording.durationSeconds)
      } finally {
        stoppeZwischenmeldung()
      }
    }

    // --- Umschreib-Phase: Rohtext → Endtext-Terminal-Phase (fertig / teilErfolg). ---
    // Reine Gliederung; Prompt-Auflösung, Token-Limit-, Treue- und Kennungs-Logik unverändert.
    async function schreibeUm(rohtext: string, def: WorkflowDefinition): Promise<WorkflowPhase> {
      transition({ status: 'umschreiben', istWiederholung })
      // A2: additiver Zwischenmeldungs-Timer — MUSS gestoppt werden, sobald die Phase verlassen wird
      // (Erfolg, Teil-Erfolg, Fehler, Abbruch), sonst Leak/Fehlfeuern in eine andere Phase (finally
      // deckt alle Rückgabepfade dieser Funktion ab).
      const stoppeZwischenmeldung = starteZwischenmeldung('umschreiben', istWiederholung)
      try {
        const system = deps.resolveSystemPrompt(def, input?.rewriteSettings)
        // 0.3.1-Blocker-Fix: das bereits AUFGELÖSTE chatModell (aus aufloeseWorkflowLauf →
        // aufgeloestesChatModell, inkl. Fremd-Modell-Fallback) ist die alleinige Wahrheitsquelle.
        // NICHT mehr def.model bevorzugen — sonst ginge ein gepinntes OpenAI-Modell (Built-ins) gegen
        // Mistral/Groq und stürzte ab. Der def.model-Vorrang steckt bereits korrekt in chatModell.
        const model = input?.chatModell ?? ''
        // Rohtext gekapselt senden (Daten-Rahmen, prompt-builder): zieht die Grenze „zu bearbeitende
        // Daten" vs. „Anweisung", damit ein direkt ansprechendes Diktat nicht als Befehl befolgt wird.
        const rewritten = await mitRetry(
          () =>
            deps.rewrite.rewrite(
              { system, user: kapsleTranskript(rohtext) },
              { model, temperature: def.temperature, signal }
            ),
          retryOpts
        )
        // Token-Limit (W1-D): der Anbieter hat die Antwort bei finish_reason='length' abgeschnitten.
        // Der zurückgegebene Text ist unvollständig — weder als voller Erfolg einfügen noch dem
        // Treue-Detektor zur Prüfung vorlegen (der prüft eine vollständige Bearbeitung). Rohtext retten.
        if (rewritten.abgeschnitten) {
          return teilErfolg(rohtext, recording.durationSeconds, ABGESCHNITTEN_WARNUNG, 'abgeschnitten')
        }
        // Etwaig zurückgespiegelte Markierungen entfernen, bevor cleanedTranscript trimmt.
        const endtext = deps.quality.cleanedTranscript(entferneTranskriptMarken(rewritten.text))
        // Treue-Detektor (v0.4.5, ADR-0018): hat das Modell das Diktat beantwortet statt es zu
        // bearbeiten? Dann den (geglückten) Rohtext retten statt falschen Text einzufügen.
        if (deps.treueDetektor?.wirktBeantwortet(rohtext, endtext)) {
          return teilErfolg(rohtext, recording.durationSeconds, BEANTWORTET_WARNUNG, 'beantwortet')
        }
        // V5: Kennung des Prompt-Stands, der DIESEN Endtext erzeugt hat — NUR hier (Umschreib-Erfolg),
        // reine Transkription (unten) bleibt ohne System-Prompt und damit ohne Kennung.
        return abschluss(
          rohtext,
          endtext,
          recording.durationSeconds,
          rewritten.usage,
          true,
          promptKennungFuer(def, system)
        )
      } finally {
        stoppeZwischenmeldung()
      }
    }

    // Gemerkter Rohtext für den catch: ist er gesetzt, gelang die Transkription und nur das Umschreiben
    // scheiterte → Teil-Erfolg (Rohtext retten) statt Totalverlust.
    let letzterRohtext: string | null = null
    try {
      const rohtext = await transkribiere()
      if (rohtext === null) {
        // Leere/artefaktige Transkription trotz verwertbarer Länge → Aufnahme-Fehler, kein sinnvoller
        // Retry (dasselbe Audio liefert dasselbe Ergebnis) → Audio verwerfen.
        letzteAufnahme = null
        return transition({ status: 'fehler', art: 'aufnahme', message: NO_RECORDING_ERROR })
      }
      letzterRohtext = rohtext // Transkription gelang → bei späterem Umschreib-Fehler Teil-Erfolg

      const def = input?.def
      if (!def || !def.rewrites) {
        return abschluss(rohtext, rohtext, recording.durationSeconds, undefined, false)
      }

      return await schreibeUm(rohtext, def)
    } catch (err) {
      // Manueller Abbruch: still nach idle (bereits durch abbrechen() gesetzt) — kein Fehler/Metrik.
      // Bei Abbruch auch das gehaltene Audio verwerfen (der Nutzer will keinen Retry auf Verworfenes).
      if (abgebrochen) {
        letzteAufnahme = null
        return phase
      }
      const istTimeoutFehler = istTimeout || (err instanceof Error && err.name === 'TimeoutError')
      const art = klassifiziere(err, { istWatchdogTimeout: istTimeoutFehler })
      const message = istTimeoutFehler
        ? 'Zeitüberschreitung beim Anbieter.'
        : err instanceof Error
          ? err.message
          : String(err)
      // Teil-Erfolg: Transkription gelang, nur das Umschreiben scheiterte → Rohtext retten. Das Audio
      // bleibt gehalten (W3-B): der Nutzer kann das Umschreiben erneut versuchen.
      if (letzterRohtext !== null) {
        return teilErfolg(letzterRohtext, recording.durationSeconds, message, 'umschreibfehler')
      }
      // Vollfehler: das Audio bleibt gehalten (W3-B) — ein transienter netzwerk/anbieter-Fehler lässt
      // sich ab Transkription wiederholen. (Aufnahme-Fehler kommen hier nicht an, die sind oben schon
      // terminal und verwerfen das Audio.)
      return transition({ status: 'fehler', art, message })
    } finally {
      stoppeWatchdog()
    }
  }

  // Setzt die Telemetrie des Laufs und geht nach 'fertig'. rohtext/endtext bleiben hier (Verlauf);
  // die Phase trägt NUR den Endtext (kein rohtext-Leak über den Status-Kanal).
  function setzeMetrik(
    rohtext: string,
    endtext: string,
    dauerSekunden: number,
    usage: RunMetrik['usage'],
    umgeschrieben: boolean,
    promptKennung?: string
  ): void {
    letzteMetrik = {
      workflowId: input?.def.id ?? '',
      dauerSekunden,
      rohtext,
      endtext,
      usage,
      umgeschrieben,
      promptKennung
    }
  }

  function abschluss(
    rohtext: string,
    endtext: string,
    dauerSekunden: number,
    usage: RunMetrik['usage'],
    umgeschrieben: boolean,
    promptKennung?: string
  ): WorkflowPhase {
    // MAL-1 (W2-B): letzte Stelle vor Metrik/Phase — von hier geht `text` via Sitzung in
    // Zwischenablage/Auto-Paste (einfügen/anzeigen). Steuerzeichen/Escape-Sequenzen raus.
    const sauber = entferneSteuerzeichen(endtext)
    // W3-B: erfolgreicher Lauf → das flüchtig gehaltene Audio verwerfen (kein Retry mehr nötig/Datenschutz).
    letzteAufnahme = null
    setzeMetrik(rohtext, sauber, dauerSekunden, usage, umgeschrieben, promptKennung)
    return transition({ status: 'fertig', text: sauber })
  }

  // Teil-Erfolg (CONTEXT.md): die Transkription gelang, aber das Umschreiben scheiterte
  // (grund='umschreibfehler') ODER der Treue-Detektor verwarf den Endtext (grund='beantwortet', v0.4.5).
  // Wie ein fertiger Lauf protokolliert (umgeschrieben=false, endtext=rohtext), aber als eigener
  // Terminal-Zustand, den die Sitzung NICHT einfügt, sondern in die Zwischenablage legt.
  function teilErfolg(
    rohtext: string,
    dauerSekunden: number,
    warnung: string,
    grund: TeilErfolgGrund
  ): WorkflowPhase {
    // MAL-1 (W2-B): der Rohtext geht hier ebenfalls in die Zwischenablage (inZwischenablage) — derselbe
    // Filter wie im Endtext-Pfad, sonst könnte ein Teil-Erfolg die Injektion durchlassen.
    const sauber = entferneSteuerzeichen(rohtext)
    setzeMetrik(sauber, sauber, dauerSekunden, undefined, false)
    return transition({ status: 'teilErfolg', rohtext: sauber, warnung, grund })
  }

  function transition(next: WorkflowPhase): WorkflowPhase {
    // A2: JEDER Statuswechsel invalidiert eine zuvor gestartete Zwischenmeldung — zentral hier erhöht,
    // damit der Guard im Timer-Callback (starteZwischenmeldung) wirksam ist, egal wie viele andere
    // transition()-Aufrufe dazwischen liefen.
    zwischenmeldungGeneration++
    phase = next
    runner.onPhase?.(next)
    return next
  }

  // A2: startet den additiven „Dauert länger …"-Timer für eine der beiden Anbieter-Phasen. Feuert NUR,
  // wenn die beim Start gemerkte Generation noch aktuell ist (die Phase also nicht längst verlassen
  // wurde) — sonst reines No-Op. Gibt den Stop-Thunk zurück (IMMER aufrufen, sobald die Phase verlassen
  // wird: Erfolg, Fehler, Abbruch, Übergang in die nächste Phase — sonst Leak/Fehlfeuern).
  // `istWiederholung` wird durchgereicht (A4a-Feld bleibt beim Zwischenmeldungs-transition erhalten).
  function starteZwischenmeldung(
    status: 'transkribieren' | 'umschreiben',
    istWiederholung: boolean
  ): () => void {
    const meineGeneration = zwischenmeldungGeneration
    return starteZwischenmeldungsTimer(() => {
      if (zwischenmeldungGeneration !== meineGeneration) return // Phase längst gewechselt — No-Op
      transition({ status, dauertLaenger: true, istWiederholung })
    })
  }

  return runner
}
