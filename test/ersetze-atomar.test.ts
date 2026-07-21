import { describe, it, expect, vi, beforeEach } from 'vitest'

// node:fs/promises mocken → deterministische Kontrolle über rename/rm, insbesondere die
// Windows-AV-Lock-Retry-Schleife (EEXIST/EPERM/EBUSY). Spiegelt die Matrix aus
// ciphertext-file.test.ts, das die Funktion vor der Extraktion indirekt abgedeckt hat.
const rename = vi.fn()
const rm = vi.fn()

vi.mock('node:fs/promises', () => ({
  rename: (...a: unknown[]) => rename(...a),
  rm: (...a: unknown[]) => rm(...a)
}))

import { ersetzeAtomar } from '@main/fs/ersetze-atomar'

function fehler(code: string): NodeJS.ErrnoException {
  const e = new Error(code) as NodeJS.ErrnoException
  e.code = code
  return e
}

const VON = '/userData/settings.json.tmp'
const NACH = '/userData/settings.json'

beforeEach(() => {
  vi.clearAllMocks()
  vi.useRealTimers()
  rm.mockResolvedValue(undefined)
  rename.mockResolvedValue(undefined)
})

describe('ersetzeAtomar', () => {
  it('Happy Path: benennt genau einmal um, kein rm', async () => {
    await ersetzeAtomar(VON, NACH)
    expect(rename).toHaveBeenCalledTimes(1)
    expect(rename).toHaveBeenCalledWith(VON, NACH)
    expect(rm).not.toHaveBeenCalled()
  })

  it('EBUSY 2× dann Erfolg: rename beim 3. Versuch, mit Backoff-Wartezeit', async () => {
    vi.useFakeTimers()
    rename
      .mockRejectedValueOnce(fehler('EBUSY'))
      .mockRejectedValueOnce(fehler('EBUSY'))
      .mockResolvedValueOnce(undefined)

    const p = ersetzeAtomar(VON, NACH)
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

    const p = ersetzeAtomar(VON, NACH)
    await vi.advanceTimersByTimeAsync(25)
    await p

    expect(rename).toHaveBeenCalledTimes(2)
    expect(rm).not.toHaveBeenCalled()
  })

  it('EEXIST: entfernt zuerst das Ziel (rm force), dann rename — ohne Backoff', async () => {
    rename.mockRejectedValueOnce(fehler('EEXIST')).mockResolvedValueOnce(undefined)

    await ersetzeAtomar(VON, NACH)

    expect(rm).toHaveBeenCalledWith(NACH, { force: true })
    expect(rename).toHaveBeenCalledTimes(2)
  })

  it('endgültiges Scheitern: EBUSY über alle 6 Versuche wirft sauber', async () => {
    vi.useFakeTimers()
    rename.mockRejectedValue(fehler('EBUSY'))

    const p = ersetzeAtomar(VON, NACH)
    const erwartung = expect(p).rejects.toMatchObject({ code: 'EBUSY' })
    // 5 Backoffs (nach Versuch 1..5); der 6. Versuch wirft ohne weiteres Warten.
    await vi.advanceTimersByTimeAsync(25 + 50 + 75 + 100 + 125)
    await erwartung

    expect(rename).toHaveBeenCalledTimes(6) // exakt max Versuche
  })

  it('respektiert einen abweichenden versuche-Parameter (2 Versuche)', async () => {
    vi.useFakeTimers()
    rename.mockRejectedValue(fehler('EBUSY'))

    const p = ersetzeAtomar(VON, NACH, 2)
    const erwartung = expect(p).rejects.toMatchObject({ code: 'EBUSY' })
    await vi.advanceTimersByTimeAsync(25) // nur ein Backoff nach dem 1. Versuch
    await erwartung

    expect(rename).toHaveBeenCalledTimes(2)
  })

  it('unbekannter Fehlercode wird sofort weitergeworfen (kein Retry)', async () => {
    rename.mockRejectedValue(fehler('ENOSPC'))

    await expect(ersetzeAtomar(VON, NACH)).rejects.toMatchObject({ code: 'ENOSPC' })
    expect(rename).toHaveBeenCalledTimes(1) // kein Retry bei unbekanntem Code
  })
})
