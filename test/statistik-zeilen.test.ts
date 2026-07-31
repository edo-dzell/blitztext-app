// A5 (v0.8.0): Die Statistik-Tabelle rendert `summary.zeilen` in Einfüge-Reihenfolge des Stores. Im
// Grenzmonat der 90-Tage-Kompaktierung stehen dort gleichzeitig eine Monatszeile und Tageszeilen
// desselben Monats — arithmetisch korrekt, ohne Sortierung aber wie eine Dopplung wirkend.
import { describe, it, expect } from 'vitest'
import { sortiereStatistikZeilen } from '@shared/statistik-zeilen'
import type { StatZeile } from '@main/stats/stats-store'

function zeile(teil: Partial<StatZeile> & Pick<StatZeile, 'datum'>): StatZeile {
  return {
    workflowId: 'clean',
    anzahl: 1,
    audioSekunden: 1,
    asrModell: 'whisper-1',
    chatModell: '',
    promptTokens: 0,
    completionTokens: 0,
    ...teil
  }
}

describe('sortiereStatistikZeilen', () => {
  it('sortiert reine Tageszeilen absteigend nach Datum (neueste zuerst)', () => {
    const zeilen = [zeile({ datum: '2026-04-01' }), zeile({ datum: '2026-04-10' }), zeile({ datum: '2026-04-05' })]
    const ergebnis = sortiereStatistikZeilen(zeilen)
    expect(ergebnis.map((z) => z.datum)).toEqual(['2026-04-10', '2026-04-05', '2026-04-01'])
  })

  it('Grenzmonat: Monatszeile + mehrere Tageszeilen desselben Monats → deterministisch absteigend', () => {
    // Realer Fall aus A5: 90-Tage-Kompaktierungsgrenze liegt mitten im April → ältere April-Tage sind
    // bereits zur Monatszeile '2026-04' verschmolzen, jüngere April-Tage bleiben als Tageszeilen.
    const zeilen = [
      zeile({ datum: '2026-04-28', workflowId: 'clean' }),
      zeile({ datum: '2026-04', workflowId: 'improve' }),
      zeile({ datum: '2026-04-30', workflowId: 'clean' }),
      zeile({ datum: '2026-04-29', workflowId: 'improve' })
    ]
    const ergebnis = sortiereStatistikZeilen(zeilen)
    expect(ergebnis.map((z) => `${z.datum}|${z.workflowId}`)).toEqual([
      '2026-04-30|clean',
      '2026-04-29|improve',
      '2026-04-28|clean',
      '2026-04|improve'
    ])
  })

  it('sekundäres Kriterium workflowId bei gleichem Datum: deterministisch aufsteigend', () => {
    const zeilen = [
      zeile({ datum: '2026-04-10', workflowId: 'zeta' }),
      zeile({ datum: '2026-04-10', workflowId: 'alpha' }),
      zeile({ datum: '2026-04-10', workflowId: 'mitte' })
    ]
    const ergebnis = sortiereStatistikZeilen(zeilen)
    expect(ergebnis.map((z) => z.workflowId)).toEqual(['alpha', 'mitte', 'zeta'])
  })

  it('mutiert die Eingabeliste NICHT (liefert eine neue Kopie)', () => {
    const zeilen = [zeile({ datum: '2026-04-01' }), zeile({ datum: '2026-04-10' })]
    const original = [...zeilen]
    const ergebnis = sortiereStatistikZeilen(zeilen)
    expect(zeilen).toEqual(original) // Reihenfolge der Original-Referenz unverändert
    expect(ergebnis).not.toBe(zeilen)
  })
})
