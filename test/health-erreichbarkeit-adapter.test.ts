import { describe, it, expect, vi } from 'vitest'
import { createErreichbarkeitsAdapter } from '@main/health/erreichbarkeit-adapter'

function fakeFetch(status: number) {
  return vi.fn(async () => ({ status })) as unknown as typeof fetch
}

describe('createErreichbarkeitsAdapter', () => {
  it('erreichter Endpunkt (200) ⇒ erreichbar, keine Autorisierungsablehnung', async () => {
    const adapter = createErreichbarkeitsAdapter({ fetchFn: fakeFetch(200) })
    expect(await adapter.pingeAnbieter('https://api.openai.com/v1')).toEqual({ erreichbar: true })
  })

  it('404 auf /models zählt trotzdem als erreichbar (Server hat geantwortet)', async () => {
    const adapter = createErreichbarkeitsAdapter({ fetchFn: fakeFetch(404) })
    expect(await adapter.pingeAnbieter('https://api.openai.com/v1')).toEqual({ erreichbar: true })
  })

  it('401 ⇒ autorisierungAbgelehnt (Key falsch)', async () => {
    const adapter = createErreichbarkeitsAdapter({ fetchFn: fakeFetch(401) })
    const r = await adapter.pingeAnbieter('https://api.openai.com/v1')
    expect(r.autorisierungAbgelehnt).toBe(true)
    expect(r.erreichbar).toBe(false)
  })

  it('403 ⇒ autorisierungAbgelehnt', async () => {
    const adapter = createErreichbarkeitsAdapter({ fetchFn: fakeFetch(403) })
    expect((await adapter.pingeAnbieter('https://x/v1')).autorisierungAbgelehnt).toBe(true)
  })

  it('hängt /models an die Base-URL an und entfernt Trailing-Slashes', async () => {
    const fetchFn = fakeFetch(200)
    const adapter = createErreichbarkeitsAdapter({ fetchFn })
    await adapter.pingeAnbieter('https://api.openai.com/v1/')
    const [url] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0]!
    expect(url).toBe('https://api.openai.com/v1/models')
  })

  it('schickt den API-Key (falls vorhanden) als Bearer mit', async () => {
    const fetchFn = fakeFetch(200)
    const adapter = createErreichbarkeitsAdapter({ fetchFn, getApiKey: async () => 'sk-geheim' })
    await adapter.pingeAnbieter('https://x/v1')
    const [, init] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0]!
    expect(init.headers.Authorization).toBe('Bearer sk-geheim')
  })

  it('ohne Key kein Authorization-Header', async () => {
    const fetchFn = fakeFetch(200)
    const adapter = createErreichbarkeitsAdapter({ fetchFn, getApiKey: async () => null })
    await adapter.pingeAnbieter('https://x/v1')
    const [, init] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0]!
    expect(init.headers.Authorization).toBeUndefined()
  })

  it('Netzfehler (fetch wirft) propagiert als Wurf (der Check wertet das als warnung)', async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error('offline')
    }) as unknown as typeof fetch
    const adapter = createErreichbarkeitsAdapter({ fetchFn })
    await expect(adapter.pingeAnbieter('https://x/v1')).rejects.toThrow('offline')
  })

  // --- F2: URL-Guard im Main durchsetzen (Security-Review P1) ---

  it('F2: https-Base-URL ⇒ Request geht raus wie gewohnt', async () => {
    const fetchFn = fakeFetch(200)
    const adapter = createErreichbarkeitsAdapter({ fetchFn, getApiKey: async () => 'sk-geheim' })

    expect(await adapter.pingeAnbieter('https://api.openai.com/v1')).toEqual({ erreichbar: true })
    expect(fetchFn).toHaveBeenCalled()
  })

  it('F2: http-Base-URL zu fremdem Host ⇒ blockiert, KEIN fetch, kein Key-Versand — erreichbar:false statt Wurf', async () => {
    const fetchFn = fakeFetch(200)
    const adapter = createErreichbarkeitsAdapter({ fetchFn, getApiKey: async () => 'sk-geheim' })

    const r = await adapter.pingeAnbieter('http://api.example.com/v1')

    expect(fetchFn).not.toHaveBeenCalled()
    expect(r.erreichbar).toBe(false)
    expect(r.autorisierungAbgelehnt).toBeFalsy()
  })

  it('F2: http-Base-URL auf localhost ⇒ erlaubt (lokales ASR ohne TLS)', async () => {
    const fetchFn = fakeFetch(200)
    const adapter = createErreichbarkeitsAdapter({ fetchFn })

    expect(await adapter.pingeAnbieter('http://localhost:8080/v1')).toEqual({ erreichbar: true })
    expect(fetchFn).toHaveBeenCalled()
  })
})
