import { describe, it, expect } from 'vitest'
import { canSend, sendeAn, type SendbaresFenster } from '@main/window/send-to-window'

function fenster(opts: { destroyed?: boolean; wcDestroyed?: boolean }): SendbaresFenster & {
  gesendet: Array<[string, unknown[]]>
} {
  const gesendet: Array<[string, unknown[]]> = []
  return {
    gesendet,
    isDestroyed: () => opts.destroyed ?? false,
    webContents: {
      isDestroyed: () => opts.wcDestroyed ?? false,
      send: (channel, ...args) => gesendet.push([channel, args])
    }
  }
}

describe('canSend', () => {
  it('false bei null', () => expect(canSend(null)).toBe(false))
  it('false bei zerstörtem Fenster', () => expect(canSend(fenster({ destroyed: true }))).toBe(false))
  it('false bei zerstörten webContents', () =>
    expect(canSend(fenster({ wcDestroyed: true }))).toBe(false))
  it('true bei lebendem Fenster', () => expect(canSend(fenster({}))).toBe(true))
})

describe('sendeAn', () => {
  it('sendet, wenn sendbar', () => {
    const w = fenster({})
    sendeAn(w, 'history:changed')
    expect(w.gesendet).toEqual([['history:changed', []]])
  })
  it('no-op, wenn nicht sendbar', () => {
    const w = fenster({ destroyed: true })
    sendeAn(w, 'history:changed')
    expect(w.gesendet).toEqual([])
  })
  it('no-op bei zerstörten webContents (kein send-auf-Zerstörtes-Crash)', () => {
    const w = fenster({ wcDestroyed: true })
    sendeAn(w, 'theme:systemChanged', true)
    expect(w.gesendet).toEqual([])
  })
  it('no-op bei null (Broadcast über eine Liste mit leerem Slot)', () => {
    expect(() => sendeAn(null, 'theme:systemChanged', false)).not.toThrow()
  })
})
