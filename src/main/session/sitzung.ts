// Die Sitzung (CONTEXT.md): app-langlebige zentrale Steuerung. Nimmt eine Auslösung
// (Workflow + Auslösequelle) entgegen, führt damit genau einen Workflow über den workflow-runner
// aus und routet das Ergebnis — bei Hotkey ins Einfügen, bei manueller Quelle in die Anzeige.
// Pendant zu macOS AppState, aber ohne UI/OS-Wissen: die Ausgabe liegt hinter einer Naht.

import { findWorkflow, type WorkflowId } from '@shared/workflows'
import { aufloeseWorkflowLauf, type AnbieterKonfig } from '@shared/anbieter'
import type { WorkflowRunner, WorkflowPhase } from '@main/workflow/runner'
import type { SettingsStore } from '@main/settings/store'
import { fehlerMeldung, teilErfolgMeldung, type FehlerMeldung } from '@main/session/fehler-meldung'
import { NOOP_EREIGNISLOG, redigiereFehler, type EreignisLog } from '@main/diagnostics/ereignis-log'

export type Auslösequelle = 'hotkey' | 'manuell'

/** Fokus-Kontext fürs Einfügen (Weg B, ADR-0011): erfasstes Ziel + Feature-Schalter. */
export interface EinfügeKontext {
  fokusRueckkehr: boolean
  erfasstesHwnd: number | null
}

/**
 * v0.7.2 (Erstlauf-Fix B): interner Kontext, solange das HWND noch nicht gebraucht wird. Statt des
 * bereits AUFGELÖSTEN `erfasstesHwnd` trägt er das noch laufende Erfassungs-Versprechen — so blockiert
 * `runner.start()` nicht mehr auf der (beim Erstlauf zähen) HWND-Erfassung. Aufgelöst wird es dort, wo
 * der Wert konsumiert wird (`stoppe`/`verarbeiteTerminal`); Konsumenten erhalten weiter den `EinfügeKontext`.
 */
interface FokusKontextVersprechen {
  fokusRueckkehr: boolean
  // Fehler → null (nie werfen); der bestehende 2000ms-Adapter-Timeout begrenzt die Auflösung.
  hwndVersprechen: Promise<number | null>
}

/** Downstream-Naht: was die Sitzung mit dem Endtext tut. Adapter (win-paste/Fenster) sind HITL. */
export interface Ausgabe {
  /**
   * Endtext ins Paste-Ziel einfügen. `kontext` (Weg B, W3-A) trägt das beim Auslösen erfasste HWND +
   * den fokusRueckkehr-Schalter: bei Drift fügt der Adapter NICHT ins fremde Fenster ein, sondern legt
   * den Text in die Zwischenablage + zeigt die Drift-Meldung. Ohne Kontext = bisheriges Verhalten.
   */
  einfügen(text: string, kontext?: EinfügeKontext): void
  anzeigen(text: string): void
  zeigeEinstellungen(): void
  /**
   * Einen fehlgeschlagenen Lauf dem Nutzer melden (Hintergrund: Windows-Notification, OS-announced).
   * `aktionen.erneut` (F1, W3-B): bei retrybaren Fehlern (aktion:'erneut') ein Callback, den der
   * Adapter an einen Notification-Aktions-Button „Erneut versuchen" hängt — Klick löst den erneuten
   * Versuch aus (kein neues Diktat). Fehlt der Callback, bietet der Adapter keine Retry-Aktion an.
   */
  melde(fehler: FehlerMeldung, aktionen?: { erneut?: () => void }): void
  /** Text in die Zwischenablage legen, OHNE einzufügen (Teil-Erfolg: Rohtext retten). */
  inZwischenablage(text: string): void
  /**
   * Vordergrundfenster-Handle beim Auslösen der Aufnahme erfassen (Weg B, W3-A), nativ via
   * win-paste.exe --hwnd. null = konnte nicht erfasst werden (Fallback aufs bisherige Einfügen).
   * A1 (v0.6.0): asynchron (spawn statt spawnSync) — bereits vor dem ersten await gestartet, der
   * eigentliche Prozess läuft im Hintergrund. Aufrufer müssen die W2-A-Generation danach erneut prüfen.
   */
  erfasseFenster(): Promise<number | null>
}

/** Abschluss-Daten eines fertigen Laufs für Verlauf + Statistik (Strang D). */
export interface Abschlussdaten {
  workflowId: string
  workflowLabel: string
  rohtext: string
  endtext: string
  dauerSekunden: number
  asrModell: string
  chatModell: string
  usage?: { promptTokens: number; completionTokens: number }
  umgeschrieben: boolean
  /**
   * V5 (W3-μ): Kennung des Prompt-Stands, der den Endtext erzeugt hat (`promptKennungFuer`,
   * shared/workflows.ts) — kommt unverändert aus `runner.letzteMetrik.promptKennung` durch. NUR bei
   * Umschreib-Workflows gesetzt (rewrite lief); reine Transkription liefert `undefined`.
   */
  promptKennung?: string
}

/** Protokoll-Naht: zeichnet einen Abschluss auf. Der Adapter splittet in Verlauf (Text) + Stats
 *  (text-frei) und baut id/Zeitstempel. Optional — fehlt er, wird nichts aufgezeichnet. */
export interface Protokoll {
  /** Liefert true, wenn der VERLAUF tatsächlich geschrieben wurde (für das history:changed-Event, P5b). */
  aufzeichnen(daten: Abschlussdaten): Promise<boolean>
}

export interface SitzungDeps {
  runner: WorkflowRunner
  einstellungen: SettingsStore
  apiKeys: { has(anbieterId: string): Promise<boolean> }
  ausgabe: Ausgabe
  protokoll?: Protokoll
  /** Aktiviert den pro Lauf aufgelösten Anbieter (Composition setzt damit die Provider-Closure-Zelle). */
  aktiviereAnbieter?: (anbieter: AnbieterKonfig) => void
  /** Feuert NACH erfolgtem Verlauf-Schreiben (P5b) → Composition sendet `history:changed` ans Dashboard. */
  onHistoryChanged?: () => void
  /**
   * Ereignislog (v0.7.2): macht stille Hotkey-Abbrüche (unbekannter Workflow, fehlender Key, entwerteter
   * Start) und Protokoll-Schreibfehler TEXT-FREI sichtbar. Optional — fehlt er, wird NOOP genutzt und
   * nichts geloggt (Verhalten unverändert). Es gehen NIE Texte hinein, nur Ids/Quelle/Status/redig. Fehler.
   */
  log?: EreignisLog
}

export interface Sitzung {
  starteWorkflow(workflow: WorkflowId, quelle: Auslösequelle): Promise<void>
  stoppe(): Promise<void>
  brichAb(): void
  /**
   * W3-B (Audio-Retry): verarbeitet das zuletzt gehaltene Audio erneut ab der Transkription, ohne neues
   * Diktat. Für die Meldungs-Aktion `aktion:'erneut'` gedacht (Staffel 3.2 UI verbindet sie hiermit).
   * No-Op, wenn kein Audio gehalten wird (nach Erfolg/Abbruch) oder gerade ein Lauf aktiv ist.
   */
  erneutVersuchen(): Promise<void>
  /**
   * F1 (W3-B): true, wenn ein erneuter Versuch möglich ist (der Runner hält noch das Audio eines
   * transient gescheiterten Laufs). Spiegelt `runner.kannErneutVersuchen()`. Auslöser-UI (Tray-Eintrag
   * „Letzte Aufnahme erneut verarbeiten") nutzt es für den Aktiv-/Sichtbar-Zustand.
   */
  kannErneutVersuchen(): boolean
  /** true, solange ein Lauf aktiv ist (für den Live-Reconfigure-Guard der Komposition). */
  beschaeftigt(): boolean
  onStatus?: (phase: WorkflowPhase) => void
}

export function createSitzung(deps: SitzungDeps): Sitzung {
  // v0.7.2: TEXT-FREIES Ereignislog. Ohne Dep ein No-Op → Bestandsverhalten unverändert.
  const log = deps.log ?? NOOP_EREIGNISLOG
  let aktiveQuelle: Auslösequelle | null = null
  // Kontext des laufenden Workflows für das Protokoll beim Abschluss (Label + genutzte Modelle).
  let aktiverKontext: { label: string; asrModell: string; chatModell: string } | null = null
  // Weg B (W3-A): das beim Auslösen erfasste Fenster + fokusRueckkehr-Schalter, an einfügen durchgereicht.
  // v0.7.2 (Erstlauf-Fix B): die HWND-Erfassung (win-paste.exe --hwnd) lief bislang als dritter Await
  // VOR runner.start() im kritischen Pfad — der allererste Spawn (Defender-Erstscan, bis 2000ms-Timeout)
  // verzögerte Pille + Aufnahmebeginn. Jetzt hält der Kontext nur noch das VERSPRECHEN der Erfassung
  // (sofort nach der Reservierung angestoßen, nicht awaitet); aufgelöst wird es erst, wo der HWND-Wert
  // gebraucht wird (stoppe/verarbeiteTerminal). Der 2000ms-Adapter-Timeout begrenzt das Warten dort.
  let aktiverFokusKontext: FokusKontextVersprechen | null = null
  // W3-B (Audio-Retry): Kontext des ZULETZT verarbeiteten Laufs, damit ein erneutVersuchen() den
  // Terminal-Zustand identisch routen kann (gleiche Quelle/Label/Modelle/Fokus), ohne aktive Reservierung.
  let letzterLauf: {
    quelle: Auslösequelle
    kontext: { label: string; asrModell: string; chatModell: string } | null
    fokusKontext: EinfügeKontext | null
  } | null = null
  // W2-A: Generationszähler gegen zwei Start-Races. starteWorkflow hat vor runner.start() DREI awaits
  // (load, apiKeys.has, A1: erfasseFenster); die Reservierung `aktiveQuelle` allein reicht nicht:
  //  (1) Doppel-Start: die Reservierung erfolgt jetzt SOFORT beim Eintritt (vor dem ersten await),
  //      sodass ein zweiter, quasi-gleichzeitiger Aufruf am Guard scheitert.
  //  (2) Verlorener Abbruch: brichAb() während der Awaits setzte nur aktiveQuelle=null (der Runner ist
  //      noch idle → abbrechen() ist ein No-Op) — starteWorkflow lief danach weiter und startete doch.
  //      Jeder Start bucht eine Generation; brichAb()/stoppe() erhöhen sie. Nach jedem await prüft der
  //      Start, ob SEINE Generation noch aktuell ist — sonst steigt er aus, ohne runner.start().
  let laufGeneration = 0

  const sitzung: Sitzung = {
    async starteWorkflow(workflow, quelle) {
      if (aktiveQuelle !== null) return // ein Lauf zur Zeit; während aktiv neue Auslösungen ignorieren
      // v0.7.2 debug: ein Lauf beginnt (nach dem „ein Lauf zur Zeit"-Guard). Nur Workflow-Id + Quelle-Enum.
      log.debug('sitzung.start', { workflow, quelle })
      // Reservierung SOFORT, synchron, vor dem ersten await → schließt das Doppel-Start-Fenster (1).
      aktiveQuelle = quelle
      const meineGeneration = ++laufGeneration
      // True, sobald dieser Lauf inzwischen entwertet wurde (Abbruch (2) oder eine spätere Reservierung).
      const veraltet = (): boolean => laufGeneration !== meineGeneration
      // Reservierung nur zurücknehmen, wenn sie noch MIR gehört — sonst ein späterer Lauf leer räumen.
      const gibReservierungFrei = (): void => {
        if (!veraltet()) {
          aktiveQuelle = null
          aktiverKontext = null
        }
      }

      const settings = await deps.einstellungen.load()
      // (2) Abbruch während des load-Awaits: sauber aussteigen, ohne runner.start(). brichAb() hat die
      // Reservierung bereits geräumt und die Generation erhöht → nichts weiter zu tun.
      if (veraltet()) {
        log.info('sitzung.start_entwertet', { quelle })
        return
      }
      // Workflow-Definition auflösen; unbekannte Id (z. B. verwaister Hotkey) → still abbrechen.
      const def = findWorkflow(workflow, settings.workflows)
      if (!def) {
        // v0.7.2: verwaister Hotkey / unbekannte Workflow-Id — sonst still. `workflow` ist eine Id, kein Text.
        log.warnung('sitzung.workflow_unbekannt', { workflow, quelle })
        gibReservierungFrei()
        if (quelle === 'manuell') deps.ausgabe.zeigeEinstellungen()
        return
      }
      // Pro Lauf den Anbieter + die TATSÄCHLICH genutzten Modelle auflösen (ADR-0010).
      const lauf = aufloeseWorkflowLauf(def, {
        anbieter: settings.anbieter,
        standardAnbieterId: settings.standardAnbieterId,
        language: settings.language
      })
      // Gate: ohne Key des AUFGELÖSTEN Anbieters gar nicht erst aufnehmen (Cloud-only, ADR-0001).
      // L1: key-loser lokaler Anbieter braucht kein Gate; sonst ohne Key gar nicht erst aufnehmen.
      if (!lauf.anbieter.keinKeyNoetig) {
        const hatKey = await deps.apiKeys.has(lauf.anbieter.id)
        // (2) Abbruch während des has-Awaits: aussteigen, ohne runner.start().
        if (veraltet()) {
          log.info('sitzung.start_entwertet', { quelle })
          return
        }
        if (!hatKey) {
          // v0.7.2: ohne Key gar nicht erst aufnehmen — sonst (Hotkey) ein stiller Abbruch. Nur Ids.
          log.warnung('sitzung.start_ohne_key', { anbieter: lauf.anbieter.id, quelle })
          gibReservierungFrei()
          if (quelle === 'manuell') deps.ausgabe.zeigeEinstellungen()
          return // Hotkey: still abbrechen
        }
      }
      // v0.4.5 (ADR-0018): ehrlich statt still. Wurde ein Umschreib-Workflow auf den Anbieter-Standard
      // ABGEWERTET (gepinntes, dem Anbieter fremdes Modell), den Nutzer bei MANUELLER Auslösung
      // nicht-blockierend informieren (Hotkey bleibt bewusst unsichtbar). Sonst ein No-Op.
      if (quelle === 'manuell' && def.rewrites && lauf.chatModellAbgewertet) {
        deps.ausgabe.melde({
          titel: 'Modell ersetzt',
          koerper: `Das gewählte Modell ist bei „${lauf.anbieter.label}" nicht verfügbar — es läuft „${lauf.chatModell}".`
        })
      }
      deps.aktiviereAnbieter?.(lauf.anbieter)
      aktiverKontext = {
        label: def.label,
        asrModell: lauf.asrModell,
        chatModell: lauf.chatModell
      }
      // Weg B (W3-A): NUR bei Hotkey (das Ergebnis wird eingefügt) das aktuelle Vordergrundfenster
      // erfassen — das ist das Paste-Ziel. Bei manueller Quelle wird angezeigt, nicht getippt → egal.
      // v0.7.2 (Erstlauf-Fix B): die Erfassung ist ein Helfer-Spawn (win-paste.exe --hwnd) und beim
      // ALLERERSTEN Lauf zäh (Defender-Erstscan, bis 2000ms-Timeout). Sie darf runner.start() (und damit
      // Pille + Aufnahmebeginn) NICHT mehr blockieren: das Versprechen SOFORT anstoßen (nicht awaiten),
      // Fehler → null (nie werfen). Es sind damit wieder ZWEI Await-Punkte vor runner.start (load/has).
      // Die Debug-Messung `sitzung.fenster_erfasst` hängt an der Auflösung des Versprechens (weiter loggen;
      // Feldwerte reine Zahl/Boolean: Dauer in ms + ob ein Fenster erfasst wurde).
      let hwndVersprechen: Promise<number | null> | null = null
      if (quelle === 'hotkey') {
        const beginn = Date.now()
        hwndVersprechen = deps.ausgabe
          .erfasseFenster()
          .catch(() => null)
          .then((erfasstesHwnd) => {
            log.debug('sitzung.fenster_erfasst', {
              dauerMs: Date.now() - beginn,
              gefunden: erfasstesHwnd !== null
            })
            return erfasstesHwnd
          })
      }
      aktiverFokusKontext =
        quelle === 'hotkey' && hwndVersprechen
          ? { fokusRueckkehr: settings.fokusRueckkehr, hwndVersprechen }
          : null

      deps.runner.start({
        def,
        chatModell: lauf.chatModell,
        language: lauf.language,
        customTerms: settings.customTerms,
        rewriteSettings: settings
      })
    },
    async stoppe() {
      // Desync-Schutz: ohne aktiven Lauf ist nichts zu stoppen. Der Hotkey-Dispatcher arbitriert
      // „ein Workflow zur Zeit" unabhängig von der Sitzung; verwirft die Sitzung einen Start (weil
      // ein langes Umschreiben noch läuft), feuert das Loslassen jenes Chords trotzdem ein stop.
      // Dann hier no-op — sonst Phantom-recorder.stop() ('Keine aktive Aufnahme') + Doppel-Einfügen.
      if (aktiveQuelle === null) return
      // (2)/Erstlauf-Fix A: Generation SYNCHRON erhöhen, VOR dem runner.stop()-Await — entwertet einen
      // Start, der noch zwischen seinen Awaits hängt (z. B. beim zähen Erstlauf im settings.load-/apiKeys-
      // Gate). Ohne das lief der in-flight-Start NACH dem Loslassen weiter, startete die Aufnahme in ein
      // idle-Leere gestopptes System (Runner-Phantom-Stop war ein No-Op) → Geister-Aufnahme, Mikro offen.
      // Damit entspricht stoppe() endlich dem Design-Kommentar (2) („brichAb()/stoppe() erhöhen sie").
      // Der Start steigt an seinem nächsten veraltet()-Check aus; sein gibReservierungFrei() ist dann ein
      // No-Op (veraltet() → true, stoppe hat schon geräumt). Der normale Stop-Fall (Runner in 'aufnehmen',
      // starteWorkflow längst fertig, kein in-flight-Start) ist unberührt: es gibt keinen wartenden Start.
      laufGeneration++
      const quelle = aktiveQuelle
      const kontext = aktiverKontext
      const fokusKontext = aktiverFokusKontext
      const terminal = await deps.runner.stop()
      aktiveQuelle = null
      aktiverKontext = null
      aktiverFokusKontext = null
      // Fix B: das HWND-Versprechen erst JETZT auflösen (nach runner.stop(), vor dem Routen) — zum
      // Stop-Zeitpunkt fast immer schon da; der 2000ms-Adapter-Timeout deckelt das Restwarten.
      const eingefügterKontext = await loeseFokusKontext(fokusKontext)
      verarbeiteTerminal(terminal, quelle, kontext, eingefügterKontext)
    },
    async erneutVersuchen() {
      // W3-B: nur sinnvoll, wenn kein Lauf aktiv ist UND der Runner noch Audio hält (transienter
      // Fehler/Teil-Erfolg). Sonst No-Op. Den Terminal-Zustand wie den letzten Lauf routen.
      if (aktiveQuelle !== null) return
      if (!deps.runner.kannErneutVersuchen()) return
      const vorlage = letzterLauf
      if (!vorlage) return
      // F1 (P1-latent): Reservierung SOFORT, synchron, vor dem await auf runner.erneutVersuchen() —
      // dieselbe W2-A-Disziplin wie starteWorkflow/stoppe. Ohne sie meldete die Sitzung während des
      // awaiteten Retrys `beschaeftigt()===false`, und ein gleichzeitiger starteWorkflow(...,'hotkey')
      // passierte den Guard und riefe runner.start() auf demselben Runner ⇒ Doppel-Run-Korruption.
      // Quelle des ursprünglichen Laufs übernehmen (der Terminal-Zustand wird identisch geroutet).
      aktiveQuelle = vorlage.quelle
      const meineGeneration = ++laufGeneration
      const veraltet = (): boolean => laufGeneration !== meineGeneration
      const gibReservierungFrei = (): void => {
        if (!veraltet()) {
          aktiveQuelle = null
          aktiverKontext = null
        }
      }
      const terminal = await deps.runner.erneutVersuchen()
      // Ein brichAb() während des Retrys hat die Generation erhöht + die Reservierung geräumt und das
      // Audio verworfen → still aussteigen, ohne den (abgebrochenen) Terminal-Zustand zu routen.
      if (veraltet()) {
        log.info('sitzung.start_entwertet', { quelle: vorlage.quelle })
        return
      }
      gibReservierungFrei()
      verarbeiteTerminal(terminal, vorlage.quelle, vorlage.kontext, vorlage.fokusKontext)
    },
    kannErneutVersuchen() {
      // Kein Retry mitten in einem aktiven Lauf anbieten (der Runner hielte evtl. noch altes Audio).
      return aktiveQuelle === null && deps.runner.kannErneutVersuchen()
    },
    brichAb() {
      // Generation erhöhen: entwertet einen Start, der gerade zwischen seinen Awaits hängt (2) — er
      // erkennt das nach dem nächsten await und steigt aus, ohne runner.start(). Danach räumen; die
      // Freigabe des in-flight Starts (gibReservierungFrei) greift durch veraltet() dann nicht mehr.
      laufGeneration++
      deps.runner.abbrechen()
      aktiveQuelle = null
      aktiverKontext = null
      aktiverFokusKontext = null
      // W3-B: nach Abbruch kein Retry auf verworfenem Audio (der Runner verwirft es ebenfalls).
      letzterLauf = null
    },
    beschaeftigt() {
      return aktiveQuelle !== null
    }
  }

  // v0.7.2 (Erstlauf-Fix B): löst das noch offene HWND-Versprechen in einen konkreten EinfügeKontext auf.
  // Konsumenten (einfügen/paste-adapter, verarbeiteTerminal, letzterLauf) bekommen weiter den AUFGELÖSTEN
  // Wert — deren Signaturen bleiben unverändert. Wird nur an den beiden Verbrauchsstellen (stoppe /
  // erneutVersuchen-Vorlage) gerufen; zum Stop-Zeitpunkt ist das Versprechen fast immer schon da.
  async function loeseFokusKontext(
    kontext: FokusKontextVersprechen | null
  ): Promise<EinfügeKontext | null> {
    if (!kontext) return null
    const erfasstesHwnd = await kontext.hwndVersprechen
    return { fokusRueckkehr: kontext.fokusRueckkehr, erfasstesHwnd }
  }

  // Routet einen Terminal-Zustand des Runners auf die Ausgabe. Von stoppe() (frischer Lauf) UND
  // erneutVersuchen() (W3-B, gehaltenes Audio) geteilt — identisches Verhalten. Guard (defensiv):
  // NUR bei einer echten Terminal-Phase weiterlaufen — 'aufnehmen'/'transkribieren'/'umschreiben'/
  // 'idle' sind hier kein gültiger Abschluss (der Phantom-Stop-Schutz im Runner kann sonst einfach die
  // AKTUELLE, noch nicht-terminale Phase zurückliefern). Merkt den Lauf für einen etwaigen Retry
  // (letzterLauf); ein 'fertig' verwirft die Audio-Basis (Runner räumt selbst).
  function verarbeiteTerminal(
    terminal: WorkflowPhase,
    quelle: Auslösequelle,
    kontext: { label: string; asrModell: string; chatModell: string } | null,
    fokusKontext: EinfügeKontext | null
  ): void {
    if (terminal.status !== 'fertig' && terminal.status !== 'teilErfolg' && terminal.status !== 'fehler') {
      // v0.7.2: der Phantom-Stop-Schutz gab eine nicht-terminale Phase zurück (Dispatcher/Sitzung-Desync)
      // — text-frei sichtbar machen. `status` ist ein Zustandsname, kein Text.
      log.warnung('sitzung.terminal_unerwartet', { status: terminal.status })
      return
    }
    letzterLauf = { quelle, kontext, fokusKontext }
    if (terminal.status === 'fertig') {
      // Weg B (W3-A): beim Hotkey den Fokus-Kontext mitreichen → der Adapter degradiert bei Drift.
      if (quelle === 'hotkey') deps.ausgabe.einfügen(terminal.text, fokusKontext ?? undefined)
      else deps.ausgabe.anzeigen(terminal.text)
      // Fire-and-forget: das Einfügen ist bereits erfolgt; das Protokoll schreibt asynchron und
      // feuert danach onHistoryChanged. stoppe() bleibt Promise<void> (Kontext als Closure-Arg).
      void protokolliere(kontext)
    } else if (terminal.status === 'teilErfolg') {
      // Teil-Erfolg: Rohtext in die Zwischenablage, NIE auto-einfügen (bei De-Eskalation wäre der
      // Originaltext das Gegenteil der Absicht; bei einem Treue-Befund wäre der Endtext schlicht
      // falsch). Die Meldung unterscheidet den Grund (Umschreib-Fehler vs. „beantwortet", v0.4.5).
      deps.ausgabe.inZwischenablage(terminal.rohtext)
      deps.ausgabe.melde(teilErfolgMeldung(terminal.grund))
      void protokolliere(kontext)
    } else if (terminal.status === 'fehler') {
      // W3-B: bei transienten Fehlern (netzwerk/anbieter) hält der Runner das Audio → Retry anbieten.
      const retrybar =
        (terminal.art === 'netzwerk' || terminal.art === 'anbieter') &&
        deps.runner.kannErneutVersuchen()
      // F1: bei retrybaren Fehlern den Retry-Callback mitreichen → der Adapter hängt ihn an einen
      // Notification-Aktions-Button „Erneut versuchen". Klick löst erneutVersuchen() aus (kein neues
      // Diktat). void: der Adapter-Callback ist synchron, das Retry läuft im Hintergrund weiter.
      deps.ausgabe.melde(
        fehlerMeldung(terminal.art, terminal.message, retrybar),
        retrybar ? { erneut: () => void sitzung.erneutVersuchen() } : undefined
      )
    }
  }

  // Telemetrie des Laufs (aus runner.letzteMetrik, NICHT aus der Phase) ans Protokoll geben. Feuert
  // onHistoryChanged GENAU DANN, wenn der Verlauf tatsächlich geschrieben wurde (P5b).
  async function protokolliere(kontext: typeof aktiverKontext): Promise<void> {
    // A5/REL-1: Der Nebeneffekt (Verlauf/Statistik schreiben) darf die App NIE herunterreißen. Ein
    // Schreibfehler (Platte voll, AV-/OneDrive-Lock auf history.bin) wird geschluckt + protokolliert —
    // das Einfügen ist da bereits erfolgt.
    try {
      if (!deps.protokoll || !kontext) return
      const m = deps.runner.letzteMetrik
      if (!m) return
      const geschrieben = await deps.protokoll.aufzeichnen({
        workflowId: m.workflowId,
        workflowLabel: kontext.label,
        rohtext: m.rohtext,
        endtext: m.endtext,
        dauerSekunden: m.dauerSekunden,
        asrModell: kontext.asrModell,
        chatModell: m.umgeschrieben ? kontext.chatModell : '',
        usage: m.usage,
        umgeschrieben: m.umgeschrieben,
        promptKennung: m.promptKennung
      })
      if (geschrieben) deps.onHistoryChanged?.()
    } catch (err) {
      // v0.7.2: zusätzlich zum console.error TEXT-FREI ins Log (nur redigierter Fehler: name+message).
      log.fehler('protokoll.schreiben_fehl', redigiereFehler(err))
      console.error('Protokollieren fehlgeschlagen (ignoriert):', err)
    }
  }

  // Runner-Phasen nach außen reichen, damit Tray und Fenster den Status spiegeln können.
  deps.runner.onPhase = (phase) => sitzung.onStatus?.(phase)

  return sitzung
}
