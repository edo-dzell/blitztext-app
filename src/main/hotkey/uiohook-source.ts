// uiohook-Ereignisquelle (#02/#11, HITL/Windows): globaler Tastatur-Hook → KeyEvents in die
// Composition (`verarbeiteTaste`). Dünne Hülle um uiohook-napi + die reine Keycode-Abbildung
// (uiohook-keymap). Key-Repeat muss hier NICHT entprellt werden — der Matcher ignoriert Repeats
// bereits (RESEARCH §3). Ungemappte Keycodes werden verworfen.
// Caveats (RESEARCH §3): Sticky Keys können ein Up verschlucken (→ Toggle-Modus als Ausweg),
// Vollbild-/elevated Apps können Hooks schlucken. Laufzeit-Abnahme auf Windows.

import { uIOhook, type UiohookKeyboardEvent } from 'uiohook-napi'
import { keycodeZuName } from '@main/hotkey/uiohook-keymap'
import type { KeyEvent } from '@main/hotkey/matcher'
import { NOOP_PERF, type PerfInstrumentierung } from '@main/diagnostics/perf-instrumentierung'
import { NOOP_EREIGNISLOG, redigiereFehler, type EreignisLog } from '@main/diagnostics/ereignis-log'

/** Minimaler Hook-Vertrag (Teil von uIOhook) → injizierbar für Tests ohne nativen Hook. */
export interface UiohookQuelle {
  on(event: 'keydown' | 'keyup', listener: (e: UiohookKeyboardEvent) => void): unknown
  start(): void
  stop(): void
}

export interface UiohookQuelleDeps {
  verarbeiteTaste(event: KeyEvent): void
  /** Default: das uIOhook-Singleton; in Tests ein Fake. */
  hook?: UiohookQuelle
  /**
   * W3-ε (3.2): meldet, ob `hook.start()` erfolgreich war. `start()` schluckt einen Fehler (Header),
   * ohne ihn nach außen zu geben — dieser Callback macht den Erfolg/Misserfolg für den Health-Check
   * „Hotkey-Erkennung" sichtbar, OHNE die Start-Logik umzubauen (rein additiv).
   */
  onStatus?(aktiv: boolean): void
  /**
   * R5 (Perf, opt-in): Latenz-Zeitstempel keydown → Dispatch-Ende. Default `NOOP_PERF` (de facto
   * Null-Overhead — ein no-op-Funktionsaufruf pro Event, keine Allokation/kein Timer). Nur bei
   * `BLITZTEXT_PERF=1` verdrahtet die Composition eine echte `createPerfInstrumentierung()`.
   */
  perf?: PerfInstrumentierung
  /**
   * v0.7.2 Ereignislog (optional, Default NOOP): nur der einmalige Hook-Start/-Fehlschlag wird
   * geloggt. NIEMALS im keydown/keyup-Hot-Path — dort würde jede Zeile pro Tastenanschlag Latenz
   * kosten (der Grund, warum uiohook hier bewusst stumm bleibt).
   */
  log?: EreignisLog
}

/** Startet den Hook und gibt einen Stopp-Thunk zurück (für app.will-quit). */
export function starteUiohookQuelle(deps: UiohookQuelleDeps): () => void {
  const hook = deps.hook ?? uIOhook
  const perf = deps.perf ?? NOOP_PERF
  const log = deps.log ?? NOOP_EREIGNISLOG
  const handler = (type: 'down' | 'up') => (e: UiohookKeyboardEvent): void => {
    const marker = perf.erfasseStart()
    const key = keycodeZuName(e.keycode)
    // Modifier-Maske mitgeben: libuiohook resynct sie nach UIPI-Blockaden (erhöhte Fenster,
    // Secure Desktop) aus GetAsyncKeyState — der Matcher räumt damit verlorene Keyups auf.
    if (key) {
      deps.verarbeiteTaste({
        type,
        key,
        modifiers: { ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, meta: e.metaKey }
      })
    }
    perf.erfasseEnde(marker)
  }
  hook.on('keydown', handler('down'))
  hook.on('keyup', handler('up'))
  // start() in try/catch: ein Fehler beim Laden des nativen Hooks darf den App-Start nicht killen
  // (uiohook-napi-Crash ist macOS-spezifisch, Windows unkritisch — RESEARCH §5).
  try {
    hook.start()
    log.info('hotkey.hook_start')
    deps.onStatus?.(true)
  } catch (err) {
    console.error('uiohook konnte nicht gestartet werden:', err)
    log.fehler('hotkey.hook_fehl', redigiereFehler(err))
    deps.onStatus?.(false)
    return () => {}
  }
  return () => {
    try {
      hook.stop()
    } catch {
      // bereits gestoppt / nie gestartet — ignorieren
    }
  }
}
