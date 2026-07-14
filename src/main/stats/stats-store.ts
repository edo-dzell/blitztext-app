// Statistik (ADR-0009, V2 Strang D): NUR Zahlen, text-frei, getrennt vom Verlauf, daher unverschlüsselt
// in einer eigenen JSON-Datei. Aggregiert je Tag × Workflow × Modelle. Der Store liefert NUR Zahlen
// (Nutzung + Token-Summen); die EUR-Kostenberechnung wandert in die Anzeige (Renderer), da Preise +
// Kurs nun nutzer-editierbar in den Settings liegen (P7). Reiner Kern hinter einem injizierten
// Datei-Port → testbar; der Zeitstempel (jetztMs) kommt vom Aufrufer (Adapter).

/** Eingang einer Aufzeichnung — strukturell TEXT-FREI (keine rohtext/endtext-Felder). */
export interface StatNutzung {
  workflowId: string
  audioSekunden: number
  asrModell: string
  chat?: { model: string; promptTokens: number; completionTokens: number }
}

export interface StatZeile {
  datum: string // YYYY-MM-DD
  workflowId: string
  anzahl: number
  audioSekunden: number
  asrModell: string
  chatModell: string
  promptTokens: number
  completionTokens: number
}

export interface StatsSummary {
  /** Rohe aggregierte Zeilen; die EUR-Kosten berechnet die Anzeige aus Preisen + Kurs (P7). */
  zeilen: StatZeile[]
  gesamtAnzahl: number
  gesamtAudioSekunden: number
  /** Summe der Eingabe-(Prompt-)Token über alle Zeilen. */
  gesamtPromptTokens: number
  /** Summe der Ausgabe-(Completion-)Token über alle Zeilen. */
  gesamtCompletionTokens: number
}

/** Persistenz-Port (wie SettingsFile): liest/schreibt den serialisierten Stats-String. */
export interface StatsFile {
  read(): Promise<string | null>
  write(content: string): Promise<void>
}

export interface StatsStore {
  aufzeichnen(nutzung: StatNutzung, jetztMs: number): Promise<void>
  zusammenfassung(): Promise<StatsSummary>
  loeschen(): Promise<void>
}

function datumAus(jetztMs: number): string {
  // YYYY-MM-DD in LOKALER Zeit (v0.5.0-Fix): vorher UTC via toISOString(), wodurch Läufe zwischen
  // 0 und 2 Uhr deutscher Zeit (UTC+1/+2) im UTC-Vortag landeten. Jahr/Monat/Tag werden bewusst aus
  // den lokalen Date-Komponenten gebaut (nicht aus dem ISO-String), damit der Tageswechsel der
  // tatsächlichen Nutzer-Zeitzone folgt.
  //
  // BEWUSST KEINE rückwirkende Migration: Bestandseinträge behalten ihren (UTC-)Schlüssel aus
  // Versionen vor diesem Fix — historische Tage können dadurch um ±1 Tag verschoben sein. Ab v0.5.0
  // stimmen neue Einträge lokal. Alt- und Neu-Schlüssel liegen im selben Format (YYYY-MM-DD) und
  // bleiben daher lexikalisch sortier- und aggregierbar (siehe Test „gemischte Alt-/Neu-Schlüssel").
  const d = new Date(jetztMs)
  const jahr = String(d.getFullYear()).padStart(4, '0')
  const monat = String(d.getMonth() + 1).padStart(2, '0')
  const tag = String(d.getDate()).padStart(2, '0')
  return `${jahr}-${monat}-${tag}`
}

function schluessel(z: Pick<StatZeile, 'datum' | 'workflowId' | 'asrModell' | 'chatModell'>): string {
  return [z.datum, z.workflowId, z.asrModell, z.chatModell].join('|')
}

export function createStatsStore({ file }: { file: StatsFile }): StatsStore {
  async function ladeAlle(): Promise<StatZeile[]> {
    const raw = await file.read()
    if (raw === null) return []
    try {
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? (parsed as StatZeile[]) : []
    } catch {
      return []
    }
  }

  return {
    async aufzeichnen(nutzung, jetztMs) {
      const zeilen = await ladeAlle()
      const datum = datumAus(jetztMs)
      const chatModell = nutzung.chat?.model ?? ''
      const idx = zeilen.findIndex(
        (z) => schluessel(z) === schluessel({ datum, workflowId: nutzung.workflowId, asrModell: nutzung.asrModell, chatModell })
      )
      const bestehend = idx >= 0 ? zeilen[idx] : undefined
      const ziel: StatZeile =
        bestehend ?? {
              datum,
              workflowId: nutzung.workflowId,
              anzahl: 0,
              audioSekunden: 0,
              asrModell: nutzung.asrModell,
              chatModell,
              promptTokens: 0,
              completionTokens: 0
            }
      ziel.anzahl += 1
      ziel.audioSekunden += nutzung.audioSekunden
      ziel.promptTokens += nutzung.chat?.promptTokens ?? 0
      ziel.completionTokens += nutzung.chat?.completionTokens ?? 0
      if (idx < 0) zeilen.push(ziel)
      await file.write(JSON.stringify(zeilen))
    },
    async zusammenfassung() {
      const zeilen = await ladeAlle()
      let gesamtAnzahl = 0
      let gesamtAudioSekunden = 0
      let gesamtPromptTokens = 0
      let gesamtCompletionTokens = 0
      for (const z of zeilen) {
        gesamtAnzahl += z.anzahl
        gesamtAudioSekunden += z.audioSekunden
        gesamtPromptTokens += z.promptTokens
        gesamtCompletionTokens += z.completionTokens
      }
      return { zeilen, gesamtAnzahl, gesamtAudioSekunden, gesamtPromptTokens, gesamtCompletionTokens }
    },
    async loeschen() {
      await file.write(JSON.stringify([]))
    }
  }
}
