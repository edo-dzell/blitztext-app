// v0.7.4 — Welcher .exe-Pfad gehört in den Autostart-Run-Key?
//
// Der Fehler, den das behebt: Blitztext wird als electron-builder-**portable**-Target ausgeliefert
// (electron-builder.yml, `win.target: portable`, ADR-0006). Eine portable .exe ist ein selbst-
// entpackendes Archiv: Beim Start wird die App in ein TEMPORÄRES Verzeichnis ausgepackt und von dort
// ausgeführt. `process.execPath` zeigt deshalb NICHT auf die .exe, die der Nutzer angeklickt hat,
// sondern auf die entpackte Kopie unter %TEMP% — ein Pfad, der bei jedem Start ein anderer ist und
// nach dem Beenden nicht mehr gilt.
//
// Folge (Feld-Befund: „Autostart hat nie funktioniert"): Der Run-Key bekam einen TEMP-Pfad
// eingetragen. Beim nächsten Anmelden zeigte er ins Leere → Windows startete nichts. Zusätzlich meldete
// die Verwaisungs-Prüfung (autostart.ts) bei jedem Start „verwaist", weil der frische TEMP-Pfad nie mit
// dem hinterlegten übereinstimmte. Der Nutzer musste sich mit einer Verknüpfung in `shell:startup`
// behelfen.
//
// electron-builder legt den ECHTEN Pfad der gestarteten portable .exe in `PORTABLE_EXECUTABLE_FILE` ab.
// Genau der gehört in den Run-Key. Die Variable existiert NUR in einem portable-Start; im Dev-Modus und
// bei einem entpackten Build (win-unpacked) fehlt sie — dann ist `process.execPath` korrekt und bleibt
// der Rückfall.
//
// Rein und testbar (kein Electron-, kein process-Zugriff): env und execPath kommen von außen.

/** Von electron-builder in portable-Builds gesetzt: voller Pfad der vom Nutzer gestarteten .exe. */
export const PORTABLE_PFAD_VARIABLE = 'PORTABLE_EXECUTABLE_FILE'

/**
 * Liefert den Pfad, der dauerhaft auf die startbare Blitztext-.exe zeigt.
 * Bevorzugt `PORTABLE_EXECUTABLE_FILE` (portable-Start), sonst `execPath` (Dev/entpackt).
 * Leere oder nur aus Leerzeichen bestehende Werte gelten als nicht gesetzt.
 */
export function ermittleAutostartExePfad(
  env: Record<string, string | undefined>,
  execPath: string
): string {
  const portabel = env[PORTABLE_PFAD_VARIABLE]
  if (typeof portabel === 'string' && portabel.trim() !== '') return portabel.trim()
  return execPath
}

/**
 * true, wenn der Pfad aus dem portable-Start stammt. NUR für die text-freie Diagnose gedacht — der
 * Pfad selbst darf NIE ins Ereignislog (er enthält den Windows-Benutzernamen).
 */
export function istPortablerStart(env: Record<string, string | undefined>): boolean {
  const portabel = env[PORTABLE_PFAD_VARIABLE]
  return typeof portabel === 'string' && portabel.trim() !== ''
}
