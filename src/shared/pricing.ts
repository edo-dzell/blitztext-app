// Preistabelle für die Kosten-Schätzung (ADR-0009, V2 Strang D). Framework-unabhängige Domänendaten.
// Werte in USD, recherche-bestätigt (Stand 2026-06). Unbekannte Modelle → null (keine Schätzung,
// kein Absturz). Bewusst eine SCHÄTZUNG: Preise ändern sich; die UI weist darauf hin.
//
// v0.3 (P7): Die Default-Tabelle (PREISE) lässt sich nutzer-seitig per Overrides überschreiben
// (Settings.preisOverrides) und der USD→EUR-Kurs ist editierbar (Settings.usdEurKurs). Alle neuen
// Parameter sind OPTIONAL mit Default = Bestandsverhalten → byte-identische Altaufrufe.

export interface ModellPreis {
  /** ASR-Preis pro Audiominute (USD). */
  asrProMinuteUsd?: number
  /** Chat-Preis pro 1 Mio. Input-Token (USD). */
  inputPro1MUsd?: number
  /** Chat-Preis pro 1 Mio. Output-Token (USD). */
  outputPro1MUsd?: number
}

export type PreisTabelle = Record<string, ModellPreis>
/** Nutzer-Overrides je Modell-Id (feldweise; gesetzte Felder gewinnen über die Default-Tabelle). */
export type PreisOverrides = Record<string, ModellPreis>

export const PREISE: PreisTabelle = {
  // OpenAI (Transcribe-Preise als Minuten-Näherung — die ganze Tabelle ist eine Schätzung)
  'whisper-1': { asrProMinuteUsd: 0.006 },
  'gpt-4o-mini-transcribe': { asrProMinuteUsd: 0.003 },
  'gpt-4o-transcribe': { asrProMinuteUsd: 0.006 },
  'gpt-4o-mini': { inputPro1MUsd: 0.15, outputPro1MUsd: 0.6 },
  'gpt-4o': { inputPro1MUsd: 2.5, outputPro1MUsd: 10.0 },
  // Groq (Audio pro Stunde → pro Minute)
  'whisper-large-v3': { asrProMinuteUsd: 0.111 / 60 },
  'whisper-large-v3-turbo': { asrProMinuteUsd: 0.04 / 60 },
  'llama-3.3-70b-versatile': { inputPro1MUsd: 0.59, outputPro1MUsd: 0.79 },
  'llama-3.1-8b-instant': { inputPro1MUsd: 0.05, outputPro1MUsd: 0.08 },
  // Mistral — Stand 2026-07, vor Rechnungsrelevanz prüfen. Quelle: https://mistral.ai/pricing/api/
  // 'latest'-Alias löst aktuell auf: mistral-small-latest → Mistral Small 4, mistral-large-latest →
  // Mistral Large 3, voxtral-mini-latest → Voxtral Mini Transcribe 2 (Transcriptions-Endpoint).
  'mistral-small-latest': { inputPro1MUsd: 0.15, outputPro1MUsd: 0.6 },
  'mistral-large-latest': { inputPro1MUsd: 0.5, outputPro1MUsd: 1.5 },
  'voxtral-mini-latest': { asrProMinuteUsd: 0.003 }
}

// Feldweiser Merge: gesetzte Override-Felder gewinnen, fehlende behalten den Default (undefined-Felder
// werden NICHT übernommen, damit ein Teil-Override nicht andere Felder löscht).
function mergePreis(base: ModellPreis = {}, ov: ModellPreis = {}): ModellPreis {
  const r: ModellPreis = { ...base }
  if (ov.asrProMinuteUsd !== undefined) r.asrProMinuteUsd = ov.asrProMinuteUsd
  if (ov.inputPro1MUsd !== undefined) r.inputPro1MUsd = ov.inputPro1MUsd
  if (ov.outputPro1MUsd !== undefined) r.outputPro1MUsd = ov.outputPro1MUsd
  return r
}

/** Default-Tabelle (PREISE) mit Nutzer-Overrides feldweise gemischt → effektive Tabelle. */
export function aufgelosteTabelle(overrides: PreisOverrides = {}): PreisTabelle {
  const ids = new Set([...Object.keys(PREISE), ...Object.keys(overrides)])
  const out: PreisTabelle = {}
  for (const id of ids) out[id] = mergePreis(PREISE[id], overrides[id])
  return out
}

/** ASR-Kosten für eine Audiodauer; null bei unbekanntem/Token-basiertem Modell. */
export function asrKostenUsd(model: string, sekunden: number, tabelle: PreisTabelle = PREISE): number | null {
  const p = tabelle[model]
  if (!p || p.asrProMinuteUsd === undefined) return null
  return (sekunden / 60) * p.asrProMinuteUsd
}

/** Chat-Kosten für Token-Verbrauch; null bei unbekanntem Modell. */
export function chatKostenUsd(
  model: string,
  promptTokens: number,
  completionTokens: number,
  tabelle: PreisTabelle = PREISE
): number | null {
  const p = tabelle[model]
  if (!p || p.inputPro1MUsd === undefined || p.outputPro1MUsd === undefined) return null
  return (promptTokens / 1_000_000) * p.inputPro1MUsd + (completionTokens / 1_000_000) * p.outputPro1MUsd
}

/**
 * Geschätzte USD→EUR-Umrechnung. Startwert EUR_PRO_USD (Stand 2026-06, EZB-nah); in v0.3 ist der Kurs
 * nutzer-editierbar (Settings.usdEurKurs) und wird hier übergeben. Bewusst eine SCHÄTZUNG, kein
 * Live-Kurs (RESEARCH R6) — die UI weist mit „≈/geschätzt" darauf hin.
 */
export const EUR_PRO_USD = 0.86

export function eurAus(usd: number, kurs: number = EUR_PRO_USD): number {
  return usd * kurs
}

/** Eine aggregierte Statistik-/Verlauf-Zeile für die Kostenberechnung (text-frei). */
export interface KostenZeile {
  asrModell: string
  audioSekunden: number
  chatModell: string
  promptTokens: number
  completionTokens: number
}

/**
 * Geschätzte USD-Kosten einer aggregierten Zeile (ASR + ggf. Chat). null, wenn ein nötiger Teil
 * unbekannt ist (kein Falschwert). Reine Transkription (chatModell='') → nur ASR.
 */
export function zeileKostenUsd(z: KostenZeile, opts: { tabelle?: PreisTabelle } = {}): number | null {
  const tabelle = opts.tabelle ?? PREISE
  const asr = asrKostenUsd(z.asrModell, z.audioSekunden, tabelle)
  if (asr === null) return null
  if (z.chatModell === '') return asr
  const chat = chatKostenUsd(z.chatModell, z.promptTokens, z.completionTokens, tabelle)
  if (chat === null) return null
  return asr + chat
}

export interface LaufKosten {
  usd: number | null
  eur: number | null
}

/**
 * Geschätzte Kosten eines Laufs (Verlauf-Eintrag): ASR (pro Minute) + Chat (Token). Sind beide Teile
 * unbekannt → null/null (keine Anzeige statt Falschwert); sonst die Summe der bekannten Teile.
 * opts (v0.3): nutzer-Overrides + editierbarer Kurs; Default = Bestandsverhalten.
 */
export function laufKosten(
  input: {
    asrModell?: string
    dauerSekunden: number
    chatModell?: string
    usage?: { promptTokens: number; completionTokens: number }
  },
  opts: { overrides?: PreisOverrides; kurs?: number } = {}
): LaufKosten {
  const tabelle = aufgelosteTabelle(opts.overrides ?? {})
  const kurs = opts.kurs ?? EUR_PRO_USD
  const asr = input.asrModell ? asrKostenUsd(input.asrModell, input.dauerSekunden, tabelle) : null
  const chat =
    input.chatModell && input.usage
      ? chatKostenUsd(input.chatModell, input.usage.promptTokens, input.usage.completionTokens, tabelle)
      : null
  if (asr === null && chat === null) return { usd: null, eur: null }
  const usd = (asr ?? 0) + (chat ?? 0)
  return { usd, eur: eurAus(usd, kurs) }
}
