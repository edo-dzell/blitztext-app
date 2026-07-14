// R5 (Perf-Diagnose, opt-in): Leichtgewichtige Latenz-Zeitstempel keydown → Dispatch-Ende in
// einem Ringpuffer + periodisches p50/p95/max-Log. Referenz: `.scratch/v0.2.x/PERF-DIAGNOSE.md`
// (Hypothese „Main-Thread-Hook-Last"). Komplett eigenständiges, injizierbares Modul — reine,
// headless testbare Logik, KEINE Abhängigkeit von uiohook/Electron.
//
// Aktivierung ausschließlich über env `BLITZTEXT_PERF=1` (siehe uiohook-source.ts/index.ts) —
// hier im Modul selbst KEINE env-Abfrage, damit es pur und ohne Seiteneffekte bleibt.
// Null-Overhead im Aus-Zustand: `NOOP_PERF` ist ein Objekt mit no-op-Funktionen (kein Ringpuffer,
// kein Timer, keine Allokation außer dem einen Objekt-Literal beim Modul-Laden).

export interface PerfEintrag {
  tKeydownMs: number // performance.now()-Marker beim Hook-Empfang (erfasseStart)
  tDispatchEndeMs: number // performance.now() nach verarbeiteTaste-Rückkehr (erfasseEnde)
}

export interface PerfInstrumentierung {
  /** Marker beim Hook-Empfang. Rückgabewert MUSS unverändert an erfasseEnde() gereicht werden. */
  erfasseStart(): number
  /** Berechnet das Delta zum Marker und schreibt einen Eintrag in den Ringpuffer. */
  erfasseEnde(startMarker: number): void
  /** Für Tests/Introspektion — liefert eine schreibgeschützte Sicht auf den aktuellen Inhalt. */
  ringpuffer(): readonly PerfEintrag[]
  /** Stoppt den periodischen Log-Timer (Analogie zu stopUiohook) — sonst Leak/offener Prozess. */
  stoppe(): void
}

export interface PerfInstrumentierungDeps {
  /** Fassungsvermögen des Ringpuffers (älteste Einträge werden überschrieben). Default 500. */
  kapazitaet?: number
  /** Uhr-Funktion, injizierbar für Tests. Default `performance.now`. */
  jetzt?: () => number
  /** Intervall des periodischen Logs in ms. Default 30_000. */
  logIntervallMs?: number
  /** Log-Sink, injizierbar für Tests. Default `console.log`. */
  log?: (zusammenfassung: string) => void
}

const STANDARD_KAPAZITAET = 500
const STANDARD_LOG_INTERVALL_MS = 30_000

/** Kein Log-Aufruf mangels Daten — vermeidet ein irreführendes "p50=0/p95=0"-Log im Leerlauf. */
function formatiereZusammenfassung(eintraege: readonly PerfEintrag[]): string | null {
  if (eintraege.length === 0) return null
  const deltas = eintraege.map((e) => e.tDispatchEndeMs - e.tKeydownMs).sort((a, b) => a - b)
  const p50 = deltas[Math.floor(deltas.length * 0.5)]!
  const p95 = deltas[Math.floor(deltas.length * 0.95)] ?? deltas[deltas.length - 1]!
  const max = deltas[deltas.length - 1]!
  return `[perf] keydown→dispatch-ende (n=${deltas.length}): p50=${p50.toFixed(2)}ms p95=${p95.toFixed(2)}ms max=${max.toFixed(2)}ms`
}

export function createPerfInstrumentierung(
  deps: PerfInstrumentierungDeps = {}
): PerfInstrumentierung {
  const kapazitaet = deps.kapazitaet ?? STANDARD_KAPAZITAET
  const jetzt = deps.jetzt ?? (() => performance.now())
  const logIntervallMs = deps.logIntervallMs ?? STANDARD_LOG_INTERVALL_MS
  const log = deps.log ?? ((zusammenfassung: string) => console.log(zusammenfassung))

  // Fester Ringpuffer (Wrap-Around-Index) statt Array mit push/shift — keine Reallokation,
  // keine O(n)-Shifts pro Eintrag.
  const puffer: PerfEintrag[] = []
  let schreibIndex = 0

  const timer = setInterval(() => {
    const zusammenfassung = formatiereZusammenfassung(puffer)
    if (zusammenfassung) log(zusammenfassung)
  }, logIntervallMs)
  // Darf den Node-Prozess nicht am Beenden hindern, falls stoppe() vergessen wird (Test-Netz).
  timer.unref?.()

  return {
    erfasseStart() {
      return jetzt()
    },

    erfasseEnde(startMarker) {
      const eintrag: PerfEintrag = { tKeydownMs: startMarker, tDispatchEndeMs: jetzt() }
      if (puffer.length < kapazitaet) {
        puffer.push(eintrag)
      } else {
        puffer[schreibIndex] = eintrag
      }
      schreibIndex = (schreibIndex + 1) % kapazitaet
    },

    ringpuffer() {
      return puffer
    },

    stoppe() {
      clearInterval(timer)
    }
  }
}

/** Aus-Zustand (BLITZTEXT_PERF nicht gesetzt): reine no-op-Funktionen, kein Ringpuffer, kein Timer. */
export const NOOP_PERF: PerfInstrumentierung = {
  erfasseStart: () => 0,
  erfasseEnde: () => {},
  ringpuffer: () => [],
  stoppe: () => {}
}
