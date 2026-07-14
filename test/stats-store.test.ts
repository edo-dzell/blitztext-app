import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createStatsStore, type StatsFile } from '@main/stats/stats-store'

function fakeFile(): StatsFile & { content: string | null } {
  const f = {
    content: null as string | null,
    async read() {
      return f.content
    },
    async write(next: string) {
      f.content = next
    }
  }
  return f
}

// 2026-06-05 12:00 UTC
const T = Date.UTC(2026, 5, 5, 12, 0, 0)

describe('createStatsStore', () => {
  it('aggregiert mehrere Läufe desselben Tags/Workflows/Modells', async () => {
    const store = createStatsStore({ file: fakeFile() })
    await store.aufzeichnen({ workflowId: 'transcribe', audioSekunden: 10, asrModell: 'whisper-1' }, T)
    await store.aufzeichnen({ workflowId: 'transcribe', audioSekunden: 20, asrModell: 'whisper-1' }, T)
    const s = await store.zusammenfassung()
    expect(s.zeilen).toHaveLength(1)
    expect(s.zeilen[0]!.anzahl).toBe(2)
    expect(s.zeilen[0]!.audioSekunden).toBe(30)
    expect(s.gesamtAnzahl).toBe(2)
  })

  it('summiert Eingabe-/Ausgabe-Token je Zeile und gesamt (P7)', async () => {
    const store = createStatsStore({ file: fakeFile() })
    await store.aufzeichnen(
      {
        workflowId: 'improve',
        audioSekunden: 60,
        asrModell: 'whisper-1',
        chat: { model: 'gpt-4o-mini', promptTokens: 1_000_000, completionTokens: 250_000 }
      },
      T
    )
    const s = await store.zusammenfassung()
    expect(s.zeilen[0]!.promptTokens).toBe(1_000_000)
    expect(s.zeilen[0]!.completionTokens).toBe(250_000)
    expect(s.gesamtPromptTokens).toBe(1_000_000)
    expect(s.gesamtCompletionTokens).toBe(250_000)
  })

  it('addiert Token-Summen über mehrere Zeilen (verschiedene Workflows)', async () => {
    const store = createStatsStore({ file: fakeFile() })
    await store.aufzeichnen(
      { workflowId: 'improve', audioSekunden: 1, asrModell: 'whisper-1', chat: { model: 'gpt-4o-mini', promptTokens: 100, completionTokens: 40 } },
      T
    )
    await store.aufzeichnen(
      { workflowId: 'calm', audioSekunden: 1, asrModell: 'whisper-1', chat: { model: 'gpt-4o', promptTokens: 200, completionTokens: 60 } },
      T
    )
    const s = await store.zusammenfassung()
    expect(s.gesamtPromptTokens).toBe(300)
    expect(s.gesamtCompletionTokens).toBe(100)
  })

  it('trennt verschiedene Tage', async () => {
    const store = createStatsStore({ file: fakeFile() })
    const T2 = Date.UTC(2026, 5, 6, 9, 0, 0)
    await store.aufzeichnen({ workflowId: 't', audioSekunden: 5, asrModell: 'whisper-1' }, T)
    await store.aufzeichnen({ workflowId: 't', audioSekunden: 5, asrModell: 'whisper-1' }, T2)
    const s = await store.zusammenfassung()
    expect(s.zeilen.map((z) => z.datum).sort()).toEqual(['2026-06-05', '2026-06-06'])
  })

  it('persistiert KEINEN Text (nur Zahlen/Modellnamen)', async () => {
    const file = fakeFile()
    const store = createStatsStore({ file })
    await store.aufzeichnen(
      {
        workflowId: 'improve',
        audioSekunden: 3,
        asrModell: 'whisper-1',
        chat: { model: 'gpt-4o-mini', promptTokens: 5, completionTokens: 7 }
      },
      T
    )
    expect(file.content).not.toBeNull()
    // Schlüssel sind rein numerisch/Modellnamen; keine Roh-/Endtext-Felder.
    expect(file.content).not.toContain('rohtext')
    expect(file.content).not.toContain('endtext')
  })

  it('löschen leert die Statistik', async () => {
    const store = createStatsStore({ file: fakeFile() })
    await store.aufzeichnen({ workflowId: 't', audioSekunden: 5, asrModell: 'whisper-1' }, T)
    await store.loeschen()
    expect((await store.zusammenfassung()).zeilen).toEqual([])
  })
})

// Tagesgrenze: LOKALE Zeit statt UTC (Befund: Läufe zwischen 0 und 2 Uhr deutscher Zeit landeten im
// UTC-Vortag). Diese Tests fixieren process.env.TZ auf 'Europe/Berlin', unabhängig von der Zeitzone
// der Ausführungsumgebung (hier: UTC), um das Verhalten deterministisch zu belegen.
describe('createStatsStore — lokale Tagesgrenze', () => {
  const urspruenglicheTz = process.env.TZ

  beforeEach(() => {
    process.env.TZ = 'Europe/Berlin'
  })

  afterEach(() => {
    process.env.TZ = urspruenglicheTz
  })

  it('Lauf um 00:30 lokal (UTC-Vortag, CEST) landet im lokalen Tag, nicht im UTC-Tag', async () => {
    // 2026-06-05 00:30 Europe/Berlin (Sommerzeit, UTC+2) = 2026-06-04 22:30 UTC.
    const lokal0030 = Date.UTC(2026, 5, 4, 22, 30, 0)
    const store = createStatsStore({ file: fakeFile() })
    await store.aufzeichnen({ workflowId: 't', audioSekunden: 5, asrModell: 'whisper-1' }, lokal0030)
    const s = await store.zusammenfassung()
    expect(s.zeilen).toHaveLength(1)
    expect(s.zeilen[0]!.datum).toBe('2026-06-05')
  })

  it('Lauf um 12:00 lokal bleibt unverändert (gleicher Tag wie UTC)', async () => {
    // 2026-06-05 12:00 Europe/Berlin (CEST, UTC+2) = 2026-06-05 10:00 UTC.
    const lokalMittag = Date.UTC(2026, 5, 5, 10, 0, 0)
    const store = createStatsStore({ file: fakeFile() })
    await store.aufzeichnen({ workflowId: 't', audioSekunden: 5, asrModell: 'whisper-1' }, lokalMittag)
    const s = await store.zusammenfassung()
    expect(s.zeilen[0]!.datum).toBe('2026-06-05')
  })

  it('Schlüsselformat bleibt YYYY-MM-DD (auch bei einstelligem Monat/Tag)', async () => {
    // 2026-01-02 01:00 Europe/Berlin (Winterzeit, UTC+1) = 2026-01-02 00:00 UTC.
    const jan = Date.UTC(2026, 0, 2, 0, 0, 0)
    const store = createStatsStore({ file: fakeFile() })
    await store.aufzeichnen({ workflowId: 't', audioSekunden: 5, asrModell: 'whisper-1' }, jan)
    const s = await store.zusammenfassung()
    expect(s.zeilen[0]!.datum).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(s.zeilen[0]!.datum).toBe('2026-01-02')
  })

  it('aggregiert über die Tagesgrenze korrekt (00:30 und 23:30 lokal desselben Tages bleiben zusammen; nächster Tag getrennt)', async () => {
    // 2026-06-05 00:30 Berlin = 2026-06-04 22:30 UTC; 2026-06-05 23:30 Berlin = 2026-06-05 21:30 UTC.
    const frueh = Date.UTC(2026, 5, 4, 22, 30, 0)
    const spaet = Date.UTC(2026, 5, 5, 21, 30, 0)
    // 2026-06-06 00:15 Berlin = 2026-06-05 22:15 UTC — anderer lokaler Tag trotz nahem UTC-Zeitpunkt.
    const naechsterTag = Date.UTC(2026, 5, 5, 22, 15, 0)
    const store = createStatsStore({ file: fakeFile() })
    await store.aufzeichnen({ workflowId: 't', audioSekunden: 1, asrModell: 'whisper-1' }, frueh)
    await store.aufzeichnen({ workflowId: 't', audioSekunden: 1, asrModell: 'whisper-1' }, spaet)
    await store.aufzeichnen({ workflowId: 't', audioSekunden: 1, asrModell: 'whisper-1' }, naechsterTag)
    const s = await store.zusammenfassung()
    expect(s.zeilen).toHaveLength(2)
    const nachDatum = Object.fromEntries(s.zeilen.map((z) => [z.datum, z.anzahl]))
    expect(nachDatum['2026-06-05']).toBe(2)
    expect(nachDatum['2026-06-06']).toBe(1)
  })

  it('gemischte Alt-Schlüssel (UTC-Format) und Neu-Schlüssel (lokales Format) bleiben stabil sortierbar/aggregierbar', async () => {
    // Simuliert Bestandsdaten aus einer Version vor diesem Fix: gleiche YYYY-MM-DD-Form, keine Migration.
    const file = fakeFile()
    file.content = JSON.stringify([
      {
        datum: '2026-06-04', // alter UTC-Schlüssel für einen Lauf, der lokal eigentlich am 05. war
        workflowId: 't',
        anzahl: 1,
        audioSekunden: 5,
        asrModell: 'whisper-1',
        chatModell: '',
        promptTokens: 0,
        completionTokens: 0
      }
    ])
    const store = createStatsStore({ file })
    // Neuer Lauf, lokal am 05.06., landet mit dem neuen (lokalen) Schlüssel.
    const lokal0030 = Date.UTC(2026, 5, 4, 22, 30, 0)
    await store.aufzeichnen({ workflowId: 't', audioSekunden: 3, asrModell: 'whisper-1' }, lokal0030)
    const s = await store.zusammenfassung()
    // Zwei getrennte Zeilen (Alt-Schlüssel wird NICHT rückwirkend migriert) — beide im gleichen Format,
    // beide lexikalisch sortierbar, Summen bleiben korrekt.
    expect(s.zeilen.map((z) => z.datum).sort()).toEqual(['2026-06-04', '2026-06-05'])
    expect(s.gesamtAnzahl).toBe(2)
    expect(s.gesamtAudioSekunden).toBe(8)
  })
})
