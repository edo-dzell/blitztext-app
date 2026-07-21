import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

vi.mock('electron', () => ({ app: { getPath: () => tmpdir() } }))

import { createStatsFile } from '@main/stats/stats-file'

describe('createStatsFile (fs-Wrapper)', () => {
  let dir: string
  let pfad: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'blitz-stats-'))
    pfad = join(dir, 'unterordner', 'stats.json') // Unterordner: prüft mkdir recursive
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('Roundtrip: write dann read liefert exakt denselben Inhalt', async () => {
    const file = createStatsFile(pfad)
    const inhalt = JSON.stringify({ transkriptionen: 3, kostenCent: 12 })
    await file.write(inhalt)
    expect(await file.read()).toBe(inhalt)
  })

  it('write legt fehlende Verzeichnisse an (mkdir recursive)', async () => {
    const file = createStatsFile(pfad)
    await file.write('{"n":1}')
    expect(await readFile(pfad, 'utf-8')).toBe('{"n":1}')
  })

  it('read liefert null, wenn die Datei nicht existiert (ENOENT)', async () => {
    const file = createStatsFile(join(dir, 'gibt-es-nicht.json'))
    expect(await file.read()).toBeNull()
  })

  it('read liefert korrupten JSON-Inhalt roh zurück (kein Parsen, kein Wurf)', async () => {
    const direkt = join(dir, 'stats.json')
    await writeFile(direkt, 'nicht-json', 'utf-8')
    const file = createStatsFile(direkt)
    await expect(file.read()).resolves.toBe('nicht-json')
  })

  it('überschreibt bestehenden Inhalt beim erneuten write', async () => {
    const file = createStatsFile(pfad)
    await file.write('alt')
    await file.write('neu')
    expect(await file.read()).toBe('neu')
  })

  // A3 (v0.7.3): atomarer Roundtrip — keine zurückbleibende .tmp-Datei.
  it('atomarer Roundtrip: keine .tmp-Datei bleibt nach dem write zurück', async () => {
    const file = createStatsFile(pfad)
    await file.write('{"n":2}')
    expect(await file.read()).toBe('{"n":2}')
    const tmp = createStatsFile(`${pfad}.tmp`)
    expect(await tmp.read()).toBeNull()
  })

  it('Absturz-Simulation: schlägt das Ersetzen fehl, bleibt die alte Datei unversehrt (Ziel-Verzeichnis nur-lesbar)', async () => {
    if (typeof process.getuid === 'function' && process.getuid() === 0) return

    const unterordner = join(dir, 'ro')
    const direkt = join(unterordner, 'stats.json')
    const file = createStatsFile(direkt)
    await file.write('alt-gut')

    const { chmod } = await import('node:fs/promises')
    await chmod(unterordner, 0o500)
    try {
      await expect(file.write('neu-halb')).rejects.toBeTruthy()
    } finally {
      await chmod(unterordner, 0o700)
    }
    expect(await file.read()).toBe('alt-gut')
  })
})
