// Reine Tab-Zyklus-Logik für die Fokus-Falle in Bestaetigung.tsx (S21-Rest, Persona-Review-Befund:
// kein Autofokus/Tab-Trap im Bestätigungs-Dialog → Tabben verlässt den Dialog / Fokus geht verloren).
// Bewusst ohne DOM: der Dialog hat eine feste, kleine Zahl fokussierbarer Elemente (die zwei Buttons);
// diese Funktion berechnet nur den nächsten Index beim Tab/Shift+Tab-Zyklus. Das eigentliche
// `.focus()`-Aufrufen bleibt im Component (jsdom-frei nicht sinnvoll node-testbar) — siehe Kommentar
// dort; Windows-HITL bestätigt das sichtbare Verhalten.

/**
 * Nächster Fokus-Index beim zyklischen Tabben innerhalb der Falle.
 * @param anzahl Anzahl fokussierbarer Elemente in der Falle (> 0 erwartet).
 * @param aktuell Index des aktuell fokussierten Elements, oder -1 falls unbekannt/keins.
 * @param rueckwaerts true bei Shift+Tab.
 */
export function naechstesFokusZiel(anzahl: number, aktuell: number, rueckwaerts: boolean): number {
  if (anzahl <= 0) return -1
  if (rueckwaerts) return aktuell <= 0 ? anzahl - 1 : aktuell - 1
  return aktuell >= anzahl - 1 ? 0 : aktuell + 1
}
