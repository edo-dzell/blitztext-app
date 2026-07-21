import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Kein echtes Electron: app.getPath wird nicht gebraucht, weil createSettingsFile den Pfad injiziert
// bekommt. Wir mocken electron trotzdem, damit der Import (app) auflösbar ist.
vi.mock('electron', () => ({ app: { getPath: () => tmpdir() } }))

import { createSettingsFile } from '@main/settings/settings-file'

describe('createSettingsFile (fs-Wrapper)', () => {
  let dir: string
  let pfad: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'blitz-settings-'))
    pfad = join(dir, 'unterordner', 'settings.json') // Unterordner: prüft mkdir recursive
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('Roundtrip: write dann read liefert exakt denselben Inhalt', async () => {
    const file = createSettingsFile(pfad)
    const inhalt = JSON.stringify({ language: 'de', tone: 'formal' })
    await file.write(inhalt)
    expect(await file.read()).toBe(inhalt)
  })

  it('write legt fehlende Verzeichnisse an (mkdir recursive)', async () => {
    const file = createSettingsFile(pfad)
    await file.write('{"a":1}')
    // Datei liegt tatsächlich im zuvor nicht existierenden Unterordner.
    expect(await readFile(pfad, 'utf-8')).toBe('{"a":1}')
  })

  it('read liefert null, wenn die Datei nicht existiert (ENOENT)', async () => {
    const file = createSettingsFile(join(dir, 'gibt-es-nicht.json'))
    expect(await file.read()).toBeNull()
  })

  it('read liefert korrupten JSON-Inhalt roh zurück (kein Parsen, kein Wurf)', async () => {
    // Der Wrapper parst nicht — er liefert Text; das Parsen ist Sache des Stores.
    await writeFile(pfad.replace('/unterordner', ''), '{ kaputt: ', 'utf-8')
    const file = createSettingsFile(pfad.replace('/unterordner', ''))
    await expect(file.read()).resolves.toBe('{ kaputt: ')
  })

  it('überschreibt bestehenden Inhalt beim erneuten write', async () => {
    const file = createSettingsFile(pfad)
    await file.write('erst')
    await file.write('zweit')
    expect(await file.read()).toBe('zweit')
  })

  // A3 (v0.7.3): atomarer Roundtrip + Korruptions-Rettung.
  it('atomarer Roundtrip: keine .tmp-Datei bleibt nach dem write zurück', async () => {
    const file = createSettingsFile(pfad)
    await file.write('{"a":1}')
    expect(await file.read()).toBe('{"a":1}')
    // Die temporäre Datei wurde umbenannt, existiert also nicht mehr.
    const tmp = createSettingsFile(`${pfad}.tmp`)
    expect(await tmp.read()).toBeNull()
  })

  it('Absturz-Simulation: schlägt das Ersetzen fehl, bleibt die alte Datei unversehrt (Ziel-Verzeichnis nur-lesbar)', async () => {
    // Als root sind Verzeichnis-Rechte wirkungslos → Test überspringen (deterministisch nur non-root).
    if (typeof process.getuid === 'function' && process.getuid() === 0) return

    const unterordner = join(dir, 'ro')
    const direkt = join(unterordner, 'settings.json')
    const file = createSettingsFile(direkt)
    await file.write('alt-gut')

    // Verzeichnis nur-lesbar machen → rename(tmp → Ziel) scheitert (EACCES/EPERM), tmp wird nicht
    // übernommen. writeFile der tmp scheitert ebenfalls; in jedem Fall bleibt die alte Datei intakt.
    const { chmod } = await import('node:fs/promises')
    await chmod(unterordner, 0o500)
    try {
      await expect(file.write('neu-halb')).rejects.toBeTruthy()
    } finally {
      await chmod(unterordner, 0o700) // für den afterEach-rm wieder beschreibbar
    }
    // Die alte Datei ist unverändert lesbar (nie halb überschrieben).
    expect(await file.read()).toBe('alt-gut')
  })

  it('beiseiteLegen: verschiebt eine korrupte Datei nach settings.json.korrupt', async () => {
    const direkt = join(dir, 'settings.json')
    await writeFile(direkt, '{ halb', 'utf-8')
    const file = createSettingsFile(direkt)

    await file.beiseiteLegen!()

    // Original weg, .korrupt trägt den Inhalt.
    expect(await file.read()).toBeNull()
    expect(await readFile(`${direkt}.korrupt`, 'utf-8')).toBe('{ halb')
  })

  it('beiseiteLegen: wirft nie, auch wenn keine Datei existiert', async () => {
    const file = createSettingsFile(join(dir, 'gibt-es-nicht.json'))
    await expect(file.beiseiteLegen!()).resolves.toBeUndefined()
  })
})
