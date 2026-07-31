// A5 (v0.8.0): Anzeige-Sortierung der Statistik-Zeilen. Der Store rechnet korrekt, aber StatistikView
// rendert `summary.zeilen` in Einfüge-Reihenfolge — im Grenzmonat der 90-Tage-Kompaktierung stehen dort
// gleichzeitig eine 'YYYY-MM'-Monatszeile UND Tageszeilen desselben Monats, was ohne Sortierung wie
// doppelte/durcheinandergewürfelte Zeilen wirkt.

/** Minimal-Shape für die Sortierung — bewusst STRUKTURELL (kein Import aus @main/stats/stats-store),
 *  damit diese Datei framework-/store-unabhängig bleibt (gleiches Muster wie shared/pricing.ts). */
export interface SortierbareStatZeile {
  /** 'YYYY-MM-DD' (Tageszeile) ODER 'YYYY-MM' (monatskompaktiert) — beide Formen sind lexikalisch
   *  sortierstabil (ISO-Präfix), siehe stats-store.ts `komprimiereAeltereAls`. */
  datum: string
  workflowId: string
}

/**
 * Sortiert Statistik-Zeilen für die Anzeige: primär nach `datum` ABSTEIGEND (neueste zuerst, passend zur
 * Verlauf-Konvention der App), sekundär nach `workflowId` aufsteigend, damit die Reihenfolge bei
 * gleichem Datum deterministisch ist.
 *
 * Reine Funktion — mutiert die Eingabeliste NICHT (liefert eine neue, sortierte Kopie).
 */
export function sortiereStatistikZeilen<T extends SortierbareStatZeile>(zeilen: T[]): T[] {
  return [...zeilen].sort((a, b) => {
    if (a.datum !== b.datum) return a.datum > b.datum ? -1 : 1
    return a.workflowId.localeCompare(b.workflowId)
  })
}
