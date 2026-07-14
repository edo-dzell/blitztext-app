// Preistabelle für die Kosten-Schätzung (ADR-0009, V2 Strang D). Framework-unabhängige Domänendaten.
// Werte in USD, recherche-bestätigt (Stand 2026-06). Unbekannte Modelle → null (keine Schätzung,
// kein Absturz). Bewusst eine SCHÄTZUNG: Preise ändern sich; die UI weist darauf hin.
//
// v0.3 (P7): Die Default-Tabelle (PREISE) lässt sich nutzer-seitig per Overrides überschreiben
// (Settings.preisOverrides) und der USD→EUR-Kurs ist editierbar (Settings.usdEurKurs). Alle neuen
// Parameter sind OPTIONAL mit Default = Bestandsverhalten → byte-identische Altaufrufe.
//
// D3 (Strang-Konsolidierung): PREISE wird nicht mehr getrennt gepflegt, sondern aus der Modell-Registry
// (providers.ts, Feld `ModellInfo.preis`) ABGELEITET (`preiseAusProvidernAbleiten`) → Drift-Schutz:
// „welche Modelle gibt es" und „was kosten sie" leben an einer Stelle. ModellPreis zieht mit nach
// providers.ts um; hier nur re-exportiert, damit bestehende Importe (`@shared/pricing`) unverändert
// bleiben. Abhängigkeitsrichtung: pricing → providers (providers importiert nichts aus pricing).

import { PROVIDER, type ModellPreis } from './providers'

export type { ModellPreis } from './providers'

export type PreisTabelle = Record<string, ModellPreis>
/** Nutzer-Overrides je Modell-Id (feldweise; gesetzte Felder gewinnen über die Default-Tabelle). */
export type PreisOverrides = Record<string, ModellPreis>

/**
 * Leitet die Default-Preistabelle aus der Provider-Registry ab: iteriert alle ASR-/Chat-Modelle aller
 * Anbieter (inkl. 'custom', dessen Kataloge aber leer sind) und sammelt die `preis`-Felder je
 * Modell-Id. Modelle ohne `preis` tauchen NICHT in der Tabelle auf (kein Falschwert `{}`).
 */
export function preiseAusProvidernAbleiten(): PreisTabelle {
  const out: PreisTabelle = {}
  for (const provider of PROVIDER) {
    for (const modell of [...provider.asrModelle, ...provider.chatModelle]) {
      if (modell.preis) out[modell.id] = modell.preis
    }
  }
  return out
}

export const PREISE: PreisTabelle = preiseAusProvidernAbleiten()

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
