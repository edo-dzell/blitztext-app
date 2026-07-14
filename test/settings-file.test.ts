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
})
