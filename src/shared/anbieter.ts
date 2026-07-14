// Auflösungsnaht für den Workflow-Lauf (v0.2.3, ADR-0010). Framework-unabhängig + rein → der
// zentrale Ort, an dem „welcher Anbieter / welche Modelle für diesen Lauf" entschieden wird.
// Reihenfolge: Workflow-Override → Anbieter-/Global-Default; verwaiste Zuordnung → Standard-Anbieter.
// Der Byte-Identitäts-Snapshot über die vier Built-ins (siehe Test) wacht über Verhaltensgleichheit.

import { modelleFuerVorlage, PROVIDER } from '@shared/providers'

export interface AnbieterKonfig {
  id: string
  /** Welche Registry-Vorlage (openai/groq/mistral/custom). */
  vorlage: string
  label: string
  /** OpenAI-kompatible Base-URL OHNE Trailing-Slash. */
  baseUrl: string
  asrModell: string
  chatModell: string
  /** L1: lokaler/keyloser Anbieter (z. B. whisper.cpp/Speaches auf localhost) — kein API-Key nötig,
   *  kein Authorization-Header. Fehlt/false = Key wie üblich erforderlich. */
  keinKeyNoetig?: boolean
}

export interface LaufKontext {
  anbieter: readonly AnbieterKonfig[]
  standardAnbieterId: string
  language: string
}

/** Was ein Workflow zur Auflösung beiträgt (Teilmenge der WorkflowDefinition). */
export interface AufloesbarerWorkflow {
  anbieterId?: string
  model: string
  temperature: number
  /** Override Sprache (v0.2.4); '' / fehlt = erbt global. */
  language?: string
}

export interface AufgeloesterLauf {
  anbieter: AnbieterKonfig
  baseUrl: string
  asrModell: string
  chatModell: string
  temperature: number
  language: string
  /**
   * v0.4.5 (ADR-0018): true, wenn das gepinnte Workflow-Modell einem ANDEREN Anbieter gehörte und
   * deshalb still auf den Anbieter-Standard ersetzt wurde. Ehrlichkeit statt stillem Downgrade — der
   * Aufrufer kann nicht-blockierend warnen, statt den Nutzer im Glauben zu lassen, sein Modell liefe.
   */
  chatModellAbgewertet: boolean
}

export function findeAnbieter(
  liste: readonly AnbieterKonfig[],
  id: string
): AnbieterKonfig | undefined {
  return liste.find((a) => a.id === id)
}

/** Standard-Anbieter der Liste: der zur `id`, sonst der erste (Fallback für verwaiste/leere id). */
export function standardAnbieterAus(
  liste: readonly AnbieterKonfig[],
  id: string
): AnbieterKonfig {
  const gefunden = findeAnbieter(liste, id) ?? liste[0]
  if (!gefunden) throw new Error('standardAnbieterAus: leere Anbieter-Liste')
  return gefunden
}

/**
 * Löst einen Workflow-Lauf gegen die Anbieter-Liste auf. Built-ins pinnen `anbieterId` (OpenAI) und
 * `model` (Chat); das ASR-Modell und die Sprache werden geerbt. Verwaiste `anbieterId` → Standard.
 */
/**
 * Effektives Chat-Modell des Laufs. Leer → Anbieter-Standard (vererbt). Ist das gepinnte Modell ein
 * Modell, das einem ANDEREN bekannten Anbieter gehört (z. B. OpenAI-Modell gegen Mistral), ist es für
 * diesen Anbieter ungültig → Anbieter-Standard (verhindert den Absturz). Ein FREI/eigen eingegebenes
 * Modell (keiner Registry-Vorlage bekannt) bleibt respektiert.
 */
/**
 * Wie {@link aufgeloestesChatModell}, aber liefert ZUSÄTZLICH, ob ein gepinntes, dem Anbieter FREMDES
 * Modell ersetzt wurde (`abgewertet`). Quelle der Wahrheit; die String-Variante delegiert hierher.
 */
export function chatModellAufloesung(
  model: string,
  anbieter: AnbieterKonfig
): { modell: string; abgewertet: boolean } {
  if (!model) return { modell: anbieter.chatModell, abgewertet: false }
  if (modelleFuerVorlage(anbieter.vorlage).chat.some((m) => m.id === model)) {
    return { modell: model, abgewertet: false }
  }
  const gehoertAnderem = PROVIDER.some(
    (p) => p.id !== anbieter.vorlage && p.chatModelle.some((m) => m.id === model)
  )
  // Fremdes (einem anderen Anbieter bekanntes) Modell → Anbieter-Standard (kein Absturz), aber als
  // Abwertung markiert. Ein frei/eigen eingegebenes Modell bleibt respektiert (nicht abgewertet).
  return gehoertAnderem
    ? { modell: anbieter.chatModell, abgewertet: true }
    : { modell: model, abgewertet: false }
}

export function aufgeloestesChatModell(model: string, anbieter: AnbieterKonfig): string {
  return chatModellAufloesung(model, anbieter).modell
}

export function aufloeseWorkflowLauf(
  workflow: AufloesbarerWorkflow,
  ctx: LaufKontext
): AufgeloesterLauf {
  const anbieter =
    (workflow.anbieterId ? findeAnbieter(ctx.anbieter, workflow.anbieterId) : undefined) ??
    standardAnbieterAus(ctx.anbieter, ctx.standardAnbieterId)

  const chat = chatModellAufloesung(workflow.model, anbieter)
  return {
    anbieter,
    baseUrl: anbieter.baseUrl,
    // A6/D9: KEIN Pro-Workflow-ASR-Override mehr — die Transkription nutzt ohnehin das Anbieter-ASR-Modell;
    // so protokolliert der Verlauf ehrlich, was wirklich lief (ADR-0016).
    asrModell: anbieter.asrModell,
    chatModell: chat.modell,
    chatModellAbgewertet: chat.abgewertet,
    temperature: workflow.temperature,
    language: workflow.language || ctx.language
  }
}
