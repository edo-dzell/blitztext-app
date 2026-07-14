// Tray-Status (#08/#11): spiegelt die Workflow-Phase der Sitzung in den Tray-Tooltip.
// phaseTooltip ist rein (testbar); spiegleStatus ist die dünne Electron-Anbindung (HITL).

import type { Tray } from 'electron'
import type { WorkflowPhase } from '@main/workflow/runner'

/** Phase → Tooltip-Text. Rein, damit der Wortlaut ohne Electron testbar ist. */
export function phaseTooltip(phase: WorkflowPhase): string {
  switch (phase.status) {
    case 'idle':
      return 'Blitztext'
    case 'aufnehmen':
      return 'Blitztext — Aufnahme …'
    case 'transkribieren':
      return 'Blitztext — Transkribiere …'
    case 'umschreiben':
      return 'Blitztext — Schreibe um …'
    case 'fertig':
      return 'Blitztext — Fertig'
    case 'teilErfolg':
      return 'Blitztext — Rohtext in Zwischenablage'
    case 'fehler':
      return `Blitztext — Fehler: ${phase.message}`
  }
}

/** An `Sitzung.onStatus` hängen: Tray-Tooltip aktualisieren. */
export function spiegleStatus(tray: Tray, phase: WorkflowPhase): void {
  tray.setToolTip(phaseTooltip(phase))
}

/** Aktionen, die das Tray-Kontextmenü auslöst (von index.ts gestellt; hier nur die reinen Zustände). */
export interface TrayMenuAktionen {
  einstellungenOeffnen: () => void
  abbrechen: () => void
  erneutVersuchen: () => void
  beenden: () => void
}

/** Live-Zustände, die den Aktiv-/Sichtbar-Zustand der Einträge bestimmen (pro Neuaufbau frisch gelesen). */
export interface TrayMenuZustand {
  /** true, solange ein Lauf aktiv ist → „Abbrechen" aktiv. */
  beschaeftigt: boolean
  /** F1 (W3-B): true, wenn die letzte Aufnahme erneut verarbeitet werden kann → Retry-Eintrag aktiv. */
  kannErneutVersuchen: boolean
}

/**
 * Ein Menü-Eintrag (label/enabled/type/click) — die für das Kontextmenü genutzte Teilmenge von
 * Electrons MenuItemConstructorOptions, ohne Electron-Import (rein/testbar). index.ts reicht das
 * Ergebnis unverändert an `Menu.buildFromTemplate`.
 */
export interface TrayMenuEintrag {
  label?: string
  enabled?: boolean
  type?: 'separator'
  click?: () => void
}

/**
 * Baut das Tray-Kontextmenü-Template (F1: inkl. „Letzte Aufnahme erneut verarbeiten", aktiv nur wenn
 * `kannErneutVersuchen`). Rein, damit Reihenfolge/Aktivzustände ohne Electron testbar sind — die
 * dünne `Menu.buildFromTemplate`-Anbindung bleibt in index.ts (HITL).
 */
export function baueTrayMenuTemplate(
  zustand: TrayMenuZustand,
  aktionen: TrayMenuAktionen
): TrayMenuEintrag[] {
  return [
    { label: 'Einstellungen öffnen…', click: aktionen.einstellungenOeffnen },
    { label: 'Abbrechen', enabled: zustand.beschaeftigt, click: aktionen.abbrechen },
    {
      label: 'Letzte Aufnahme erneut verarbeiten',
      enabled: zustand.kannErneutVersuchen,
      click: aktionen.erneutVersuchen
    },
    { type: 'separator' },
    { label: 'Beenden', click: aktionen.beenden }
  ]
}
