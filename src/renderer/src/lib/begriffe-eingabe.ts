// Terms-UI (W2-S6): reine Commit-Logik für den Chips-Editor. Trennt „wann wird aus Freitext ein
// Begriff" von der React-Komponente (BegriffeFeld.tsx) — so bleibt die Regel ohne DOM/React testbar.
//
// Zwei Auslöser committen unterschiedlich viel:
//  - Komma/Blur (Teil-Commit): alles VOR dem letzten Komma gilt als abgeschlossen, das Fragment NACH
//    dem letzten Komma bleibt Freitext in der Eingabezeile (der Nutzer tippt eventuell weiter).
//  - Enter (Voll-Commit): auch das letzte Fragment ohne abschließendes Komma gilt als fertig.
//
// normalisiereBegriffe() aus @shared/begriffe übernimmt Trim/Leerstring-Filter/case-insensitives
// Dedupe (Erstschreibweise gewinnt) — hier nicht duplizieren.

import { normalisiereBegriffe } from '@shared/begriffe'

export interface CommitErgebnis {
  /** Neue, normalisierte Begriffsliste (bestehend + committete Fragmente). */
  begriffe: string[]
  /** Was in der Eingabezeile stehen bleibt (leer bei Voll-Commit). */
  restEingabe: string
}

/**
 * Teil-Commit (Komma/Blur): alle vollständigen Fragmente vor dem letzten Komma werden committet,
 * das letzte Fragment (ohne folgendes Komma) bleibt als Freitext in der Eingabezeile stehen.
 * Enthält `eingabeText` kein Komma, wird nichts committet — der ganze Text bleibt restEingabe.
 */
export function commitEingabe(bestehend: string[], eingabeText: string): CommitErgebnis {
  const letzteKommaPos = eingabeText.lastIndexOf(',')
  if (letzteKommaPos === -1) {
    return { begriffe: normalisiereBegriffe(bestehend), restEingabe: eingabeText }
  }
  const committeterTeil = eingabeText.slice(0, letzteKommaPos)
  const rest = eingabeText.slice(letzteKommaPos + 1)
  const fragmente = committeterTeil.split(',')
  return {
    begriffe: normalisiereBegriffe([...bestehend, ...fragmente]),
    restEingabe: rest
  }
}

/**
 * Voll-Commit (Enter): der GESAMTE Eingabetext wird an Kommas gesplittet und committet — auch das
 * letzte Fragment ohne abschließendes Komma. Eingabezeile ist danach immer leer.
 */
export function commitAlles(bestehend: string[], eingabeText: string): CommitErgebnis {
  const fragmente = eingabeText.split(',')
  return {
    begriffe: normalisiereBegriffe([...bestehend, ...fragmente]),
    restEingabe: ''
  }
}
