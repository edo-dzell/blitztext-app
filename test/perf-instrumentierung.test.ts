import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  createPerfInstrumentierung,
  NOOP_PERF,
  type PerfInstrumentierung
} from '@main/diagnostics/perf-instrumentierung'

describe('createPerfInstrumentierung', () => {
  it('erfasseStart/erfasseEnde schreiben einen Eintrag mit korrektem Delta in den Ringpuffer', () => {
    const werte = [100, 137.5]
    let i = 0
    const perf = createPerfInstrumentierung({ jetzt: () => werte[i++]! })

    const marker = perf.erfasseStart()
    perf.erfasseEnde(marker)

    expect(perf.ringpuffer()).toEqual([{ tKeydownMs: 100, tDispatchEndeMs: 137.5 }])
    perf.stoppe()
  })

  it('Ringpuffer überschreibt den ältesten Eintrag nach Erreichen der Kapazität (Wrap-Around)', () => {
    // kapazitaet=3, jeder Aufruf liefert ein festes, aufsteigendes Paar (start, ende).
    let n = 0
    const perf = createPerfInstrumentierung({ kapazitaet: 3, jetzt: () => n++ })

    // 4 Zyklen à (start, ende) → Werte 0..7, der 4. Zyklus überschreibt den 1. Eintrag.
    for (let zyklus = 0; zyklus < 4; zyklus++) {
      const marker = perf.erfasseStart()
      perf.erfasseEnde(marker)
    }

    expect(perf.ringpuffer()).toHaveLength(3)
    // Erwartete Rohwerte: Zyklus0=(0,1) Zyklus1=(2,3) Zyklus2=(4,5) Zyklus3=(6,7).
    // Kapazität 3 → nach Zyklus3 ist Zyklus0 überschrieben, übrig: Zyklus1, Zyklus2, Zyklus3
    // (Zyklus3 liegt am Schreibindex 0, da (3 % 3) === 0 → überschreibt slot 0 = Zyklus0).
    expect(perf.ringpuffer()).toEqual([
      { tKeydownMs: 6, tDispatchEndeMs: 7 }, // Zyklus3, an Index 0
      { tKeydownMs: 2, tDispatchEndeMs: 3 }, // Zyklus1, an Index 1
      { tKeydownMs: 4, tDispatchEndeMs: 5 } // Zyklus2, an Index 2
    ])
    perf.stoppe()
  })

  describe('periodisches Log', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })
    afterEach(() => {
      vi.useRealTimers()
    })

    it('wird nach logIntervallMs genau einmal aufgerufen', () => {
      const log = vi.fn()
      let n = 0
      const perf = createPerfInstrumentierung({ jetzt: () => n++, logIntervallMs: 1000, log })

      const marker = perf.erfasseStart()
      perf.erfasseEnde(marker)

      vi.advanceTimersByTime(1000)
      expect(log).toHaveBeenCalledTimes(1)
      expect(log.mock.calls[0]![0]).toContain('p50=')

      perf.stoppe()
    })

    it('loggt NICHT, solange der Ringpuffer leer ist (kein irreführendes p50=0-Log)', () => {
      const log = vi.fn()
      const perf = createPerfInstrumentierung({ logIntervallMs: 1000, log })

      vi.advanceTimersByTime(1000)
      expect(log).not.toHaveBeenCalled()

      perf.stoppe()
    })

    it('stoppe() verhindert weitere Log-Aufrufe (Timer-Leck-Schutz)', () => {
      const log = vi.fn()
      let n = 0
      const perf = createPerfInstrumentierung({ jetzt: () => n++, logIntervallMs: 1000, log })

      const marker = perf.erfasseStart()
      perf.erfasseEnde(marker)
      perf.stoppe()

      vi.advanceTimersByTime(10_000)
      expect(log).not.toHaveBeenCalled()
    })
  })
})

describe('NOOP_PERF', () => {
  it('alle Methoden sind No-Op und werfen nicht', () => {
    const perf: PerfInstrumentierung = NOOP_PERF
    expect(() => {
      const marker = perf.erfasseStart()
      perf.erfasseEnde(marker)
      perf.stoppe()
    }).not.toThrow()
    expect(perf.ringpuffer()).toEqual([])
  })
})
