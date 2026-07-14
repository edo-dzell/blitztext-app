import { describe, it, expect } from 'vitest'
import { createHotkeyMatcher, type ModifierLage } from '@main/hotkey/matcher'

const maske = (teile: Partial<ModifierLage> = {}): ModifierLage => ({
  ctrl: false,
  alt: false,
  shift: false,
  meta: false,
  ...teile
})

// v0.4.1 heilte nur verlorene Modifier-Keyups (die uiohook-Maske ist ihre Ground Truth).
// Eine Nicht-Modifier-Chord-Taste (z. B. KeyJ in [ControlRight, KeyJ]) hat KEINE Maske: ihr
// verschlucktes Keyup (UIPI/Win+L, RESEARCH §3) bliebe für immer als „gedrückt" getrackt und
// verfälschte spätere Chord-Auswertungen (Phantom-Zustand). Wenn die Modifier-Reconciliation
// stale Modifier räumt — das verlässliche Signal „wir waren in einem UIPI-/Lock-Fenster" —,
// müssen im selben Zug auch stale Nicht-Modifier-Tasten fliegen, die nicht im aktuellen Event stecken.
describe('Selbstheilung: verlorene Keyups bei Nicht-Modifier-Chord-Tasten', () => {
  it('Win+L-Szenario: verschlucktes KeyJ-Keyup wird bei der Modifier-Reconciliation geräumt (verwaiste Aufnahme → cancel)', () => {
    const m = createHotkeyMatcher({ chord: ['ControlRight', 'KeyJ'], mode: 'hold' })

    m.handle({ type: 'down', key: 'ControlRight', modifiers: maske({ ctrl: true }) })
    expect(
      m.handle({ type: 'down', key: 'KeyJ', modifiers: maske({ ctrl: true }) })
    ).toBe('start')

    // Win+L: beide Keyups gehen auf dem Secure Desktop verloren (auch das von KeyJ).
    // Ein späteres Fremd-Event meldet ctrl als losgelassen → Modifier-Reconciliation räumt
    // ControlRight UND das stale KeyJ. Verwaiste Aufnahme → cancel (Loslass-Zeitpunkt unbekannt).
    expect(m.handle({ type: 'down', key: 'KeyA', modifiers: maske() })).toBe('cancel')
  })

  it('nach der Heilung startet eine einzelne Rest-Chord-Taste NICHT (Phantom-Zustand ist weg)', () => {
    const m = createHotkeyMatcher({ chord: ['ControlRight', 'KeyJ'], mode: 'hold' })

    m.handle({ type: 'down', key: 'ControlRight', modifiers: maske({ ctrl: true }) })
    m.handle({ type: 'down', key: 'KeyJ', modifiers: maske({ ctrl: true }) })
    // Win+L schluckt beide Keyups; Reconciliation räumt beide Chord-Tasten:
    m.handle({ type: 'down', key: 'KeyA', modifiers: maske() })

    // Ohne Heilung bliebe KeyJ „gedrückt": ControlRight allein würde später den Chord
    // komplettieren und fälschlich starten. Mit Heilung passiert nichts.
    expect(
      m.handle({ type: 'down', key: 'ControlRight', modifiers: maske({ ctrl: true }) })
    ).toBeNull()

    // Der echte Chord funktioniert danach wieder normal:
    expect(m.handle({ type: 'down', key: 'KeyJ', modifiers: maske({ ctrl: true }) })).toBe('start')
  })

  it('die reconciling Nicht-Modifier-Taste selbst wird NICHT geräumt (sie ist real gedrückt)', () => {
    // Chord aus zwei Nicht-Modifier-Tasten + einem Modifier: KeyB soll überleben, wenn ES das
    // Event ist, das ctrl als stale meldet.
    const m = createHotkeyMatcher({ chord: ['ControlLeft', 'KeyB'], mode: 'toggle' })

    m.handle({ type: 'down', key: 'ControlLeft', modifiers: maske({ ctrl: true }) })
    // ctrl-Keyup verschluckt; jetzt kommt KeyB down und die Maske meldet ctrl=false.
    // ControlLeft wird geräumt, aber KeyB (= event.key) darf NICHT mitgeräumt werden.
    m.handle({ type: 'down', key: 'KeyB', modifiers: maske() })
    expect(m.handle({ type: 'up', key: 'KeyB', modifiers: maske() })).toBeNull()
    // KeyB war real gedrückt und ist jetzt sauber wieder los — kein Phantom, kein Start.
    expect(m.handle({ type: 'down', key: 'KeyA', modifiers: maske() })).toBeNull()
  })

  it('echtes Loslassen einer Nicht-Modifier-Chord-Taste bleibt stop, auch wenn dabei ein stale Modifier fällt', () => {
    const m = createHotkeyMatcher({ chord: ['ControlRight', 'KeyJ'], mode: 'hold' })
    m.handle({ type: 'down', key: 'ControlRight', modifiers: maske({ ctrl: true }) })
    expect(
      m.handle({ type: 'down', key: 'KeyJ', modifiers: maske({ ctrl: true }) })
    ).toBe('start')

    // ControlRight-Up ging verloren; der Nutzer lässt KeyJ ECHT los → normales stop.
    expect(m.handle({ type: 'up', key: 'KeyJ', modifiers: maske() })).toBe('stop')
  })
})

// NEGATIV: normales schnelles Tippen während gehaltenem Chord darf keine Räumung auslösen.
describe('Kein Fehlräumen: konsistente Maske ⇒ Nicht-Modifier bleiben gedrückt', () => {
  it('gehaltener Chord + Zusatztaste ohne Masken-Diskrepanz räumt KeyJ NICHT', () => {
    const m = createHotkeyMatcher({ chord: ['ControlRight', 'KeyJ'], mode: 'hold' })
    m.handle({ type: 'down', key: 'ControlRight', modifiers: maske({ ctrl: true }) })
    expect(
      m.handle({ type: 'down', key: 'KeyJ', modifiers: maske({ ctrl: true }) })
    ).toBe('start')

    // Schnelles Tippen: eine fremde Taste mit KONSISTENTER Maske (ctrl weiter gedrückt).
    // Kein Modifier fällt → keine Nicht-Modifier-Räumung → KeyJ bleibt, Aufnahme läuft weiter.
    expect(m.handle({ type: 'down', key: 'KeyM', modifiers: maske({ ctrl: true }) })).toBeNull()
    expect(m.handle({ type: 'up', key: 'KeyM', modifiers: maske({ ctrl: true }) })).toBeNull()

    // Erst das echte Loslassen von KeyJ beendet die Aufnahme (KeyJ war nie fälschlich geräumt).
    expect(m.handle({ type: 'up', key: 'KeyJ', modifiers: maske({ ctrl: true }) })).toBe('stop')
  })

  it('Auto-Repeat der Nicht-Modifier-Chord-Taste bei konsistenter Maske ändert nichts', () => {
    const m = createHotkeyMatcher({ chord: ['ControlRight', 'KeyJ'], mode: 'hold' })
    m.handle({ type: 'down', key: 'ControlRight', modifiers: maske({ ctrl: true }) })
    expect(
      m.handle({ type: 'down', key: 'KeyJ', modifiers: maske({ ctrl: true }) })
    ).toBe('start')
    // uiohook-Auto-Repeat von KeyJ, Maske konsistent → kein zweiter start, kein Räumen.
    expect(m.handle({ type: 'down', key: 'KeyJ', modifiers: maske({ ctrl: true }) })).toBeNull()
    expect(m.handle({ type: 'up', key: 'KeyJ', modifiers: maske({ ctrl: true }) })).toBe('stop')
  })

  it('Ereignis ohne Maske heilt keine Nicht-Modifier-Taste (kein Ground-Truth-Signal)', () => {
    const m = createHotkeyMatcher({ chord: ['ControlRight', 'KeyJ'], mode: 'hold' })
    m.handle({ type: 'down', key: 'ControlRight' })
    m.handle({ type: 'down', key: 'KeyJ' })
    // Ohne Maske gibt es keine Reconciliation → KeyJ bleibt getrackt, Verhalten wie bisher.
    expect(m.handle({ type: 'down', key: 'KeyA' })).toBeNull()
  })
})

// reset()/setzeZurueck()-Pfad (powerMonitor): muss ALLE Tasten inkl. Nicht-Modifier leeren.
describe('reset() leert auch Nicht-Modifier-Tasten (powerMonitor-Pfad)', () => {
  it('nach reset() startet keine getrackte Nicht-Modifier-Rest-Taste den Chord', () => {
    const m = createHotkeyMatcher({ chord: ['ControlRight', 'KeyJ'], mode: 'hold' })
    m.handle({ type: 'down', key: 'KeyJ' }) // Nicht-Modifier ins Tracking
    m.reset()
    // Wäre KeyJ noch getrackt, würde ControlRight allein starten. Nach reset() nicht.
    expect(m.handle({ type: 'down', key: 'ControlRight' })).toBeNull()
    // Voller Chord funktioniert frisch:
    expect(m.handle({ type: 'down', key: 'KeyJ' })).toBe('start')
  })
})
