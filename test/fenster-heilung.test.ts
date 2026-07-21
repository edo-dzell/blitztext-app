import { describe, it, expect, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { montiereFensterHeilung } from '@main/window/fenster-heilung'

// Fake-Fenster: webContents als EventEmitter mit reload()/isDestroyed(). Muster analog
// test/fenster-bereitschaft.test.ts / test/recorder-adapter.test.ts.
function fakeFenster(opts: { zerstoert?: boolean; wcZerstoert?: boolean } = {}) {
  const webContents = Object.assign(new EventEmitter(), {
    destroyed: opts.wcZerstoert ?? false,
    reloadCount: 0,
    isDestroyed(): boolean {
      return this.destroyed
    },
    reload(): void {
      this.reloadCount++
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

// Minimaler Fake-Log: sammelt Aufrufe je Stufe (ereignis + felder) für die Feld-Assertions.
function fakeLog() {
  const eintraege: Array<{ stufe: string; ereignis: string; felder?: Record<string, unknown> }> = []
  const push = (stufe: string) => (ereignis: string, felder?: Record<string, unknown>) =>
    eintraege.push({ stufe, ereignis, felder })
  return {
    eintraege,
    debug: push('debug'),
    info: push('info'),
    warnung: push('warnung'),
    fehler: push('fehler')
  }
}

describe('montiereFensterHeilung', () => {
  it('reload einmal bei render-process-gone', () => {
    const f = fakeFenster()
    montiereFensterHeilung({ fenster: f as never, name: 'recorder' })
    f.webContents.emit('render-process-gone')
    expect(f.webContents.reloadCount).toBe(1)
  })

  it('Deckel: höchstens maxReloads Reloads', () => {
    const f = fakeFenster()
    const beiAufgabe = vi.fn()
    montiereFensterHeilung({ fenster: f as never, name: 'recorder', maxReloads: 3, beiAufgabe })
    for (let i = 0; i < 5; i++) f.webContents.emit('render-process-gone')
    expect(f.webContents.reloadCount).toBe(3)
    expect(beiAufgabe).toHaveBeenCalledTimes(1)
  })

  it('gleitendes Fenster: nach Ablauf von fensterMs zählt der Deckel wieder frisch', () => {
    let t = 1000
    const f = fakeFenster()
    const beiAufgabe = vi.fn()
    montiereFensterHeilung({
      fenster: f as never,
      name: 'recorder',
      maxReloads: 2,
      fensterMs: 60000,
      jetzt: () => t,
      beiAufgabe
    })
    // Zwei Crashes im Fenster → 2 Reloads.
    f.webContents.emit('render-process-gone')
    t += 1000
    f.webContents.emit('render-process-gone')
    expect(f.webContents.reloadCount).toBe(2)
    // Dritter Crash noch im Fenster → Deckel greift (Aufgabe), kein weiterer Reload.
    t += 1000
    f.webContents.emit('render-process-gone')
    expect(f.webContents.reloadCount).toBe(2)
    expect(beiAufgabe).toHaveBeenCalledTimes(1)
  })

  it('gleitendes Fenster: alte Crashes altern aus → Deckel greift nicht, weiter heilbar', () => {
    let t = 1000
    const f = fakeFenster()
    const beiAufgabe = vi.fn()
    montiereFensterHeilung({
      fenster: f as never,
      name: 'pille',
      maxReloads: 2,
      fensterMs: 60000,
      jetzt: () => t,
      beiAufgabe
    })
    f.webContents.emit('render-process-gone') // t=1000 → reload 1
    t += 30000
    f.webContents.emit('render-process-gone') // t=31000 → reload 2
    expect(f.webContents.reloadCount).toBe(2)
    // Weit über fensterMs nach dem ERSTEN Crash: t=1000 fällt aus dem 60s-Fenster (nur t=31000 bleibt),
    // also < maxReloads im Fenster → statt Aufgabe wird erneut geheilt (Selbstheilung erholt sich).
    t += 70000 // t=101000; Fenster deckt [41000..101000] → nur der t=31000-Eintrag fällt heraus
    f.webContents.emit('render-process-gone')
    expect(f.webContents.reloadCount).toBe(3)
    expect(beiAufgabe).not.toHaveBeenCalled()
  })

  it('destroyed-Fenster: kein Reload (App-Abbau)', () => {
    const f = fakeFenster({ zerstoert: true })
    montiereFensterHeilung({ fenster: f as never, name: 'recorder' })
    f.webContents.emit('render-process-gone')
    expect(f.webContents.reloadCount).toBe(0)
  })

  it('zerstörtes webContents: kein Reload', () => {
    const f = fakeFenster({ wcZerstoert: true })
    // Bindung passiert nicht (wc zerstört) → emit läuft ins Leere, aber der Guard schützt zusätzlich.
    montiereFensterHeilung({ fenster: f as never, name: 'recorder' })
    f.webContents.emit('render-process-gone')
    expect(f.webContents.reloadCount).toBe(0)
  })

  it('entferne(): danach kein Reload mehr', () => {
    const f = fakeFenster()
    const { entferne } = montiereFensterHeilung({ fenster: f as never, name: 'pille' })
    expect(f.webContents.listenerCount('render-process-gone')).toBe(1)
    entferne()
    expect(f.webContents.listenerCount('render-process-gone')).toBe(0)
    f.webContents.emit('render-process-gone')
    expect(f.webContents.reloadCount).toBe(0)
  })

  it('Log-Felder: renderer_tot/neu_geladen/heilung_aufgegeben tragen nur { fenster:name }', () => {
    const f = fakeFenster()
    const log = fakeLog()
    montiereFensterHeilung({ fenster: f as never, name: 'recorder', log: log as never, maxReloads: 1 })
    f.webContents.emit('render-process-gone') // reload → renderer_tot + neu_geladen
    f.webContents.emit('render-process-gone') // Deckel → renderer_tot + heilung_aufgegeben
    const tot = log.eintraege.find((e) => e.ereignis === 'fenster.renderer_tot')
    const geladen = log.eintraege.find((e) => e.ereignis === 'fenster.neu_geladen')
    const aufgegeben = log.eintraege.find((e) => e.ereignis === 'fenster.heilung_aufgegeben')
    expect(tot?.felder).toEqual({ fenster: 'recorder' })
    expect(geladen?.felder).toEqual({ fenster: 'recorder' })
    expect(aufgegeben?.felder).toEqual({ fenster: 'recorder' })
    // Text-frei: kein Feld trägt einen freien String außer dem Enum-Namen.
    for (const e of log.eintraege) {
      for (const v of Object.values(e.felder ?? {})) {
        expect(['recorder', 'pille']).toContain(v)
      }
    }
  })

  it('wirft nicht bei fehlendem webContents; entferne() bleibt aufrufbar', () => {
    const heilung = montiereFensterHeilung({ fenster: { webContents: null } as never, name: 'pille' })
    expect(() => heilung.entferne()).not.toThrow()
  })

  it('Reihenfolge-Sonde: ein zuvor registrierter Adapter-Listener feuert VOR dem Reload', () => {
    const f = fakeFenster()
    const reihenfolge: string[] = []
    // Der recorder-adapter registriert seinen 'render-process-gone'-Listener zuerst (in createRecorder).
    f.webContents.on('render-process-gone', () => reihenfolge.push('adapter'))
    // Danach die Heilung montieren → ihr Listener kommt hinten dran, feuert also nach dem Adapter.
    montiereFensterHeilung({
      fenster: f as never,
      name: 'recorder',
      log: {
        debug: () => {},
        info: (ereignis: string) => {
          if (ereignis === 'fenster.neu_geladen') reihenfolge.push('reload')
        },
        warnung: () => {},
        fehler: () => {}
      } as never
    })
    f.webContents.emit('render-process-gone')
    expect(reihenfolge).toEqual(['adapter', 'reload'])
  })
})
