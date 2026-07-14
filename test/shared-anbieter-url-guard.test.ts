import { describe, it, expect } from 'vitest'
import { istSichereAnbieterUrl, pruefeAnbieterUrlSicherheit } from '@shared/anbieter-url-guard'

describe('istSichereAnbieterUrl (geteilte Quelle für Main+Renderer)', () => {
  it('akzeptiert https-URLs', () => {
    expect(istSichereAnbieterUrl('https://api.openai.com/v1')).toBe(true)
    expect(istSichereAnbieterUrl('https://api.mistral.ai/v1')).toBe(true)
  })

  it('lehnt http-URLs auf einen Nicht-lokalen Host ab', () => {
    expect(istSichereAnbieterUrl('http://api.openai.com/v1')).toBe(false)
    expect(istSichereAnbieterUrl('http://example.com')).toBe(false)
  })

  it('akzeptiert http auf localhost (lokales ASR ohne TLS)', () => {
    expect(istSichereAnbieterUrl('http://localhost:8080/v1')).toBe(true)
    expect(istSichereAnbieterUrl('http://127.0.0.1:8080/v1')).toBe(true)
    expect(istSichereAnbieterUrl('http://[::1]:8080/v1')).toBe(true)
  })

  it('akzeptiert auch https auf localhost', () => {
    expect(istSichereAnbieterUrl('https://localhost:8443/v1')).toBe(true)
  })

  it('lehnt andere unsichere Schemata ab', () => {
    expect(istSichereAnbieterUrl('ftp://api.openai.com/v1')).toBe(false)
    expect(istSichereAnbieterUrl('file:///etc/passwd')).toBe(false)
  })

  it('lehnt unparsbare/leere URLs ab statt zu werfen', () => {
    expect(istSichereAnbieterUrl('')).toBe(false)
    expect(istSichereAnbieterUrl('nicht-mal-eine-url')).toBe(false)
  })

  it('Host-Vergleich ist case-insensitiv', () => {
    expect(istSichereAnbieterUrl('http://LOCALHOST:8080/v1')).toBe(true)
  })
})

describe('pruefeAnbieterUrlSicherheit (Main-seitiger Hart-Block vor Key-tragendem fetch)', () => {
  it('wirft NICHT bei https-URLs', () => {
    expect(() => pruefeAnbieterUrlSicherheit('https://api.openai.com/v1')).not.toThrow()
  })

  it('wirft NICHT bei http auf localhost/127.0.0.1/::1', () => {
    expect(() => pruefeAnbieterUrlSicherheit('http://localhost:8080/v1')).not.toThrow()
    expect(() => pruefeAnbieterUrlSicherheit('http://127.0.0.1:8080/v1')).not.toThrow()
    expect(() => pruefeAnbieterUrlSicherheit('http://[::1]:8080/v1')).not.toThrow()
  })

  it('wirft bei http auf einen fremden Host, mit .status=400 (→ Fehler-Art konfiguration, kein Retry)', () => {
    let caught: unknown
    try {
      pruefeAnbieterUrlSicherheit('http://api.openai.com/v1')
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(Error)
    const err = caught as Error & { status?: number; transport?: boolean }
    expect(err.status).toBe(400)
    expect(err.transport).toBeUndefined()
    expect(err.message).toMatch(/http/i)
  })

  it('Fehlermeldung ist deutsch und nennt die Ursache (unverschlüsselt/http)', () => {
    expect(() => pruefeAnbieterUrlSicherheit('http://example.com')).toThrow(/unverschlüsselt|http/i)
  })
})
