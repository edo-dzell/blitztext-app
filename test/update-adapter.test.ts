import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createUpdateHoler } from '@main/update/update-holer'
import { createUpdateCacheFile } from '@main/update/update-cache-file'
import type { UpdateCacheEintrag } from '@main/update/update-hinweis'

// ---- Holer (fetch-Kapsel) ---------------------------------------------------------------------

describe('createUpdateHoler', () => {
  it('reicht Status/Header/JSON der fetch-Antwort durch', async () => {
    const fetchFn = vi.fn(async () => ({
      status: 200,
      headers: { get: (n: string) => (n.toLowerCase() === 'etag' ? 'W/"abc"' : null) },
      json: async () => ({ tag_name: 'v0.6.0' })
    })) as unknown as typeof fetch
    const holer = createUpdateHoler({ fetchFn })

    const antwort = await holer.fetch('https://api.github.com/x', {
      headers: { 'If-None-Match': 'W/"abc"' }
    })

    expect(antwort.status).toBe(200)
    expect(antwort.headers.get('etag')).toBe('W/"abc"')
    expect(await antwort.json()).toEqual({ tag_name: 'v0.6.0' })
  })

  it('setzt einen statischen User-Agent (GitHub-API-Pflicht) und übergibt Aufrufer-Header', async () => {
    const fetchFn = vi.fn(async () => ({
      status: 304,
      headers: { get: () => null },
      json: async () => ({})
    })) as unknown as typeof fetch
    const holer = createUpdateHoler({ fetchFn })

    await holer.fetch('https://api.github.com/x', { headers: { Accept: 'application/vnd.github+json' } })

    const [, init] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0]!
    expect(init.method).toBe('GET')
    expect(init.headers['User-Agent']).toBe('Blitztext-UpdateCheck')
    expect(init.headers.Accept).toBe('application/vnd.github+json')
    // Keine Nutzer-Identifikatoren in den Headern.
    expect(JSON.stringify(init.headers)).not.toMatch(/user-?id|uuid|machine/i)
  })

  it('übergibt ein AbortSignal (Timeout-Schutz)', async () => {
    const fetchFn = vi.fn(async () => ({
      status: 200,
      headers: { get: () => null },
      json: async () => ({})
    })) as unknown as typeof fetch
    const holer = createUpdateHoler({ fetchFn, timeoutMs: 1000 })
    await holer.fetch('https://api.github.com/x')
    const [, init] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0]!
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })
})

// ---- Cache-Datei ------------------------------------------------------------------------------

describe('createUpdateCacheFile', () => {
  let dir: string
  let pfad: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'blitz-update-cache-'))
    pfad = join(dir, 'unterordner', 'update-cache.json') // Unterordner prüft mkdir recursive
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  const eintrag: UpdateCacheEintrag = {
    geprueftAmMs: 1234,
    etag: 'W/"xyz"',
    letztesErgebnis: { aktuelleVersion: '0.5.0', neuVerfuegbar: false, url: '' }
  }

  it('Roundtrip: schreiben dann lesen liefert denselben Eintrag', async () => {
    const cache = createUpdateCacheFile(pfad)
    await cache.schreiben(eintrag)
    expect(await cache.lesen()).toEqual(eintrag)
  })

  it('lesen liefert null, wenn die Datei nicht existiert', async () => {
    const cache = createUpdateCacheFile(join(dir, 'gibt-es-nicht.json'))
    expect(await cache.lesen()).toBeNull()
  })

  it('kaputter JSON-Inhalt ⇒ null (wie „kein Cache", kein Wurf)', async () => {
    await writeFile(pfad.replace('/unterordner', ''), '{ kaputt', 'utf-8')
    const cache = createUpdateCacheFile(pfad.replace('/unterordner', ''))
    expect(await cache.lesen()).toBeNull()
  })

  it('valides JSON aber falsche Form (kein geprueftAmMs) ⇒ null', async () => {
    await writeFile(pfad.replace('/unterordner', ''), JSON.stringify({ irgendwas: 1 }), 'utf-8')
    const cache = createUpdateCacheFile(pfad.replace('/unterordner', ''))
    expect(await cache.lesen()).toBeNull()
  })
})
