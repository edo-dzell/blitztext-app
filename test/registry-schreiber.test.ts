import { describe, it, expect } from 'vitest'
import { EventEmitter } from 'node:events'
import type { spawn } from 'node:child_process'
import { createRegistrySchreiber } from '@main/autostart/registry-schreiber'

// Minimaler Fake für node:child_process spawn — genug EventEmitter-Verhalten (stdout.on, once
// 'error'/'exit'), damit registry-schreiber.ts ohne echtes reg.exe/Windows testbar ist.
function fakeSpawn(deps: {
  exitCode: number | null
  stdout?: string
  aufrufe: { command: string; args: string[] }[]
  fehlerStattExit?: Error
}): typeof spawn {
  return ((command: string, args: string[]) => {
    deps.aufrufe.push({ command, args })
    const kind = new EventEmitter() as unknown as ReturnType<typeof spawn>
    const stdout = new EventEmitter()
    // @ts-expect-error - Test-Double, kein vollständiger ChildProcess
    kind.stdout = stdout
    queueMicrotask(() => {
      if (deps.fehlerStattExit) {
        kind.emit('error', deps.fehlerStattExit)
        return
      }
      if (deps.stdout) stdout.emit('data', Buffer.from(deps.stdout))
      kind.emit('exit', deps.exitCode)
    })
    return kind
  }) as typeof spawn
}

describe('createRegistrySchreiber', () => {
  it('setze ruft reg add mit dem Run-Key, Wertnamen, REG_SZ und dem Pfad auf', async () => {
    const aufrufe: { command: string; args: string[] }[] = []
    const schreiber = createRegistrySchreiber({ spawnFn: fakeSpawn({ exitCode: 0, aufrufe }) })
    await schreiber.setze('Blitztext', '"C:\\App\\Blitztext.exe"')
    expect(aufrufe).toHaveLength(1)
    expect(aufrufe[0]!.command).toBe('reg')
    expect(aufrufe[0]!.args).toEqual([
      'add',
      'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run',
      '/v',
      'Blitztext',
      '/t',
      'REG_SZ',
      '/d',
      '"C:\\App\\Blitztext.exe"',
      '/f'
    ])
  })

  it('setze wirft bei Exit-Code ungleich 0', async () => {
    const aufrufe: { command: string; args: string[] }[] = []
    const schreiber = createRegistrySchreiber({ spawnFn: fakeSpawn({ exitCode: 1, aufrufe }) })
    await expect(schreiber.setze('Blitztext', 'x')).rejects.toThrow(/reg add/)
  })

  it('entferne ruft reg delete auf', async () => {
    const aufrufe: { command: string; args: string[] }[] = []
    const schreiber = createRegistrySchreiber({ spawnFn: fakeSpawn({ exitCode: 0, aufrufe }) })
    await schreiber.entferne('Blitztext')
    expect(aufrufe[0]!.args).toEqual([
      'delete',
      'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run',
      '/v',
      'Blitztext',
      '/f'
    ])
  })

  it('entferne ist idempotent: Exit-Code 1 ("Wert nicht gefunden") ist kein Fehler', async () => {
    const aufrufe: { command: string; args: string[] }[] = []
    const schreiber = createRegistrySchreiber({ spawnFn: fakeSpawn({ exitCode: 1, aufrufe }) })
    await expect(schreiber.entferne('Blitztext')).resolves.toBeUndefined()
  })

  it('entferne wirft bei echtem Fehler (Exit-Code > 1)', async () => {
    const aufrufe: { command: string; args: string[] }[] = []
    const schreiber = createRegistrySchreiber({ spawnFn: fakeSpawn({ exitCode: 5, aufrufe }) })
    await expect(schreiber.entferne('Blitztext')).rejects.toThrow(/reg delete/)
  })

  it('liest parst REG_SZ-Wert aus der reg-query-Ausgabe', async () => {
    const aufrufe: { command: string; args: string[] }[] = []
    const stdout =
      'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Run\r\n' +
      '    Blitztext    REG_SZ    "C:\\Users\\nutzer\\AppData\\Local\\Blitztext\\Blitztext.exe"\r\n' +
      '\r\n'
    const schreiber = createRegistrySchreiber({
      spawnFn: fakeSpawn({ exitCode: 0, stdout, aufrufe })
    })
    const wert = await schreiber.liest('Blitztext')
    expect(wert).toBe('"C:\\Users\\nutzer\\AppData\\Local\\Blitztext\\Blitztext.exe"')
  })

  it('liest liefert null, wenn der Wert nicht existiert (Exit-Code ungleich 0)', async () => {
    const aufrufe: { command: string; args: string[] }[] = []
    const schreiber = createRegistrySchreiber({ spawnFn: fakeSpawn({ exitCode: 1, aufrufe }) })
    expect(await schreiber.liest('Blitztext')).toBeNull()
  })

  it('liest ist tolerant gegenüber variabler Spaltenbreite in der reg-Ausgabe', async () => {
    const aufrufe: { command: string; args: string[] }[] = []
    const stdout = 'HKEY_CURRENT_USER\\...\r\nBlitztext REG_SZ "C:\\x.exe"\r\n'
    const schreiber = createRegistrySchreiber({
      spawnFn: fakeSpawn({ exitCode: 0, stdout, aufrufe })
    })
    expect(await schreiber.liest('Blitztext')).toBe('"C:\\x.exe"')
  })

  it('Spawn-Fehler (z. B. ENOENT auf Nicht-Windows) lässt setze/liest werfen bzw. propagieren', async () => {
    const aufrufe: { command: string; args: string[] }[] = []
    const schreiber = createRegistrySchreiber({
      spawnFn: fakeSpawn({ exitCode: null, aufrufe, fehlerStattExit: new Error('ENOENT') })
    })
    await expect(schreiber.setze('Blitztext', 'x')).rejects.toThrow('ENOENT')
  })
})
