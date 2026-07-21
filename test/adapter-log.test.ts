import { describe, it, expect, vi } from 'vitest'

// v0.7.2 Ereignislog — Verdrahtung in den nativen Adaptern (Slice D). Prüft NUR, dass die richtigen
// Ereignisse mit text-freien Feldern gefeuert werden; das Verhalten der Adapter bleibt unverändert
// (die Bestandstests recorder-adapter.test.ts / paste-*.test.ts decken das ab).

// electron: ipcMain als EventEmitter (Recorder), app/clipboard als minimale Fakes (Paste).
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  return {
    ipcMain: new EventEmitter(),
    app: { isPackaged: false, getAppPath: () => '/app', getPath: () => '/tmp' },
    clipboard: { readText: () => '', writeText: () => {} }
  }
})

import { EventEmitter } from 'node:events'
import type { spawn } from 'node:child_process'
import { createRecorder } from '@main/recording/recorder-adapter'
import { starteUiohookQuelle, type UiohookQuelle } from '@main/hotkey/uiohook-source'
import { createPasteAusgabe } from '@main/output/paste-adapter'
import type { EreignisLog, LogFelder } from '@main/diagnostics/ereignis-log'

/** Sammelt alle Log-Aufrufe als (stufe, ereignis, felder)-Tripel — kein Schreiben auf Disk. */
function fakeLog() {
  const eintraege: Array<{ stufe: string; ereignis: string; felder?: LogFelder }> = []
  const mach = (stufe: string) => (ereignis: string, felder?: LogFelder) =>
    eintraege.push({ stufe, ereignis, felder })
  const log: EreignisLog = {
    debug: mach('debug'),
    info: mach('info'),
    warnung: mach('warnung'),
    fehler: mach('fehler')
  }
  return { log, eintraege }
}

// --- Recorder ---

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

describe('recorder-adapter Ereignislog', () => {
  it('zerstörtes Fenster → recorder.sende_fehl mit kanal=start (Warnung)', () => {
    const fenster = fakeFensterMitEvents()
    fenster.destroyed = true
    fenster.webContents.destroyed = true
    const { log, eintraege } = fakeLog()

    const recorder = createRecorder(fenster as never, { log })
    recorder.start()

    const treffer = eintraege.find((e) => e.ereignis === 'recorder.sende_fehl')
    expect(treffer).toBeDefined()
    expect(treffer?.stufe).toBe('warnung')
    expect(treffer?.felder).toEqual({ kanal: 'start' })
  })

  it('zerstörtes Fenster → discard() loggt kanal=discard', () => {
    const fenster = fakeFensterMitEvents()
    fenster.destroyed = true
    fenster.webContents.destroyed = true
    const { log, eintraege } = fakeLog()

    const recorder = createRecorder(fenster as never, { log })
    recorder.discard()

    const treffer = eintraege.filter((e) => e.ereignis === 'recorder.sende_fehl')
    expect(treffer.map((e) => e.felder)).toContainEqual({ kanal: 'discard' })
  })

  it('zerstörtes Fenster → stop() loggt kanal=stop und rejected', async () => {
    const fenster = fakeFensterMitEvents()
    fenster.destroyed = true
    fenster.webContents.destroyed = true
    const { log, eintraege } = fakeLog()

    const recorder = createRecorder(fenster as never, { log })
    await expect(recorder.stop()).rejects.toThrow()

    expect(eintraege).toContainEqual(
      expect.objectContaining({ ereignis: 'recorder.sende_fehl', felder: { kanal: 'stop' } })
    )
  })

  it('render-process-gone während stop() → recorder.renderer_tot (Fehler)', async () => {
    const fenster = fakeFensterMitEvents()
    const { log, eintraege } = fakeLog()
    const recorder = createRecorder(fenster as never, { log })
    const stopP = recorder.stop()

    fenster.webContents.emit('render-process-gone', {}, { reason: 'crashed' })

    await expect(stopP).rejects.toThrow()
    expect(eintraege).toContainEqual(
      expect.objectContaining({ stufe: 'fehler', ereignis: 'recorder.renderer_tot' })
    )
  })

  it('recorder:error → recorder.fehler mit gekürzter message (nie Audio/Text)', async () => {
    const { ipcMain } = await import('electron')
    const fenster = fakeFensterMitEvents()
    const { log, eintraege } = fakeLog()
    const recorder = createRecorder(fenster as never, { log })
    const stopP = recorder.stop()

    ;(ipcMain as unknown as { emit: (c: string, ...a: unknown[]) => void }).emit(
      'recorder:error',
      {},
      'Mikrofon nicht verfügbar'
    )

    await expect(stopP).rejects.toThrow(/Mikrofon nicht verfügbar/)
    const treffer = eintraege.find((e) => e.ereignis === 'recorder.fehler')
    expect(treffer?.stufe).toBe('fehler')
    expect(treffer?.felder?.message).toBe('Mikrofon nicht verfügbar')
  })

  it('lebendes Fenster → start() loggt recorder.start_gesendet (debug), keine Felder/Text', () => {
    const fenster = fakeFensterMitEvents()
    const { log, eintraege } = fakeLog()

    const recorder = createRecorder(fenster as never, { log })
    recorder.start()

    const treffer = eintraege.find((e) => e.ereignis === 'recorder.start_gesendet')
    expect(treffer).toBeDefined()
    expect(treffer?.stufe).toBe('debug')
    expect(treffer?.felder).toBeUndefined()
    // Kein Sende-Fehler-Log, wenn der Start erfolgreich war.
    expect(eintraege.some((e) => e.ereignis === 'recorder.sende_fehl')).toBe(false)
  })

  it('ohne log-Dep → keine Ausnahme (NOOP-Default)', () => {
    const fenster = fakeFensterMitEvents()
    fenster.destroyed = true
    fenster.webContents.destroyed = true
    const recorder = createRecorder(fenster as never)
    expect(() => recorder.start()).not.toThrow()
  })
})

// --- uiohook ---

/** Minimaler Hook-Fake; start() kann optional werfen (nativer Ladefehler). */
function fakeHook(opts: { startWirft?: Error } = {}): UiohookQuelle {
  return {
    on: () => undefined,
    start: () => {
      if (opts.startWirft) throw opts.startWirft
    },
    stop: () => {}
  }
}

describe('uiohook-source Ereignislog', () => {
  it('erfolgreicher hook.start() → hotkey.hook_start (Info)', () => {
    const { log, eintraege } = fakeLog()
    starteUiohookQuelle({ verarbeiteTaste: () => {}, hook: fakeHook(), log })
    expect(eintraege).toContainEqual(
      expect.objectContaining({ stufe: 'info', ereignis: 'hotkey.hook_start' })
    )
  })

  it('hook.start() wirft → hotkey.hook_fehl mit redigiertem Fehler (nur name/message)', () => {
    const { log, eintraege } = fakeLog()
    starteUiohookQuelle({
      verarbeiteTaste: () => {},
      hook: fakeHook({ startWirft: new Error('libuiohook fehlt') }),
      log
    })
    const treffer = eintraege.find((e) => e.ereignis === 'hotkey.hook_fehl')
    expect(treffer?.stufe).toBe('fehler')
    expect(treffer?.felder).toEqual({ name: 'Error', message: 'libuiohook fehlt' })
    // Kein Hook-Start-Log, wenn der Start scheiterte.
    expect(eintraege.some((e) => e.ereignis === 'hotkey.hook_start')).toBe(false)
  })

  it('ohne log-Dep → kein Wurf (NOOP-Default)', () => {
    expect(() =>
      starteUiohookQuelle({ verarbeiteTaste: () => {}, hook: fakeHook() })
    ).not.toThrow()
  })
})

// --- paste-adapter ---

/**
 * Fake-spawn für den Paste-Pfad: liefert pro Aufruf einen Exit-Code abhängig von den Args.
 * `--set-clip` bekommt Exit 0 (Zwischenablage geschrieben), Paste-Strategien den vorgegebenen Code.
 */
function fakePasteSpawn(strategieExit: number): typeof spawn {
  return ((_cmd: string, args: string[]) => {
    const kind = new EventEmitter() as unknown as ReturnType<typeof spawn>
    // stdin für --set-clip (schreibUeberHelfer)
    // @ts-expect-error - Test-Double
    kind.stdin = { write: () => {}, end: () => {} }
    // @ts-expect-error - Test-Double
    kind.stdout = new EventEmitter()
    // @ts-expect-error - Test-Double
    kind.kill = () => {}
    const istSetClip = args.includes('--set-clip')
    queueMicrotask(() => {
      kind.emit('exit', istSetClip ? 0 : strategieExit)
    })
    return kind
  }) as unknown as typeof spawn
}

describe('paste-adapter Ereignislog', () => {
  it('Strategie-Fehlschlag → paste.strategie mit erfolg=false + code (Warnung), nie Text', async () => {
    const { log, eintraege } = fakeLog()
    const meldungen: unknown[] = []
    const ausgabe = createPasteAusgabe({
      fenster: {
        anzeigen: () => {},
        zeigeEinstellungen: () => {},
        zeigeManuellenHinweis: () => {},
        melde: (f) => meldungen.push(f)
      },
      spawnFn: fakePasteSpawn(3),
      spawnSyncFn: (() => ({ status: 1, stdout: '' })) as never,
      helferPfad: 'win-paste.exe',
      delayMs: 0,
      log
    })

    ausgabe.einfügen('GEHEIMER DIKTATTEXT')
    // Auf die fire-and-forget-Kette warten (mehrere Microtasks: set-clip → strategien).
    await new Promise((r) => setTimeout(r, 20))

    const strategieLogs = eintraege.filter((e) => e.ereignis === 'paste.strategie')
    expect(strategieLogs.length).toBeGreaterThan(0)
    // Alle scheitern (Exit 3) → Warnung mit erfolg=false + code=3.
    const helfer = strategieLogs.find((e) => e.felder?.name === 'helfer')
    expect(helfer?.stufe).toBe('warnung')
    expect(helfer?.felder).toEqual({ name: 'helfer', erfolg: false, code: 3 })

    // Redaction: kein Log-Feld enthält den Diktattext.
    const alleWerte = eintraege.flatMap((e) => Object.values(e.felder ?? {}).map(String))
    expect(alleWerte.some((w) => w.includes('GEHEIMER'))).toBe(false)
  })

  it('erfolgreiche Strategie → paste.strategie mit erfolg=true (Info)', async () => {
    const { log, eintraege } = fakeLog()
    const ausgabe = createPasteAusgabe({
      fenster: {
        anzeigen: () => {},
        zeigeEinstellungen: () => {},
        zeigeManuellenHinweis: () => {},
        melde: () => {}
      },
      spawnFn: fakePasteSpawn(0),
      spawnSyncFn: (() => ({ status: 1, stdout: '' })) as never,
      helferPfad: 'win-paste.exe',
      delayMs: 0,
      log
    })

    ausgabe.einfügen('text')
    await new Promise((r) => setTimeout(r, 20))

    const helfer = eintraege.find((e) => e.ereignis === 'paste.strategie' && e.felder?.name === 'helfer')
    expect(helfer?.stufe).toBe('info')
    expect(helfer?.felder).toEqual({ name: 'helfer', erfolg: true, code: 0 })
  })
})
