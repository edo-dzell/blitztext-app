import { describe, it, expect } from 'vitest'
import { istNeuer, parseVersion } from '@main/update/semver-vergleich'

describe('parseVersion', () => {
  it('zerlegt eine einfache Version', () => {
    expect(parseVersion('0.5.0')).toEqual({ major: 0, minor: 5, patch: 0, preRelease: undefined })
  })

  it('toleriert ein führendes v (GitHub-Tag-Konvention)', () => {
    expect(parseVersion('v0.5.0')).toEqual({ major: 0, minor: 5, patch: 0, preRelease: undefined })
  })

  it('erkennt Pre-Release-Suffixe', () => {
    expect(parseVersion('0.5.0-beta.1')).toEqual({ major: 0, minor: 5, patch: 0, preRelease: 'beta.1' })
  })

  it('liefert null bei nicht interpretierbarem Format', () => {
    expect(parseVersion('nicht-semver')).toBeNull()
    expect(parseVersion('')).toBeNull()
    expect(parseVersion('1.2')).toBeNull()
  })
})

describe('istNeuer', () => {
  it('v0.4.5 vs v0.5.0: MINOR-Sprung wird als neuer erkannt', () => {
    expect(istNeuer('v0.5.0', '0.4.5')).toBe(true)
    expect(istNeuer('0.5.0', '0.4.5')).toBe(true)
  })

  it('gleiche Version ist nicht neuer', () => {
    expect(istNeuer('0.5.0', '0.5.0')).toBe(false)
    expect(istNeuer('v0.5.0', '0.5.0')).toBe(false) // v-Präfix darf keinen Unterschied machen
  })

  it('ältere Remote-Version ist nicht neuer', () => {
    expect(istNeuer('0.4.5', '0.5.0')).toBe(false)
    expect(istNeuer('0.3.9', '0.4.5')).toBe(false)
  })

  it('MAJOR schlägt MINOR/PATCH', () => {
    expect(istNeuer('1.0.0', '0.99.99')).toBe(true)
    expect(istNeuer('0.99.99', '1.0.0')).toBe(false)
  })

  it('PATCH-Unterschied bei gleichem MAJOR.MINOR', () => {
    expect(istNeuer('0.5.1', '0.5.0')).toBe(true)
    expect(istNeuer('0.5.0', '0.5.1')).toBe(false)
  })

  it('Pre-Release derselben Kernversion gilt NICHT als neuer als die stabile Version', () => {
    expect(istNeuer('0.5.0-beta.1', '0.5.0')).toBe(false)
  })

  it('eine stabile Version ist neuer als ein Pre-Release derselben Kernversion', () => {
    expect(istNeuer('0.5.0', '0.5.0-beta.1')).toBe(true)
  })

  it('nicht interpretierbare Eingaben gelten als „nicht neuer" (Fail-safe)', () => {
    expect(istNeuer('kaputt', '0.4.5')).toBe(false)
    expect(istNeuer('0.5.0', 'kaputt')).toBe(false)
    expect(istNeuer('', '')).toBe(false)
  })
})
