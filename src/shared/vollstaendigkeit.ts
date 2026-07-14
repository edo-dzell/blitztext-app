// Vollständigkeits-Detektor (v0.7.1 Stufe 3, 5. Vorfallsklasse „Weglassen"): rein/deterministisch,
// KEIN Modell-Aufruf. Geteilt zwischen dem Laufzeit-Pfad (Runner) und potenziellen Eval-Erweiterungen —
// derselbe Aufbau wie der Treue-Klassifikator (treue-klassifikator.ts), der die 3. Vorfallsklasse
// („Beantworten") laufzeitseitig abfängt.
//
// VORGESCHICHTE: v0.7.1 führte gegen den realen 14.7.2026-Vorfall (improve verschluckte den ersten
// Teilsatz eines Diktats, weil er meta-artig klang) zunächst NUR eine Prompt-Härtung ein
// (Vollständigkeits-Invariante + kontrastives Beispiel in IMPROVE_BASE, dazu ein Rezenz-Zusatz in
// TRANSKRIPT_NACHSATZ) und verzichtete bewusst auf einen Laufzeit-Detektor (docs/umschreib-treue.md,
// „Bewusst NICHT getan"). Diese Entscheidung ist EMPIRISCH WIDERLEGT: 4 identische Diktate desselben
// Vorfallssatzes mit Blitztext+ (gpt-4o-mini) lieferten nur 1/4 vollständige Endtexte — die
// Prompt-Schicht allein reicht nicht. Wie bei der 3. Vorfallsklasse (v0.4.5) gilt daher jetzt das
// Drei-Schichten-Muster: Prompt-Rezenz + deterministischer Detektor + Eval.
//
// Bewusst KONSERVATIV (Präzision vor Recall, wie treue-klassifikator): eine Wort-Abdeckungs-Heuristik
// kann echtes Sprachverständnis nicht ersetzen (ob eine bestimmte AUSSAGE fehlt, nicht nur Zeichen) —
// das leistet nur der LLM-Judge in der Eval. Dieser Detektor zielt daher NICHT auf hohen Recall,
// sondern auf den harten Kern: ein SATTER, mehrfacher Verlust von Inhaltswörtern, der bei normaler
// Politur (Füllwörter/Versprecher glätten, Ton ändern, Emojis einstreuen) praktisch nie vorkommt.

// Deutsche + englische Stopwörter/Füllwörter mit >=4 Zeichen — bewusst KLEIN gehalten (nur Wörter, die
// bei normaler Politur häufig UND inhaltlich belanglos sind: Konjunktionen, Hilfsverben, Modalverben,
// Possessiv-/Demonstrativpronomen, Verstärker/Füllwörter). Kein Anspruch auf Vollständigkeit einer
// echten Stopwortliste — jedes zusätzliche Wort hier SENKT die Empfindlichkeit (weniger „Inhalt"),
// also bewusst nur, was in der Praxis Fehlalarme verursacht hätte.
const STOPWOERTER = new Set([
  // Deutsch: Konjunktionen/Adverbien ohne Eigeninhalt
  'aber',
  'dass',
  'also',
  'wenn',
  'dann',
  'noch',
  'schon',
  'jetzt',
  'mal',
  'eben',
  'halt',
  'sehr',
  'zwar',
  'doch',
  'sondern',
  'damit',
  'sowie',
  'weil',
  'obwohl',
  'davon',
  'daran',
  'darauf',
  'darüber',
  'worüber',
  'wobei',
  'wodurch',
  'wirklich',
  'einfach',
  'ziemlich',
  'irgendwie',
  'eigentlich',
  'gerade',
  'immer',
  'wieder',
  // Deutsch: Demonstrativ-/Possessivpronomen (tragen keinen eigenen Sachinhalt)
  'diese',
  'dieser',
  'dieses',
  'diesen',
  'einem',
  'einer',
  'eines',
  'einen',
  'mein',
  'meine',
  'meiner',
  'meinem',
  'meinen',
  'dein',
  'deine',
  'deiner',
  'deinem',
  'deinen',
  'ihre',
  'ihrer',
  'ihrem',
  'ihren',
  'unser',
  'unsere',
  // Deutsch: Hilfs-/Modalverb-Flexionen
  'haben',
  'hatte',
  'hatten',
  'werden',
  'wurde',
  'wurden',
  'worden',
  'könnte',
  'könnten',
  'würde',
  'würden',
  'sollte',
  'sollten',
  'müsste',
  'müssten',
  'kann',
  'kannst',
  'können',
  'wollte',
  'wollten',
  'wird',
  'sind',
  'war',
  'waren',
  'bin',
  'bist',
  'ist',
  'sein',
  // Englisch
  'that',
  'this',
  'these',
  'those',
  'have',
  'been',
  'were',
  'will',
  'would',
  'could',
  'should',
  'just',
  'very',
  'really',
  'then',
  'than',
  'also',
  'their',
  'there',
  'they',
  'about'
])

// Satzzeichen/Anführungszeichen, die beim Tokenisieren als Trenner behandelt werden (nicht Teil des
// Worts) — deckt deutsche UND englische Anführungszeichen-Varianten sowie Gedankenstriche ab.
const TRENNZEICHEN = /[„“”"'‚‘’.,!?;:()[\]{}\-–—…]/g

/** Zerlegt einen Text in Kleinbuchstaben-Tokens ohne Satzzeichen (reine Whitespace-Tokenisierung). */
function tokenisiere(text: string): string[] {
  return text
    .toLowerCase()
    .replace(TRENNZEICHEN, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 0)
}

/**
 * Inhaltswörter eines Texts: Tokens ab 4 Zeichen, die NICHT in der Stopwortliste stehen. Exportiert,
 * damit Tests/Eval dieselbe Zerlegung direkt prüfen können.
 */
export function inhaltswoerter(text: string): string[] {
  return tokenisiere(text).filter((w) => w.length >= 4 && !STOPWOERTER.has(w))
}

// Schwellwerte (bewusst konservativ, siehe Moduskommentar oben):
// - MIN_FEHLENDE_WOERTER: unter 3 fehlenden Inhaltswörtern kein Alarm — ein, zwei verlorene Wörter
//   passieren auch bei legitimer Politur (Synonymersetzung, Umformulierung) und wären ein Fehlalarm-Risiko.
// - MIN_FEHLQUOTE: die fehlenden Wörter müssen zusätzlich einen SUBSTANTIELLEN Anteil der Inhaltswörter
//   ausmachen (40%) — ein langes Diktat mit vielen Inhaltswörtern, von denen nur wenige (aber absolut
//   gesehen >=3) fehlen, ist eher normale Kürzung als ein weggelassener Aussagenblock.
// - MIN_WOERTER_ROHTEXT: unter 8 Wörtern im Rohtext ist die Wort-Statistik zu instabil (ein einzelnes
//   Wort kippt die Quote um zig Prozentpunkte) — kurze Diktate bleiben außen vor.
const MIN_FEHLENDE_WOERTER = 3
const MIN_FEHLQUOTE = 0.4
const MIN_WOERTER_ROHTEXT = 8

/**
 * Heuristik: Wirkt der Endtext unvollständig gegenüber dem Rohtext — hat er einen satten Block von
 * Inhaltswörtern verloren, der auf eine stillschweigend weggelassene Aussage hindeutet (5. Vorfalls-
 * klasse „Weglassen", v0.7.1)?
 *
 * Matching TOLERANT: ein Inhaltswort aus dem Rohtext gilt als „vorhanden", wenn es als Substring
 * (case-insensitiv) irgendwo im Endtext steckt — das fängt grob Flexionen ab (z. B. „erkannt" in
 * „unerkannt", oder ein Kompositum, das das Wort enthält). Das ist bewusst grob (kein Stemmer) und
 * senkt den Recall leicht (siehe Restrisiken unten), aber es hält die Fehlalarm-Rate niedrig: eine
 * exakte Wortformen-Prüfung würde bei jeder normalen Flexionsänderung (z. B. „gehen" → „ging") fälschlich
 * „fehlend" meldem.
 *
 * Feuert NUR, wenn ALLE drei Bedingungen zutreffen (siehe Schwellwerte oben):
 *   1) mindestens 3 Inhaltswörter aus dem Rohtext fehlen im Endtext, UND
 *   2) diese fehlenden Wörter machen mindestens 40% aller Rohtext-Inhaltswörter aus, UND
 *   3) der Rohtext hat mindestens 8 Wörter (Wort-Statistik sonst zu instabil).
 */
export function wirktUnvollstaendig(rohtext: string, endtext: string): boolean {
  const rohtextWoerter = rohtext.trim().split(/\s+/).filter(Boolean)
  if (rohtextWoerter.length < MIN_WOERTER_ROHTEXT) return false

  const rohInhalt = inhaltswoerter(rohtext)
  if (rohInhalt.length === 0) return false

  const endLower = endtext.toLowerCase()
  const fehlend = rohInhalt.filter((w) => !endLower.includes(w))
  if (fehlend.length < MIN_FEHLENDE_WOERTER) return false

  const fehlquote = fehlend.length / rohInhalt.length
  return fehlquote >= MIN_FEHLQUOTE
}
