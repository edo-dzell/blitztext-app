import { describe, it, expect } from 'vitest'
import { validateApiKey } from '@main/secrets/validate-api-key'

function fetchReturning(status: number): typeof fetch {
  return (async () => new Response(null, { status })) as unknown as typeof fetch
}

describe('validateApiKey', () => {
  it('meldet valid bei HTTP 200', async () => {
    expect(await validateApiKey('sk-good', { fetchFn: fetchReturning(200) })).toEqual({
      status: 'valid'
    })
  })

  it('meldet invalid bei HTTP 401', async () => {
    expect(await validateApiKey('sk-bad', { fetchFn: fetchReturning(401) })).toEqual({
      status: 'invalid'
    })
  })

  it('meldet network-error, wenn fetch fehlschlägt', async () => {
    const fetchThrows = (async () => {
      throw new Error('offline')
    }) as unknown as typeof fetch

    const result = await validateApiKey('sk-x', { fetchFn: fetchThrows })

    expect(result.status).toBe('network-error')
  })

  it('meldet invalid bei leerem Key ohne Netzaufruf', async () => {
    let called = false
    const fetchSpy = (async () => {
      called = true
      return new Response(null, { status: 200 })
    }) as unknown as typeof fetch

    expect(await validateApiKey('   ', { fetchFn: fetchSpy })).toEqual({ status: 'invalid' })
    expect(called).toBe(false)
  })

  it('nutzt die übergebene Base-URL für den Modell-Endpunkt', async () => {
    let url: string | undefined
    const fetchSpy = (async (u: string) => {
      url = u
      return new Response(null, { status: 200 })
    }) as unknown as typeof fetch

    await validateApiKey('sk', { baseUrl: 'https://api.groq.com/openai/v1', fetchFn: fetchSpy })
    expect(url).toBe('https://api.groq.com/openai/v1/models')
  })

  // --- F2: URL-Guard im Main durchsetzen (Security-Review P1) ---

  it('F2: https-Base-URL ⇒ Request geht raus wie gewohnt', async () => {
    let called = false
    const fetchFn = (async () => {
      called = true
      return new Response(null, { status: 200 })
    }) as unknown as typeof fetch

    const result = await validateApiKey('sk', {
      baseUrl: 'https://api.openai.com/v1',
      fetchFn
    })
    expect(result).toEqual({ status: 'valid' })
    expect(called).toBe(true)
  })

  it('F2: http-Base-URL zu fremdem Host ⇒ blockiert, KEIN fetch, network-error statt Netzwerk-Retry', async () => {
    let called = false
    const fetchFn = (async () => {
      called = true
      return new Response(null, { status: 200 })
    }) as unknown as typeof fetch

    const result = await validateApiKey('sk', {
      baseUrl: 'http://api.example.com/v1',
      fetchFn
    })

    expect(called).toBe(false)
    expect(result.status).toBe('network-error')
    if (result.status === 'network-error') {
      expect(result.message).toMatch(/http|unverschlüsselt/i)
    }
  })

  it('F2: http-Base-URL auf localhost ⇒ erlaubt (lokales ASR ohne TLS)', async () => {
    let called = false
    const fetchFn = (async () => {
      called = true
      return new Response(null, { status: 200 })
    }) as unknown as typeof fetch

    const result = await validateApiKey('sk', {
      baseUrl: 'http://localhost:8080/v1',
      fetchFn
    })
    expect(result).toEqual({ status: 'valid' })
    expect(called).toBe(true)
  })
})
