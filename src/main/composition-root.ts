// Composition Root (#11): konstruiert die app-langlebige Sitzung im Main-Prozess und schließt ihre
// Kollaborateure an. Die reinen/Cloud-Teile (Runner, Transkription, Umschreiben, Quality, Settings)
// werden hier verdrahtet; die vier OS-/GUI-nahen Stücke kommen als injizierte NATIVE Ports herein
// (HITL/Windows, nicht headless verifizierbar):
//   - recorder  : MediaRecorder in einem versteckten Renderer + IPC (liefert audio-Blob)
//   - ausgabe   : win-paste.exe/PowerShell-Einfügen (winPastePfad) + Fenster zeigen
// Die KeyEvent-Quelle (uiohook-Adapter, ebenfalls HITL) wird über `verarbeiteTaste` eingespeist.
// So bleibt die gesamte Verdrahtung typecheck-/testbar, und nur die vier Adapter sind Windows-Arbeit.

import { createWorkflowRunner, type Recorder } from '@main/workflow/runner'
import { createCloudTranscriptionProvider } from '@main/transcription/cloud-provider'
import { createCloudRewriteProvider } from '@main/rewrite/cloud-provider'
import { createTreueDetektor } from '@main/rewrite/treue-detektor'
import { resolveSystemPrompt } from '@main/rewrite/prompt-builder'
import { shouldRejectRecording, cleanedTranscript, rohtextAus } from '@main/transcription/quality'
import {
  createSettingsStore,
  type SettingsFile,
  type BlitztextSettings
} from '@main/settings/store'
import { createSitzung, type Sitzung, type Ausgabe } from '@main/session/sitzung'
import { createHotkeyDispatcher, type Bindung, type DispatchAktion } from '@main/hotkey/dispatcher'
import { createVerlaufStore, type VerlaufStore } from '@main/history/history-store'
import { createStatsStore, type StatsStore, type StatsFile } from '@main/stats/stats-store'
import { createProtokoll } from '@main/session/protokoll-adapter'
import { buildAssistentVerbesserung, ASSISTENT_TEMPERATUR } from '@main/rewrite/assistent'
import type { SecretCipher, CiphertextFile } from '@main/secrets/api-key-store'
import type { ApiKeyVault } from '@main/secrets/api-key-vault'
import type { SettingsStore } from '@main/settings/store'
import type { KeyEvent } from '@main/hotkey/matcher'
import { findeAnbieter, standardAnbieterAus, type AnbieterKonfig } from '@shared/anbieter'
import type { Autostart, AutostartStatus } from '@main/autostart'
import { pruefeAufUpdate, type Holer, type UpdateCacheSpeicher, type UpdateErgebnis } from '@main/update/update-hinweis'
import { fuehreDiagnose, type DiagnoseErgebnis, type ErreichbarkeitsPort } from '@main/health'

/** Die OS-/GUI-nahen Ports, die nur Windows real erfüllen kann (HITL). */
export interface NativePorts {
  recorder: Recorder
  ausgabe: Ausgabe
}

export interface CompositionDeps extends NativePorts {
  apiKeys: ApiKeyVault
  settingsFile: SettingsFile
  /** Cipher + Datei für den verschlüsselten Verlauf (Strang D); reuse safeStorage/CiphertextFile. */
  verlaufCipher: SecretCipher
  verlaufFile: CiphertextFile
  /** Datei für die text-freie Statistik (Strang D). */
  statsFile: StatsFile
  /** Echte Uhr/Id-Quelle (Adapter); in Tests injizierbar. Default Date.now/randomUUID. */
  jetzt?: () => number
  neueId?: () => string
  /** Feuert nach erfolgtem Verlauf-Schreiben (P5b) → index.ts sendet `history:changed` ans Dashboard. */
  onHistoryChanged?: () => void
  /**
   * W3-γ (3.2): Autostart-Port (createDefaultAutostart) + der aktuelle .exe-Pfad. Beide optional, damit
   * headless-Tests/Nicht-Windows die Komposition ohne echten Registry-Port bauen können. Fehlt der Port,
   * sind Autostart-Kopplung + Status ein No-Op (Status meldet 'inaktiv').
   */
  autostart?: Autostart
  exePfad?: string
  /**
   * W3-δ (3.2): echte Ports für den Opt-in-Update-Hinweis. Fehlen sie, liefert `pruefeUpdate` still
   * „kein Update" (kein Netz). Die Opt-in-Entscheidung kommt live aus den Settings.
   */
  updateHoler?: Holer
  updateCache?: UpdateCacheSpeicher
  /** Lokale App-Version für den Update-Vergleich (app.getVersion()); Default '0.0.0'. */
  appVersion?: string
  /**
   * W3-ε (3.2): echter Erreichbarkeits-Port (leichter Anbieter-Ping) für die Selbstdiagnose. Fehlt er,
   * meldet der Erreichbarkeits-Check 'warnung' (nicht prüfbar) — kein Absturz.
   */
  erreichbarkeit?: ErreichbarkeitsPort
}

export interface MainComposition {
  sitzung: Sitzung
  /** Bricht den laufenden Workflow ab (Tray-„Abbrechen"). */
  brichAb(): void
  /** true, solange ein Lauf aktiv ist (Aktivzustand des Tray-„Abbrechen"-Eintrags). */
  beschaeftigt(): boolean
  /**
   * F1 (W3-B): true, wenn die letzte Aufnahme erneut verarbeitet werden kann (transient gescheitert,
   * Audio noch gehalten). Aktivzustand des Tray-Eintrags „Letzte Aufnahme erneut verarbeiten".
   */
  kannErneutVersuchen(): boolean
  /** F1 (W3-B): verarbeitet die zuletzt gehaltene Aufnahme erneut (Tray-Eintrag/Notification-Button). */
  erneutVersuchen(): void
  /** Einstellungs-Store für die Settings-IPC (get/save). */
  einstellungen: SettingsStore
  /** Verlauf-Store für die Verlauf-IPC (liste/loeschen). */
  verlauf: VerlaufStore
  /** Statistik-Store für die Statistik-IPC. */
  stats: StatsStore
  /** Ein KeyEvent aus dem uiohook-Adapter (HITL) hier einspeisen → Dispatch → Sitzung. */
  verarbeiteTaste(event: KeyEvent): void
  /**
   * Setzt das Hotkey-Tasten-Tracking zurück (powerMonitor: Sperre/Standby/Resume) — dort gehen
   * Keyups verloren (Secure Desktop/UIPI) und Modifier blieben sonst für immer „gedrückt".
   * Ein gerade per Hotkey aktiver Lauf wird abgebrochen (kein blindes Weiterlaufen der Aufnahme).
   */
  setzeTastenZurueck(): void
  /**
   * Prompt-Assistent: erzeugt einen System-Prompt-Entwurf über den Chat-Anbieter (ADR-0008). Ist
   * `bestehend` gesetzt, wird dieser Prompt VERBESSERT statt neu erstellt (W-4).
   */
  assistiere(beschreibung: string, bestehend?: string): Promise<string>
  /** Base-URL des Standard-Anbieters (für Assistent/Default-Validierung). */
  aktuelleBaseUrl(): string
  /** Base-URL eines bestimmten Anbieters (für die Key-Validierung beim Speichern, B3). */
  baseUrlVon(anbieterId: string): string
  /** Id des Standard-Anbieters (z. B. für das Assistent-Key-Gate). */
  standardAnbieterId(): string
  /**
   * Übernimmt geänderte Einstellungen zur Laufzeit (Settings-UI). Solange ein Lauf aktiv ist, werden
   * sie NICHT angewandt (weder Provider-Wechsel mitten im laufenden Call noch Dispatcher-Rebuild, der
   * den gehaltenen Chord/Keyup verlöre), sondern als „ausstehend" gemerkt und nach Lauf-Ende über
   * `wendeAusstehendeAn` übernommen. Gibt true zurück, wenn sofort übernommen, sonst false (verschoben).
   */
  aktualisiere(settings: BlitztextSettings): boolean
  /** Wendet ausstehende Einstellungen an, sobald kein Lauf mehr aktiv ist (vom onStatus-Terminal). */
  wendeAusstehendeAn(): void
  /**
   * W3-γ: meldet den Laufstatus des globalen Tastatur-Hooks (uiohook). index.ts setzt ihn nach dem
   * `starteUiohookQuelle`-Start-Ergebnis; der Health-Check „Hotkey-Erkennung" liest ihn.
   */
  setzeHotkeyHookAktiv(aktiv: boolean): void
  /**
   * W3-γ: gleicht beim App-Start den Registry-Eintrag an das gespeicherte `autostart`-Feld an (an ⇒
   * Pfad auf die aktuelle .exe aktualisieren — heilt einen „verwaisten" Eintrag nach dem Verschieben;
   * aus ⇒ Eintrag entfernen). No-Op ohne verdrahteten Port.
   */
  syncAutostartBeimStart(): Promise<void>
  /** W3-γ: Autostart-Status gegen den aktuellen .exe-Pfad (aktiv/inaktiv/verwaist). */
  autostartStatus(): Promise<AutostartStatus>
  /**
   * W3-δ: führt den Opt-in-Update-Hinweis aus (nutzt live die `updateHinweisAktiv`-Einstellung als
   * optIn). Ohne echte Ports oder bei optIn=false ⇒ still „kein Update".
   */
  pruefeUpdate(): Promise<UpdateErgebnis>
  /**
   * W3-ε: führt die Selbstdiagnose aus. `mikrofonAnzahl` liefert der Renderer (enumerateDevices) per
   * IPC mit — der Main-Prozess hat keinen direkten Medien-Geräte-Zugriff.
   */
  diagnose(mikrofonAnzahl: number): Promise<DiagnoseErgebnis>
}

/** Mutierbare Provider-Config-Zelle: die Provider-Closures lesen sie pro Call (Live-Wechsel). */
function bindungenAus(settings: BlitztextSettings): Bindung[] {
  // Nur Workflows mit belegtem Chord binden (custom Workflows können unbelegt sein).
  return settings.workflows.flatMap((w) => {
    const chord = settings.hotkeys[w.id]
    return chord && chord.length > 0 ? [{ chord, workflow: w.id }] : []
  })
}

/** Reine Glue: ordnet eine Dispatch-Aktion der passenden Sitzung-Methode zu (Hotkey-Quelle). */
export function routeDispatch(
  aktion: DispatchAktion | null,
  sitzung: Pick<Sitzung, 'starteWorkflow' | 'stoppe' | 'brichAb'>
): void {
  if (!aktion) return
  if (aktion.aktion === 'start') void sitzung.starteWorkflow(aktion.workflow, 'hotkey')
  else if (aktion.aktion === 'stop') void sitzung.stoppe()
  else sitzung.brichAb()
}

export async function createMainComposition(deps: CompositionDeps): Promise<MainComposition> {
  const einstellungen = createSettingsStore({ file: deps.settingsFile })
  let settings = await einstellungen.load()

  // Anbieter-Auflösung (ADR-0010): Standard-Anbieter (für Assistent/Validierung) + der pro Lauf aktive
  // Anbieter, den die Provider-Closures pro Call lesen. Die Sitzung setzt `aktiverAnbieter` je Lauf.
  const findeStandard = (s: BlitztextSettings): AnbieterKonfig =>
    standardAnbieterAus(s.anbieter, s.standardAnbieterId)
  let standardAnbieter: AnbieterKonfig = findeStandard(settings)
  let aktiverAnbieter: AnbieterKonfig = standardAnbieter

  // Key des PRO LAUF aktiven Anbieters (Vault, eine Datei je Anbieter).
  const getApiKey = (): Promise<string | null> => deps.apiKeys.get(aktiverAnbieter.id)

  const rewriteProvider = createCloudRewriteProvider({
    getApiKey,
    getBaseUrl: () => aktiverAnbieter.baseUrl,
    erlaubeOhneKey: () => aktiverAnbieter.keinKeyNoetig === true
  })

  const runner = createWorkflowRunner({
    recorder: deps.recorder,
    transcription: createCloudTranscriptionProvider({
      getApiKey,
      getConfig: () => ({ baseUrl: aktiverAnbieter.baseUrl, model: aktiverAnbieter.asrModell }),
      erlaubeOhneKey: () => aktiverAnbieter.keinKeyNoetig === true
    }),
    rewrite: rewriteProvider,
    resolveSystemPrompt,
    quality: { shouldRejectRecording, cleanedTranscript, rohtextAus },
    // v0.4.5 (ADR-0018): deterministischer Treue-Detektor, kein zusätzlicher Modell-Aufruf.
    treueDetektor: createTreueDetektor()
  })

  // Verlauf (verschlüsselt, opt-in) + Statistik (text-frei) + Protokoll-Adapter (Strang D).
  const verlauf = createVerlaufStore({
    cipher: deps.verlaufCipher,
    file: deps.verlaufFile,
    // Live: aktiv nur, wenn opt-in an UND die Verlauf-Sperre nicht greift.
    istAktiv: () => settings.verlaufAktiv && !settings.verlaufGesperrt
  })
  const stats = createStatsStore({ file: deps.statsFile })
  const protokoll = createProtokoll({
    verlauf,
    stats,
    jetzt: deps.jetzt ?? Date.now,
    neueId: deps.neueId ?? (() => globalThis.crypto.randomUUID())
  })

  const sitzung = createSitzung({
    runner,
    einstellungen,
    apiKeys: deps.apiKeys,
    ausgabe: deps.ausgabe,
    protokoll,
    // Pro Lauf den aufgelösten Anbieter aktivieren → Provider-Closures lesen ihn (baseUrl/Modell).
    aktiviereAnbieter: (a) => {
      aktiverAnbieter = a
    },
    onHistoryChanged: deps.onHistoryChanged
  })

  // Hotkeys aus den Einstellungen → Dispatcher. Bei Settings-Änderung über `aktualisiere` neu aufgebaut.
  let dispatcher = createHotkeyDispatcher({
    bindungen: bindungenAus(settings),
    mode: settings.aufnahmemodus
  })

  // Einstellungen, die während eines aktiven Laufs gespeichert wurden und nach Lauf-Ende greifen.
  let ausstehend: BlitztextSettings | null = null

  // W3-γ: Laufstatus des globalen Tastatur-Hooks (uiohook). Wird von index.ts nach dem Start gesetzt;
  // vor dem Start pessimistisch false (der Health-Check meldet dann 'fehler', bis der Hook läuft).
  let hotkeyHookAktiv = false

  /**
   * W3-γ: koppelt den Autostart-Registry-Eintrag an das `autostart`-Settings-Feld. an ⇒ Eintrag auf den
   * aktuellen exePfad setzen, aus ⇒ Eintrag entfernen. Fehler (z. B. reg.exe auf Nicht-Windows) werden
   * geschluckt — eine fehlgeschlagene Autostart-Kopplung darf das Settings-Speichern nicht scheitern
   * lassen (der Status-Getter zeigt dem Nutzer ohnehin den echten Registry-Zustand).
   */
  async function koppleAutostart(gewuenscht: boolean): Promise<void> {
    if (!deps.autostart || !deps.exePfad) return
    try {
      if (gewuenscht) await deps.autostart.autostartAn(deps.exePfad)
      else await deps.autostart.autostartAus()
    } catch (err) {
      console.error('Autostart konnte nicht gekoppelt werden:', err instanceof Error ? err.message : err)
    }
  }

  function uebernimm(next: BlitztextSettings): void {
    const autostartGeaendert = next.autostart !== settings.autostart
    settings = next
    standardAnbieter = findeStandard(next)
    aktiverAnbieter = standardAnbieter
    dispatcher = createHotkeyDispatcher({
      bindungen: bindungenAus(next),
      mode: next.aufnahmemodus
    })
    // Nur bei echter Änderung an-/abkoppeln (idempotenter Registry-Schreibvorgang, aber unnötige
    // reg.exe-Aufrufe bei jedem Speichern vermeiden). Bewusst nicht awaiten — feuer-und-vergiss.
    if (autostartGeaendert) void koppleAutostart(next.autostart)
  }

  return {
    sitzung,
    brichAb() {
      sitzung.brichAb()
    },
    beschaeftigt() {
      return sitzung.beschaeftigt()
    },
    kannErneutVersuchen() {
      return sitzung.kannErneutVersuchen()
    },
    erneutVersuchen() {
      void sitzung.erneutVersuchen()
    },
    einstellungen,
    verlauf,
    stats,
    verarbeiteTaste(event) {
      routeDispatch(dispatcher.handle(event), sitzung)
    },
    setzeTastenZurueck() {
      routeDispatch(dispatcher.setzeZurueck(), sitzung)
    },
    async assistiere(beschreibung, bestehend) {
      // Assistent läuft über den Standard-Anbieter (kein Workflow-Kontext).
      aktiverAnbieter = standardAnbieter
      const ergebnis = await rewriteProvider.rewrite(
        buildAssistentVerbesserung(bestehend ?? '', beschreibung),
        { model: standardAnbieter.chatModell, temperature: ASSISTENT_TEMPERATUR }
      )
      return ergebnis.text
    },
    aktuelleBaseUrl() {
      return standardAnbieter.baseUrl
    },
    baseUrlVon(anbieterId) {
      return (findeAnbieter(settings.anbieter, anbieterId) ?? standardAnbieter).baseUrl
    },
    standardAnbieterId() {
      return standardAnbieter.id
    },
    aktualisiere(next) {
      // Mitten im Lauf NICHT anwenden (kein Provider-Wechsel im laufenden Call, kein Dispatcher-
      // Rebuild der den gehaltenen Chord verlöre) → merken und nach Lauf-Ende übernehmen.
      if (sitzung.beschaeftigt()) {
        ausstehend = next
        return false
      }
      ausstehend = null
      uebernimm(next)
      return true
    },
    wendeAusstehendeAn() {
      if (ausstehend && !sitzung.beschaeftigt()) {
        uebernimm(ausstehend)
        ausstehend = null
      }
    },
    setzeHotkeyHookAktiv(aktiv) {
      hotkeyHookAktiv = aktiv
    },
    async syncAutostartBeimStart() {
      await koppleAutostart(settings.autostart)
    },
    async autostartStatus() {
      if (!deps.autostart || !deps.exePfad) return { zustand: 'inaktiv' }
      return deps.autostart.istAutostartAktiv(deps.exePfad)
    },
    async pruefeUpdate() {
      const leer: UpdateErgebnis = {
        aktuelleVersion: deps.appVersion ?? '0.0.0',
        neuVerfuegbar: false,
        url: ''
      }
      if (!deps.updateHoler || !deps.updateCache) return leer
      return pruefeAufUpdate({
        optIn: settings.updateHinweisAktiv, // live aus den Einstellungen (Opt-in)
        lokaleVersion: deps.appVersion ?? '0.0.0',
        holer: deps.updateHoler,
        speicher: deps.updateCache
      })
    },
    async diagnose(mikrofonAnzahl) {
      return fuehreDiagnose({
        apiKey: { apiKeys: deps.apiKeys, anbieter: standardAnbieter },
        erreichbarkeit: {
          // Ohne echten Port meldet der Check 'warnung' (Port wirft ⇒ nicht prüfbar).
          holer: deps.erreichbarkeit ?? {
            pingeAnbieter: async () => {
              throw new Error('kein Erreichbarkeits-Port verdrahtet')
            }
          },
          anbieter: { label: standardAnbieter.label, baseUrl: standardAnbieter.baseUrl }
        },
        // Der Renderer speist die (nicht-negative, ganzzahlige) Geräteanzahl ein.
        mikrofon: { geraete: { anzahl: async () => Math.max(0, Math.trunc(mikrofonAnzahl)) } },
        hotkeyHook: { hook: { istAktiv: async () => hotkeyHookAktiv } }
      })
    }
  }
}
