import { describe, it, expect } from 'vitest'
import {
  initialerZustand,
  naechsterSchritt,
  vorherigerSchritt,
  kannWeiter,
  type WizardZustand
} from '@renderer/lib/onboarding-wizard'

describe('initialerZustand', () => {
  it('startet bei willkommen ohne Anbieter-Wahl und ohne Ergebnisse', () => {
    const z = initialerZustand()
    expect(z).toEqual({
      schritt: 'willkommen',
      anbieterWahl: null,
      keyGetestet: false,
      mikroGeprueft: false,
      probeErgebnis: null
    })
  })
})

describe('naechsterSchritt', () => {
  it('durchläuft die feste Reihenfolge willkommen→key→mikrofon→probe→fertig', () => {
    let z = initialerZustand()
    expect(z.schritt).toBe('willkommen')
    z = naechsterSchritt(z)
    expect(z.schritt).toBe('key')
    z = naechsterSchritt(z)
    expect(z.schritt).toBe('mikrofon')
    z = naechsterSchritt(z)
    expect(z.schritt).toBe('probe')
    z = naechsterSchritt(z)
    expect(z.schritt).toBe('fertig')
  })

  it('bleibt bei fertig stehen (kein Schritt danach)', () => {
    const z: WizardZustand = { ...initialerZustand(), schritt: 'fertig' }
    expect(naechsterSchritt(z).schritt).toBe('fertig')
  })

  it('verändert die übrigen Felder nicht', () => {
    const z: WizardZustand = {
      schritt: 'willkommen',
      anbieterWahl: 'cloud',
      keyGetestet: true,
      mikroGeprueft: false,
      probeErgebnis: null
    }
    const next = naechsterSchritt(z)
    expect(next.anbieterWahl).toBe('cloud')
    expect(next.keyGetestet).toBe(true)
  })
})

describe('vorherigerSchritt', () => {
  it('durchläuft die Reihenfolge rückwärts', () => {
    let z: WizardZustand = { ...initialerZustand(), schritt: 'fertig' }
    z = vorherigerSchritt(z)
    expect(z.schritt).toBe('probe')
    z = vorherigerSchritt(z)
    expect(z.schritt).toBe('mikrofon')
    z = vorherigerSchritt(z)
    expect(z.schritt).toBe('key')
    z = vorherigerSchritt(z)
    expect(z.schritt).toBe('willkommen')
  })

  it('bleibt bei willkommen stehen (nicht vor den ersten Schritt zurück)', () => {
    const z = initialerZustand()
    expect(vorherigerSchritt(z).schritt).toBe('willkommen')
  })
})

describe('kannWeiter', () => {
  it('willkommen ohne Anbieter-Wahl: kann NICHT weiter', () => {
    const z = initialerZustand()
    expect(kannWeiter(z)).toBe(false)
  })

  it('willkommen MIT Anbieter-Wahl (cloud oder lokal): kann weiter', () => {
    expect(kannWeiter({ ...initialerZustand(), anbieterWahl: 'cloud' })).toBe(true)
    expect(kannWeiter({ ...initialerZustand(), anbieterWahl: 'lokal' })).toBe(true)
  })

  it('key/mikrofon/probe/fertig: immer weiter-bar, auch ohne jeden Erfolg', () => {
    const basis: WizardZustand = {
      schritt: 'key',
      anbieterWahl: 'cloud',
      keyGetestet: false,
      mikroGeprueft: false,
      probeErgebnis: null
    }
    expect(kannWeiter(basis)).toBe(true)
    expect(kannWeiter({ ...basis, schritt: 'mikrofon' })).toBe(true)
    expect(kannWeiter({ ...basis, schritt: 'probe' })).toBe(true)
    expect(kannWeiter({ ...basis, schritt: 'fertig' })).toBe(true)
  })
})
