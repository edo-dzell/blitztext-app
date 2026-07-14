// Ausgabe-Adapter (#04/#11, HITL/Windows): implementiert den Ausgabe-Port der Sitzung.
// - einfügen: Zwischenablage setzen → paste-service (win-paste.exe via winPastePfad → PowerShell-
//   SendKeys → nur-Zwischenablage+Hinweis) → bei Erfolg VERZÖGERTES, marker-geschütztes Restore
//   (RESEARCH §4: kein Sofort-Restore wegen Race; 1,5 s wie macOS). Port bleibt synchron `void`
//   (RESEARCH §4 Naht-Mismatch) — der Adapter besitzt das Async.
// - anzeigen / zeigeEinstellungen: an die Fenster-Schicht (index.ts) delegiert.
// Nicht headless verifizierbar (Electron clipboard + spawn) — Laufzeit-Abnahme auf Windows.

import { app, clipboard } from 'electron'
import { spawn, spawnSync } from 'node:child_process'
import {
  createPasteService,
  type EinfügeStrategie,
  type Zwischenablage
} from '@main/output/paste-service'
import { winPastePfad } from '@main/output/win-paste-path'
import type { Ausgabe, EinfügeKontext } from '@main/session/sitzung'
import { fokusDriftMeldung, type FehlerMeldung } from '@main/session/fehler-meldung'

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
}

function defaultHelferPfad(): string {
  return winPastePfad({
    istVerpackt: app.isPackaged,
    resourcesPath: process.resourcesPath,
    appPfad: app.getAppPath()
  })
}

/** Prozess starten und auf Exit-Code 0 als Erfolg prüfen; Spawn-Fehler (ENOENT) → false. */
function prozessErfolg(spawnFn: typeof spawn, command: string, args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const kind = spawnFn(command, args, { windowsHide: true })
      kind.once('error', () => resolve(false))
      kind.once('exit', (code) => resolve(code === 0))
    } catch {
      resolve(false)
    }
  })
}

/**
 * Aktuelles Vordergrundfenster-Handle über `win-paste.exe --hwnd` (W3-A). Der Helfer schreibt das HWND
 * als Dezimalzahl auf stdout. Synchron, weil die Weg-B-Prüfung genau zwischen „Zwischenablage gesetzt"
 * und „Paste ausgelöst" laufen muss (ein async-Fenster dazwischen wäre selbst driftanfällig). null =
 * Helfer fehlt/scheitert/liefert nichts Parsbares → der PasteService fällt aufs bisherige Einfügen zurück.
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

export function createPasteAusgabe(deps: PasteAusgabeDeps): Ausgabe {
  const spawnFn = deps.spawnFn ?? spawn
  const delayMs = deps.delayMs ?? RESTORE_DELAY_MS

  const spawnSyncFn = deps.spawnSyncFn ?? spawnSync
  const helferPfad = deps.helferPfad ?? defaultHelferPfad()

  // MAL-2: Text bevorzugt über den Helfer (`--set-clip`) in die Zwischenablage schreiben — der setzt
  // ExcludeClipboardContentFromMonitorProcessing + CanIncludeInClipboardHistory=0, damit Diktate NICHT
  // in die Zwischenablage-Historie / Cloud-Sync gelangen. Fällt der Helfer aus (fehlt/scheitert/leerer
  // Text → status != 0), greift der Electron-clipboard-Fallback. `lies` bleibt Electron (nur für den
  // marker-geschützten Restore-Vergleich; kein Sensitivitäts-Belang).
  function schreibUeberHelfer(text: string): boolean {
    try {
      const r = spawnSyncFn(helferPfad, ['--set-clip'], {
        input: text,
        windowsHide: true,
        timeout: 2000
      })
      return r.status === 0
    } catch {
      return false
    }
  }
  const zwischenablage: Zwischenablage = {
    lies: () => clipboard.readText(),
    schreib: (text) => {
      if (!schreibUeberHelfer(text)) clipboard.writeText(text)
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
        prozessErfolg(
          spawnFn,
          helferPfad,
          aktuellesPasteZielHwnd !== null ? ['--paste', String(aktuellesPasteZielHwnd)] : ['--paste']
        )
    },
    {
      name: 'powershell',
      // Abhängigkeitsfreier Fallback (ADR-0003): SendKeys('^v') ins Vordergrundfenster.
      versuch: () =>
        prozessErfolg(spawnFn, 'powershell', [
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
    aktuellesFenster: () => hwndVonHelfer(spawnSyncFn, helferPfad, ['--hwnd']),
    // Drift erkannt: Text liegt schon in der Zwischenablage, dem Nutzer den Strg+V-Hinweis melden.
    zeigeDriftHinweis: () => deps.fenster.melde(fokusDriftMeldung())
  })

  return {
    einfügen(text, kontext?: EinfügeKontext) {
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
      })().catch((err) => console.error('Einfügen fehlgeschlagen (ignoriert):', err))
    },
    anzeigen: (text) => deps.fenster.anzeigen(text),
    zeigeEinstellungen: () => deps.fenster.zeigeEinstellungen(),
    melde: (fehler, aktionen) => deps.fenster.melde(fehler, aktionen),
    // Teil-Erfolg: Rohtext in die Zwischenablage legen und liegen lassen (kein Restore — der Nutzer fügt
    // selbst mit Strg+V ein). Bewusst KEIN Auto-Paste.
    inZwischenablage: (text) => zwischenablage.schreib(text),
    // Weg B (W3-A): Vordergrundfenster beim Auslösen erfassen (natives `--hwnd`). null = nicht erfassbar.
    erfasseFenster: () => hwndVonHelfer(spawnSyncFn, helferPfad, ['--hwnd'])
  }
}
