// Port für den Autostart-Eintrag (W3-γ, portable .exe): "Mit Windows starten" kann bei einem
// portablen Build NICHT verlässlich über app.setLoginItemSettings laufen (RESEARCH: bei portablen
// Electron-Builds ist das API-Verhalten inkonsistent/unwirksam, weil kein Installer-Registrierungspfad
// existiert). Robuster Weg: direkter Registry-Run-Key HKCU\Software\Microsoft\Windows\CurrentVersion\Run
// — pro Benutzer (kein Admin nötig), übersteht Windows-Updates, ist der Weg, den portable Tools i.d.R.
// nutzen. Der Port kapselt NUR diesen einen Key/Value; er weiß nichts von Electron oder reg.exe — das
// ist Sache der Default-Implementierung (registry-schreiber.ts), damit die reine Logik hier ohne echte
// Registry testbar bleibt.

/** Schreibt/liest EINEN Wert im Autostart-Run-Key. Injizierbar → ohne echte Registry testbar. */
export interface RegistrySchreiber {
  /** Legt/überschreibt den Wert `name` mit `pfad` (i.d.R. der Befehl inkl. Anführungszeichen). */
  setze(name: string, pfad: string): Promise<void>
  /** Entfernt den Wert `name`; ist bereits nichts hinterlegt, ist das ein No-Op (kein Fehler). */
  entferne(name: string): Promise<void>
  /** Liest den aktuell hinterlegten Wert; `null`, wenn kein Eintrag existiert. */
  liest(name: string): Promise<string | null>
}
