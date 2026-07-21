import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { existsSync, appendFileSync, statSync, renameSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// app.getPath → tmpdir, damit logOrdnerPfad() ohne Electron auflösbar ist (Muster stats-file.test.ts).
vi.mock('electron', () => ({ app: { getPath: () => tmpdir() } }))

import { createLogDateiSenke, logOrdnerPfad } from '@main/diagnostics/log-datei'

// Reale synchrone fs-Teilmenge — Default der Senke, hier explizit für die „echtes Tempdir"-Tests.
const echtesFs = { appendFileSync, statSync, renameSync, rmSync, mkdirSync }

describe('createLogDateiSenke — echtes Tempdir', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'blitz-log-'))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('appendFileSync schreibt die Zeile sofort und lesbar auf Disk', async () => {
    const pfad = join(dir, 'blitztext.log')
    const senke = createLogDateiSenke({ pfad })

    senke.schreibeZeile('ZEILE EINS')

    // synchron geschrieben → unmittelbar danach lesbar (kein Flush nötig).
    expect(await readFile(pfad, 'utf-8')).toBe('ZEILE EINS\n')
  })

  it('legt fehlende Ordner bei ENOENT einmal an und schreibt dann (mkdir recursive)', async () => {
    const pfad = join(dir, 'tief', 'verschachtelt', 'blitztext.log')
    const senke = createLogDateiSenke({ pfad })

    senke.schreibeZeile('a')
    senke.schreibeZeile('b')

    expect(await readFile(pfad, 'utf-8')).toBe('a\nb\n')
  })

  it('rotiert bei Überschreiten von maxBytes: alt.log erhält den alten Inhalt, log startet frisch', async () => {
    const pfad = join(dir, 'blitztext.log')
    const altPfad = join(dir, 'blitztext.alt.log')
    // maxBytes klein: 'AAAA\n' = 5 Bytes belegt die Datei, die nächste Zeile löst Rotation aus.
    const senke = createLogDateiSenke({ pfad, maxBytes: 6 })

    senke.schreibeZeile('AAAA') // groesse 5
    senke.schreibeZeile('BBBB') // 5 + 5 > 6 → Rotation, dann neu

    expect(await readFile(altPfad, 'utf-8')).toBe('AAAA\n')
    expect(await readFile(pfad, 'utf-8')).toBe('BBBB\n')
  })

  it('eine einzelne übergroße Zeile in leerer Datei rotiert NICHT (schreibt trotzdem)', async () => {
    const pfad = join(dir, 'blitztext.log')
    const altPfad = join(dir, 'blitztext.alt.log')
    const senke = createLogDateiSenke({ pfad, maxBytes: 3 })

    senke.schreibeZeile('viel-zu-lang')

    expect(await readFile(pfad, 'utf-8')).toBe('viel-zu-lang\n')
    expect(existsSync(altPfad)).toBe(false)
  })

  it('führt die Anfangsgröße aus statSync mit → rotiert bei bestehender voller Datei', async () => {
    const pfad = join(dir, 'blitztext.log')
    const altPfad = join(dir, 'blitztext.alt.log')
    // Datei vorbelegen, sodass die erste neue Zeile bereits über maxBytes liegt.
    appendFileSync(pfad, 'VORHANDEN\n', 'utf-8') // 10 Bytes
    const senke = createLogDateiSenke({ pfad, maxBytes: 8, fs: echtesFs })

    senke.schreibeZeile('NEU')

    expect(await readFile(altPfad, 'utf-8')).toBe('VORHANDEN\n')
    expect(await readFile(pfad, 'utf-8')).toBe('NEU\n')
  })

  it('setzeZurueck() nach dem Löschen verhindert eine überflüssige Rotation der frischen Datei', async () => {
    const pfad = join(dir, 'blitztext.log')
    const altPfad = join(dir, 'blitztext.alt.log')
    const senke = createLogDateiSenke({ pfad, maxBytes: 6 })

    senke.schreibeZeile('AAAA') // groesse 5 (nahe der Schwelle)

    // Simuliert den log:loeschen-Handler: Dateien weg + Größenzähler zurücksetzen.
    rmSync(pfad, { force: true })
    rmSync(altPfad, { force: true })
    senke.setzeZurueck!()

    // Nächste Zeile darf NICHT rotieren (groesse ist 0) → sie landet in der frischen aktiven Datei,
    // und es entsteht keine alt.log aus der zuvor gelöschten Mini-Datei.
    senke.schreibeZeile('BBBB')

    expect(await readFile(pfad, 'utf-8')).toBe('BBBB\n')
    expect(existsSync(altPfad)).toBe(false)
  })

  it('logOrdnerPfad() zeigt in den logs-Unterordner von userData', () => {
    expect(logOrdnerPfad()).toBe(join(tmpdir(), 'logs'))
  })
})

describe('createLogDateiSenke — injizierte fs (Fehlerpfade)', () => {
  it('rename-Fehler (AV-Lock) überspringt die Rotation und schreibt weiter in die aktive Datei', () => {
    const geschrieben: string[] = []
    const fs = {
      statSync: () => ({ size: 100 }) as ReturnType<typeof statSync>,
      appendFileSync: (_p: unknown, daten: string) => {
        geschrieben.push(String(daten))
      },
      renameSync: () => {
        const e = new Error('locked') as NodeJS.ErrnoException
        e.code = 'EPERM'
        throw e
      },
      rmSync: () => {}
    } as unknown as typeof echtesFs

    const senke = createLogDateiSenke({ pfad: '/x/blitztext.log', maxBytes: 10, fs })

    // groesse startet bei 100 (> maxBytes) → Rotation versucht → rename wirft → übersprungen.
    expect(() => senke.schreibeZeile('trotzdem')).not.toThrow()
    expect(geschrieben).toEqual(['trotzdem\n'])
  })

  it('Schreibfehler wirft NIE nach außen und meldet genau EIN console.error', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const fs = {
        statSync: () => {
          const e = new Error('kein') as NodeJS.ErrnoException
          e.code = 'ENOENT'
          throw e
        },
        appendFileSync: () => {
          const e = new Error('platte voll') as NodeJS.ErrnoException
          e.code = 'ENOSPC'
          throw e
        },
        renameSync: () => {},
        rmSync: () => {},
        mkdirSync: () => undefined
      } as unknown as typeof echtesFs

      const senke = createLogDateiSenke({ pfad: '/x/blitztext.log', fs })

      expect(() => senke.schreibeZeile('a')).not.toThrow()
      expect(() => senke.schreibeZeile('b')).not.toThrow()
      expect(() => senke.schreibeZeile('c')).not.toThrow()

      // Genau EIN console.error trotz mehrerer Fehlschläge (keine Konsolen-Flut).
      expect(spy).toHaveBeenCalledTimes(1)
      expect(String(spy.mock.calls[0]![0])).toContain('[ereignislog]')
    } finally {
      spy.mockRestore()
    }
  })

  it('ENOENT beim Append → einmal mkdirSync(recursive) + erfolgreicher Retry (kein console.error)', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      let mkdirRufe = 0
      let appendVersuche = 0
      const geschrieben: string[] = []
      const fs = {
        statSync: () => {
          const e = new Error('kein') as NodeJS.ErrnoException
          e.code = 'ENOENT'
          throw e
        },
        appendFileSync: (_p: unknown, daten: string) => {
          appendVersuche++
          if (appendVersuche === 1) {
            const e = new Error('ordner fehlt') as NodeJS.ErrnoException
            e.code = 'ENOENT'
            throw e
          }
          geschrieben.push(String(daten))
        },
        renameSync: () => {},
        rmSync: () => {},
        mkdirSync: () => {
          mkdirRufe++
          return undefined
        }
      } as unknown as typeof echtesFs

      const senke = createLogDateiSenke({ pfad: '/neu/blitztext.log', fs })
      senke.schreibeZeile('hallo')

      expect(mkdirRufe).toBe(1)
      expect(geschrieben).toEqual(['hallo\n'])
      expect(spy).not.toHaveBeenCalled()
    } finally {
      spy.mockRestore()
    }
  })
})
