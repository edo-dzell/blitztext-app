// Reine Autostart-Logik (W3-γ, isoliert — NICHT verdrahtet; das macht Staffel 3.2).
// Ehrliche Einschränkung (portable .exe, kein Installer): der Registry-Eintrag zeigt auf den exakten
// .exe-Pfad zum Zeitpunkt des Einschaltens. Wird die .exe danach verschoben/umbenannt, bleibt der
// ALTE Pfad im Run-Key stehen → Windows startet ihn nicht mehr (Datei existiert dort nicht mehr) oder
// startet die falsche/alte Kopie. Diese Klasse erkennt genau diesen Fall ("verwaist") und meldet ihn
// als inaktiv/korrekturbedürftig, statt fälschlich "aktiv" zu behaupten — Ehrlichkeits-Prinzip der App.

import type { RegistrySchreiber } from './autostart-port'

/** Name des Werts im Run-Key. Stabil halten — eine Änderung verwaist bestehende Nutzer-Einträge. */
export const AUTOSTART_WERTNAME = 'Blitztext'

export type AutostartStatus =
  /** Kein Eintrag vorhanden. */
  | { zustand: 'inaktiv' }
  /** Eintrag vorhanden und zeigt auf den aktuell übergebenen exePfad. */
  | { zustand: 'aktiv'; pfad: string }
  /**
   * Eintrag vorhanden, zeigt aber auf einen ANDEREN Pfad als den aktuellen (.exe wurde verschoben/
   * umbenannt, oder ein alter Eintrag einer früheren Installation). Gilt als NICHT aktiv — der Eintrag
   * ist wirkungslos oder startet die falsche Kopie — aber wird gesondert gemeldet, damit die UI (3.2)
   * z. B. "Autostart-Eintrag zeigt auf eine alte Version — bitte neu einschalten" anzeigen kann.
   */
  | { zustand: 'verwaist'; hinterlegterPfad: string }

export interface AutostartDeps {
  registry: RegistrySchreiber
}

export interface Autostart {
  /** Setzt/aktualisiert den Run-Key-Eintrag auf exePfad. Idempotent. */
  autostartAn(exePfad: string): Promise<void>
  /** Entfernt den Run-Key-Eintrag. Idempotent (No-Op, wenn schon keiner existiert). */
  autostartAus(): Promise<void>
  /** Konsistenzprüfung: vorhanden + aktueller Pfad ⇒ aktiv; vorhanden + anderer Pfad ⇒ verwaist. */
  istAutostartAktiv(exePfad: string): Promise<AutostartStatus>
}

export function createAutostart(deps: AutostartDeps): Autostart {
  return {
    async autostartAn(exePfad) {
      await deps.registry.setze(AUTOSTART_WERTNAME, formatiereBefehl(exePfad))
    },
    async autostartAus() {
      await deps.registry.entferne(AUTOSTART_WERTNAME)
    },
    async istAutostartAktiv(exePfad) {
      const hinterlegt = await deps.registry.liest(AUTOSTART_WERTNAME)
      if (hinterlegt === null) return { zustand: 'inaktiv' }
      if (entpackePfad(hinterlegt) === exePfad) return { zustand: 'aktiv', pfad: exePfad }
      return { zustand: 'verwaist', hinterlegterPfad: entpackePfad(hinterlegt) }
    }
  }
}

/** Pfad mit Leerzeichen (üblich unter "…\AppData\Local\…") braucht Anführungszeichen im Run-Key. */
function formatiereBefehl(exePfad: string): string {
  return `"${exePfad}"`
}

/** Kehrt formatiereBefehl um — entfernt umschließende Anführungszeichen, falls vorhanden. */
function entpackePfad(befehl: string): string {
  const getrimmt = befehl.trim()
  if (getrimmt.startsWith('"') && getrimmt.endsWith('"') && getrimmt.length >= 2) {
    return getrimmt.slice(1, -1)
  }
  return getrimmt
}
