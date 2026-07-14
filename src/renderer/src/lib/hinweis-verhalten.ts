import type { HinweisTyp } from '@/components/Hinweis'

// Verzweigungslogik der Toast-Typen (erfolg/info/fehler) ausgelagert aus Hinweis.tsx, damit sie
// isoliert (ohne React) testbar ist. Regel: alles blendet automatisch aus außer Fehler; nur Fehler
// gilt als „dringend" (alert-Live-Region statt status, bleibt stehen bis manuell geschlossen).

/** Blendet der Hinweis-Typ automatisch aus (true) oder bleibt er stehen, bis er manuell geschlossen wird? */
export function blendetAutomatischAus(typ: HinweisTyp): boolean {
  return typ !== 'fehler'
}

/** Ist der Hinweis-Typ „dringend" (alert-Live-Region, bestimmt vorgelesen)? Nur Fehler. */
export function istDringend(typ: HinweisTyp): boolean {
  return typ === 'fehler'
}
