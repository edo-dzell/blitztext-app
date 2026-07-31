import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createStatsStore, komprimiereAeltereAls, type StatsFile, type StatZeile } from '@main/stats/stats-store'

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
    const s = await store.zusammenfassung(T)
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
    const s = await store.zusammenfassung(T)
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
    const s = await store.zusammenfassung(T)
    expect(s.gesamtPromptTokens).toBe(300)
    expect(s.gesamtCompletionTokens).toBe(100)
  })

  it('trennt verschiedene Tage', async () => {
    const store = createStatsStore({ file: fakeFile() })
    const T2 = Date.UTC(2026, 5, 6, 9, 0, 0)
    await store.aufzeichnen({ workflowId: 't', audioSekunden: 5, asrModell: 'whisper-1' }, T)
    await store.aufzeichnen({ workflowId: 't', audioSekunden: 5, asrModell: 'whisper-1' }, T2)
    const s = await store.zusammenfassung(T2)
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
    expect((await store.zusammenfassung(T)).zeilen).toEqual([])
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
    const s = await store.zusammenfassung(lokal0030)
    expect(s.zeilen).toHaveLength(1)
    expect(s.zeilen[0]!.datum).toBe('2026-06-05')
  })

  it('Lauf um 12:00 lokal bleibt unverändert (gleicher Tag wie UTC)', async () => {
    // 2026-06-05 12:00 Europe/Berlin (CEST, UTC+2) = 2026-06-05 10:00 UTC.
    const lokalMittag = Date.UTC(2026, 5, 5, 10, 0, 0)
    const store = createStatsStore({ file: fakeFile() })
    await store.aufzeichnen({ workflowId: 't', audioSekunden: 5, asrModell: 'whisper-1' }, lokalMittag)
    const s = await store.zusammenfassung(lokalMittag)
    expect(s.zeilen[0]!.datum).toBe('2026-06-05')
  })

  it('Schlüsselformat bleibt YYYY-MM-DD (auch bei einstelligem Monat/Tag)', async () => {
    // 2026-01-02 01:00 Europe/Berlin (Winterzeit, UTC+1) = 2026-01-02 00:00 UTC.
    const jan = Date.UTC(2026, 0, 2, 0, 0, 0)
    const store = createStatsStore({ file: fakeFile() })
    await store.aufzeichnen({ workflowId: 't', audioSekunden: 5, asrModell: 'whisper-1' }, jan)
    // jetztMs fix auf denselben Zeitpunkt: verhindert, dass die B1-Monats-Kompaktierung (90-Tage-
    // Schwelle relativ zur echten Systemzeit) dieses Fixture nachträglich verändert — der Test prüft
    // ausschließlich das Tages-Schlüsselformat direkt nach dem Aufzeichnen.
    const s = await store.zusammenfassung(jan)
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
    const s = await store.zusammenfassung(naechsterTag)
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
    const s = await store.zusammenfassung(lokal0030)
    // Zwei getrennte Zeilen (Alt-Schlüssel wird NICHT rückwirkend migriert) — beide im gleichen Format,
    // beide lexikalisch sortierbar, Summen bleiben korrekt.
    expect(s.zeilen.map((z) => z.datum).sort()).toEqual(['2026-06-04', '2026-06-05'])
    expect(s.gesamtAnzahl).toBe(2)
    expect(s.gesamtAudioSekunden).toBe(8)
  })
})

// B1: Monats-Kompaktierung — Zeilen älter als 90 Tage werden in `zusammenfassung()` auf Monatsebene
// aggregiert (Speicherplatz/Übersicht), jüngere Zeilen bleiben auf Tagesebene unangetastet.
describe('komprimiereAeltereAls (reine Funktion)', () => {
  function zeile(teil: Partial<StatZeile> & Pick<StatZeile, 'datum'>): StatZeile {
    return {
      workflowId: 'transcribe',
      anzahl: 1,
      audioSekunden: 0,
      asrModell: 'whisper-1',
      chatModell: '',
      promptTokens: 0,
      completionTokens: 0,
      ...teil
    }
  }

  it('aggregiert mehrere Tage desselben Monats/Workflows/Modells zu einer Monatszeile', () => {
    const zeilen: StatZeile[] = [
      zeile({ datum: '2026-03-01', anzahl: 2, audioSekunden: 10, promptTokens: 100, completionTokens: 20 }),
      zeile({ datum: '2026-03-15', anzahl: 3, audioSekunden: 15, promptTokens: 50, completionTokens: 10 }),
      zeile({ datum: '2026-03-31', anzahl: 1, audioSekunden: 5, promptTokens: 25, completionTokens: 5 })
    ]
    const ergebnis = komprimiereAeltereAls(zeilen, '2026-06-01')
    expect(ergebnis).toHaveLength(1)
    expect(ergebnis[0]!.datum).toBe('2026-03')
    expect(ergebnis[0]!.anzahl).toBe(6)
    expect(ergebnis[0]!.audioSekunden).toBe(30)
    expect(ergebnis[0]!.promptTokens).toBe(175)
    expect(ergebnis[0]!.completionTokens).toBe(35)
  })

  it('hält verschiedene Workflows/Modelle im selben Monat getrennt', () => {
    const zeilen: StatZeile[] = [
      zeile({ datum: '2026-03-01', workflowId: 'transcribe', anzahl: 1 }),
      zeile({ datum: '2026-03-02', workflowId: 'improve', chatModell: 'gpt-4o-mini', anzahl: 1 }),
      zeile({ datum: '2026-03-03', workflowId: 'transcribe', asrModell: 'whisper-2', anzahl: 1 })
    ]
    const ergebnis = komprimiereAeltereAls(zeilen, '2026-06-01')
    expect(ergebnis).toHaveLength(3)
    expect(ergebnis.every((z) => z.datum === '2026-03')).toBe(true)
  })

  it('Grenzfall: Zeile GENAU an der Grenze bleibt eine Tageszeile (nicht kompaktiert)', () => {
    const zeilen: StatZeile[] = [zeile({ datum: '2026-04-10', anzahl: 1 })]
    const ergebnis = komprimiereAeltereAls(zeilen, '2026-04-10')
    expect(ergebnis).toHaveLength(1)
    expect(ergebnis[0]!.datum).toBe('2026-04-10')
  })

  it('Zeile einen Tag VOR der Grenze wird kompaktiert', () => {
    const zeilen: StatZeile[] = [zeile({ datum: '2026-04-09', anzahl: 1 })]
    const ergebnis = komprimiereAeltereAls(zeilen, '2026-04-10')
    expect(ergebnis).toHaveLength(1)
    expect(ergebnis[0]!.datum).toBe('2026-04')
  })

  it('ist idempotent: zweiter Lauf auf bereits kompaktierten Monatszeilen verändert nichts', () => {
    const zeilen: StatZeile[] = [
      zeile({ datum: '2026-03-01', anzahl: 2, audioSekunden: 10 }),
      zeile({ datum: '2026-03-20', anzahl: 3, audioSekunden: 15 })
    ]
    const einmal = komprimiereAeltereAls(zeilen, '2026-06-01')
    const zweimal = komprimiereAeltereAls(einmal, '2026-06-01')
    expect(zweimal).toEqual(einmal)
    expect(zweimal).toHaveLength(1)
    expect(zweimal[0]!.anzahl).toBe(5)
    expect(zweimal[0]!.audioSekunden).toBe(25)
  })

  it('führt bereits kompaktierte YYYY-MM-Zeilen mit gleichem Schlüssel weiter zusammen', () => {
    // Simuliert zwei unabhängig kompaktierte Monatszeilen (z.B. aus zwei früheren Läufen), die beim
    // erneuten Kompaktieren (Schlüssel: Monat+Workflow+Modelle) zusammengeführt werden müssen.
    const zeilen: StatZeile[] = [
      zeile({ datum: '2026-03', anzahl: 5, audioSekunden: 25, promptTokens: 10, completionTokens: 2 }),
      zeile({ datum: '2026-03', anzahl: 1, audioSekunden: 3, promptTokens: 1, completionTokens: 1 })
    ]
    const ergebnis = komprimiereAeltereAls(zeilen, '2026-06-01')
    expect(ergebnis).toHaveLength(1)
    expect(ergebnis[0]!.datum).toBe('2026-03')
    expect(ergebnis[0]!.anzahl).toBe(6)
    expect(ergebnis[0]!.audioSekunden).toBe(28)
    expect(ergebnis[0]!.promptTokens).toBe(11)
    expect(ergebnis[0]!.completionTokens).toBe(3)
  })

  it('verarbeitet gemischte Formate (Tages- und Monatszeilen) korrekt nebeneinander', () => {
    const zeilen: StatZeile[] = [
      zeile({ datum: '2026-03-05', anzahl: 2 }), // alt, Tagesform → wird kompaktiert
      zeile({ datum: '2026-02', anzahl: 4 }), // alt, bereits Monatsform → bleibt/verschmilzt
      zeile({ datum: '2026-06-10', anzahl: 1 }) // jung → bleibt Tageszeile
    ]
    const ergebnis = komprimiereAeltereAls(zeilen, '2026-06-01')
    const nachDatum = Object.fromEntries(ergebnis.map((z) => [z.datum, z.anzahl]))
    expect(nachDatum['2026-03']).toBe(2)
    expect(nachDatum['2026-02']).toBe(4)
    expect(nachDatum['2026-06-10']).toBe(1)
    expect(ergebnis).toHaveLength(3)
  })

  it('Gesamt-Invariante: Summe aller Felder vor Kompaktierung == Summe nach Kompaktierung', () => {
    const zeilen: StatZeile[] = [
      zeile({ datum: '2026-01-01', anzahl: 2, audioSekunden: 11, promptTokens: 7, completionTokens: 3 }),
      zeile({ datum: '2026-01-15', workflowId: 'improve', chatModell: 'gpt-4o', anzahl: 5, audioSekunden: 20, promptTokens: 40, completionTokens: 8 }),
      zeile({ datum: '2026-02-28', anzahl: 1, audioSekunden: 1, promptTokens: 1, completionTokens: 1 }),
      zeile({ datum: '2026-06-10', anzahl: 3, audioSekunden: 9, promptTokens: 6, completionTokens: 2 }) // jung, bleibt Tageszeile
    ]
    const summe = (liste: StatZeile[], feld: keyof Pick<StatZeile, 'anzahl' | 'audioSekunden' | 'promptTokens' | 'completionTokens'>) =>
      liste.reduce((acc, z) => acc + z[feld], 0)

    const ergebnis = komprimiereAeltereAls(zeilen, '2026-06-01')

    expect(summe(ergebnis, 'anzahl')).toBe(summe(zeilen, 'anzahl'))
    expect(summe(ergebnis, 'audioSekunden')).toBe(summe(zeilen, 'audioSekunden'))
    expect(summe(ergebnis, 'promptTokens')).toBe(summe(zeilen, 'promptTokens'))
    expect(summe(ergebnis, 'completionTokens')).toBe(summe(zeilen, 'completionTokens'))
  })
})

describe('createStatsStore.zusammenfassung — Monats-Kompaktierung (B1)', () => {
  const jetzt2026_06_15 = Date.UTC(2026, 5, 15, 12, 0, 0) // 2026-06-15 12:00 UTC

  it('kompaktiert Zeilen älter als 90 Tage und schreibt das Ergebnis zurück', async () => {
    const file = fakeFile()
    file.content = JSON.stringify([
      { datum: '2026-01-01', workflowId: 't', anzahl: 1, audioSekunden: 5, asrModell: 'whisper-1', chatModell: '', promptTokens: 0, completionTokens: 0 },
      { datum: '2026-01-20', workflowId: 't', anzahl: 2, audioSekunden: 3, asrModell: 'whisper-1', chatModell: '', promptTokens: 0, completionTokens: 0 },
      { datum: '2026-06-14', workflowId: 't', anzahl: 1, audioSekunden: 9, asrModell: 'whisper-1', chatModell: '', promptTokens: 0, completionTokens: 0 }
    ] satisfies StatZeile[])
    const store = createStatsStore({ file })

    const s = await store.zusammenfassung(jetzt2026_06_15)

    const nachDatum = Object.fromEntries(s.zeilen.map((z) => [z.datum, z.anzahl]))
    expect(nachDatum['2026-01']).toBe(3)
    expect(nachDatum['2026-06-14']).toBe(1)
    expect(s.gesamtAnzahl).toBe(4)
    expect(s.gesamtAudioSekunden).toBe(17)

    // Zurückgeschrieben: die Datei enthält jetzt die kompaktierte Form.
    const persistiert = JSON.parse(file.content!) as StatZeile[]
    expect(persistiert.map((z) => z.datum).sort()).toEqual(['2026-01', '2026-06-14'])
  })

  it('ist idempotent: zweiter Aufruf verändert die Datei nicht mehr (kein unnötiger Write)', async () => {
    const file = fakeFile()
    file.content = JSON.stringify([
      { datum: '2026-01-01', workflowId: 't', anzahl: 1, audioSekunden: 5, asrModell: 'whisper-1', chatModell: '', promptTokens: 0, completionTokens: 0 }
    ] satisfies StatZeile[])
    const store = createStatsStore({ file })

    await store.zusammenfassung(jetzt2026_06_15)
    const inhaltNachErstemLauf = file.content

    let schreibAufrufe = 0
    const urspruenglichesWrite = file.write.bind(file)
    file.write = async (next: string) => {
      schreibAufrufe += 1
      await urspruenglichesWrite(next)
    }

    const s2 = await store.zusammenfassung(jetzt2026_06_15)

    expect(schreibAufrufe).toBe(0)
    expect(file.content).toBe(inhaltNachErstemLauf)
    expect(s2.zeilen).toHaveLength(1)
    expect(s2.zeilen[0]!.datum).toBe('2026-01')
    expect(s2.gesamtAnzahl).toBe(1)
  })

  it('nimmt KEINEN Write vor, wenn nichts zu kompaktieren ist (nur junge Zeilen)', async () => {
    const file = fakeFile()
    file.content = JSON.stringify([
      { datum: '2026-06-10', workflowId: 't', anzahl: 1, audioSekunden: 5, asrModell: 'whisper-1', chatModell: '', promptTokens: 0, completionTokens: 0 }
    ] satisfies StatZeile[])
    const store = createStatsStore({ file })

    let schreibAufrufe = 0
    const urspruenglichesWrite = file.write.bind(file)
    file.write = async (next: string) => {
      schreibAufrufe += 1
      await urspruenglichesWrite(next)
    }

    const s = await store.zusammenfassung(jetzt2026_06_15)

    expect(schreibAufrufe).toBe(0)
    expect(s.zeilen).toHaveLength(1)
    expect(s.zeilen[0]!.datum).toBe('2026-06-10')
  })

  it('leere Statistik bleibt leer, kein Write', async () => {
    const file = fakeFile()
    const store = createStatsStore({ file })

    let schreibAufrufe = 0
    const urspruenglichesWrite = file.write.bind(file)
    file.write = async (next: string) => {
      schreibAufrufe += 1
      await urspruenglichesWrite(next)
    }

    const s = await store.zusammenfassung(jetzt2026_06_15)

    expect(schreibAufrufe).toBe(0)
    expect(s.zeilen).toEqual([])
    expect(s.gesamtAnzahl).toBe(0)
  })

  it('ohne übergebenes jetztMs funktioniert zusammenfassung() weiterhin (Default = aktuelle Zeit)', async () => {
    const file = fakeFile()
    file.content = JSON.stringify([
      { datum: '2026-06-10', workflowId: 't', anzahl: 1, audioSekunden: 5, asrModell: 'whisper-1', chatModell: '', promptTokens: 0, completionTokens: 0 }
    ] satisfies StatZeile[])
    const store = createStatsStore({ file })

    const s = await store.zusammenfassung()

    expect(s.zeilen).toHaveLength(1)
    expect(s.gesamtAnzahl).toBe(1)
  })

  // --- v0.8.0 (statistikKompaktierungTage): Live-Getter, nimmt Vorrang vor KOMPAKTIERUNGS_SCHWELLE_TAGE ---

  it('getKompaktierungTage=30 kompaktiert eine 45 Tage alte Zeile, die der Default (90) noch tagesgenau ließe', async () => {
    const vor45Tagen = '2026-05-01' // 45 Tage vor 2026-06-15
    const file = fakeFile()
    file.content = JSON.stringify([
      { datum: vor45Tagen, workflowId: 't', anzahl: 1, audioSekunden: 5, asrModell: 'whisper-1', chatModell: '', promptTokens: 0, completionTokens: 0 }
    ] satisfies StatZeile[])

    const storeDefault = createStatsStore({ file })
    const sDefault = await storeDefault.zusammenfassung(jetzt2026_06_15)
    expect(sDefault.zeilen[0]!.datum).toBe(vor45Tagen) // Default (90): 45 Tage sind noch nicht alt genug

    const file2 = fakeFile()
    file2.content = JSON.stringify([
      { datum: vor45Tagen, workflowId: 't', anzahl: 1, audioSekunden: 5, asrModell: 'whisper-1', chatModell: '', promptTokens: 0, completionTokens: 0 }
    ] satisfies StatZeile[])
    const storeKurz = createStatsStore({ file: file2, getKompaktierungTage: () => 30 })
    const sKurz = await storeKurz.zusammenfassung(jetzt2026_06_15)
    expect(sKurz.zeilen[0]!.datum).toBe('2026-05') // abweichender Wert kommt an: jetzt kompaktiert
  })

  it('wird bei JEDEM zusammenfassung()-Aufruf frisch gelesen (Live-Änderung ohne Store-Neubau)', async () => {
    const vor45Tagen = '2026-05-01'
    const file = fakeFile()
    file.content = JSON.stringify([
      { datum: vor45Tagen, workflowId: 't', anzahl: 1, audioSekunden: 5, asrModell: 'whisper-1', chatModell: '', promptTokens: 0, completionTokens: 0 }
    ] satisfies StatZeile[])
    let schwelleTage = 90
    const store = createStatsStore({ file, getKompaktierungTage: () => schwelleTage })

    expect((await store.zusammenfassung(jetzt2026_06_15)).zeilen[0]!.datum).toBe(vor45Tagen)

    schwelleTage = 30 // Live-Änderung, wie composition-root sie über die Closure durchreicht
    expect((await store.zusammenfassung(jetzt2026_06_15)).zeilen[0]!.datum).toBe('2026-05')
  })
})
