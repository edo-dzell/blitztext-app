// Terms-Kern (customTerms): EINE Quelle für Normalisierung, Budget-Guard und Prompt-Text-Erzeugung.
// Bisher hing dieselbe Logik lose in store.ts/cloud-provider.ts/prompt-builder.ts/runner.ts — Bugs
// (Leerstring-Artefakte „Acme, , GmbH" in ASR- und Rewrite-Prompt, kein Budget-Guard, kein Dedupe)
// entstanden genau daraus. Reine Funktionen, ohne Seiteneffekte → einfach/deterministisch testbar.

/**
 * Trimmt jeden Begriff, verwirft leere/Whitespace-only-Einträge und entfernt Duplikate
 * CASE-INSENSITIVE — die ERSTE Schreibweise gewinnt (Insertion-Order bleibt stabil).
 *
 * Begründung „Erstschreibweise gewinnt": Der Rewrite-Prompt sagt dem Modell „schreibe X exakt so" —
 * zwei Schreibweisen desselben Begriffs (z. B. „GmbH" und „gmbh") wären eine widersprüchliche
 * Anweisung. Ein einziger kanonischer Eintrag pro Begriff vermeidet das.
 */
export function normalisiereBegriffe(roh: string[]): string[] {
  const ergebnis: string[] = []
  const gesehen = new Set<string>()
  for (const eintrag of roh) {
    const getrimmt = eintrag.trim()
    if (getrimmt === '') continue
    const schluessel = getrimmt.toLowerCase()
    if (gesehen.has(schluessel)) continue
    gesehen.add(schluessel)
    ergebnis.push(getrimmt)
  }
  return ergebnis
}

// Der Whisper-`prompt`-Parameter hat faktisch ein ~224-Token-Limit; die API schneidet serverseitig
// still ab (kein Fehler, kein Hinweis). 900 Zeichen ist eine konservative Faustregel (grob
// überschlagen: 224 Token × ~4 Zeichen/Token abzüglich Sicherheitsabstand), an dieser EINEN Stelle
// kalibrierbar, statt verstreut in mehreren Dateien.
export const ASR_PROMPT_BUDGET_ZEICHEN = 900

/**
 * Behält so viele Begriffe, wie in das Zeichen-Budget passen (gemessen an der Länge des späteren
 * `join(', ')`-Strings). Priorität: NEUESTE ZUERST — das Ende der Liste gilt als „zuletzt
 * hinzugefügt" (z. B. gerade aus einem künftigen Korrektur-Loop nachgetragen), älteste Begriffe
 * fallen zuerst raus. Das Ergebnis wird wieder in ORIGINAL-Reihenfolge zurückgegeben.
 *
 * Deterministisch und idempotent: ein bereits passendes Ergebnis erneut hindurchgereicht liefert
 * sich selbst zurück.
 */
export function begriffeFuerAsrPrompt(
  begriffe: string[],
  maxZeichen: number = ASR_PROMPT_BUDGET_ZEICHEN
): string[] {
  // Erst normalisieren (trim/leer raus/Dedupe) — sonst würde das Budget von Leerstrings/Duplikaten
  // aufgefressen und das join(', ')-Ergebnis enthielte weiterhin „, ,"-Artefakte.
  const sauber = normalisiereBegriffe(begriffe)
  const behalten = new Set<number>()
  let laenge = 0
  // Von hinten (neueste) nach vorn (älteste) auffüllen, bis das Budget erschöpft ist.
  for (let i = sauber.length - 1; i >= 0; i--) {
    const begriff = sauber[i]
    if (begriff === undefined) continue
    // join(', ')-Länge: Begriff selbst + Trenner ", " für jeden bereits behaltenen Begriff.
    const zusatz = behalten.size === 0 ? begriff.length : begriff.length + 2
    if (laenge + zusatz > maxZeichen) continue
    laenge += zusatz
    behalten.add(i)
  }
  return sauber.filter((_, i) => behalten.has(i))
}

/**
 * Exakter Wortlaut für den ASR-`prompt`-Parameter (bisher cloud-provider.ts:101-102).
 * `null` bei leerer Liste — der Aufrufer lässt das Feld dann ganz weg.
 */
export function asrPromptText(begriffe: string[]): string | null {
  if (begriffe.length === 0) return null
  return `Eigennamen und Begriffe: ${begriffe.join(', ')}`
}

// B1: Mistrals `context_bias`-Feld (Voxtral-Transkription) hat KEIN Zeichen-Budget wie Whispers
// `prompt` — die Doku nennt stattdessen eine Obergrenze an EINTRÄGEN ("up to 100 words or phrases",
// https://docs.mistral.ai/studio-api/audio/speech_to_text/offline_transcription, Stand 2026-07-31).
// Whispers ASR_PROMPT_BUDGET_ZEICHEN ist auf dessen ~224-Token-Grenze kalibriert und gehört NICHT
// zum context_bias-Weg — eigene Konstante, damit die beiden Grenzen nie querbeeinflusst werden.
export const ASR_CONTEXT_BIAS_MAX_EINTRAEGE = 100

/**
 * Kappt die normalisierte Begriffsliste auf die von Mistral dokumentierte Obergrenze für
 * `context_bias` (Anzahl statt Zeichen, siehe ASR_CONTEXT_BIAS_MAX_EINTRAEGE). Gleiche Priorität
 * wie begriffeFuerAsrPrompt: bei Überschreitung bleiben die NEUESTEN (Ende der Liste) erhalten,
 * älteste fallen zuerst raus; das Ergebnis behält die Original-Reihenfolge.
 */
export function begriffeFuerContextBias(
  begriffe: string[],
  maxEintraege: number = ASR_CONTEXT_BIAS_MAX_EINTRAEGE
): string[] {
  const sauber = normalisiereBegriffe(begriffe)
  if (sauber.length <= maxEintraege) return sauber
  // slice() erhält die Original-Reihenfolge automatisch (kein Sortieren nötig) — die letzten
  // maxEintraege Einträge SIND bereits die neuesten in ihrer ursprünglichen Reihenfolge.
  return sauber.slice(sauber.length - maxEintraege)
}

/**
 * Exakter Wortlaut für den Rewrite-Prompt-Anhang (bisher prompt-builder.ts:287-291 / 344-348).
 * `null` bei leerer Liste — der Aufrufer hängt dann nichts an.
 */
export function begriffeFuerRewritePrompt(begriffe: string[]): string | null {
  const sauber = normalisiereBegriffe(begriffe)
  if (sauber.length === 0) return null
  return `Wichtig: Diese Eigennamen und Fachbegriffe müssen exakt so geschrieben werden: ${sauber.join(', ')}`
}
