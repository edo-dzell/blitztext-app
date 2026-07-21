import { describe, it, expect, vi, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'
import type { spawn } from 'node:child_process'

// A2 (v0.7.3): Härtung von `schreibUeberHelfer` (--set-clip) gegen einen weggerissenen Helfer-Prozess.
// Wird win-paste.exe während des stdin-Schreibens gekillt (Task-Manager, Crash), feuert stdin ein
// 'error' (EPIPE/ERR_STREAM_DESTROYED) — ohne eigenen Listener eskaliert Node das zu einer
// uncaughtException → App-Absturz. Diese Tests fahren den Adapter über `createPasteAusgabe` und einen
// Fake-spawn mit EventEmitter-stdin und prüfen: KEIN unhandled Fehler, Degradation über den
// clipboard.writeText-Fallback, `paste.helfer_stdin_fehl`-Warnung ohne Text.

// clipboard.writeText protokolliert den Fallback-Aufruf; app minimal für defaultHelferPfad (hier via
// helferPfad injiziert, aber die Mock-Signatur muss vollständig sein).
const clipboardSchreibe: string[] = []
vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => '/app', getPath: () => '/tmp', resourcesPath: '/res' },
  clipboard: {
    readText: () => '',
    writeText: (t: string) => {
      clipboardSchreibe.push(t)
    }
  }
}))

import { createPasteAusgabe } from '@main/output/paste-adapter'
import type { EreignisLog, LogFelder } from '@main/diagnostics/ereignis-log'

/** Sammelt alle Log-Aufrufe als (stufe, ereignis, felder)-Tripel. */
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

// Verhalten des Fake-stdin für den --set-clip-Prozess.
type StdinModus =
  // stdin feuert 'error' (EPIPE) statt eines sauberen exit.
  | { art: 'error' }
  // write() ruft seinen Callback mit einem Fehler auf (asynchroner Schreibfehler).
  | { art: 'writeCbFehler' }
  // write() wirft synchron (ERR_STREAM_DESTROYED bei zerstörtem Stream).
  | { art: 'writeWurf' }
  // Prozess hängt: kein exit/error/write-Fehler → Timeout-Pfad (kill).
  | { art: 'haengt' }
  // Happy-Path: exit 0.
  | { art: 'ok' }

/**
 * Fake-spawn: --set-clip-Aufrufe verhalten sich gemäß `modus`, jeder andere Aufruf (Paste-Strategien,
 * --hwnd) endet neutral mit Exit-Code 0. stdin ist ein echter EventEmitter (mit write/end), damit
 * on('error') registrierbar ist und wir 'error' feuern können.
 */
function fakeSpawn(modus: StdinModus, killAufrufe: number[] = []): typeof spawn {
  return ((_cmd: string, args: string[]) => {
    const kind = new EventEmitter() as unknown as ReturnType<typeof spawn>
    // @ts-expect-error - Test-Double
    kind.stdout = new EventEmitter()
    // @ts-expect-error - Test-Double
    kind.kill = () => {
      killAufrufe.push(1)
    }
    const istSetClip = args.includes('--set-clip')
    const stdin = new EventEmitter() as EventEmitter & {
      write: (text: string, cb?: (fehler?: Error | null) => void) => void
      end: () => void
    }
    stdin.write = (_text, cb) => {
      if (!istSetClip) {
        cb?.(null)
        return
      }
      if (modus.art === 'writeWurf') throw new Error('ERR_STREAM_DESTROYED')
      if (modus.art === 'writeCbFehler') {
        cb?.(new Error('EPIPE'))
        return
      }
      cb?.(null)
    }
    stdin.end = () => {}
    // @ts-expect-error - Test-Double
    kind.stdin = stdin

    if (istSetClip) {
      if (modus.art === 'error') {
        queueMicrotask(() => stdin.emit('error', new Error('EPIPE')))
      } else if (modus.art === 'ok') {
        queueMicrotask(() => kind.emit('exit', 0))
      }
      // 'haengt'/'writeWurf'/'writeCbFehler': kein exit (der Fehlerpfad muss selbst auflösen; bei
      // 'haengt' greift der Timeout).
    } else {
      // Paste-Strategien / --hwnd: neutraler Erfolg.
      queueMicrotask(() => kind.emit('exit', 0))
    }
    return kind
  }) as unknown as typeof spawn
}

function baueAusgabe(spawnFn: typeof spawn, log: EreignisLog) {
  return createPasteAusgabe({
    fenster: {
      anzeigen: () => {},
      zeigeEinstellungen: () => {},
      zeigeManuellenHinweis: () => {},
      melde: () => {}
    },
    spawnFn,
    spawnSyncFn: (() => ({ status: 1, stdout: '' })) as never,
    helferPfad: 'win-paste.exe',
    delayMs: 0,
    log
  })
}

describe('paste-adapter schreibUeberHelfer — EPIPE/stdin-Härtung (A2)', () => {
  afterEach(() => {
    vi.useRealTimers()
    clipboardSchreibe.length = 0
  })

  it('stdin feuert error (EPIPE) → clipboard-Fallback + paste.helfer_stdin_fehl-Warnung, kein Text im Log', async () => {
    const { log, eintraege } = fakeLog()
    const ausgabe = baueAusgabe(fakeSpawn({ art: 'error' }), log)

    // inZwischenablage geht direkt über zwischenablage.schreib → schreibUeberHelfer, ohne Paste-Kette.
    ausgabe.inZwischenablage('GEHEIMER DIKTATTEXT')
    await new Promise((r) => setTimeout(r, 20))

    const stdinFehl = eintraege.filter((e) => e.ereignis === 'paste.helfer_stdin_fehl')
    expect(stdinFehl).toHaveLength(1)
    expect(stdinFehl[0]?.stufe).toBe('warnung')
    // Ohne Felder (Redaction-Vorgabe des Plans).
    expect(stdinFehl[0]?.felder).toBeUndefined()

    // Degradation: der Text landet über den clipboard.writeText-Fallback in der Zwischenablage.
    expect(clipboardSchreibe).toContain('GEHEIMER DIKTATTEXT')
    // Und der Fallback-Umstand wurde geloggt.
    expect(eintraege.some((e) => e.ereignis === 'paste.helfer_clip_fallback')).toBe(true)

    // Redaction: kein Log-Feld enthält den Diktattext.
    const alleWerte = eintraege.flatMap((e) => Object.values(e.felder ?? {}).map(String))
    expect(alleWerte.some((w) => w.includes('GEHEIMER'))).toBe(false)
  })

  it('write() wirft synchron (ERR_STREAM_DESTROYED) → Fallback + Warnung, kein unhandled', async () => {
    const { log, eintraege } = fakeLog()
    const ausgabe = baueAusgabe(fakeSpawn({ art: 'writeWurf' }), log)

    ausgabe.inZwischenablage('inhalt')
    await new Promise((r) => setTimeout(r, 20))

    expect(eintraege.some((e) => e.ereignis === 'paste.helfer_stdin_fehl' && e.stufe === 'warnung')).toBe(true)
    expect(clipboardSchreibe).toContain('inhalt')
  })

  it('write()-Callback meldet Fehler asynchron → Fallback + Warnung', async () => {
    const { log, eintraege } = fakeLog()
    const ausgabe = baueAusgabe(fakeSpawn({ art: 'writeCbFehler' }), log)

    ausgabe.inZwischenablage('inhalt')
    await new Promise((r) => setTimeout(r, 20))

    expect(eintraege.some((e) => e.ereignis === 'paste.helfer_stdin_fehl' && e.stufe === 'warnung')).toBe(true)
    expect(clipboardSchreibe).toContain('inhalt')
  })

  it('Timeout-Kill (Prozess hängt) → Fallback ohne unhandled, kill() gerufen', async () => {
    vi.useFakeTimers()
    const { log, eintraege } = fakeLog()
    const killAufrufe: number[] = []
    const ausgabe = baueAusgabe(fakeSpawn({ art: 'haengt' }, killAufrufe), log)

    ausgabe.inZwischenablage('inhalt')
    // Timeout im schreibUeberHelfer ist 2000ms; über die Fake-Timer vorspulen.
    await vi.advanceTimersByTimeAsync(2000)
    // Die fire-and-forget-catch-Kette einen Tick durchlaufen lassen.
    await vi.advanceTimersByTimeAsync(0)

    expect(killAufrufe).toHaveLength(1)
    // Timeout → Misserfolg → clipboard-Fallback.
    expect(clipboardSchreibe).toContain('inhalt')
    // Timeout ist KEIN stdin-Fehler → keine paste.helfer_stdin_fehl-Warnung.
    expect(eintraege.some((e) => e.ereignis === 'paste.helfer_stdin_fehl')).toBe(false)
  })

  it('uncaughtException-Sonde: ein weggerissener Helfer löst KEINE uncaughtException aus', async () => {
    const gefangene: unknown[] = []
    const sonde = (fehler: unknown): void => {
      gefangene.push(fehler)
    }
    // Vitest registriert selbst einen uncaughtException-Listener und lässt den Prozess sonst fehlschlagen;
    // die eigene Sonde weist positiv nach, dass NICHTS eskaliert.
    process.on('uncaughtException', sonde)
    try {
      const { log } = fakeLog()
      const ausgabe = baueAusgabe(fakeSpawn({ art: 'error' }), log)
      ausgabe.inZwischenablage('inhalt')
      // Genügend Zeit, damit ein eskalierter stdin-'error' als uncaughtException durchschlagen würde.
      await new Promise((r) => setTimeout(r, 30))
    } finally {
      process.off('uncaughtException', sonde)
    }
    expect(gefangene).toHaveLength(0)
  })

  it('Happy-Path-Regression: Helfer exit 0 → KEIN clipboard-Fallback, keine stdin-Warnung', async () => {
    const { log, eintraege } = fakeLog()
    const ausgabe = baueAusgabe(fakeSpawn({ art: 'ok' }), log)

    ausgabe.inZwischenablage('inhalt')
    await new Promise((r) => setTimeout(r, 20))

    expect(clipboardSchreibe).toHaveLength(0)
    expect(eintraege.some((e) => e.ereignis === 'paste.helfer_stdin_fehl')).toBe(false)
    expect(eintraege.some((e) => e.ereignis === 'paste.helfer_clip_fallback')).toBe(false)
  })
})
