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

/**
 * Exakter Wortlaut für den Rewrite-Prompt-Anhang (bisher prompt-builder.ts:287-291 / 344-348).
 * `null` bei leerer Liste — der Aufrufer hängt dann nichts an.
 */
export function begriffeFuerRewritePrompt(begriffe: string[]): string | null {
  const sauber = normalisiereBegriffe(begriffe)
  if (sauber.length === 0) return null
  return `Wichtig: Diese Eigennamen und Fachbegriffe müssen exakt so geschrieben werden: ${sauber.join(', ')}`
}
