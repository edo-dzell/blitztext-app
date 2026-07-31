import { describe, it, expect } from 'vitest'
import {
  tiefGleich,
  workflowEntwurfGeaendert,
  einstellungenGeaendert,
  apiKeyEntwurfGeaendert,
  assistentSperrtAuswahl,
  preiseGeaendert
} from '@renderer/lib/dirty'
import { defaultSettings } from '@main/settings/store'
import { BUILTIN_WORKFLOWS } from '@shared/workflows'

const def = { ...BUILTIN_WORKFLOWS[1]! } // 'improve' (rewrites=true)

describe('tiefGleich', () => {
  it('gleich für strukturell identische Werte', () => {
    expect(tiefGleich({ a: 1, b: [1, 2] }, { a: 1, b: [1, 2] })).toBe(true)
  })
  it('ungleich bei Abweichung', () => {
    expect(tiefGleich({ a: 1 }, { a: 2 })).toBe(false)
  })
})

describe('workflowEntwurfGeaendert (P4 — beide Entwürfe)', () => {
  const chord = ['ControlRight', 'ShiftRight', 'Digit2']
  it('false bei unveränderter Definition UND unverändertem Chord', () => {
    expect(workflowEntwurfGeaendert({ ...def }, def, [...chord], chord)).toBe(false)
  })
  it('true bei reiner Definitionsänderung', () => {
    expect(workflowEntwurfGeaendert({ ...def, temperature: 0.9 }, def, [...chord], chord)).toBe(true)
  })
  it('true bei reiner Hotkey-Änderung', () => {
    expect(workflowEntwurfGeaendert({ ...def }, def, ['ControlLeft'], chord)).toBe(true)
  })
})

describe('einstellungenGeaendert (P8)', () => {
  it('false nach Roundtrip (gleiche Defaults)', () => {
    expect(einstellungenGeaendert(defaultSettings(), defaultSettings())).toBe(false)
  })
  it('true bei geändertem Feld', () => {
    expect(
      einstellungenGeaendert({ ...defaultSettings(), language: 'en' }, defaultSettings())
    ).toBe(true)
  })
  it('ignoriert apiKeyStatus (Main-only Feld)', () => {
    const mitStatus = {
      ...defaultSettings(),
      apiKeyStatus: { openai: { status: 'verifiziert', zuletztGetestetMs: 1 } }
    } as unknown as ReturnType<typeof defaultSettings>
    expect(einstellungenGeaendert(mitStatus, defaultSettings())).toBe(false)
  })

  // v0.8.0: die neuen Laufzeit-Profile + GUI-Lücken-Felder brauchten KEINE Anpassung von
  // einstellungenGeaendert (Ganz-Objekt-Vergleich via tiefGleich) — dieser Test belegt das für
  // jedes neu in der Einstellungen-Oberfläche bedienbare Feld statt es nur zu behaupten.
  it('erkennt Änderungen an jedem neuen v0.8.0-Feld (Laufzeit-Profile + GUI-Lücken + Spiegelung)', () => {
    const basis = defaultSettings()
    const patches: Array<Partial<ReturnType<typeof defaultSettings>>> = [
      { mindestAufnahmeSekunden: 1.0 },
      { stilleProfil: 'streng' },
      { netzwerkProfil: 'lang' },
      { retryVersuche: 4 },
      { verlaufMaximum: 1000 },
      { statistikKompaktierungTage: 365 },
      { updateIntervallStunden: 168 },
      { pillenAnzeigedauerProfil: 'lang' },
      { perfAktiv: true },
      { fokusRueckkehr: false },
      { tone: 'casual' },
      { emojiDensity: 'viel' },
      { verlaufAktiv: true },
      { verlaufSortierung: 'aeltesteZuerst' }
    ]
    for (const patch of patches) {
      expect(einstellungenGeaendert({ ...basis, ...patch }, basis)).toBe(true)
    }
  })
})

describe('apiKeyEntwurfGeaendert (W1-E — ungespeicherter API-Key als Dirty-Quelle)', () => {
  it('false bei leerem Eingabefeld', () => {
    expect(apiKeyEntwurfGeaendert('')).toBe(false)
  })
  it('false bei reinem Whitespace', () => {
    expect(apiKeyEntwurfGeaendert('   ')).toBe(false)
  })
  it('true bei nicht-leerem, ungespeichertem Key-Text', () => {
    expect(apiKeyEntwurfGeaendert('sk-abc123')).toBe(true)
  })
  it('true auch mit umgebendem Whitespace, solange Inhalt übrig bleibt', () => {
    expect(apiKeyEntwurfGeaendert('  sk-abc123  ')).toBe(true)
  })
})

describe('assistentSperrtAuswahl (W1-E — laufende Assistent-Anfrage sperrt Workflow-Wechsel)', () => {
  it('false wenn keine Anfrage läuft', () => {
    expect(assistentSperrtAuswahl(false)).toBe(false)
  })
  it('true während eine Anfrage läuft', () => {
    expect(assistentSperrtAuswahl(true)).toBe(true)
  })
})

describe('preiseGeaendert (C1 — Preise-Pane in StatistikView)', () => {
  const overrides = { 'gpt-4o-mini': { input: 0.15, output: 0.6 } }

  it('false bei unveränderten Overrides und unverändertem Kurs', () => {
    expect(preiseGeaendert(overrides, overrides, 0.92, true, 0.92)).toBe(false)
  })

  it('true bei geänderten Overrides', () => {
    const geaendert = { 'gpt-4o-mini': { input: 0.2, output: 0.6 } }
    expect(preiseGeaendert(geaendert, overrides, 0.92, true, 0.92)).toBe(true)
  })

  it('true bei gültigem, geändertem Kurs', () => {
    expect(preiseGeaendert(overrides, overrides, 1.05, true, 0.92)).toBe(true)
  })

  it('false bei UNGÜLTIGEM Kurs, selbst wenn die Zahl abweicht (z. B. NaN durch leeres Feld)', () => {
    expect(preiseGeaendert(overrides, overrides, NaN, false, 0.92)).toBe(false)
  })
})
