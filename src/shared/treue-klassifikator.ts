// Treue-Klassifikator (v0.4.5): rein/deterministisch, KEIN Modell-Aufruf. Geteilt zwischen dem
// Laufzeit-Detektor (src/main/rewrite/treue-detektor.ts) und dem Eval-Korpus (eval/) — „identischer
// Code", damit die Eval genau das prüft, was ausgeliefert wird (ADR-0018).
//
// Zweck: die wiederkehrende Fehlerklasse erkennen, bei der ein Umschreib-Workflow das Diktat
// BEANTWORTET, statt es zu BEARBEITEN — konkret den Personen-Flip „du …" → „Ich …" (real beobachtet
// 14.6.2026: Roh „… wie du … verarbeiten könntest …" → End „Ich hätte … so verarbeitet, dass ich …").
//
// Bewusst eng und auf PRÄZISION getunt (Experten-Konsens): lieber einen seltenen echten Fehler
// durchlassen (Rückfall = Status quo, evtl. falsches Einfügen) als eine korrekte Politur fälschlich
// abstufen (häufiger, leiser Vertrauensverlust). Marker sind ASCII → \b-Wortgrenzen greifen sauber.
//
// v0.5.0 (Slice W2-C): zwei Präzisions-erhaltende Erweiterungen gegen bisher unerkannte Flips:
//   1) SPRACHWECHSEL — antwortet das Modell englisch, zählten die deutschen Regexe 0 ⇒ Flip unerkannt.
//      Deshalb parallele englische Pronomen-Profile; der Flip ist sprachübergreifend (roh deutsch-du +
//      end englisch-ich zählt genauso wie roh/end in derselben Sprache).
//   2) ANTWORT-PRÄFIX — ein eindeutiges Assistenz-Präfix am Endtext-ANFANG als ZUSÄTZLICHES Signal,
//      aber nur wenn dasselbe Präfix NICHT schon im Rohtext steht (sonst legitimer Diktat-Inhalt).

export interface PersonProfil {
  /** Treffer für die 1. Person (ich/mir/mich/wir/uns + Possessiva). */
  erste: number
  /** Treffer für die 2. Person — informell (du/…) UND formell (Sie/Ihnen/…). */
  zweite: number
}

// --- Deutsch ---------------------------------------------------------------------------------------
// Exakte Formen (keine \w*-Wildcards): „mein" matcht nur „mein", nie „Meinung".
const ERSTE =
  /\b(ich|mir|mich|wir|uns|mein|meine|meinen|meinem|meiner|meines|unser|unsere|unseren|unserem|unserer|unseres)\b/gi
// Informelle 2. Person (du-Formen sind eindeutig). „ihr/euch" bewusst AUSGELASSEN (mehrdeutig mit der
// 3. Person Dativ/Possessiv → würde die Präzision senken).
const ZWEITE_DU = /\b(du|dir|dich|dein|deine|deinen|deinem|deiner|deines)\b/gi
// Formelle 2. Person: GROSS geschrieben (case-sensitive), um die 3.-Person-Form „sie/ihr" auszuschließen.
const ZWEITE_SIE = /\b(Sie|Ihnen|Ihr|Ihre|Ihren|Ihrem|Ihrer|Ihres)\b/g

// --- Englisch --------------------------------------------------------------------------------------
// „I" ist eindeutig groß; „me/my/mine/myself" sind eindeutige 1.-Person-Formen. Kein „we/us/our",
// weil das im Umschreib-Kontext selten und mit deutschem „wir/uns" durch den deutschen Profil-Zweig
// bereits abgedeckt ist — die relevante Flip-Achse ist you→I.
const ERSTE_EN = /(\bI\b|\b(me|my|mine|myself)\b)/g
// 2. Person eindeutig: you/your/yours/yourself. „you" ist nicht mehrdeutig (anders als dt. „ihr").
const ZWEITE_EN = /\b(you|your|yours|yourself)\b/gi

function zaehle(text: string, regex: RegExp): number {
  return (text.match(regex) ?? []).length
}

export function personProfil(text: string): PersonProfil {
  return {
    erste: zaehle(text, ERSTE),
    zweite: zaehle(text, ZWEITE_DU) + zaehle(text, ZWEITE_SIE)
  }
}

export function personProfilEn(text: string): PersonProfil {
  return {
    erste: zaehle(text, ERSTE_EN),
    zweite: zaehle(text, ZWEITE_EN)
  }
}

/** Sprachübergreifendes Profil: deutsche + englische Marker addiert (die Flip-Achse ist sprachneutral). */
function gesamtProfil(text: string): PersonProfil {
  const de = personProfil(text)
  const en = personProfilEn(text)
  return { erste: de.erste + en.erste, zweite: de.zweite + en.zweite }
}

// Eindeutige Assistenz-/Antwort-Eröffnungen. BEWUSST ENG: nur konversationelle Präfixe, die ein
// Korrekturwerkzeug NIE produzieren würde. KEIN generisches „Hier ist …" (das räumt der Marken-Putzer
// ab) — das würde legitime Diktate treffen. Die du/Ihre-Varianten decken beide Anreden ab.
const ANTWORT_PRAEFIXE: readonly RegExp[] = [
  /^\s*gerne\b/i, // „Gerne!" / „Gerne helfe ich …"
  /^\s*als (ki|künstliche intelligenz)\b/i,
  /^\s*ich verstehe (deine|ihre)\b/i,
  /^\s*vielen dank für (deine|ihre)\b/i,
  /^\s*sure\b/i,
  /^\s*of course\b/i,
  /^\s*as an ai\b/i,
  /^\s*certainly\b/i
]

/**
 * ZUSATZ-Signal: beginnt der Endtext mit einem eindeutigen Assistenz-Präfix, das NICHT bereits im
 * Rohtext vorkommt? Die Rohtext-Bedingung ist essenziell für die Präzision: sagt der Sprecher selbst
 * „Gerne mach ich das …", ist das legitimer Diktat-Inhalt und darf NIE als Antwort gewertet werden.
 */
function beginntMitAntwortPraefix(rohtext: string, endtext: string): boolean {
  const treffer = ANTWORT_PRAEFIXE.find((re) => re.test(endtext))
  if (!treffer) return false
  // Präfix darf NICHT schon im Rohtext stehen (dann ist es Diktat-Inhalt, keine Modell-Antwort).
  return !treffer.test(rohtext.trimStart())
}

/**
 * Heuristik: Wirkt der Endtext, als hätte das Modell das Diktat beantwortet/umgedeutet statt es zu
 * bearbeiten? Zwei unabhängige Signale (ODER-verknüpft):
 *
 *   A) PERSONEN-FLIP (sprachübergreifend):
 *      - der Rohtext spricht ein Gegenüber an (2. Person ≥ 1 und mindestens so präsent wie die 1. Person), UND
 *      - der Endtext hat die Anrede VOLLSTÄNDIG verloren (2. Person = 0) und spricht in der 1. Person.
 *      Deutsch- und Englisch-Marker werden addiert → roh deutsch-„du" + end englisch-„I" zählt als Flip.
 *
 *   B) ANTWORT-PRÄFIX: der Endtext beginnt mit einem eindeutigen Assistenz-Präfix, das nicht im Rohtext steht.
 *
 * Die Bedingung `roh.zweite >= roh.erste` schützt vor Fehlalarmen bei 1.-Person-dominanten Diktaten
 * (eine Ich-Erzählung mit einem Streu-„dir" kippt nicht). Out-of-Scope (bewusst): du→Sie-Wechsel bei
 * gleichbleibender 2. Person (das fängt die Prompt-Härtung ab, nicht dieser Detektor).
 */
export function wirktBeantwortet(rohtext: string, endtext: string): boolean {
  const roh = gesamtProfil(rohtext)
  const end = gesamtProfil(endtext)
  const personenFlip = roh.zweite >= 1 && roh.zweite >= roh.erste && end.zweite === 0 && end.erste >= 1
  return personenFlip || beginntMitAntwortPraefix(rohtext, endtext)
}
