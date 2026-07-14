// Wort-Diff für den Verlauf (Feature #1): macht sichtbar, WAS das Umschreiben verändert hat.
// Reine Funktionen, kein React — testbar ohne DOM. Keine Kopier-/Wiedereinfüge-Buttons (expliziter
// Nutzer-Entscheid) — nur Anzeige.

/**
 * Zerlegt einen Text in Wort- und Whitespace-Tokens. `/\s+|\S+/g` alterniert zwischen
 * zusammenhängendem Whitespace (inkl. Zeilenumbrüchen) und zusammenhängenden Nicht-Whitespace-Läufen,
 * sodass `tokenisiere(text).join('')` den Originaltext exakt rekonstruiert (Invariante, s. Tests).
 */
export function tokenisiere(text: string): string[] {
  if (text === '') return []
  return text.match(/\s+|\S+/g) ?? []
}

export type DiffToken = { text: string; art: 'gleich' | 'entfernt' | 'eingefuegt' }

/** Kappung: über dieser Token-Zahl (rohtext-Tokens × endtext-Tokens würde die DP-Tabelle sonst zu
 * groß) geben wir auf und liefern `null` — Aufrufer fällt auf die heutige Block-Anzeige zurück. */
export const MAX_DIFF_TOKENS = 4000

/**
 * Klassisches LCS-basiertes Diff auf Token-Ebene (O(n·m) Zeit/Speicher). Für realistische Diktate
 * (≤ ~1000 Tokens/Seite) < 50ms. Nachrüstpfad falls je nötig: Myers-Diff (O((n+m)·d), d = Anzahl
 * Änderungen) — bislang nicht nötig, da MAX_DIFF_TOKENS harte Obergrenze setzt.
 *
 * Gibt `null` zurück, wenn rohtext oder endtext das Token-Limit übersteigen (Kappung).
 */
export function wortDiff(rohtext: string, endtext: string): DiffToken[] | null {
  const a = tokenisiere(rohtext)
  const b = tokenisiere(endtext)

  if (a.length > MAX_DIFF_TOKENS || b.length > MAX_DIFF_TOKENS) return null

  const n = a.length
  const m = b.length

  // dp[i][j] = Länge der LCS von a[i..] und b[j..]
  const dp: Uint32Array[] = new Array(n + 1)
  for (let i = 0; i <= n; i++) dp[i] = new Uint32Array(m + 1)

  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] =
        a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!)
    }
  }

  // Backtrack von (0,0) zu (n,m), baue Tokens in Reihenfolge.
  const roh: DiffToken[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      roh.push({ text: a[i]!, art: 'gleich' })
      i++
      j++
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      roh.push({ text: a[i]!, art: 'entfernt' })
      i++
    } else {
      roh.push({ text: b[j]!, art: 'eingefuegt' })
      j++
    }
  }
  while (i < n) {
    roh.push({ text: a[i]!, art: 'entfernt' })
    i++
  }
  while (j < m) {
    roh.push({ text: b[j]!, art: 'eingefuegt' })
    j++
  }

  // Benachbarte Tokens gleicher Art zusammenfassen (weniger DOM-Knoten).
  const zusammengefasst: DiffToken[] = []
  for (const tok of roh) {
    const letzter = zusammengefasst[zusammengefasst.length - 1]
    if (letzter && letzter.art === tok.art) {
      letzter.text += tok.text
    } else {
      zusammengefasst.push({ ...tok })
    }
  }

  return zusammengefasst
}
