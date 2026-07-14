// Gemeinsame Typen der Selbstdiagnose (Slice W3-ε). Jeder Check liefert unabhängig ein
// HealthErgebnis; die Ampel-UI (Staffel 3.2) verdrahtet diese Checks gegen echte Datenlieferanten
// und rendert `status` als Farbe. Dieses Modul selbst fasst NICHTS an (kein echter OS-/Netz-Zugriff),
// alle Datenquellen kommen über injizierbare Ports in den jeweiligen Check-Dateien.

/** Schwere eines Diagnose-Ergebnisses, aufsteigend sortiert (ok < warnung < fehler). */
export type HealthStatus = 'ok' | 'warnung' | 'fehler'

export interface HealthErgebnis {
  status: HealthStatus
  /** Kurzer, UI-tauglicher Titel (z. B. „API-Key vorhanden"). */
  titel: string
  /** Ein bis zwei Sätze Klartext für die Detailansicht; bei Fehlern möglichst handlungsleitend. */
  detail: string
}

/** Rang für den Vergleich „schlechtester Status gewinnt" (fuehreDiagnose). */
const RANG: Record<HealthStatus, number> = { ok: 0, warnung: 1, fehler: 2 }

export function schlechtererStatus(a: HealthStatus, b: HealthStatus): HealthStatus {
  return RANG[b] > RANG[a] ? b : a
}
