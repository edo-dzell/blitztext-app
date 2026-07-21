// Begrenzter Wiederhol-Mechanismus für transiente Anbieter-Fehler (CONTEXT.md Fehler-Art 'netzwerk').
// Rein/deterministisch testbar über den injizierten sleep-Port. Wiederholt NUR, wenn retrybar(fehler).
// Läuft im selben Watchdog-Fenster des Aufrufers (kein eigener Timer) — ein gefeuerter Watchdog beendet
// die Wiederholungen über retrybar (abgebrochen/Timeout → false). (Retry-After-Header-Auswertung: später.)

export interface RetryOptions {
  /** Gesamtzahl Versuche (1 = kein Retry). */
  versuche: number
  /** Basis-Backoff in ms; je Wiederholung verdoppelt (300 → 600 → …). */
  backoffMs: number
  /** Entscheidet, ob ein Fehler einen weiteren Versuch wert ist (transient/netzwerk). */
  retrybar: (fehler: unknown) => boolean
  /** Injizierbar für Tests; Default echte Verzögerung. */
  sleep?: (ms: number) => Promise<void>
  /**
   * Beobachtungs-Hook (v0.7.2, Ereignislog): feuert VOR dem Backoff-Sleep, GENAU DANN, wenn ein
   * Versuch scheiterte UND ein weiterer folgt (also nie beim Erfolg, nie beim finalen Wurf). Reine
   * Beobachtung — der Kontrollfluss bleibt unverändert. Wirft der Hook selbst, wird das geschluckt,
   * damit das Logging den Retry-Pfad niemals stört.
   */
  beiWiederholung?: (versuch: number, fehler: unknown) => void
}

export async function mitRetry<T>(fn: () => Promise<T>, opts: RetryOptions): Promise<T> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  for (let versuch = 1; ; versuch++) {
    try {
      return await fn()
    } catch (fehler) {
      if (versuch >= opts.versuche || !opts.retrybar(fehler)) throw fehler
      // Nur bei einem Fehlversuch, dem ein weiterer Versuch folgt (nicht beim Erfolg/finalen Wurf).
      // Darf-nie-werfen-Guard: ein Logging-Fehler darf den Retry nicht abbrechen.
      if (opts.beiWiederholung) {
        try {
          opts.beiWiederholung(versuch, fehler)
        } catch {
          /* still: Beobachtung darf den Retry-Pfad nie stören */
        }
      }
      await sleep(opts.backoffMs * 2 ** (versuch - 1))
    }
  }
}
