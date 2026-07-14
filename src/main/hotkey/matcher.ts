// Reine Zustandsmaschine: aus synthetischen Tasten-Down/Up + Aufnahmemodus + Chord → start/stop/cancel.
// Treue Portierung von HotkeyService.swift, an uiohooks diskrete Down/Up-Events angepasst (statt
// macOS' flagsChanged). Keine uiohook-Abhängigkeit — die Ereignisquelle liegt hinter einem Adapter.
//
// Selbstheilung: Win+L/UAC/erhöhte Fenster verschlucken Keyups (UIPI, RESEARCH §3) — ohne Korrektur
// bliebe der Modifier für immer „gedrückt" und eine einzelne Resttaste startete die Aufnahme. Die
// Quelle liefert deshalb pro Event die kollabierte Modifier-Maske (libuiohook resynct sie nach
// UIPI-Blockaden aus GetAsyncKeyState); meldet sie eine Familie als losgelassen, fliegen deren
// Tasten aus dem Tracking.

export type RecordingMode = 'hold' | 'toggle'
export type HotkeyAction = 'start' | 'stop' | 'cancel'

/** Kollabierte Modifier-Maske der Quelle (links/rechts vereint, uiohook ctrlKey & Co.). */
export interface ModifierLage {
  ctrl: boolean
  alt: boolean
  shift: boolean
  meta: boolean
}

export interface KeyEvent {
  type: 'down' | 'up'
  key: string
  /** Falls vorhanden: Ground Truth zum Aufräumen verlorener Keyups. */
  modifiers?: ModifierLage
}

export interface HotkeyMatcherConfig {
  chord: string[]
  mode: RecordingMode
}

export interface HotkeyMatcher {
  handle(event: KeyEvent): HotkeyAction | null
  /** Vergisst alle getrackten Tasten und den Aktiv-Zustand (z. B. nach Sperre/Standby). */
  reset(): void
}

const MODIFIER_FAMILIE: Record<string, keyof ModifierLage> = {
  ControlLeft: 'ctrl',
  ControlRight: 'ctrl',
  AltLeft: 'alt',
  AltRight: 'alt',
  ShiftLeft: 'shift',
  ShiftRight: 'shift',
  MetaLeft: 'meta',
  MetaRight: 'meta'
}

export function createHotkeyMatcher(config: HotkeyMatcherConfig): HotkeyMatcher {
  const chord = new Set(config.chord)
  const pressed = new Set<string>()
  let active = false

  const chordComplete = (): boolean => {
    for (const key of chord) {
      if (!pressed.has(key)) return false
    }
    return true
  }

  // Entfernt getrackte Modifier, die laut Maske gar nicht (mehr) gedrückt sind, und heilt
  // im selben Zug stale Nicht-Modifier-Tasten. Für Modifier ist die uiohook-Maske Ground Truth;
  // Nicht-Modifier (z. B. KeyJ in [ControlRight, KeyJ]) haben KEINE Maske — ihr verschlucktes
  // Keyup (UIPI/Win+L, RESEARCH §3) bliebe sonst für immer getrackt (Phantom-Zustand).
  // Das verlässliche Signal „wir waren in einem UIPI-/Lock-Fenster" ist, dass die Maske einen
  // getrackten Modifier als losgelassen entlarvt. Genau dann — und nur dann — räumen wir auch
  // alle gedrückten Nicht-Modifier-Tasten, außer der aktuell empfangenen (die ist real da).
  // So bricht normales schnelles Tippen bei konsistenter Maske nichts.
  const raeumeStaleTasten = (modifiers: ModifierLage, aktuelleTaste: string): void => {
    let staleModifierGeraeumt = false
    for (const key of pressed) {
      const familie = MODIFIER_FAMILIE[key]
      if (familie && !modifiers[familie]) {
        pressed.delete(key)
        staleModifierGeraeumt = true
      }
    }
    if (!staleModifierGeraeumt) return
    for (const key of pressed) {
      if (!MODIFIER_FAMILIE[key] && key !== aktuelleTaste) pressed.delete(key)
    }
  }

  return {
    reset() {
      pressed.clear()
      active = false
    },

    handle(event) {
      // Escape ist der feste Abbruch-Key (HotkeyService.handleEscape, keyCode 53).
      if (event.key === 'Escape') {
        if (event.type === 'down' && active) {
          active = false
          return 'cancel'
        }
        return null
      }

      // wasComplete VOR dem Aufräumen messen: nur so wird eine verwaiste aktive Aufnahme
      // (Keyups während der Sperre verloren) als fallende Flanke erkannt und beendet.
      const wasComplete = chordComplete()
      if (event.modifiers) raeumeStaleTasten(event.modifiers, event.key)

      const istChordTaste = chord.has(event.key)
      if (istChordTaste) {
        if (event.type === 'down') pressed.add(event.key)
        else pressed.delete(event.key)
      }
      const isComplete = chordComplete()

      const risingEdge = !wasComplete && isComplete
      const fallingEdge = wasComplete && !isComplete

      if (config.mode === 'hold') {
        if (risingEdge && !active) {
          active = true
          return 'start'
        }
        if (fallingEdge && active) {
          active = false
          // Kam die Flanke vom echten Loslassen einer Chord-Taste → stop (transkribieren).
          // Entstand sie nur durchs Aufräumen, ist der Loslass-Zeitpunkt unbekannt → cancel
          // (kein blindes Transkribieren einer verwaisten Aufnahme).
          const echtesLoslassen = event.type === 'up' && istChordTaste
          return echtesLoslassen ? 'stop' : 'cancel'
        }
        return null
      }

      // toggle: nur die steigende Flanke schaltet um, Loslassen tut nichts
      if (risingEdge) {
        active = !active
        return active ? 'start' : 'stop'
      }
      return null
    }
  }
}
