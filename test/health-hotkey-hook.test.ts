import { describe, it, expect } from 'vitest'
import { pruefeHotkeyHook, type HotkeyHookPort } from '@main/health/pruefe-hotkey-hook'

function port(aktiv: boolean): HotkeyHookPort {
  return { async istAktiv() { return aktiv } }
}

describe('pruefeHotkeyHook', () => {
  it('ok, wenn der Hook aktiv ist', async () => {
    const r = await pruefeHotkeyHook({ hook: port(true) })
    expect(r.status).toBe('ok')
  })

  it('fehler, wenn der Hook nicht aktiv ist', async () => {
    const r = await pruefeHotkeyHook({ hook: port(false) })
    expect(r.status).toBe('fehler')
  })

  it('fehler, wenn der Port wirft', async () => {
    const wirftPort: HotkeyHookPort = {
      async istAktiv() {
        throw new Error('kaputt')
      }
    }
    const r = await pruefeHotkeyHook({ hook: wirftPort })
    expect(r.status).toBe('fehler')
  })
})
