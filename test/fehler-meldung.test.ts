import { describe, it, expect } from 'vitest'
import {
  fehlerMeldung,
  teilErfolgMeldung,
  fokusDriftMeldung,
  fehlenderApiKeyMeldung,
  unbekannterWorkflowMeldung
} from '@main/session/fehler-meldung'

describe('fehlerMeldung', () => {
  it('konfiguration → Sprung in die Einstellungen, trägt die Ursache', () => {
    const m = fehlerMeldung('konfiguration', 'Ungültiger Key')
    expect(m.aktion).toBe('einstellungen')
    expect(m.koerper).toContain('Ungültiger Key')
  })

  it('netzwerk → freundlicher Wiederhol-Hinweis, keine Aktion', () => {
    const m = fehlerMeldung('netzwerk', 'roh')
    expect(m.aktion).toBeUndefined()
    expect(m.titel).toBe('Keine Verbindung')
  })

  it('aufnahme → trägt die Ursache, keine Aktion', () => {
    const m = fehlerMeldung('aufnahme', 'Keine Aufnahme erkannt.')
    expect(m.aktion).toBeUndefined()
    expect(m.koerper).toBe('Keine Aufnahme erkannt.')
  })

  it('anbieter → trägt die Ursache', () => {
    expect(fehlerMeldung('anbieter', 'Server kaputt').koerper).toBe('Server kaputt')
  })
})

describe('teilErfolgMeldung (v0.4.5)', () => {
  it('umschreibfehler → Strg+V-Hinweis', () => {
    const m = teilErfolgMeldung('umschreibfehler')
    expect(m.titel).toBe('Umschreiben fehlgeschlagen')
    expect(m.koerper).toContain('Strg+V')
    expect(m.aktion).toBeUndefined()
  })

  it('beantwortet → benennt den Grund ehrlich (verständlich auch bei Fehlalarm)', () => {
    const m = teilErfolgMeldung('beantwortet')
    expect(m.koerper).toContain('Anweisung an die KI')
    expect(m.koerper).toContain('Zwischenablage')
  })

  it('abgeschnitten → benennt das Token-Limit, verweist auf die Zwischenablage', () => {
    const m = teilErfolgMeldung('abgeschnitten')
    expect(m.koerper).toContain('abgeschnitten')
    expect(m.koerper).toContain('Zwischenablage')
    expect(m.aktion).toBeUndefined()
  })

  // v0.7.1 Stufe 3 (5. Vorfallsklasse „Weglassen"): Vollständigkeits-Detektor.
  it('unvollstaendig → benennt das Weglassen, verweist auf die Zwischenablage', () => {
    const m = teilErfolgMeldung('unvollstaendig')
    expect(m.koerper).toContain('weggelassen')
    expect(m.koerper).toContain('Zwischenablage')
    expect(m.aktion).toBeUndefined()
  })
})

describe('fokusDriftMeldung (W3-A, ADR-0011 Weg B)', () => {
  it('nennt den Fokuswechsel und den Strg+V-Hinweis, keine Sprung-Aktion', () => {
    const m = fokusDriftMeldung()
    expect(m.titel).toContain('Fokus')
    expect(m.koerper).toContain('Strg+V')
    expect(m.aktion).toBeUndefined()
  })
})

// v0.8.0 (Auftrag 2, Befund 17): bislang brach ein per Hotkey ausgelöstes Diktat ohne API-Key WORTLOS
// ab. Nach dem Muster von fokusDriftMeldung — reiner, nicht-blockierender Hinweis, keine Sprung-Aktion
// (das Nachvorn-Holen der Einstellungen bleibt der manuellen Auslösung vorbehalten, s. sitzung.ts).
describe('fehlenderApiKeyMeldung (v0.8.0, Befund 17)', () => {
  it('nennt den betroffenen Anbieter, keine Sprung-Aktion', () => {
    const m = fehlenderApiKeyMeldung('OpenAI')
    expect(m.koerper).toContain('OpenAI')
    expect(m.aktion).toBeUndefined()
  })

  it('nennt einen ANDEREN Anbieter, wenn ein anderer betroffen ist', () => {
    const m = fehlenderApiKeyMeldung('Mistral')
    expect(m.koerper).toContain('Mistral')
  })
})

// v0.8.0 (Auftrag 2): derselbe stille Fehler wie der fehlende API-Key — ein verwaister Hotkey (Chord
// zeigt auf eine gelöschte/unbekannte Workflow-Id) brach bislang ebenso wortlos ab.
describe('unbekannterWorkflowMeldung (v0.8.0)', () => {
  it('meldet, dass der Workflow nicht mehr existiert, keine Sprung-Aktion', () => {
    const m = unbekannterWorkflowMeldung()
    expect(m.titel).toBe('Workflow nicht gefunden')
    expect(m.aktion).toBeUndefined()
  })
})
