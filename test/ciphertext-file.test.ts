import { describe, it, expect, vi, beforeEach } from 'vitest'

// node:fs/promises vollständig mocken → deterministische Kontrolle über rename/rm-Verhalten,
// insbesondere die Windows-AV-Lock-Retry-Schleife in ersetzeAtomar (EEXIST/EPERM/EBUSY).
const rename = vi.fn()
const rm = vi.fn()
const mkdir = vi.fn()
const writeFile = vi.fn()
const readFile = vi.fn()

vi.mock('node:fs/promises', () => ({
  rename: (...a: unknown[]) => rename(...a),
  rm: (...a: unknown[]) => rm(...a),
  mkdir: (...a: unknown[]) => mkdir(...a),
  writeFile: (...a: unknown[]) => writeFile(...a),
  readFile: (...a: unknown[]) => readFile(...a)
}))

vi.mock('electron', () => ({ app: { getPath: () => '/userData' } }))

import { createCiphertextFile } from '@main/secrets/ciphertext-file'

function fehler(code: string): NodeJS.ErrnoException {
  const e = new Error(code) as NodeJS.ErrnoException
  e.code = code
  return e
}

const ZIEL = '/userData/api-key-test.bin'
const TMP = `${ZIEL}.tmp`

beforeEach(() => {
  vi.clearAllMocks()
  vi.useRealTimers()
  mkdir.mockResolvedValue(undefined)
  writeFile.mockResolvedValue(undefined)
  rm.mockResolvedValue(undefined)
  rename.mockResolvedValue(undefined)
})

describe('createCiphertextFile — write / atomares Ersetzen', () => {
  it('Happy Path: schreibt tmp, benennt einmal um', async () => {
    const file = createCiphertextFile(ZIEL)
    await file.write(new Uint8Array([1, 2, 3]))

    expect(mkdir).toHaveBeenCalledWith('/userData', { recursive: true })
    expect(writeFile).toHaveBeenCalledWith(TMP, expect.any(Uint8Array))
    expect(rename).toHaveBeenCalledTimes(1)
    expect(rename).toHaveBeenCalledWith(TMP, ZIEL)
  })

  it('EBUSY 2× dann Erfolg: rename beim 3. Versuch, mit Backoff-Wartezeit', async () => {
    vi.useFakeTimers()
    rename
      .mockRejectedValueOnce(fehler('EBUSY'))
      .mockRejectedValueOnce(fehler('EBUSY'))
      .mockResolvedValueOnce(undefined)

    const file = createCiphertextFile(ZIEL)
    const p = file.write(new Uint8Array([9]))

    // Backoff 25*(i+1)ms: 25ms nach 1. Fehler, 50ms nach 2. Fehler.
    await vi.advanceTimersByTimeAsync(25)
    await vi.advanceTimersByTimeAsync(50)
    await p

    expect(rename).toHaveBeenCalledTimes(3)
    expect(rm).not.toHaveBeenCalled() // EBUSY führt NICHT zum rm-Pfad
  })

  it('EPERM dann Erfolg: gleiche Retry-Behandlung wie EBUSY', async () => {
    vi.useFakeTimers()
    rename.mockRejectedValueOnce(fehler('EPERM')).mockResolvedValueOnce(undefined)

    const file = createCiphertextFile(ZIEL)
    const p = file.write(new Uint8Array([7]))
    await vi.advanceTimersByTimeAsync(25)
    await p

    expect(rename).toHaveBeenCalledTimes(2)
    expect(rm).not.toHaveBeenCalled()
  })

  it('EEXIST: entfernt zuerst das Ziel (rm force), dann rename — ohne Backoff', async () => {
    rename.mockRejectedValueOnce(fehler('EEXIST')).mockResolvedValueOnce(undefined)

    const file = createCiphertextFile(ZIEL)
    await file.write(new Uint8Array([5]))

    expect(rm).toHaveBeenCalledWith(ZIEL, { force: true })
    expect(rename).toHaveBeenCalledTimes(2)
  })

  it('endgültiges Scheitern: EBUSY über alle 6 Versuche wirft sauber', async () => {
    vi.useFakeTimers()
    rename.mockRejectedValue(fehler('EBUSY'))

    const file = createCiphertextFile(ZIEL)
    const p = file.write(new Uint8Array([1]))
    const erwartung = expect(p).rejects.toMatchObject({ code: 'EBUSY' })

    // 5 Backoffs (nach Versuch 1..5); der 6. Versuch wirft ohne weiteres Warten.
    await vi.advanceTimersByTimeAsync(25 + 50 + 75 + 100 + 125)
    await erwartung

    expect(rename).toHaveBeenCalledTimes(6) // exakt max Versuche
  })

  it('unbekannter Fehlercode wird sofort weitergeworfen (kein Retry)', async () => {
    rename.mockRejectedValue(fehler('ENOSPC'))

    const file = createCiphertextFile(ZIEL)
    await expect(file.write(new Uint8Array([1]))).rejects.toMatchObject({ code: 'ENOSPC' })
    expect(rename).toHaveBeenCalledTimes(1) // kein Retry bei unbekanntem Code
  })
})

// A1: Korruptions-Rettung — wörtlich dasselbe Muster wie settings-file.ts (ersetzeAtomar auf
// `${filePath}.korrupt`, wirft NIE). Genutzt von history-store.ts (Verlauf) und api-key-vault.ts
// (Key-Tresor), damit eine nicht entschlüsselbare Datei beiseitegelegt statt überschrieben wird.
describe('createCiphertextFile — beiseiteLegen (A1)', () => {
  it('benennt die Datei nach <pfad>.korrupt um', async () => {
    const file = createCiphertextFile(ZIEL)
    await file.beiseiteLegen!()

    expect(rename).toHaveBeenCalledTimes(1)
    expect(rename).toHaveBeenCalledWith(ZIEL, `${ZIEL}.korrupt`)
  })

  it('wirft nie, auch wenn das Umbenennen endgültig scheitert (best effort, Aufrufer hat Vorrang)', async () => {
    rename.mockRejectedValue(fehler('EACCES'))
    const file = createCiphertextFile(ZIEL)

    await expect(file.beiseiteLegen!()).resolves.toBeUndefined()
  })

  it('wirft nie bei ENOENT (Quelle existiert nicht mehr)', async () => {
    rename.mockRejectedValue(fehler('ENOENT'))
    const file = createCiphertextFile(ZIEL)

    await expect(file.beiseiteLegen!()).resolves.toBeUndefined()
  })
})

describe('createCiphertextFile — read / remove', () => {
  it('read liefert Uint8Array bei vorhandener Datei', async () => {
    readFile.mockResolvedValueOnce(Buffer.from([1, 2, 3]))
    const file = createCiphertextFile(ZIEL)
    const out = await file.read()
    expect(out).toBeInstanceOf(Uint8Array)
    expect(Array.from(out!)).toEqual([1, 2, 3])
  })

  it('read liefert null bei ENOENT', async () => {
    readFile.mockRejectedValueOnce(fehler('ENOENT'))
    const file = createCiphertextFile(ZIEL)
    expect(await file.read()).toBeNull()
  })

  it('read wirft bei anderem Fehler (nicht ENOENT)', async () => {
    readFile.mockRejectedValueOnce(fehler('EACCES'))
    const file = createCiphertextFile(ZIEL)
    await expect(file.read()).rejects.toMatchObject({ code: 'EACCES' })
  })

  it('remove ruft rm mit force', async () => {
    const file = createCiphertextFile(ZIEL)
    await file.remove()
    expect(rm).toHaveBeenCalledWith(ZIEL, { force: true })
  })
})
