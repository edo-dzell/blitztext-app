import { describe, it, expect, vi } from 'vitest'
import { pruefeAufUpdate, type Holer, type UpdateCacheEintrag, type UpdateCacheSpeicher } from '@main/update/update-hinweis'

function fakeHolerMitAntwort(opts: {
  status: number
  body?: unknown
  etag?: string
}): Holer {
  return {
    fetch: vi.fn(async () => ({
      status: opts.status,
      headers: { get: (name: string) => (name.toLowerCase() === 'etag' ? opts.etag ?? null : null) },
      json: async () => opts.body
    }))
  }
}

function fakeSpeicher(initial: UpdateCacheEintrag | null = null): UpdateCacheSpeicher & { eintrag: UpdateCacheEintrag | null } {
  const s = {
    eintrag: initial,
    async lesen() {
      return s.eintrag
    },
    async schreiben(e: UpdateCacheEintrag) {
      s.eintrag = e
    }
  }
  return s
}

const LOKALE_VERSION = '0.4.5'

describe('pruefeAufUpdate — Opt-in-Gate', () => {
  it('ruft den Holer NIE auf, wenn optIn=false', async () => {
    const holer = fakeHolerMitAntwort({ status: 200, body: { tag_name: 'v0.5.0', html_url: 'https://example.test/release' } })
    const speicher = fakeSpeicher()

    const ergebnis = await pruefeAufUpdate({ optIn: false, lokaleVersion: LOKALE_VERSION, holer, speicher })

    expect(holer.fetch).not.toHaveBeenCalled()
    expect(ergebnis).toEqual({ aktuelleVersion: LOKALE_VERSION, neuVerfuegbar: false, url: '' })
  })
})

describe('pruefeAufUpdate — neues Release verfügbar', () => {
  it('neuere Remote-Version ⇒ neuVerfuegbar true + url gesetzt', async () => {
    const holer = fakeHolerMitAntwort({
      status: 200,
      body: { tag_name: 'v0.5.0', html_url: 'https://github.com/edo-dzell/blitztext-app-windows/releases/tag/v0.5.0' },
      etag: 'W/"abc123"'
    })
    const speicher = fakeSpeicher()

    const ergebnis = await pruefeAufUpdate({ optIn: true, lokaleVersion: LOKALE_VERSION, holer, speicher })

    expect(ergebnis.neuVerfuegbar).toBe(true)
    expect(ergebnis.aktuelleVersion).toBe(LOKALE_VERSION)
    expect(ergebnis.url).toBe('https://github.com/edo-dzell/blitztext-app-windows/releases/tag/v0.5.0')
  })

  it('speichert den Cache-Eintrag inkl. ETag nach einem erfolgreichen Abruf', async () => {
    const holer = fakeHolerMitAntwort({
      status: 200,
      body: { tag_name: 'v0.5.0', html_url: 'https://example.test/release' },
      etag: 'W/"xyz"'
    })
    const speicher = fakeSpeicher()

    await pruefeAufUpdate({ optIn: true, lokaleVersion: LOKALE_VERSION, holer, speicher, jetztMs: () => 1_000 })

    expect(speicher.eintrag).not.toBeNull()
    expect(speicher.eintrag?.etag).toBe('W/"xyz"')
    expect(speicher.eintrag?.geprueftAmMs).toBe(1_000)
    expect(speicher.eintrag?.letztesErgebnis.neuVerfuegbar).toBe(true)
  })
})

describe('pruefeAufUpdate — kein neues Release', () => {
  it('gleiche Version ⇒ neuVerfuegbar false, keine url', async () => {
    const holer = fakeHolerMitAntwort({ status: 200, body: { tag_name: 'v0.4.5', html_url: 'https://example.test/release' } })
    const speicher = fakeSpeicher()

    const ergebnis = await pruefeAufUpdate({ optIn: true, lokaleVersion: LOKALE_VERSION, holer, speicher })

    expect(ergebnis).toEqual({ aktuelleVersion: LOKALE_VERSION, neuVerfuegbar: false, url: '' })
  })

  it('ältere Remote-Version (Downgrade-Tag/Draft eines alten Releases) ⇒ false', async () => {
    const holer = fakeHolerMitAntwort({ status: 200, body: { tag_name: 'v0.3.9', html_url: 'https://example.test/release' } })
    const speicher = fakeSpeicher()

    const ergebnis = await pruefeAufUpdate({ optIn: true, lokaleVersion: LOKALE_VERSION, holer, speicher })

    expect(ergebnis.neuVerfuegbar).toBe(false)
    expect(ergebnis.url).toBe('')
  })

  it('semver-Edge: 0.5.0 vs 0.5.0 (lokal bereits die neueste) ⇒ false', async () => {
    const holer = fakeHolerMitAntwort({ status: 200, body: { tag_name: 'v0.5.0', html_url: 'https://example.test/release' } })
    const speicher = fakeSpeicher()

    const ergebnis = await pruefeAufUpdate({ optIn: true, lokaleVersion: '0.5.0', holer, speicher })

    expect(ergebnis.neuVerfuegbar).toBe(false)
  })

  it('Pre-Release-Tag (z. B. v0.5.0-beta.1) bei gleicher Kernversion ⇒ kein Hinweis', async () => {
    const holer = fakeHolerMitAntwort({ status: 200, body: { tag_name: 'v0.5.0-beta.1', html_url: 'https://example.test/release' } })
    const speicher = fakeSpeicher()

    const ergebnis = await pruefeAufUpdate({ optIn: true, lokaleVersion: '0.5.0', holer, speicher })

    expect(ergebnis.neuVerfuegbar).toBe(false)
  })
})

describe('pruefeAufUpdate — Robustheit', () => {
  it('Netzfehler (fetch wirft) ⇒ still neuVerfuegbar false, kein Absturz', async () => {
    const holer: Holer = { fetch: vi.fn(async () => { throw new Error('offline') }) }
    const speicher = fakeSpeicher()

    const ergebnis = await pruefeAufUpdate({ optIn: true, lokaleVersion: LOKALE_VERSION, holer, speicher })

    expect(ergebnis).toEqual({ aktuelleVersion: LOKALE_VERSION, neuVerfuegbar: false, url: '' })
  })

  it('Rate-Limit (403) ⇒ still false, kein Cache-Schreiben (nächster Start darf erneut fragen)', async () => {
    const holer = fakeHolerMitAntwort({ status: 403, body: { message: 'API rate limit exceeded' } })
    const speicher = fakeSpeicher()

    const ergebnis = await pruefeAufUpdate({ optIn: true, lokaleVersion: LOKALE_VERSION, holer, speicher })

    expect(ergebnis.neuVerfuegbar).toBe(false)
    expect(speicher.eintrag).toBeNull()
  })

  it('kaputtes JSON (json() wirft) ⇒ still false', async () => {
    const holer: Holer = {
      fetch: vi.fn(async () => ({
        status: 200,
        headers: { get: () => null },
        json: async () => {
          throw new SyntaxError('Unexpected token')
        }
      }))
    }
    const speicher = fakeSpeicher()

    const ergebnis = await pruefeAufUpdate({ optIn: true, lokaleVersion: LOKALE_VERSION, holer, speicher })

    expect(ergebnis).toEqual({ aktuelleVersion: LOKALE_VERSION, neuVerfuegbar: false, url: '' })
  })

  it('unerwartete Antwort-Form (kein tag_name) ⇒ still false', async () => {
    const holer = fakeHolerMitAntwort({ status: 200, body: { irgendwas: 'unerwartet' } })
    const speicher = fakeSpeicher()

    const ergebnis = await pruefeAufUpdate({ optIn: true, lokaleVersion: LOKALE_VERSION, holer, speicher })

    expect(ergebnis.neuVerfuegbar).toBe(false)
  })

  it('kaputter/nicht lesbarer Cache (lesen() wirft) ⇒ wie „kein Cache" behandelt, kein Absturz', async () => {
    const holer = fakeHolerMitAntwort({ status: 200, body: { tag_name: 'v0.5.0', html_url: 'https://example.test/release' } })
    const speicher: UpdateCacheSpeicher = {
      lesen: vi.fn(async () => { throw new Error('Datei kaputt') }),
      schreiben: vi.fn(async () => {})
    }

    const ergebnis = await pruefeAufUpdate({ optIn: true, lokaleVersion: LOKALE_VERSION, holer, speicher })

    expect(ergebnis.neuVerfuegbar).toBe(true)
  })
})

describe('pruefeAufUpdate — Cache verhindert Doppelabfrage', () => {
  it('frischer Cache (innerhalb Mindestabstand) ⇒ Holer wird NICHT erneut aufgerufen', async () => {
    const holer = fakeHolerMitAntwort({ status: 200, body: { tag_name: 'v0.9.0', html_url: 'https://example.test/release' } })
    const speicher = fakeSpeicher({
      geprueftAmMs: 1_000,
      etag: 'W/"alt"',
      letztesErgebnis: { aktuelleVersion: LOKALE_VERSION, neuVerfuegbar: true, url: 'https://example.test/cached' }
    })

    const ergebnis = await pruefeAufUpdate({
      optIn: true,
      lokaleVersion: LOKALE_VERSION,
      holer,
      speicher,
      jetztMs: () => 1_000 + 60_000, // 1 Minute später, weit unter dem Default-Mindestabstand (24h)
      mindestabstandMs: 24 * 60 * 60 * 1000
    })

    expect(holer.fetch).not.toHaveBeenCalled()
    expect(ergebnis.url).toBe('https://example.test/cached') // gecachtes Ergebnis unverändert geliefert
    expect(ergebnis.neuVerfuegbar).toBe(true)
  })

  it('abgelaufener Cache (Mindestabstand überschritten) ⇒ fragt erneut', async () => {
    const holer = fakeHolerMitAntwort({ status: 200, body: { tag_name: 'v0.6.0', html_url: 'https://example.test/neu' } })
    const speicher = fakeSpeicher({
      geprueftAmMs: 0,
      letztesErgebnis: { aktuelleVersion: LOKALE_VERSION, neuVerfuegbar: false, url: '' }
    })

    const ergebnis = await pruefeAufUpdate({
      optIn: true,
      lokaleVersion: LOKALE_VERSION,
      holer,
      speicher,
      jetztMs: () => 25 * 60 * 60 * 1000, // 25h später > 24h Mindestabstand
      mindestabstandMs: 24 * 60 * 60 * 1000
    })

    expect(holer.fetch).toHaveBeenCalledTimes(1)
    expect(ergebnis.url).toBe('https://example.test/neu')
  })

  it('304 Not Modified (ETag bestätigt) ⇒ übernimmt gecachtes Ergebnis, aktualisiert Zeitstempel', async () => {
    const holer = fakeHolerMitAntwort({ status: 304 })
    const speicher = fakeSpeicher({
      geprueftAmMs: 0,
      etag: 'W/"stabil"',
      letztesErgebnis: { aktuelleVersion: LOKALE_VERSION, neuVerfuegbar: true, url: 'https://example.test/bereits-bekannt' }
    })

    const ergebnis = await pruefeAufUpdate({
      optIn: true,
      lokaleVersion: LOKALE_VERSION,
      holer,
      speicher,
      jetztMs: () => 99_999,
      mindestabstandMs: 1 // Cache "abgelaufen" nach Zeit → erzwingt echten Request, der dann 304 liefert
    })

    expect(ergebnis.url).toBe('https://example.test/bereits-bekannt')
    expect(ergebnis.neuVerfuegbar).toBe(true)
    expect(speicher.eintrag?.geprueftAmMs).toBe(99_999) // Zeitstempel aufgefrischt
  })

  it('sendet den gespeicherten ETag als If-None-Match-Header bei erneutem Abruf', async () => {
    const holer = fakeHolerMitAntwort({ status: 304 })
    const speicher = fakeSpeicher({
      geprueftAmMs: 0,
      etag: 'W/"mein-etag"',
      letztesErgebnis: { aktuelleVersion: LOKALE_VERSION, neuVerfuegbar: false, url: '' }
    })

    await pruefeAufUpdate({
      optIn: true,
      lokaleVersion: LOKALE_VERSION,
      holer,
      speicher,
      jetztMs: () => 999_999,
      mindestabstandMs: 1
    })

    expect(holer.fetch).toHaveBeenCalledWith(
      expect.stringContaining('api.github.com'),
      expect.objectContaining({ headers: expect.objectContaining({ 'If-None-Match': 'W/"mein-etag"' }) })
    )
  })
})

describe('pruefeAufUpdate — keine Nutzer-Identifikatoren im Request', () => {
  it('der Request enthält keinen Query-String/Body mit Nutzerdaten', async () => {
    const holer = fakeHolerMitAntwort({ status: 200, body: { tag_name: 'v0.4.5', html_url: '' } })
    const speicher = fakeSpeicher()

    await pruefeAufUpdate({ optIn: true, lokaleVersion: LOKALE_VERSION, holer, speicher })

    const [url, init] = (holer.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!
    expect(url).toBe('https://api.github.com/repos/edo-dzell/blitztext-app-windows/releases/latest')
    expect(init).not.toHaveProperty('body')
    expect(JSON.stringify(init)).not.toMatch(/user|uuid|id=|machine/i)
  })
})
