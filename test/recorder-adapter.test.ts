import { describe, it, expect, vi } from 'vitest'

// electron/ipcMain durch einen EventEmitter ersetzen, damit der Adapter ohne Electron testbar ist.
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  return { ipcMain: new EventEmitter() }
})

import { EventEmitter } from 'node:events'
import { ipcMain } from 'electron'
import { createRecorder } from '@main/recording/recorder-adapter'

// v0.7.3 (A1): createRecorder registriert einen DAUERHAFTEN 'recorder:error'-Listener. Der Fake-ipcMain
// wird über die ganze Datei geteilt, sodass die vielen createRecorder-Aufrufe die 10er-Default-Grenze
// überschreiten (reines Test-Artefakt: die echte App hat einen einzigen Recorder). Limit anheben, damit
// keine MaxListenersExceededWarning die Testausgabe verrauscht.
;(ipcMain as unknown as EventEmitter).setMaxListeners(100)

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
    const ee = ipcMain as unknown as EventEmitter
    const fenster = fakeFensterMitEvents()
    // v0.7.3 (A1): createRecorder registriert jetzt EINEN dauerhaften 'recorder:error'-Listener
    // (externer Aufnahme-Fehlerkanal), der die stop()-Lebensdauer überdauert. Der Fake-ipcMain wird über
    // die ganze Datei geteilt, also Baseline JETZT (nach createRecorder) messen und Deltas prüfen.
    const recorder = createRecorder(fenster as never)
    const fehlerBasis = ee.listenerCount('recorder:error') // = dauerhafte Listener inkl. dem neuen
    const stopP = recorder.stop()

    // Renderer stirbt (Crash) → das Event muss den wartenden stop() auflösen.
    fenster.webContents.emit('render-process-gone', {}, { reason: 'crashed' })

    await expect(stopP).rejects.toThrow()
    // Keine verwaisten once-Listener auf ipcMain zurückgelassen — der once('recorder:result') ist weg,
    // und der once('recorder:error') des stop() ist weg (nur der dauerhafte Listener bleibt, Delta 0).
    expect(ee.listenerCount('recorder:result')).toBe(0)
    expect(ee.listenerCount('recorder:error')).toBe(fehlerBasis)
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
    const ee = ipcMain as unknown as EventEmitter
    const recorder = createRecorder(fenster as never)
    // v0.7.3 (A1): der dauerhafte externe 'recorder:error'-Listener zählt fortan mit → Baseline messen
    // und Deltas prüfen (der geteilte Fake-ipcMain akkumuliert sonst über die Datei).
    const fehlerBasis = ee.listenerCount('recorder:error')

    const erst = recorder.stop()
    // Der erste stop() muss durch den zweiten sauber abgelöst werden (AbortError), nicht hängen bleiben.
    const erstErgebnis = erst.then(() => 'resolved', () => 'rejected')
    const zweit = recorder.stop()

    // Kein Listener-Leak: der abgelöste erste stop() darf seine once-Listener nicht zurücklassen —
    // nur je EIN offener once-Listener pro Kanal (der des zweiten stop()); bei recorder:error zusätzlich
    // der dauerhafte externe Listener (Baseline), daher Delta +1.
    expect(ee.listenerCount('recorder:result')).toBe(1)
    expect(ee.listenerCount('recorder:error')).toBe(fehlerBasis + 1)

    ee.emit('recorder:result', {}, {
      buffer: new ArrayBuffer(2),
      durationSeconds: 1,
      mimeType: 'audio/webm'
    })

    expect(await erstErgebnis).toBe('rejected') // erster stop() abgelöst → kein Hänger
    await expect(zweit).resolves.toBeDefined() // zweiter stop() liefert das Ergebnis

    // Am Ende keine verwaisten once-Listener mehr — nur der dauerhafte externe Listener bleibt (Baseline).
    expect(ee.listenerCount('recorder:result')).toBe(0)
    expect(ee.listenerCount('recorder:error')).toBe(fehlerBasis)
  })

  // --- v0.7.3 (A1): dauerhafter externer Aufnahme-Fehlerkanal (recorder:error außerhalb von stop()) ---

  it('externer recorder:error OHNE laufenden stop() → onFehler-Callback wird mit der Meldung gerufen', () => {
    const ee = ipcMain as unknown as EventEmitter
    const recorder = createRecorder(fakeFenster())
    const gemeldet: string[] = []
    recorder.onFehler?.((m) => gemeldet.push(m))

    // Aufnahme läuft (kein stop() aktiv), das Mikrofon fällt aus → der Renderer sendet recorder:error.
    ee.emit('recorder:error', {}, 'Mikrofon exklusiv belegt')

    expect(gemeldet).toEqual(['Mikrofon exklusiv belegt'])
  })

  it('externer recorder:error WÄHREND eines wartenden stop() → NUR der stop()-Reject, KEINE Doppelmeldung', async () => {
    const ee = ipcMain as unknown as EventEmitter
    const recorder = createRecorder(fakeFenster())
    const gemeldet: string[] = []
    recorder.onFehler?.((m) => gemeldet.push(m))

    const stopP = recorder.stop() // stop läuft → der dauerhafte Listener muss sich raushalten (stopLaeuft)
    ee.emit('recorder:error', {}, 'Aufnahme kaputt')

    await expect(stopP).rejects.toThrow(/Aufnahme kaputt/)
    // Der stop()-once-Listener hat den Fehler verarbeitet; der externe Callback DARF nicht auch feuern.
    expect(gemeldet).toEqual([])
  })

  it('start(): sendeSicher schlägt fehl (zerstörtes Fenster) → onFehler meldet „Aufnahme-Fenster nicht verfügbar."', () => {
    const fenster = fakeFensterMitEvents()
    fenster.destroyed = true
    fenster.webContents.destroyed = true
    const recorder = createRecorder(fenster as never)
    const gemeldet: string[] = []
    recorder.onFehler?.((m) => gemeldet.push(m))

    recorder.start() // send scheitert → der Nutzer bekäme sonst nie ein stop()-Ergebnis

    expect(gemeldet).toEqual(['Aufnahme-Fenster nicht verfügbar.'])
  })

  it('externer recorder:error NACH abgeschlossenem stop() (Listener dauerhaft) → onFehler feuert wieder', async () => {
    const ee = ipcMain as unknown as EventEmitter
    const recorder = createRecorder(fakeFenster())
    const gemeldet: string[] = []
    recorder.onFehler?.((m) => gemeldet.push(m))

    // Ein stop() sauber abschließen (setzt stopLaeuft wieder auf false via aufraeumen()).
    const stopP = recorder.stop()
    ee.emit('recorder:result', {}, { buffer: new ArrayBuffer(2), durationSeconds: 1, mimeType: 'audio/webm' })
    await stopP

    // Danach ein externer Fehler (nächste Aufnahme): der dauerhafte Listener greift wieder.
    ee.emit('recorder:error', {}, 'späterer Ausfall')
    expect(gemeldet).toEqual(['späterer Ausfall'])
  })
})
