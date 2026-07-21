import { describe, it, expect } from 'vitest'
import { mitRetry } from '@main/workflow/retry'

const sofort = async (): Promise<void> => {}

describe('mitRetry', () => {
  it('Sofort-Erfolg: ruft fn genau einmal', async () => {
    let n = 0
    const r = await mitRetry(
      async () => {
        n++
        return 'ok'
      },
      { versuche: 3, backoffMs: 1, retrybar: () => true, sleep: sofort }
    )
    expect(r).toBe('ok')
    expect(n).toBe(1)
  })

  it('transient → Erfolg: wiederholt, bis es klappt', async () => {
    let n = 0
    const r = await mitRetry(
      async () => {
        n++
        if (n < 2) throw new Error('transient')
        return 'ok'
      },
      { versuche: 3, backoffMs: 1, retrybar: () => true, sleep: sofort }
    )
    expect(r).toBe('ok')
    expect(n).toBe(2)
  })

  it('dauerhaft → Fehler nach erschöpften Versuchen', async () => {
    let n = 0
    await expect(
      mitRetry(
        async () => {
          n++
          throw new Error('weg')
        },
        { versuche: 2, backoffMs: 1, retrybar: () => true, sleep: sofort }
      )
    ).rejects.toThrow('weg')
    expect(n).toBe(2)
  })

  it('nicht retrybar → wirft sofort ohne Wiederholung', async () => {
    let n = 0
    await expect(
      mitRetry(
        async () => {
          n++
          throw new Error('konfig')
        },
        { versuche: 3, backoffMs: 1, retrybar: () => false, sleep: sofort }
      )
    ).rejects.toThrow('konfig')
    expect(n).toBe(1)
  })

  it('beiWiederholung feuert je Fehlversuch, der wiederholt wird — nicht beim Erfolg', async () => {
    const hits: Array<{ versuch: number; message: string }> = []
    let n = 0
    const r = await mitRetry(
      async () => {
        n++
        if (n < 3) throw new Error(`transient-${n}`)
        return 'ok'
      },
      {
        versuche: 5,
        backoffMs: 1,
        retrybar: () => true,
        sleep: sofort,
        beiWiederholung: (versuch, fehler) =>
          hits.push({ versuch, message: fehler instanceof Error ? fehler.message : String(fehler) })
      }
    )
    expect(r).toBe('ok')
    // Zwei Fehlversuche (n=1, n=2), dann Erfolg (n=3) → genau zwei Hook-Aufrufe, keiner beim Erfolg.
    expect(hits).toEqual([
      { versuch: 1, message: 'transient-1' },
      { versuch: 2, message: 'transient-2' }
    ])
  })

  it('beiWiederholung feuert NICHT beim Sofort-Erfolg', async () => {
    let hits = 0
    await mitRetry(async () => 'ok', {
      versuche: 3,
      backoffMs: 1,
      retrybar: () => true,
      sleep: sofort,
      beiWiederholung: () => {
        hits++
      }
    })
    expect(hits).toBe(0)
  })

  it('beiWiederholung feuert NICHT beim finalen Wurf (Versuche erschöpft)', async () => {
    const hits: number[] = []
    await expect(
      mitRetry(
        async () => {
          throw new Error('weg')
        },
        {
          versuche: 2,
          backoffMs: 1,
          retrybar: () => true,
          sleep: sofort,
          beiWiederholung: (versuch) => hits.push(versuch)
        }
      )
    ).rejects.toThrow('weg')
    // Versuch 1 scheitert und wird wiederholt (Hook), Versuch 2 scheitert final (kein Hook).
    expect(hits).toEqual([1])
  })

  it('beiWiederholung feuert NICHT, wenn der Fehler nicht retrybar ist', async () => {
    let hits = 0
    await expect(
      mitRetry(
        async () => {
          throw new Error('konfig')
        },
        {
          versuche: 3,
          backoffMs: 1,
          retrybar: () => false,
          sleep: sofort,
          beiWiederholung: () => {
            hits++
          }
        }
      )
    ).rejects.toThrow('konfig')
    expect(hits).toBe(0)
  })

  it('ein werfender beiWiederholung-Hook stört den Retry nicht (darf-nie-werfen-Guard)', async () => {
    let n = 0
    const r = await mitRetry(
      async () => {
        n++
        if (n < 2) throw new Error('transient')
        return 'ok'
      },
      {
        versuche: 3,
        backoffMs: 1,
        retrybar: () => true,
        sleep: sofort,
        beiWiederholung: () => {
          throw new Error('log-fehler')
        }
      }
    )
    expect(r).toBe('ok')
    expect(n).toBe(2)
  })
})
