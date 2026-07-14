import { describe, it, expect, vi } from 'vitest'

// electron/ipcMain durch einen EventEmitter ersetzen, damit der Adapter ohne Electron testbar ist.
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  return { ipcMain: new EventEmitter() }
})

import { EventEmitter } from 'node:events'
import { ipcMain } from 'electron'
import { createRecorder } from '@main/recording/recorder-adapter'

function fakeFenster() {
  return { webContents: { send: vi.fn() } } as never
}

// Fenster mit steuerbarer Zerstörung + webContents als EventEmitter (render-process-gone/destroyed).
function fakeFensterMitEvents() {
  const webContents = Object.assign(new EventEmitter(), {
    send: vi.fn(),
    destroyed: false,
    isDestroyed(): boolean {
      return this.destroyed
    }
  })
  const fenster = {
    destroyed: false,
    isDestroyed(): boolean {
      return this.destroyed
    },
    webContents
  }
  return fenster
}

describe('createRecorder', () => {
  it('stop() löst mit Audio-Blob + Dauer auf, wenn recorder:result kommt', async () => {
    const recorder = createRecorder(fakeFenster())
    const stopP = recorder.stop()

    ;(ipcMain as unknown as { emit: (c: string, ...a: unknown[]) => void }).emit(
      'recorder:result',
      {},
      { buffer: new ArrayBuffer(3), durationSeconds: 1.2, mimeType: 'audio/webm' }
    )

    const res = await stopP
    expect(res.durationSeconds).toBe(1.2)
    expect(res.audio.type).toBe('audio/webm')
  })

  it('discard() rejected den offenen stop()-Promise mit AbortError (kein Hänger)', async () => {
    const recorder = createRecorder(fakeFenster())
    const stopP = recorder.stop()

    recorder.discard()

    await expect(stopP).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('recorder:error rejected den stop()-Promise mit der Meldung', async () => {
    const recorder = createRecorder(fakeFenster())
    const stopP = recorder.stop()

    ;(ipcMain as unknown as { emit: (c: string, ...a: unknown[]) => void }).emit(
      'recorder:error',
      {},
      'Mikrofon nicht verfügbar'
    )

    await expect(stopP).rejects.toThrow(/Mikrofon nicht verfügbar/)
  })

  // --- P0: zerstörtes Recorder-Fenster reißt nicht die App mit ---

  it('start()/stop()/discard() werfen NICHT, wenn das Fenster zerstört ist (Guard)', () => {
    const fenster = fakeFensterMitEvents()
    fenster.destroyed = true
    fenster.webContents.destroyed = true
    // send() darf gar nicht erst gerufen werden (sonst „Object has been destroyed" im echten Electron).
    fenster.webContents.send.mockImplementation(() => {
      throw new Error('darf nicht gesendet werden')
    })
    const recorder = createRecorder(fenster as never)

    expect(() => recorder.start()).not.toThrow()
    expect(() => recorder.discard()).not.toThrow()
    expect(fenster.webContents.send).not.toHaveBeenCalled()
  })

  it('stop() auf zerstörtem Fenster rejected (Fehlerpfad) statt zu hängen', async () => {
    const fenster = fakeFensterMitEvents()
    fenster.destroyed = true
    fenster.webContents.destroyed = true
    const recorder = createRecorder(fenster as never)

    await expect(recorder.stop()).rejects.toThrow()
  })

  it('render-process-gone während wartendem stop() → Promise rejected + Listener aufgeräumt', async () => {
    const fenster = fakeFensterMitEvents()
    const recorder = createRecorder(fenster as never)
    const stopP = recorder.stop()

    // Renderer stirbt (Crash) → das Event muss den wartenden stop() auflösen.
    fenster.webContents.emit('render-process-gone', {}, { reason: 'crashed' })

    await expect(stopP).rejects.toThrow()
    // Keine verwaisten once-Listener auf ipcMain zurückgelassen.
    expect((ipcMain as unknown as EventEmitter).listenerCount('recorder:result')).toBe(0)
    expect((ipcMain as unknown as EventEmitter).listenerCount('recorder:error')).toBe(0)
  })

  it('destroyed-Event während wartendem stop() → Promise rejected', async () => {
    const fenster = fakeFensterMitEvents()
    const recorder = createRecorder(fenster as never)
    const stopP = recorder.stop()

    fenster.webContents.emit('destroyed')

    await expect(stopP).rejects.toThrow()
  })

  it('Doppel-stop(): zweiter Aufruf löst keine verwaisten once-Listener aus; keiner hängt für immer', async () => {
    const fenster = fakeFensterMitEvents()
    const recorder = createRecorder(fenster as never)
    const ee = ipcMain as unknown as EventEmitter

    const erst = recorder.stop()
    // Der erste stop() muss durch den zweiten sauber abgelöst werden (AbortError), nicht hängen bleiben.
    const erstErgebnis = erst.then(() => 'resolved', () => 'rejected')
    const zweit = recorder.stop()

    // Kein Listener-Leak: der abgelöste erste stop() darf seine once-Listener nicht zurücklassen —
    // nur je EIN offener Listener pro Kanal (der des zweiten stop()).
    expect(ee.listenerCount('recorder:result')).toBe(1)
    expect(ee.listenerCount('recorder:error')).toBe(1)

    ee.emit('recorder:result', {}, {
      buffer: new ArrayBuffer(2),
      durationSeconds: 1,
      mimeType: 'audio/webm'
    })

    expect(await erstErgebnis).toBe('rejected') // erster stop() abgelöst → kein Hänger
    await expect(zweit).resolves.toBeDefined() // zweiter stop() liefert das Ergebnis

    // Am Ende keine verwaisten Listener.
    expect(ee.listenerCount('recorder:result')).toBe(0)
    expect(ee.listenerCount('recorder:error')).toBe(0)
  })
})
