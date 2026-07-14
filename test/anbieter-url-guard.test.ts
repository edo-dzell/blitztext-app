import { describe, it, expect } from 'vitest'
import { istSichereAnbieterUrl } from '@renderer/lib/anbieter-url-guard'

describe('istSichereAnbieterUrl', () => {
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
