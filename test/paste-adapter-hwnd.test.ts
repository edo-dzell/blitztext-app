import { describe, it, expect, vi, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'
import type { spawn } from 'node:child_process'
import { hwndVonHelferAsync } from '@main/output/paste-adapter'

// A1 (v0.6.0): isolierter Logiktest für die neue Async-HWND-Erfassung (Ausgabe.erfasseFenster).
// Fake-Konvention wie test/registry-schreiber.test.ts: EventEmitter-Double mit stdout.on/once.
function fakeSpawn(deps: {
  exitCode?: number | null
  stdout?: string
  fehlerStattExit?: Error
  /** true = kind feuert NIE exit/error (Timeout-Pfad); prüft, ob kill() aufgerufen wird. */
  haengtEwig?: boolean
  killAufrufe?: number[]
}): typeof spawn {
  return (() => {
    const kind = new EventEmitter() as unknown as ReturnType<typeof spawn>
    const stdout = new EventEmitter()
    // @ts-expect-error - Test-Double, kein vollständiger ChildProcess
    kind.stdout = stdout
    // @ts-expect-error - Test-Double
    kind.kill = () => {
      deps.killAufrufe?.push(1)
    }
    if (!deps.haengtEwig) {
      queueMicrotask(() => {
        if (deps.fehlerStattExit) {
          kind.emit('error', deps.fehlerStattExit)
          return
        }
        if (deps.stdout !== undefined) stdout.emit('data', Buffer.from(deps.stdout))
        kind.emit('exit', deps.exitCode ?? 0)
      })
    }
    return kind
  }) as typeof spawn
}

describe('hwndVonHelferAsync', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('liefert das geparste HWND bei Exit-Code 0 + numerischem stdout', async () => {
    const spawnFn = fakeSpawn({ exitCode: 0, stdout: '4711\n' })
    const hwnd = await hwndVonHelferAsync(spawnFn, 'win-paste.exe', ['--hwnd'])
    expect(hwnd).toBe(4711)
  })

  it('liefert null bei Exit-Code ungleich 0', async () => {
    const spawnFn = fakeSpawn({ exitCode: 1, stdout: '4711' })
    const hwnd = await hwndVonHelferAsync(spawnFn, 'win-paste.exe', ['--hwnd'])
    expect(hwnd).toBeNull()
  })

  it('liefert null bei nicht-parsbarem stdout (kein Dezimalstring)', async () => {
    const spawnFn = fakeSpawn({ exitCode: 0, stdout: 'nicht-numerisch' })
    const hwnd = await hwndVonHelferAsync(spawnFn, 'win-paste.exe', ['--hwnd'])
    expect(hwnd).toBeNull()
  })

  it('liefert null bei leerem stdout', async () => {
    const spawnFn = fakeSpawn({ exitCode: 0, stdout: '' })
    const hwnd = await hwndVonHelferAsync(spawnFn, 'win-paste.exe', ['--hwnd'])
    expect(hwnd).toBeNull()
  })

  it('liefert null, wenn HWND 0 oder negativ wäre (nur > 0 gilt als gültig)', async () => {
    const spawnFn = fakeSpawn({ exitCode: 0, stdout: '0' })
    const hwnd = await hwndVonHelferAsync(spawnFn, 'win-paste.exe', ['--hwnd'])
    expect(hwnd).toBeNull()
  })

  it('liefert null beim Spawn-Fehler (z. B. ENOENT, Helfer fehlt)', async () => {
    const spawnFn = fakeSpawn({ fehlerStattExit: new Error('ENOENT') })
    const hwnd = await hwndVonHelferAsync(spawnFn, 'win-paste.exe', ['--hwnd'])
    expect(hwnd).toBeNull()
  })

  it('liefert null, wenn spawnFn synchron wirft', async () => {
    const spawnFn = (() => {
      throw new Error('kaputt')
    }) as unknown as typeof spawn
    const hwnd = await hwndVonHelferAsync(spawnFn, 'win-paste.exe', ['--hwnd'])
    expect(hwnd).toBeNull()
  })

  it('Timeout: killt den Kind-Prozess und löst mit null auf, wenn nie exit/error feuert', async () => {
    vi.useFakeTimers()
    const killAufrufe: number[] = []
    const spawnFn = fakeSpawn({ haengtEwig: true, killAufrufe })

    const versprechen = hwndVonHelferAsync(spawnFn, 'win-paste.exe', ['--hwnd'], 2000)
    await vi.advanceTimersByTimeAsync(2000)
    const hwnd = await versprechen

    expect(hwnd).toBeNull()
    expect(killAufrufe).toHaveLength(1)
  })

  it('Timeout-Leak-Schutz: ein NACH dem Exit spät feuerender Timer löst NICHT nochmal auf/killt nicht', async () => {
    vi.useFakeTimers()
    const killAufrufe: number[] = []
    const spawnFn = fakeSpawn({ exitCode: 0, stdout: '99', killAufrufe })

    const hwnd = await hwndVonHelferAsync(spawnFn, 'win-paste.exe', ['--hwnd'], 2000)
    expect(hwnd).toBe(99)
    // Timer weiterlaufen lassen, obwohl exit schon aufgelöst hat — kill() darf NICHT mehr feuern
    // (sonst Leak-Symptom: Timer wurde im exit-Handler nicht gecleart).
    await vi.advanceTimersByTimeAsync(5000)
    expect(killAufrufe).toHaveLength(0)
  })
})
