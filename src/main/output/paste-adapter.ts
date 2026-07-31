// Ausgabe-Adapter (#04/#11, HITL/Windows): implementiert den Ausgabe-Port der Sitzung.
// - einfügen: Zwischenablage setzen → paste-service (win-paste.exe via winPastePfad → PowerShell-
//   SendKeys → nur-Zwischenablage+Hinweis) → bei Erfolg VERZÖGERTES, marker-geschütztes Restore
//   (RESEARCH §4: kein Sofort-Restore wegen Race; 1,5 s wie macOS). Port bleibt synchron `void`
//   (RESEARCH §4 Naht-Mismatch) — der Adapter besitzt das Async.
// - anzeigen / zeigeEinstellungen: an die Fenster-Schicht (index.ts) delegiert.
// A1 (v0.6.0): `erfasseFenster` (Ausgabe-Port) UND `schreibUeberHelfer` (Zwischenablage-Schreiben)
// laufen über `spawn`+Promise statt `spawnSync` — der Aufrufer (sitzung.ts) awaitet erfasseFenster()
// bereits (async starteWorkflow), blockiert also nicht mehr den Event-Loop. NUR das zweite `--hwnd`
// unmittelbar vor dem Paste (Weg-B-Drift-Gate, `aktuellesFenster` unten) bleibt bewusst synchron.
// F2 (Review R2, v0.6.0, Fix): die A1-Umstellung machte `Zwischenablage.schreib` kurzzeitig
// fire-and-forget — der PasteService rief `schreib()` ohne await auf und startete danach sofort die
// Drift-Prüfung/Paste-Strategien, obwohl `--set-clip` (spawn) noch lief. Bei einem langsamen Helfer
// (z.B. AV-Scan) konnte so der ALTE Zwischenablage-Inhalt eingefügt werden, still und ohne Fehler.
// Behoben: `Zwischenablage.schreib` gibt jetzt `Promise<void>` zurück; `paste-service.ts` awaitet es
// VOR der Drift-Prüfung. Betrifft NUR das Schreiben vor dem Paste — `inZwischenablage` (Teil-Erfolg,
// kein nachfolgender Paste) bleibt bewusst synchron `void`/fire-and-forget.
// A2 (v0.7.3): `schreibUeberHelfer` gegen einen weggerissenen Helfer-Prozess (Task-Manager-Kill/Crash)
// gehärtet — ein stdin-'error'-Listener + write-Fehler-Callback + try/catch fangen EPIPE/
// ERR_STREAM_DESTROYED ab (sonst uncaughtException → App-Absturz); Degradation läuft über den
// bestehenden clipboard.writeText-Fallback, geloggt als `paste.helfer_stdin_fehl` (text-frei).
// Nicht headless verifizierbar (Electron clipboard + spawn) — Laufzeit-Abnahme auf Windows. Die neue
// `hwndVonHelferAsync`-Logik ist als eigene, exportierte Funktion mit injizierbarem spawnFn isoliert
// testbar (siehe test/paste-adapter-hwnd.test.ts).

import { app, clipboard } from 'electron'
import { spawn, spawnSync } from 'node:child_process'
import {
  createPasteService,
  type EinfügeStrategie,
  type StrategieErgebnis,
  type Zwischenablage
} from '@main/output/paste-service'
import { winPastePfad } from '@main/output/win-paste-path'
import type { Ausgabe, EinfügeKontext } from '@main/session/sitzung'
import { fokusDriftMeldung, type FehlerMeldung } from '@main/session/fehler-meldung'
import { NOOP_EREIGNISLOG, redigiereFehler, type EreignisLog, type LogFelder } from '@main/diagnostics/ereignis-log'

// macOS nutzt 1,5 s Delay vor dem Restore (restorePasteboardIfCurrent); RESEARCH §4.
const RESTORE_DELAY_MS = 1500

/** Fenster-/Hinweis-Operationen, die der Adapter nicht selbst besitzt (von index.ts gestellt). */
export interface AusgabeFenster {
  anzeigen(text: string): void
  zeigeEinstellungen(): void
  /** „In Zwischenablage kopiert — bitte mit Strg+V einfügen." */
  zeigeManuellenHinweis(): void
  /**
   * Einen fehlgeschlagenen Lauf melden (Notification; bei aktion 'einstellungen' mit Sprung).
   * `aktionen.erneut` (F1, W3-B): Callback für den Notification-Aktions-Button „Erneut versuchen".
   */
  melde(fehler: FehlerMeldung, aktionen?: { erneut?: () => void }): void
}

export interface PasteAusgabeDeps {
  fenster: AusgabeFenster
  /** Pfad zu win-paste.exe; Default via winPastePfad aus app. Injizierbar für Tests/Sonderfälle. */
  helferPfad?: string
  /** Injizierbar für Tests; Default: node:child_process spawn. */
  spawnFn?: typeof spawn
  /** Injizierbar für Tests; Default: node:child_process spawnSync (für die synchrone HWND-Abfrage, W3-A). */
  spawnSyncFn?: typeof spawnSync
  /** Verzögerung; injizierbar für Tests. */
  delayMs?: number
  /**
   * v0.7.2 Ereignislog (optional, Default NOOP): protokolliert pro Strategie-Versuch nur Name/Erfolg/
   * Exit-Code — NIEMALS den einzufügenden Text oder Zwischenablage-Inhalt.
   */
  log?: EreignisLog
}

function defaultHelferPfad(): string {
  return winPastePfad({
    istVerpackt: app.isPackaged,
    resourcesPath: process.resourcesPath,
    appPfad: app.getAppPath()
  })
}

/**
 * Ergebnis eines Strategie-Prozesses: `erfolg` (Exit-Code 0) plus der rohe `code` fürs Ereignislog.
 * `code` ist null bei Spawn-Fehler (ENOENT) oder wenn der Prozess ohne numerischen Code endete
 * (Signal-Kill) — dafür wird im Log kein `code`-Feld gesetzt.
 */
interface ProzessAusgang {
  erfolg: boolean
  code: number | null
}

/**
 * Prozess starten und auf Exit-Code 0 als Erfolg prüfen; Spawn-Fehler (ENOENT) → erfolg=false/code=null.
 * v0.7.2: gibt zusätzlich den Exit-Code zurück (dateilokal, fürs `paste.strategie`-Log). Diese Funktion
 * bleibt bewusst zweiwertig (erfolg/code) — erst `versucheMitLog` (unten) verfeinert den Exit-Code auf
 * das dreiwertige `StrategieErgebnis` (Befund 12: Exit-Code 2 der Helfer-Strategie = 'drift').
 */
function prozessErfolg(spawnFn: typeof spawn, command: string, args: string[]): Promise<ProzessAusgang> {
  return new Promise((resolve) => {
    try {
      const kind = spawnFn(command, args, { windowsHide: true })
      kind.once('error', () => resolve({ erfolg: false, code: null }))
      kind.once('exit', (code) => resolve({ erfolg: code === 0, code: code ?? null }))
    } catch {
      resolve({ erfolg: false, code: null })
    }
  })
}

/**
 * Aktuelles Vordergrundfenster-Handle über `win-paste.exe --hwnd` (W3-A). Der Helfer schreibt das HWND
 * als Dezimalzahl auf stdout. Synchron, weil die Weg-B-Prüfung genau zwischen „Zwischenablage gesetzt"
 * und „Paste ausgelöst" laufen muss (ein async-Fenster dazwischen wäre selbst driftanfällig). null =
 * Helfer fehlt/scheitert/liefert nichts Parsbares → der PasteService fällt aufs bisherige Einfügen zurück.
 * A1 (v0.6.0): BEWUSST die einzige verbleibende synchrone Helfer-Abfrage im Adapter — NICHT anfassen
 * (Drift-Schutz unmittelbar vor dem Paste, siehe `aktuellesFenster` unten).
 */
function hwndVonHelfer(spawnSyncFn: typeof spawnSync, command: string, args: string[]): number | null {
  try {
    const ergebnis = spawnSyncFn(command, args, { windowsHide: true, encoding: 'utf8', timeout: 2000 })
    if (ergebnis.status !== 0 || typeof ergebnis.stdout !== 'string') return null
    const roh = ergebnis.stdout.trim()
    if (!/^\d+$/.test(roh)) return null
    const hwnd = Number.parseInt(roh, 10)
    return Number.isSafeInteger(hwnd) && hwnd > 0 ? hwnd : null
  } catch {
    return null
  }
}

// Timeout für die HWND-Erfassung beim Auslösen (A1): identisch zum bisherigen spawnSync-timeout (2000ms).
const HWND_ASYNC_TIMEOUT_MS = 2000

/**
 * Async-Pendant zu `hwndVonHelfer` für den `Ausgabe.erfasseFenster`-Port (A1, v0.6.0): erfasst das
 * Vordergrundfenster beim AUSLÖSEN der Aufnahme, NICHT unmittelbar vor dem Paste (das bleibt
 * `hwndVonHelfer`, synchron). Läuft über `spawn` statt `spawnSync`, damit `sitzung.ts` beim Awaiten
 * den Event-Loop nicht blockiert. `spawnSync` kennt eine native `timeout`-Option — `spawn` nicht, daher
 * hier ein manueller Timer, der bei Ablauf den Kind-Prozess killt und mit `null` auflöst; der Timer wird
 * in JEDEM Terminalpfad (exit/error/timeout) gecleart, um kein Leck zu hinterlassen. Eigenständig
 * exportiert (statt in der Closure von `createPasteAusgabe` versteckt), damit sie isoliert mit einem
 * Fake-`spawn` testbar ist — analog zu `prozessErfolg`.
 */
export function hwndVonHelferAsync(
  spawnFn: typeof spawn,
  command: string,
  args: string[],
  timeoutMs = HWND_ASYNC_TIMEOUT_MS
): Promise<number | null> {
  return new Promise((resolve) => {
    try {
      const kind = spawnFn(command, args, { windowsHide: true })
      let stdout = ''
      let erledigt = false
      const timer = setTimeout(() => {
        if (erledigt) return
        erledigt = true
        kind.kill()
        resolve(null)
      }, timeoutMs)
      kind.stdout?.on('data', (chunk) => {
        stdout += chunk
      })
      kind.once('error', () => {
        if (erledigt) return
        erledigt = true
        clearTimeout(timer)
        resolve(null)
      })
      kind.once('exit', (code) => {
        if (erledigt) return
        erledigt = true
        clearTimeout(timer)
        if (code !== 0) return resolve(null)
        const roh = stdout.trim()
        if (!/^\d+$/.test(roh)) return resolve(null)
        const hwnd = Number.parseInt(roh, 10)
        resolve(Number.isSafeInteger(hwnd) && hwnd > 0 ? hwnd : null)
      })
    } catch {
      resolve(null)
    }
  })
}

export function createPasteAusgabe(deps: PasteAusgabeDeps): Ausgabe {
  const spawnFn = deps.spawnFn ?? spawn
  const delayMs = deps.delayMs ?? RESTORE_DELAY_MS

  const spawnSyncFn = deps.spawnSyncFn ?? spawnSync
  const helferPfad = deps.helferPfad ?? defaultHelferPfad()
  const log = deps.log ?? NOOP_EREIGNISLOG

  // Führt eine Strategie aus und loggt ihren Ausgang (Name/Erfolg/Exit-Code) — Erfolg als info,
  // Fehlschlag/Drift als warnung. NIE der Text, nur Meta: `code` wird nur gesetzt, wenn ein
  // numerischer Exit-Code vorliegt.
  // Befund 12 (Fehlerjagd): früher mappte diese Funktion auf `boolean` — Exit-Code 2 der HELFER-
  // Strategie (natives Weg-B-Drift-Gate, `--paste <hwnd>` in win-paste.c) landete damit im selben
  // `erfolg:false`-Zweig wie jeder andere Fehlschlag, und die Strategie-Schleife in paste-service.ts
  // probierte als Nächstes den PowerShell-Fallback — der KEIN Drift-Gate kennt und blind ins
  // (mittlerweile fremde) Vordergrundfenster tippt. Jetzt dreiwertig: nur die 'helfer'-Strategie kennt
  // die Exit-Code-2-Bedeutung (PowerShell hat kein eigenes Drift-Protokoll), und der Aufrufer
  // (paste-service.ts) bricht bei 'drift' sofort ab statt die nächste Strategie zu versuchen.
  const versucheMitLog = async (
    name: 'helfer' | 'powershell',
    command: string,
    args: string[]
  ): Promise<StrategieErgebnis> => {
    const ausgang = await prozessErfolg(spawnFn, command, args)
    const felder: LogFelder = { name, erfolg: ausgang.erfolg }
    if (typeof ausgang.code === 'number') felder.code = ausgang.code
    if (name === 'helfer' && ausgang.code === 2) {
      log.warnung('paste.strategie', felder)
      return 'drift'
    }
    if (ausgang.erfolg) log.info('paste.strategie', felder)
    else log.warnung('paste.strategie', felder)
    return ausgang.erfolg ? 'erfolg' : 'fehlschlag'
  }

  // MAL-2: Text bevorzugt über den Helfer (`--set-clip`) in die Zwischenablage schreiben — der setzt
  // ExcludeClipboardContentFromMonitorProcessing + CanIncludeInClipboardHistory=0, damit Diktate NICHT
  // in die Zwischenablage-Historie / Cloud-Sync gelangen. Fällt der Helfer aus (fehlt/scheitert/leerer
  // Text → status != 0), greift der Electron-clipboard-Fallback. `lies` bleibt Electron (nur für den
  // marker-geschützten Restore-Vergleich; kein Sensitivitäts-Belang).
  // A1 (v0.6.0): spawn+Promise statt spawnSync. `input` gibt es bei spawn nicht als Option — stdin wird
  // manuell beschrieben (write+end). Timeout (2000ms, wie bisher) manuell nachgebaut (kein natives Flag).
  function schreibUeberHelfer(text: string): Promise<boolean> {
    return new Promise((resolve) => {
      try {
        const kind = spawnFn(helferPfad, ['--set-clip'], { windowsHide: true })
        let erledigt = false
        const timer = setTimeout(() => {
          if (erledigt) return
          erledigt = true
          kind.kill()
          resolve(false)
        }, 2000)
        kind.once('error', () => {
          if (erledigt) return
          erledigt = true
          clearTimeout(timer)
          resolve(false)
        })
        kind.once('exit', (code) => {
          if (erledigt) return
          erledigt = true
          clearTimeout(timer)
          resolve(code === 0)
        })
        // A2 (v0.7.3): EPIPE-Härtung. Wird der Helfer-Prozess weggerissen (Task-Manager-Kill, Crash),
        // während wir noch in stdin schreiben, feuert stdin ein 'error'-Ereignis (EPIPE/
        // ERR_STREAM_DESTROYED). OHNE eigenen Listener eskaliert Node das zu einer uncaughtException →
        // App-Absturz. Hier abfangen: gleiche erledigt-Guard/clearTimeout-Mechanik wie exit/error, dann
        // sauber als Fehlschlag auflösen (der Aufrufer fällt auf clipboard.writeText zurück). Nur der
        // Umstand wird geloggt, NIE der Text (Redaction).
        kind.stdin?.on('error', () => {
          if (erledigt) return
          erledigt = true
          clearTimeout(timer)
          log.warnung('paste.helfer_stdin_fehl')
          resolve(false)
        })
        // write kann synchron werfen (ERR_STREAM_DESTROYED, wenn stdin schon zerstört ist) ODER den
        // Fehler asynchron an den Callback reichen — beides führt in den identischen Degradations-Pfad
        // wie das 'error'-Ereignis oben (idempotent über die erledigt-Guard). try/catch fängt den
        // synchronen Wurf; der Callback fängt die asynchrone Variante.
        try {
          kind.stdin?.write(text, (fehler) => {
            if (!fehler) return
            if (erledigt) return
            erledigt = true
            clearTimeout(timer)
            log.warnung('paste.helfer_stdin_fehl')
            resolve(false)
          })
          kind.stdin?.end()
        } catch {
          if (erledigt) return
          erledigt = true
          clearTimeout(timer)
          log.warnung('paste.helfer_stdin_fehl')
          resolve(false)
        }
      } catch {
        resolve(false)
      }
    })
  }
  const zwischenablage: Zwischenablage = {
    lies: () => clipboard.readText(),
    // F2 (Review R2, v0.6.0): awaitable statt fire-and-forget. Der PasteService wartet jetzt auf den
    // Abschluss (Erfolg ODER Fallback), bevor die Drift-Prüfung/Paste-Strategien laufen — vorher
    // (spawnSync) war das implizit garantiert, seit A1 (spawn+Promise) nicht mehr. Fehler crashen
    // weiterhin nicht: catch → Electron-clipboard-Fallback, die Promise löst danach normal auf.
    schreib: async (text) => {
      // v0.7.2 debug: das Setzen der Zwischenablage ist ein Helfer-Spawn (Dauer-Verdächtiger). Nur die
      // Dauer in ms wird geloggt (nach dem Setzen), NIE der Zwischenablage-Inhalt.
      const beginn = Date.now()
      try {
        const erfolg = await schreibUeberHelfer(text)
        if (!erfolg) {
          // MAL-2-Härtung des Helfers (ExcludeClipboardContentFromMonitorProcessing) griff nicht →
          // Electron-Fallback. Nur der Umstand wird geloggt, NIE der Text.
          log.warnung('paste.helfer_clip_fallback')
          clipboard.writeText(text)
        }
      } catch {
        log.warnung('paste.helfer_clip_fallback')
        clipboard.writeText(text)
      }
      log.debug('paste.clip_gesetzt', { dauerMs: Date.now() - beginn })
    }
  }

  // Weg B (W3-A): das erfasste Paste-Ziel des LAUFENDEN einfügen-Aufrufs. Die Helfer-Strategie liest es
  // pro Versuch, um den nativen Drift-Gate `--paste <hwnd>` zu nutzen (defense-in-depth zur TS-Prüfung).
  let aktuellesPasteZielHwnd: number | null = null

  const strategien: EinfügeStrategie[] = [
    {
      name: 'helfer',
      // Mit erfasstem Ziel den nativen Drift-Gate nutzen (`--paste <hwnd>` fügt nur bei passendem
      // Vordergrund ein); sonst der bisherige unbedingte Paste (`--paste`/keine Args).
      versuch: () =>
        versucheMitLog(
          'helfer',
          helferPfad,
          aktuellesPasteZielHwnd !== null ? ['--paste', String(aktuellesPasteZielHwnd)] : ['--paste']
        )
    },
    {
      name: 'powershell',
      // Abhängigkeitsfreier Fallback (ADR-0003): SendKeys('^v') ins Vordergrundfenster.
      versuch: () =>
        versucheMitLog('powershell', 'powershell', [
          '-NoProfile',
          '-Command',
          "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('^v')"
        ])
    }
  ]

  const pasteService = createPasteService({
    zwischenablage,
    strategien,
    zeigeManuellenHinweis: () => deps.fenster.zeigeManuellenHinweis(),
    // Weg B: aktuellen Vordergrund synchron vom Helfer holen; null = unbekannt → kein Drift-Urteil.
    // A1 (v0.6.0): BEWUSST SYNCHRON, NICHT auf hwndVonHelferAsync umstellen — dieser Aufruf sitzt genau
    // zwischen „Zwischenablage gesetzt" und „Paste ausgelöst" (Drift-Gate); ein async-Fenster hier wäre
    // selbst driftanfällig. Siehe Kommentar bei hwndVonHelfer oben.
    aktuellesFenster: () => hwndVonHelfer(spawnSyncFn, helferPfad, ['--hwnd']),
    // Drift erkannt: Text liegt schon in der Zwischenablage, dem Nutzer den Strg+V-Hinweis melden.
    zeigeDriftHinweis: () => deps.fenster.melde(fokusDriftMeldung())
  })

  return {
    einfügen(text, kontext?: EinfügeKontext) {
      // v0.7.2 debug: ein Einfüge-Vorgang beginnt. Nur die LÄNGE (`zeichen`) des Endtexts, NIE der Text.
      log.debug('paste.beginn', { zeichen: text.length })
      // Das native Drift-Gate nur bei aktivem Feature + erfasstem Ziel setzen; sonst unbedingter Paste.
      aktuellesPasteZielHwnd =
        kontext && kontext.fokusRueckkehr ? kontext.erfasstesHwnd : null
      // Fire-and-forget: der Port ist synchron `void`, das Async lebt hier.
      void (async () => {
        const ergebnis = await pasteService.einfügen(text, kontext)
        if (ergebnis.erfolg) {
          // Verzögert + marker-geschützt (Guard steckt im Thunk): erst zurücksetzen, wenn das Ziel
          // unser Strg+V wirklich verarbeitet hat — sonst Race (RESEARCH §4).
          setTimeout(() => ergebnis.wiederherstellen(), delayMs)
        }
        // Bei Drift/Total-Fehlschlag bleibt der Text bewusst in der Zwischenablage (Hinweis kam schon).
      })().catch((err) => {
        log.fehler('paste.einfuegen_fehl', redigiereFehler(err))
        console.error('Einfügen fehlgeschlagen (ignoriert):', err)
      })
    },
    anzeigen: (text) => deps.fenster.anzeigen(text),
    zeigeEinstellungen: () => deps.fenster.zeigeEinstellungen(),
    melde: (fehler, aktionen) => deps.fenster.melde(fehler, aktionen),
    // Teil-Erfolg: Rohtext in die Zwischenablage legen und liegen lassen (kein Restore — der Nutzer fügt
    // selbst mit Strg+V ein). Bewusst KEIN Auto-Paste danach — der `Ausgabe`-Port `inZwischenablage`
    // bleibt darum synchron `void`/fire-and-forget (F2): anders als bei `einfügen` folgt hier keine
    // Drift-Prüfung/Paste-Strategie, die auf den Abschluss angewiesen wäre. Fehler crashen nicht
    // (schreib() selbst fängt intern ab); trotzdem sichtbar loggen statt still zu verschlucken.
    inZwischenablage: (text) => {
      void zwischenablage.schreib(text).catch((err) => {
        log.fehler('paste.zwischenablage_fehl', redigiereFehler(err))
        console.error('inZwischenablage fehlgeschlagen (ignoriert):', err)
      })
    },
    // Weg B (W3-A): Vordergrundfenster beim Auslösen erfassen (natives `--hwnd`). null = nicht erfassbar.
    // A1 (v0.6.0): async (spawn statt spawnSync) — sitzung.ts awaitet das bereits (starteWorkflow ist
    // async), blockiert den Event-Loop beim Auslösen also nicht mehr.
    // v0.7.2 debug: die HWND-Erfassung ist ein Helfer-Spawn (Dauer-Verdächtiger). Nur Zahl/Boolean:
    // Dauer in ms + ob ein Fenster erfasst wurde — NIE ein Text.
    async erfasseFenster() {
      const beginn = Date.now()
      const hwnd = await hwndVonHelferAsync(spawnFn, helferPfad, ['--hwnd'])
      log.debug('paste.hwnd', { dauerMs: Date.now() - beginn, gefunden: hwnd !== null })
      return hwnd
    }
  }
}
