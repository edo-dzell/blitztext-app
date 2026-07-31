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
  // YYYY-MM-DD (Tagesauflösung, jünger als 90 Tage) ODER YYYY-MM (monatskompaktiert, älter; B1).
  datum: string
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
  zusammenfassung(jetztMs?: number): Promise<StatsSummary>
  loeschen(): Promise<void>
}

/** Anzahl Tage, ab der Tageszeilen in `zusammenfassung()` auf Monatsebene kompaktiert werden (B1). */
const KOMPAKTIERUNGS_SCHWELLE_TAGE = 90
const TAG_MS = 24 * 60 * 60 * 1000

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

/** 'YYYY-MM-DD' → 'YYYY-MM'; bereits kompaktierte 'YYYY-MM'-Werte (Länge 7) bleiben unverändert. */
function monatVon(datum: string): string {
  return datum.slice(0, 7)
}

/**
 * Aggregiert Zeilen mit `datum < grenzeDatum` (lexikalischer Vergleich, ISO-Präfixe sind sortierstabil)
 * auf Monatsebene (Schlüssel: monat|workflowId|asrModell|chatModell). Zeilen ab der Grenze bleiben
 * unverändert (Tagesauflösung). Bereits monatskompaktierte Zeilen (datum-Länge 7, 'YYYY-MM') werden
 * anhand desselben Präfix-Vergleichs erneut erfasst und mit gleichlautenden Schlüsseln idempotent
 * zusammengeführt (mehrfaches Kompaktieren verändert die Summen nicht mehr).
 *
 * Reine Funktion, keine Seiteneffekte — der Aufrufer entscheidet, ob/wann geschrieben wird.
 */
export function komprimiereAeltereAls(zeilen: StatZeile[], grenzeDatum: string): StatZeile[] {
  const ergebnis: StatZeile[] = []
  const indexNachSchluessel = new Map<string, number>()

  for (const z of zeilen) {
    if (z.datum >= grenzeDatum) {
      // Jung genug: unverändert übernehmen (Tagesauflösung bleibt erhalten).
      ergebnis.push({ ...z })
      continue
    }
    const monat = monatVon(z.datum)
    const k = schluessel({ datum: monat, workflowId: z.workflowId, asrModell: z.asrModell, chatModell: z.chatModell })
    const bestehenderIdx = indexNachSchluessel.get(k)
    if (bestehenderIdx === undefined) {
      indexNachSchluessel.set(k, ergebnis.length)
      ergebnis.push({
        datum: monat,
        workflowId: z.workflowId,
        anzahl: z.anzahl,
        audioSekunden: z.audioSekunden,
        asrModell: z.asrModell,
        chatModell: z.chatModell,
        promptTokens: z.promptTokens,
        completionTokens: z.completionTokens
      })
    } else {
      const ziel = ergebnis[bestehenderIdx]!
      ziel.anzahl += z.anzahl
      ziel.audioSekunden += z.audioSekunden
      ziel.promptTokens += z.promptTokens
      ziel.completionTokens += z.completionTokens
    }
  }

  return ergebnis
}

export function createStatsStore({
  file,
  getKompaktierungTage
}: {
  file: StatsFile
  /**
   * v0.8.0 (statistikKompaktierungTage): Live-Getter — nimmt Vorrang vor KOMPAKTIERUNGS_SCHWELLE_TAGE,
   * falls gesetzt. Composition-root reicht ihn als Closure über die lebende Settings-Kopie durch
   * (Muster wie in history-store.ts `getMaxEintraege`). `zusammenfassung()` liest ihn bereits PRO
   * AUFRUF (kein Store-Neubau nötig) — die Live-Übernahme ergibt sich daraus von selbst.
   */
  getKompaktierungTage?: () => number
}): StatsStore {
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
    async zusammenfassung(jetztMs = Date.now()) {
      const geladen = await ladeAlle()
      const schwelleTage = getKompaktierungTage ? getKompaktierungTage() : KOMPAKTIERUNGS_SCHWELLE_TAGE
      const grenzeDatum = datumAus(jetztMs - schwelleTage * TAG_MS)
      const kompaktiert = komprimiereAeltereAls(geladen, grenzeDatum)
      const hatSichVeraendert = JSON.stringify(kompaktiert) !== JSON.stringify(geladen)
      if (hatSichVeraendert) {
        await file.write(JSON.stringify(kompaktiert))
      }
      const zeilen = kompaktiert
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
