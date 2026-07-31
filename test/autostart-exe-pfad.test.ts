import { describe, it, expect } from 'vitest'
import {
  ermittleAutostartExePfad,
  istPortablerStart,
  PORTABLE_PFAD_VARIABLE
} from '@main/autostart/exe-pfad'

// v0.7.4 — Regression: Blitztext wird als electron-builder-portable-Target ausgeliefert. Eine portable
// .exe entpackt sich beim Start nach %TEMP% und läuft von dort; `process.execPath` zeigt deshalb auf
// diese temporäre Kopie, nicht auf die vom Nutzer gestartete Datei. Der Autostart-Run-Key bekam so einen
// Pfad eingetragen, den es beim nächsten Anmelden nicht mehr gab — Autostart hat nie funktioniert.
// REGEL für Fixtures: nie ein realer Benutzername (siehe Leak-Vorfall v0.5.0).
const TEMP_KOPIE = 'C:\\Users\\nutzer\\AppData\\Local\\Temp\\2F3A\\Blitztext.exe'
const ECHTE_EXE = 'D:\\Werkzeuge\\Blitztext-0.7.4-win-portable.exe'

describe('ermittleAutostartExePfad', () => {
  it('portable-Start: nimmt PORTABLE_EXECUTABLE_FILE statt der TEMP-Kopie', () => {
    const pfad = ermittleAutostartExePfad({ [PORTABLE_PFAD_VARIABLE]: ECHTE_EXE }, TEMP_KOPIE)
    expect(pfad).toBe(ECHTE_EXE)
  })

  it('ohne die Variable (Dev / entpackter Build): execPath bleibt korrekt', () => {
    expect(ermittleAutostartExePfad({}, TEMP_KOPIE)).toBe(TEMP_KOPIE)
  })

  it('leere oder nur aus Leerzeichen bestehende Variable gilt als nicht gesetzt', () => {
    expect(ermittleAutostartExePfad({ [PORTABLE_PFAD_VARIABLE]: '' }, TEMP_KOPIE)).toBe(TEMP_KOPIE)
    expect(ermittleAutostartExePfad({ [PORTABLE_PFAD_VARIABLE]: '   ' }, TEMP_KOPIE)).toBe(TEMP_KOPIE)
  })

  it('trimmt umgebende Leerzeichen des Variablenwerts', () => {
    expect(ermittleAutostartExePfad({ [PORTABLE_PFAD_VARIABLE]: `  ${ECHTE_EXE}  ` }, TEMP_KOPIE)).toBe(
      ECHTE_EXE
    )
  })

  it('Pfade mit Leerzeichen bleiben unangetastet (die Quotierung macht autostart.ts)', () => {
    const mitLeerzeichen = 'C:\\Program Files\\Meine Werkzeuge\\Blitztext.exe'
    expect(ermittleAutostartExePfad({ [PORTABLE_PFAD_VARIABLE]: mitLeerzeichen }, TEMP_KOPIE)).toBe(
      mitLeerzeichen
    )
  })

  // Die eigentliche Fehlerbedingung, festgehalten: Ein TEMP-Pfad darf NIE im Run-Key landen, solange
  // die Variable einen echten Pfad liefert.
  it('der TEMP-Pfad wird im portable-Fall nicht verwendet', () => {
    const pfad = ermittleAutostartExePfad({ [PORTABLE_PFAD_VARIABLE]: ECHTE_EXE }, TEMP_KOPIE)
    expect(pfad).not.toContain('Temp')
  })
})

describe('istPortablerStart', () => {
  it('erkennt den portable-Start', () => {
    expect(istPortablerStart({ [PORTABLE_PFAD_VARIABLE]: ECHTE_EXE })).toBe(true)
  })

  it('Dev/entpackt → false', () => {
    expect(istPortablerStart({})).toBe(false)
    expect(istPortablerStart({ [PORTABLE_PFAD_VARIABLE]: '' })).toBe(false)
  })
})
