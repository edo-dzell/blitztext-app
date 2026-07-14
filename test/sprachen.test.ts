import { describe, it, expect } from 'vitest'
import { SPRACHEN, findeSprache, sprachPromptName } from '@shared/sprachen'
import { istGueltigerSprachcode } from '@shared/workflows'

describe('SPRACHEN (W2-F: zentrale Sprachliste)', () => {
  it('enthält mindestens die geforderten 23 Sprachen', () => {
    const erwarteteCodes = [
      'de',
      'en',
      'fr',
      'es',
      'it',
      'pt',
      'nl',
      'pl',
      'tr',
      'ru',
      'uk',
      'cs',
      'sv',
      'da',
      'no',
      'fi',
      'hu',
      'ro',
      'el',
      'ar',
      'ja',
      'ko',
      'zh'
    ]
    const codes = SPRACHEN.map((s) => s.code)
    for (const c of erwarteteCodes) {
      expect(codes).toContain(c)
    }
    expect(SPRACHEN.length).toBe(erwarteteCodes.length)
  })

  it('jeder Eintrag hat einen nicht-leeren Anzeige- UND Prompt-Namen', () => {
    for (const s of SPRACHEN) {
      expect(s.anzeigeName.trim()).not.toBe('')
      expect(s.promptName.trim()).not.toBe('')
    }
  })

  it('jeder Code ist ein gültiger ISO-639-1-Code (zwei Kleinbuchstaben) und eindeutig', () => {
    const codes = SPRACHEN.map((s) => s.code)
    for (const c of codes) {
      expect(istGueltigerSprachcode(c)).toBe(true)
    }
    expect(new Set(codes).size).toBe(codes.length)
  })

  it('de/en bleiben erhalten (Migrations-Kompatibilität: bestehende Settings laden unverändert)', () => {
    expect(findeSprache('de')).toEqual({ code: 'de', anzeigeName: 'Deutsch (de)', promptName: 'Deutsch' })
    expect(findeSprache('en')).toEqual({
      code: 'en',
      anzeigeName: 'Englisch (en)',
      promptName: 'Englisch'
    })
  })

  it('findeSprache liefert undefined für unbekannten Code', () => {
    expect(findeSprache('xx')).toBeUndefined()
  })

  it('sprachPromptName fällt bei unbekanntem Code auf den Code selbst zurück', () => {
    expect(sprachPromptName('xx')).toBe('xx')
    expect(sprachPromptName('fr')).toBe('Französisch')
  })
})
