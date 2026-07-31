import { describe, it, expect, vi, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'
import { warteAufFensterBereit, protokolliereLadefehler } from '@main/window/fenster-bereitschaft'

// Fake-Fenster: webContents als EventEmitter (did-finish-load/did-fail-load), steuerbares isLoading
// und isDestroyed. Muster analog test/recorder-adapter.test.ts.
function fakeFenster(opts: { loading?: boolean; zerstoert?: boolean; wcZerstoert?: boolean } = {}) {
  const webContents = Object.assign(new EventEmitter(), {
    loading: opts.loading ?? false,
    destroyed: opts.wcZerstoert ?? false,
    isLoading(): boolean {
      return this.loading
    },
    isDestroyed(): boolean {
      return this.destroyed
    }
  })
  return {
    destroyed: opts.zerstoert ?? false,
    isDestroyed(): boolean {
      return this.destroyed
    },
    webContents
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('warteAufFensterBereit', () => {
  it('bereits geladen (isLoading=false) → sofort bereit', async () => {
    const f = fakeFenster({ loading: false })
    const res = await warteAufFensterBereit([f as never], 3000)
    expect(res.bereit).toBe(true)
  })

  it('lädt noch → bereit nach did-finish-load', async () => {
    const f = fakeFenster({ loading: true })
    const p = warteAufFensterBereit([f as never], 3000)
    f.webContents.emit('did-finish-load')
    const res = await p
    expect(res.bereit).toBe(true)
  })

  it('did-fail-load zählt als fertig (kein ewiges Warten bei Ladefehler)', async () => {
    const f = fakeFenster({ loading: true })
    const p = warteAufFensterBereit([f as never], 3000)
    f.webContents.emit('did-fail-load')
    const res = await p
    expect(res.bereit).toBe(true)
  })

  it('Timeout → bereit:false nach timeoutMs', async () => {
    vi.useFakeTimers()
    const f = fakeFenster({ loading: true }) // lädt und feuert nie
    const p = warteAufFensterBereit([f as never], 3000)
    await vi.advanceTimersByTimeAsync(3000)
    const res = await p
    expect(res.bereit).toBe(false)
  })

  it('zerstörtes Fenster → sofort bereit', async () => {
    const f = fakeFenster({ loading: true, zerstoert: true })
    const res = await warteAufFensterBereit([f as never], 3000)
    expect(res.bereit).toBe(true)
  })

  it('zerstörtes webContents → sofort bereit', async () => {
    const f = fakeFenster({ loading: true, wcZerstoert: true })
    const res = await warteAufFensterBereit([f as never], 3000)
    expect(res.bereit).toBe(true)
  })

  it('wirft nie (null/leeres Array/fehlendes webContents)', async () => {
    const a = await warteAufFensterBereit([null, undefined], 3000)
    expect(a.bereit).toBe(true)
    const b = await warteAufFensterBereit([], 3000)
    expect(b.bereit).toBe(true)
    const c = await warteAufFensterBereit([{ webContents: null } as never], 3000)
    expect(c.bereit).toBe(true)
  })

  it('mehrere Fenster: bereit erst wenn ALLE fertig', async () => {
    const a = fakeFenster({ loading: true })
    const b = fakeFenster({ loading: true })
    const p = warteAufFensterBereit([a as never, b as never], 3000)
    a.webContents.emit('did-finish-load')
    // b noch offen → race darf noch nicht auflösen; wir emitten b und erwarten dann bereit.
    b.webContents.emit('did-finish-load')
    const res = await p
    expect(res.bereit).toBe(true)
  })

  it('entfernt die Listener nach Auflösung (kein Leak)', async () => {
    const f = fakeFenster({ loading: true })
    const p = warteAufFensterBereit([f as never], 3000)
    expect(f.webContents.listenerCount('did-finish-load')).toBe(1)
    expect(f.webContents.listenerCount('did-fail-load')).toBe(1)
    f.webContents.emit('did-finish-load')
    await p
    expect(f.webContents.listenerCount('did-finish-load')).toBe(0)
    expect(f.webContents.listenerCount('did-fail-load')).toBe(0)
  })

  it('dauerMs wird über den injizierten jetzt() gemessen', async () => {
    let t = 1000
    const f = fakeFenster({ loading: false })
    const res = await warteAufFensterBereit([f as never], 3000, () => {
      const v = t
      t += 25
      return v
    })
    expect(res.dauerMs).toBe(25)
  })
})

// v0.7.4 — Regression: Ein 'did-fail-load' zählte zwar als „fertig" (richtig, damit der Hook nicht ewig
// wartet), war danach aber vom Erfolgsfall NICHT mehr unterscheidbar und wurde nirgends protokolliert.
// Ein gescheitertes pill.html blieb damit vollständig unsichtbar: Fenster lebt, send() verpufft,
// showInactive() zeigt eine leere Fläche, kein einziges Log-Ereignis.
describe('warteAufFensterBereit — Ladefehler', () => {
  it('did-fail-load gilt weiterhin als fertig, wird aber als Ladefehler gemeldet', async () => {
    const f = fakeFenster({ loading: true })
    const p = warteAufFensterBereit([f as never], 3000)
    f.webContents.emit('did-fail-load')
    const res = await p
    expect(res.bereit).toBe(true) // blockiert den Hook-Start weiterhin nicht
    expect(res.ladefehler).toEqual([0])
  })

  it('meldet den INDEX des gescheiterten Fensters (Aufrufer mappt auf recorder/pille)', async () => {
    const ok = fakeFenster({ loading: true })
    const kaputt = fakeFenster({ loading: true })
    const p = warteAufFensterBereit([ok as never, kaputt as never], 3000)
    ok.webContents.emit('did-finish-load')
    kaputt.webContents.emit('did-fail-load')
    const res = await p
    expect(res.ladefehler).toEqual([1])
  })

  it('sauberer Start → ladefehler leer', async () => {
    const f = fakeFenster({ loading: true })
    const p = warteAufFensterBereit([f as never], 3000)
    f.webContents.emit('did-finish-load')
    expect((await p).ladefehler).toEqual([])
  })

  it('entfernt beide Listener auch nach did-fail-load (kein Leak)', async () => {
    const f = fakeFenster({ loading: true })
    const p = warteAufFensterBereit([f as never], 3000)
    f.webContents.emit('did-fail-load')
    await p
    expect(f.webContents.listenerCount('did-finish-load')).toBe(0)
    expect(f.webContents.listenerCount('did-fail-load')).toBe(0)
  })
})

describe('protokolliereLadefehler', () => {
  function fakeLog() {
    const eintraege: Array<{ ereignis: string; felder?: Record<string, unknown> }> = []
    return {
      eintraege,
      warnung: (ereignis: string, felder?: Record<string, unknown>) =>
        eintraege.push({ ereignis, felder })
    }
  }

  it('protokolliert einen SPÄTEREN Ladefehler (nach dem Start, z. B. nach einem Reload)', () => {
    const f = fakeFenster({ loading: false })
    const log = fakeLog()
    protokolliereLadefehler(f as never, 'pille', log)
    f.webContents.emit('did-fail-load')
    expect(log.eintraege).toEqual([{ ereignis: 'fenster.ladefehler', felder: { fenster: 'pille' } }])
  })

  it('protokolliert jeden weiteren Ladefehler ebenfalls (kein Einmal-Flag)', () => {
    const f = fakeFenster({ loading: false })
    const log = fakeLog()
    protokolliereLadefehler(f as never, 'recorder', log)
    f.webContents.emit('did-fail-load')
    f.webContents.emit('did-fail-load')
    expect(log.eintraege).toHaveLength(2)
  })

  it('entferne() meldet ab und ist idempotent', () => {
    const f = fakeFenster({ loading: false })
    const log = fakeLog()
    const w = protokolliereLadefehler(f as never, 'pille', log)
    w.entferne()
    w.entferne()
    f.webContents.emit('did-fail-load')
    expect(log.eintraege).toEqual([])
  })

  it('zerstörtes/fehlendes Fenster → No-Op, wirft nicht', () => {
    const log = fakeLog()
    expect(() => protokolliereLadefehler(null, 'pille', log).entferne()).not.toThrow()
    const tot = fakeFenster({ zerstoert: true })
    expect(() => protokolliereLadefehler(tot as never, 'pille', log).entferne()).not.toThrow()
    tot.webContents.emit('did-fail-load')
    expect(log.eintraege).toEqual([])
  })
})
