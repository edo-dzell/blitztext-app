// Geteilte Stufen-Tabelle für Laufzeit-Einstellungen (v0.8.0). Reine, Electron-/Node-freie Datei
// (Muster: pricing.ts) — die EINE Quelle aller Stufenwerte, die von drei Seiten importiert wird:
// dem Settings-Store (Validierung, feldweiser Wertebereich), der Composition-Root (Auflösung der
// Profile in die tatsächlich genutzten Konstanten) und der Einstellungen-View (Dropdown-Optionen).
//
// Hintergrund (Nutzer-Anforderung): ALLE Einstellungen müssen unter „Einstellungen" konfigurierbar
// sein, ausschließlich über boolesche Schalter oder Dropdown-Felder — keine Freitext-Zahleneingabe.
// Jede numerische Einstellung bekommt deshalb eine FESTE, geschlossene Stufenliste (Vorbild:
// TEMPERATUR_STUFEN in workflows.ts) statt eines offenen number-Feldes.
//
// WICHTIGSTE EIGENSCHAFT: 'normal' (bzw. die jeweilige Mittelstufe) MUSS in jedem Profil exakt das
// heutige, hart kodierte Verhalten reproduzieren — eine v0.7.x-`settings.json` OHNE diese Felder
// verhält sich nach der Migration exakt wie heute. Das wird in test/laufzeit-profile.test.ts über
// einen Drift-Schutz erzwungen: die 'normal'-Werte werden gegen die main-seitigen Original-Konstanten
// verglichen (quality.ts, cloud-provider.ts) bzw. gegen das beobachtbare Verhalten (pill-status.ts,
// das seine Konstanten nicht exportiert).
//
// Diese Datei importiert bewusst NICHTS aus @main (Layering-Regel, siehe eslint.config.mjs D4-Block:
// shared/ ist richtungsunabhängig) — die main-seitigen Konstanten werden hier NICHT wiederverwendet,
// sondern unabhängig dupliziert und über den Drift-Test synchron gehalten. Das ist bewusst: eine
// Test-Datei DARF beide Seiten importieren und vergleichen, die Produktionsdatei selbst nicht.

/**
 * Generischer, wurffreier Wertebereichs-Check: ist `wert` Mitglied der (geschlossenen) Stufenliste?
 * Dient als EINE gemeinsame Validierungsfunktion für alle Felder dieser Datei (Store-Migration) — ein
 * typfremder/unbekannter Wert liefert `false` statt zu werfen, egal ob `wert` eine Zahl, ein String,
 * `undefined` oder sonst etwas ist.
 */
export function istStufe<T>(stufen: readonly T[], wert: unknown): wert is T {
  return (stufen as readonly unknown[]).includes(wert)
}

// --- mindestAufnahmeSekunden — löst MINIMUM_RECORDING_SECONDS (quality.ts) ab. --------------------
// 'normal'-Äquivalent ist hier der Default selbst (kein separates Profil, nur eine Zahlen-Stufe).

export const MINDEST_AUFNAHME_SEKUNDEN_STUFEN = [0.1, 0.2, 0.3, 0.5, 1.0] as const
export type MindestAufnahmeSekundenStufe = (typeof MINDEST_AUFNAHME_SEKUNDEN_STUFEN)[number]
/** = MINIMUM_RECORDING_SECONDS (quality.ts) — heutiges Verhalten. */
export const MINDEST_AUFNAHME_SEKUNDEN_DEFAULT: MindestAufnahmeSekundenStufe = 0.3

// --- stilleProfil — löst STILLE_HART/STILLE_WEICH/STILLE_DYNAMIK (quality.ts) ab. ------------------
//
// quality.ts dokumentiert die drei Konstanten so: unterhalb HART ist es für jedes Mikrofon Stille,
// oberhalb WEICH ist es immer hörbares Sprechen, dazwischen entscheidet die DYNAMIK (Verhältnis
// Spitze:Grundrauschen — Sprache ist stoßhaft, Stille ist flach). Eine AGGRESSIVERE Stufe (verwirft
// öfter) vergrößert die „klar still"-Zone (höheres HART), verkleinert die „klar hörbar"-Zone (höheres
// WEICH) UND verlangt ein höheres Dynamik-Verhältnis, um im Graubereich noch als Sprache zu gelten.
// Eine VORSICHTIGERE Stufe (verwirft seltener) macht exakt das Gegenteil. Skalierung: HART/WEICH
// werden gemeinsam auf die halbe/doppelte Schwelle bewegt (das Verhältnis WEICH:HART = 10 aus
// quality.ts bleibt in jeder Stufe erhalten), DYNAMIK verschiebt sich um ±1 in dieselbe Richtung.
// 'aus' deaktiviert die Prüfung vollständig (kein Schwellenwert, `stilleSchwellenFuer` liefert null).
//
// ABSOLUT (Befund A, v0.8.0, s. STILLE_ABSOLUT in quality.ts): dieselbe halbe/doppelte Skalierung wie
// HART/WEICH, UND zusätzlich im festen Verhältnis ABSOLUT:WEICH = 1,5 zu jeder Stufe — dieselbe Marge,
// mit der ABSOLUT für 'normal' aus den Feld-Messwerten hergeleitet wurde (s. quality.ts). 'streng'
// verwirft dadurch bei einem noch lauteren absoluten Pegel als 'normal', 'vorsichtig' bei einem noch
// leiseren — konsistent mit „aggressiver verwirft mehr / vorsichtiger verwirft weniger" oben.

export const STILLE_PROFIL_STUFEN = ['aus', 'vorsichtig', 'normal', 'streng'] as const
export type StilleProfil = (typeof STILLE_PROFIL_STUFEN)[number]
export const STILLE_PROFIL_DEFAULT: StilleProfil = 'normal'

export interface StilleSchwellen {
  /** Unterhalb davon ist es für JEDES Mikrofon Stille (= STILLE_HART in quality.ts). */
  hart: number
  /** Oberhalb davon ist es in jedem Fall hörbares Sprechen (= STILLE_WEICH in quality.ts). */
  weich: number
  /** Verhältnis Spitze:Grundrauschen, das im Graubereich für „hörbar" nötig ist (= STILLE_DYNAMIK). */
  dynamik: number
  /**
   * Befund A (v0.8.0): absolute Untergrenze, UNABHÄNGIG von der Dynamik und von `weich` geprüft
   * (= STILLE_ABSOLUT in quality.ts). Liegt bewusst ÜBER `weich` (Faktor 2,5) — siehe Kommentar dort.
   */
  absolut: number
}

// 'normal' = STILLE_HART/STILLE_WEICH/STILLE_DYNAMIK/STILLE_ABSOLUT aus quality.ts, byte-identisch
// (Drift-Test).
const STILLE_SCHWELLEN_TABELLE: Record<Exclude<StilleProfil, 'aus'>, StilleSchwellen> = {
  vorsichtig: { hart: 0.001, weich: 0.01, dynamik: 2, absolut: 0.015 },
  normal: { hart: 0.002, weich: 0.02, dynamik: 3, absolut: 0.03 },
  streng: { hart: 0.004, weich: 0.04, dynamik: 4, absolut: 0.06 }
}

/** Schwellenwerte für eine Stille-Profil-Stufe; `null` bei 'aus' (keine Stille-Prüfung). */
export function stilleSchwellenFuer(profil: StilleProfil): StilleSchwellen | null {
  if (profil === 'aus') return null
  return STILLE_SCHWELLEN_TABELLE[profil]
}

// --- netzwerkProfil — löst den ASR-Fetch-Timeout (cloud-provider.ts) + den Runner-Watchdog ---------
// (runner.ts) ab.
//
// Hinterlegt wird NUR der Fetch-Timeout je Stufe; der Watchdog wird daraus abgeleitet (Fetch + feste
// Marge). Damit ist die Invariante „Fetch-Timeout < Watchdog" (der Fetch-Timeout MUSS unter dem
// Watchdog liegen, sonst greift der Watchdog zuerst und der Fehler wird fälschlich als nicht
// wiederholbarer Anbieter-Fehler statt als retrybarer Transport-Fehler klassifiziert, siehe
// cloud-provider.ts) durch KONSTRUKTION garantiert, nicht bloß durch einen Kommentar behauptet — ein
// zweites, unabhängig gepflegtes Zahlenpaar könnte man verkehrt herum eintragen, dieses Design nicht.
// 'normal' reproduziert exakt den Bestand: Fetch 60_000 (DEFAULT_FETCH_TIMEOUT_MS) + Marge 30_000 =
// Watchdog 90_000 (runner.ts, inline). 'kurz'/'lang' halbieren/verdoppeln den Fetch-Timeout.

export const NETZWERK_PROFIL_STUFEN = ['kurz', 'normal', 'lang'] as const
export type NetzwerkProfil = (typeof NETZWERK_PROFIL_STUFEN)[number]
export const NETZWERK_PROFIL_DEFAULT: NetzwerkProfil = 'normal'

/** Feste Marge zwischen Fetch-Timeout und Watchdog, für JEDE Stufe gleich (= 90_000 − 60_000 heute). */
export const NETZWERK_WATCHDOG_MARGE_MS = 30_000

const NETZWERK_FETCH_TIMEOUT_TABELLE: Record<NetzwerkProfil, number> = {
  kurz: 30_000,
  normal: 60_000, // = DEFAULT_FETCH_TIMEOUT_MS (cloud-provider.ts), byte-identisch (Drift-Test)
  lang: 120_000
}

export interface NetzwerkWerte {
  fetchTimeoutMs: number
  /** IMMER fetchTimeoutMs + NETZWERK_WATCHDOG_MARGE_MS — kann nie „verkehrt herum" konfiguriert sein. */
  watchdogMs: number
}

/** Fetch-Timeout + daraus abgeleiteter Watchdog für eine Netzwerk-Profil-Stufe. */
export function netzwerkProfilWerte(profil: NetzwerkProfil): NetzwerkWerte {
  const fetchTimeoutMs = NETZWERK_FETCH_TIMEOUT_TABELLE[profil]
  return { fetchTimeoutMs, watchdogMs: fetchTimeoutMs + NETZWERK_WATCHDOG_MARGE_MS }
}

// --- retryVersuche — Anzahl der Anbieter-Retry-Versuche. -------------------------------------------

export const RETRY_VERSUCHE_STUFEN = [1, 2, 3, 4] as const
export type RetryVersucheStufe = (typeof RETRY_VERSUCHE_STUFEN)[number]
export const RETRY_VERSUCHE_DEFAULT: RetryVersucheStufe = 2

// --- verlaufMaximum — Deckelung der Anzahl gespeicherter Verlauf-Einträge. --------------------------

export const VERLAUF_MAXIMUM_STUFEN = [50, 100, 200, 500, 1000] as const
export type VerlaufMaximumStufe = (typeof VERLAUF_MAXIMUM_STUFEN)[number]
export const VERLAUF_MAXIMUM_DEFAULT: VerlaufMaximumStufe = 200

// --- statistikKompaktierungTage — ab welchem Alter (Tage) die Statistik monatlich kompaktiert wird. -

export const STATISTIK_KOMPAKTIERUNG_TAGE_STUFEN = [30, 60, 90, 180, 365] as const
export type StatistikKompaktierungTageStufe = (typeof STATISTIK_KOMPAKTIERUNG_TAGE_STUFEN)[number]
export const STATISTIK_KOMPAKTIERUNG_TAGE_DEFAULT: StatistikKompaktierungTageStufe = 90

// --- updateIntervallStunden — wie oft der (opt-in) Update-Hinweis nach Neuem sucht. -----------------

export const UPDATE_INTERVALL_STUNDEN_STUFEN = [6, 12, 24, 72, 168] as const
export type UpdateIntervallStundenStufe = (typeof UPDATE_INTERVALL_STUNDEN_STUFEN)[number]
export const UPDATE_INTERVALL_STUNDEN_DEFAULT: UpdateIntervallStundenStufe = 24

// --- pillenAnzeigedauerProfil — löst AUTO_HIDE_BASIS_MS/OBERGRENZE_MS/MS_PRO_ZEICHEN (pill-status.ts)
// ab.
//
// pill-status.ts berechnet die Auto-Hide-Dauer als
// `min(OBERGRENZE, max(BASIS, label.length * MS_PRO_ZEICHEN))`. 'normal' reproduziert exakt den
// Bestand (Basis 4000ms, Obergrenze 8000ms, 60ms/Zeichen). 'kurz'/'lang' skalieren ALLE DREI Werte
// proportional (halbe/doppelte Zahlen) — damit bleibt das Verhältnis von Basis zu Obergrenze (1:2) und
// die Steigung zueinander konsistent, eine kürzere/längere Stufe „fühlt sich" also gleich an, nur
// schneller/langsamer. pill-status.ts exportiert seine Konstanten nicht (Modul-privat) — der Drift-
// Test prüft deshalb über das beobachtbare Verhalten von `pillenStatus`, nicht per Direktimport.

export const PILLEN_ANZEIGEDAUER_PROFIL_STUFEN = ['kurz', 'normal', 'lang'] as const
export type PillenAnzeigedauerProfil = (typeof PILLEN_ANZEIGEDAUER_PROFIL_STUFEN)[number]
export const PILLEN_ANZEIGEDAUER_PROFIL_DEFAULT: PillenAnzeigedauerProfil = 'normal'

export interface PillenAnzeigedauerWerte {
  /** Mindest-Anzeigedauer, auch für sehr kurze Labels (= AUTO_HIDE_BASIS_MS). */
  basisMs: number
  /** Höchst-Anzeigedauer, auch für sehr lange Labels (= AUTO_HIDE_OBERGRENZE_MS). */
  obergrenzeMs: number
  /** Anzeigedauer pro Zeichen zwischen Basis und Obergrenze (= AUTO_HIDE_MS_PRO_ZEICHEN). */
  msProZeichen: number
}

const PILLEN_ANZEIGEDAUER_TABELLE: Record<PillenAnzeigedauerProfil, PillenAnzeigedauerWerte> = {
  kurz: { basisMs: 2000, obergrenzeMs: 4000, msProZeichen: 30 },
  // = AUTO_HIDE_BASIS_MS/OBERGRENZE_MS/MS_PRO_ZEICHEN (pill-status.ts), byte-identisch (Drift-Test).
  normal: { basisMs: 4000, obergrenzeMs: 8000, msProZeichen: 60 },
  lang: { basisMs: 8000, obergrenzeMs: 16000, msProZeichen: 120 }
}

/** Anzeigedauer-Parameter für eine Pillen-Anzeigedauer-Profil-Stufe. */
export function pillenAnzeigedauerWerteFuer(profil: PillenAnzeigedauerProfil): PillenAnzeigedauerWerte {
  return PILLEN_ANZEIGEDAUER_TABELLE[profil]
}

// --- perfAktiv — schaltet die Perf-Messung (BLITZTEXT_PERF) über die Einstellungen statt nur über die
// Umgebungsvariable. Reiner boolescher Schalter, keine Stufenliste nötig. --------------------------

export const PERF_AKTIV_DEFAULT = false
