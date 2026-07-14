import { describe, it, expect, vi, beforeEach } from 'vitest'

// S21-Rest (Listener-Leak, W3-μ): preload/index.ts importiert contextBridge/ipcRenderer direkt aus
// 'electron' → wie recorder-adapter.test.ts gemockt (EventEmitter-basiert), damit ipcRenderer.on/
// removeListener echtes Listener-Verhalten zeigen. process.contextIsolated=false lässt den
// Kontextisolations-Fallback greifen (globalThis.blitztext = api statt contextBridge), damit `api`
// hier direkt erreichbar ist, ohne contextBridge.exposeInMainWorld mocken zu müssen.
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  const ipcRenderer = Object.assign(new EventEmitter(), {
    invoke: vi.fn(),
    send: vi.fn(),
    removeListener: vi.fn((channel: string, listener: (...args: unknown[]) => void) => {
      EventEmitter.prototype.removeListener.call(ipcRenderer, channel, listener)
    })
  })
  return {
    contextBridge: { exposeInMainWorld: vi.fn() },
    ipcRenderer
  }
})

describe('preload theme.onSystemChanged (Abmeldung, S21-Rest)', () => {
  beforeEach(() => {
    vi.resetModules()
    ;(globalThis as unknown as { process: { contextIsolated: boolean } }).process = {
      ...process,
      contextIsolated: false
    }
  })

  it('liefert eine Abmelde-Funktion, die den registrierten Listener entfernt', async () => {
    const { ipcRenderer } = await import('electron')
    await import('../src/preload/index')
    const api = (globalThis as unknown as { blitztext: unknown }).blitztext as {
      theme: { onSystemChanged: (cb: (dark: boolean) => void) => (() => void) | void }
    }

    const cb = vi.fn()
    const abmelden = api.theme.onSystemChanged(cb)

    expect(ipcRenderer.listenerCount('theme:systemChanged')).toBe(1)

    // Ein Event VOR der Abmeldung erreicht den Callback normal.
    ipcRenderer.emit('theme:systemChanged', {}, true)
    expect(cb).toHaveBeenCalledWith(true)

    abmelden?.()

    expect(ipcRenderer.listenerCount('theme:systemChanged')).toBe(0)

    // Ein Event NACH der Abmeldung erreicht den Callback nicht mehr.
    ipcRenderer.emit('theme:systemChanged', {}, false)
    expect(cb).toHaveBeenCalledTimes(1)
  })

  it('mehrere Registrierungen entfernen jeweils nur ihren eigenen Listener (Referenz-Matching)', async () => {
    const { ipcRenderer } = await import('electron')
    await import('../src/preload/index')
    const api = (globalThis as unknown as { blitztext: { theme: { onSystemChanged: (cb: (dark: boolean) => void) => (() => void) | void } } }).blitztext

    const cb1 = vi.fn()
    const cb2 = vi.fn()
    const abmelden1 = api.theme.onSystemChanged(cb1)
    api.theme.onSystemChanged(cb2)

    expect(ipcRenderer.listenerCount('theme:systemChanged')).toBe(2)

    abmelden1?.()
    expect(ipcRenderer.listenerCount('theme:systemChanged')).toBe(1)

    ipcRenderer.emit('theme:systemChanged', {}, true)
    expect(cb1).not.toHaveBeenCalled()
    expect(cb2).toHaveBeenCalledWith(true)
  })
})

describe('preload workflowStatus.onChanged (C4, gleiches Muster wie history.onChanged)', () => {
  beforeEach(() => {
    vi.resetModules()
    ;(globalThis as unknown as { process: { contextIsolated: boolean } }).process = {
      ...process,
      contextIsolated: false
    }
  })

  it('registriert einen Listener auf workflow:status und liefert eine Abmelde-Funktion', async () => {
    const { ipcRenderer } = await import('electron')
    await import('../src/preload/index')
    const api = (globalThis as unknown as { blitztext: unknown }).blitztext as {
      workflowStatus: { onChanged: (cb: (phase: unknown) => void) => () => void }
    }

    const cb = vi.fn()
    const abmelden = api.workflowStatus.onChanged(cb)

    expect(ipcRenderer.listenerCount('workflow:status')).toBe(1)

    const phase = { status: 'aufnehmen' }
    ipcRenderer.emit('workflow:status', {}, phase)
    expect(cb).toHaveBeenCalledWith(phase)

    abmelden()

    expect(ipcRenderer.listenerCount('workflow:status')).toBe(0)

    // Ein Event NACH der Abmeldung erreicht den Callback nicht mehr.
    ipcRenderer.emit('workflow:status', {}, { status: 'fertig' })
    expect(cb).toHaveBeenCalledTimes(1)
  })
})
