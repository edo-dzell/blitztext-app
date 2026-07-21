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

describe('preload sitzung.starteManuell/stoppeManuell (W2-S8, Onboarding-Wizard-Probe)', () => {
  beforeEach(() => {
    vi.resetModules()
    ;(globalThis as unknown as { process: { contextIsolated: boolean } }).process = {
      ...process,
      contextIsolated: false
    }
  })

  it('starteManuell reicht die workflowId an sitzung:starteManuell weiter', async () => {
    const { ipcRenderer } = await import('electron')
    await import('../src/preload/index')
    const api = (globalThis as unknown as { blitztext: unknown }).blitztext as {
      sitzung: { starteManuell: (id: string) => Promise<void>; stoppeManuell: () => Promise<void> }
    }

    await api.sitzung.starteManuell('transcribe')

    expect(ipcRenderer.invoke).toHaveBeenCalledWith('sitzung:starteManuell', 'transcribe')
  })

  it('stoppeManuell ruft sitzung:stoppeManuell ohne Argumente auf', async () => {
    const { ipcRenderer } = await import('electron')
    await import('../src/preload/index')
    const api = (globalThis as unknown as { blitztext: unknown }).blitztext as {
      sitzung: { starteManuell: (id: string) => Promise<void>; stoppeManuell: () => Promise<void> }
    }

    await api.sitzung.stoppeManuell()

    expect(ipcRenderer.invoke).toHaveBeenCalledWith('sitzung:stoppeManuell')
  })
})

describe('preload workflow.export/import (Preset-Datei)', () => {
  beforeEach(() => {
    vi.resetModules()
    ;(globalThis as unknown as { process: { contextIsolated: boolean } }).process = {
      ...process,
      contextIsolated: false
    }
  })

  it('registriert workflow.export und workflow.import als Funktionen', async () => {
    await import('../src/preload/index')
    const api = (globalThis as unknown as { blitztext: unknown }).blitztext as {
      workflow: { export: unknown; import: unknown }
    }

    expect(typeof api.workflow.export).toBe('function')
    expect(typeof api.workflow.import).toBe('function')
  })

  it('export reicht die workflowId an workflow:export weiter', async () => {
    const { ipcRenderer } = await import('electron')
    await import('../src/preload/index')
    const api = (globalThis as unknown as { blitztext: unknown }).blitztext as {
      workflow: { export: (id: string) => Promise<unknown> }
    }

    await api.workflow.export('custom-123')

    expect(ipcRenderer.invoke).toHaveBeenCalledWith('workflow:export', 'custom-123')
  })

  it('import ruft workflow:import ohne Argumente auf', async () => {
    const { ipcRenderer } = await import('electron')
    await import('../src/preload/index')
    const api = (globalThis as unknown as { blitztext: unknown }).blitztext as {
      workflow: { import: () => Promise<unknown> }
    }

    await api.workflow.import()

    expect(ipcRenderer.invoke).toHaveBeenCalledWith('workflow:import')
  })
})

describe('preload api.log (v0.7.2 Ereignislog-Bridge, Slice B)', () => {
  beforeEach(() => {
    vi.resetModules()
    // Der electron-Mock ist modulweit; send/invoke sind vi.fn() und akkumulieren über Tests hinweg.
    // Für die send-vs-invoke-Trennung hier zählen wir die Aufrufe PRO Test → Historie leeren.
    vi.clearAllMocks()
    ;(globalThis as unknown as { process: { contextIsolated: boolean } }).process = {
      ...process,
      contextIsolated: false
    }
  })

  it('schreibe verwendet send (fire-and-forget) auf log:schreibe mit {stufe, ereignis, felder}', async () => {
    const { ipcRenderer } = await import('electron')
    await import('../src/preload/index')
    const api = (globalThis as unknown as { blitztext: unknown }).blitztext as {
      log: {
        schreibe: (
          stufe: string,
          ereignis: string,
          felder?: Record<string, string | number | boolean>
        ) => void
      }
    }

    const ergebnis = api.log.schreibe('fehler', 'renderer.pill.fehler', { message: 'boom' })

    // fire-and-forget: kein Promise, kein Rückgabewert
    expect(ergebnis).toBeUndefined()
    expect(ipcRenderer.send).toHaveBeenCalledWith('log:schreibe', {
      stufe: 'fehler',
      ereignis: 'renderer.pill.fehler',
      felder: { message: 'boom' }
    })
    // send, NICHT invoke
    expect(ipcRenderer.invoke).not.toHaveBeenCalled()
  })

  it('schreibe ohne Felder sendet felder=undefined', async () => {
    const { ipcRenderer } = await import('electron')
    await import('../src/preload/index')
    const api = (globalThis as unknown as { blitztext: unknown }).blitztext as {
      log: { schreibe: (stufe: string, ereignis: string) => void }
    }

    api.log.schreibe('info', 'renderer.foo')

    expect(ipcRenderer.send).toHaveBeenCalledWith('log:schreibe', {
      stufe: 'info',
      ereignis: 'renderer.foo',
      felder: undefined
    })
  })

  it('pfad/oeffneOrdner/loeschen laufen über invoke auf die passenden Kanäle', async () => {
    const { ipcRenderer } = await import('electron')
    await import('../src/preload/index')
    const api = (globalThis as unknown as { blitztext: unknown }).blitztext as {
      log: {
        pfad: () => Promise<string>
        oeffneOrdner: () => Promise<void>
        loeschen: () => Promise<void>
      }
    }

    await api.log.pfad()
    await api.log.oeffneOrdner()
    await api.log.loeschen()

    expect(ipcRenderer.invoke).toHaveBeenCalledWith('log:pfad')
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('log:oeffneOrdner')
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('log:loeschen')
    // Diese Wege sind Anfragen (invoke), nicht send.
    expect(ipcRenderer.send).not.toHaveBeenCalled()
  })
})
