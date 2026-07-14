import { describe, it, expect, vi } from 'vitest'
import { starteUiohookQuelle, type UiohookQuelle } from '@main/hotkey/uiohook-source'
import type { UiohookKeyboardEvent } from 'uiohook-napi'

// Fake-Hook: sammelt Listener, erlaubt manuelles Feuern; zählt start/stop.
function fakeHook() {
  const listeners: Record<string, ((e: UiohookKeyboardEvent) => void)[]> = { keydown: [], keyup: [] }
  let started = 0
  let stopped = 0
  const hook: UiohookQuelle = {
    on(event, listener) {
      listeners[event]!.push(listener)
      return hook
    },
    start() {
      started++
    },
    stop() {
      stopped++
    }
  }
  const feuere = (
    event: 'keydown' | 'keyup',
    keycode: number,
    mods: Partial<Pick<UiohookKeyboardEvent, 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'>> = {}
  ): void => {
    const e = {
      keycode,
      ctrlKey: mods.ctrlKey ?? false,
      altKey: mods.altKey ?? false,
      shiftKey: mods.shiftKey ?? false,
      metaKey: mods.metaKey ?? false
    } as UiohookKeyboardEvent
    for (const l of listeners[event]!) l(e)
  }
  return { hook, feuere, get started() { return started }, get stopped() { return stopped } }
}

const keineMaske = { ctrl: false, alt: false, shift: false, meta: false }

describe('starteUiohookQuelle', () => {
  it('mappt keydown/keyup-Keycodes auf KeyEvents (DOM-Namen) und startet den Hook', () => {
    const f = fakeHook()
    const verarbeiteTaste = vi.fn()
    starteUiohookQuelle({ verarbeiteTaste, hook: f.hook })

    expect(f.started).toBe(1)
    f.feuere('keydown', 0x0e1d) // ControlRight
    f.feuere('keydown', 0x0036) // ShiftRight
    f.feuere('keyup', 0x0036)

    expect(verarbeiteTaste).toHaveBeenNthCalledWith(1, { type: 'down', key: 'ControlRight', modifiers: keineMaske })
    expect(verarbeiteTaste).toHaveBeenNthCalledWith(2, { type: 'down', key: 'ShiftRight', modifiers: keineMaske })
    expect(verarbeiteTaste).toHaveBeenNthCalledWith(3, { type: 'up', key: 'ShiftRight', modifiers: keineMaske })
  })

  it('reicht die Modifier-Maske der Quelle durch (Selbstheilung verlorener Keyups)', () => {
    const f = fakeHook()
    const verarbeiteTaste = vi.fn()
    starteUiohookQuelle({ verarbeiteTaste, hook: f.hook })

    f.feuere('keydown', 0x001d, { ctrlKey: true, metaKey: true }) // ControlLeft bei gehaltenem Win
    expect(verarbeiteTaste).toHaveBeenCalledWith({
      type: 'down',
      key: 'ControlLeft',
      modifiers: { ctrl: true, alt: false, shift: false, meta: true }
    })
  })

  it('verwirft ungemappte Keycodes', () => {
    const f = fakeHook()
    const verarbeiteTaste = vi.fn()
    starteUiohookQuelle({ verarbeiteTaste, hook: f.hook })
    f.feuere('keydown', 0xffff)
    expect(verarbeiteTaste).not.toHaveBeenCalled()
  })

  it('der Stopp-Thunk stoppt den Hook', () => {
    const f = fakeHook()
    const stop = starteUiohookQuelle({ verarbeiteTaste: vi.fn(), hook: f.hook })
    stop()
    expect(f.stopped).toBe(1)
  })

  // W3-ε: onStatus macht den (sonst geschluckten) Start-Erfolg für den Health-Check sichtbar.
  it('meldet onStatus(true) bei erfolgreichem Start', () => {
    const f = fakeHook()
    const onStatus = vi.fn()
    starteUiohookQuelle({ verarbeiteTaste: vi.fn(), hook: f.hook, onStatus })
    expect(onStatus).toHaveBeenCalledWith(true)
  })

  it('meldet onStatus(false), wenn hook.start() wirft (Fehler wird geschluckt, App-Start lebt)', () => {
    const werfenderHook: UiohookQuelle = {
      on() {
        return werfenderHook
      },
      start() {
        throw new Error('nativer Hook nicht ladbar')
      },
      stop() {}
    }
    const onStatus = vi.fn()
    const stop = starteUiohookQuelle({ verarbeiteTaste: vi.fn(), hook: werfenderHook, onStatus })
    expect(onStatus).toHaveBeenCalledWith(false)
    expect(() => stop()).not.toThrow() // No-Op-Stopp-Thunk
  })

  // B3 (R5, Perf, opt-in): additive Verdrahtung, ändert NICHTS an der bestehenden Struktur.
  // Ohne `perf`-Dep (alle Tests oben) bleibt das Verhalten unverändert (Default NOOP_PERF).
  it('ruft bei injiziertem perf-Fake erfasseStart/erfasseEnde für jedes keydown/keyup-Event auf', () => {
    const f = fakeHook()
    const aufrufe: string[] = []
    const perf = {
      erfasseStart: vi.fn(() => {
        aufrufe.push('start')
        return 42
      }),
      erfasseEnde: vi.fn((marker: number) => {
        aufrufe.push(`ende:${marker}`)
      }),
      ringpuffer: () => [],
      stoppe: vi.fn()
    }
    starteUiohookQuelle({ verarbeiteTaste: vi.fn(), hook: f.hook, perf })

    f.feuere('keydown', 0x0e1d) // ControlRight
    f.feuere('keyup', 0x0e1d)

    expect(perf.erfasseStart).toHaveBeenCalledTimes(2)
    expect(perf.erfasseEnde).toHaveBeenCalledTimes(2)
    expect(perf.erfasseEnde).toHaveBeenNthCalledWith(1, 42)
    expect(perf.erfasseEnde).toHaveBeenNthCalledWith(2, 42)
    // Reihenfolge pro Event: erst erfasseStart, dann erfasseEnde (keydown, dann keyup):
    expect(aufrufe).toEqual(['start', 'ende:42', 'start', 'ende:42'])
  })

  it('ruft perf auch für ungemappte Keycodes auf (Latenz des Hook-Aufrufs selbst, nicht nur der Verarbeitung)', () => {
    const f = fakeHook()
    const perf = {
      erfasseStart: vi.fn(() => 1),
      erfasseEnde: vi.fn(),
      ringpuffer: () => [],
      stoppe: vi.fn()
    }
    const verarbeiteTaste = vi.fn()
    starteUiohookQuelle({ verarbeiteTaste, hook: f.hook, perf })

    f.feuere('keydown', 0xffff) // ungemappt
    expect(verarbeiteTaste).not.toHaveBeenCalled()
    expect(perf.erfasseStart).toHaveBeenCalledTimes(1)
    expect(perf.erfasseEnde).toHaveBeenCalledTimes(1)
  })
})
