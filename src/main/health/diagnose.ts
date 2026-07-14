// Aggregat der Selbstdiagnose (Slice W3-ε): bündelt alle Einzel-Checks zu einer Liste + einem
// Gesamtstatus. Gesamtstatus = schlechtester Einzelstatus (fehler schlägt warnung schlägt ok).
// Ein werfender Port darf die anderen Checks NICHT mitreißen — jeder Check fängt seinen eigenen
// Port-Fehler bereits ab (siehe pruefe-*.ts) und liefert dafür 'fehler' zurück; hier läuft zusätzlich
// ein Sicherheitsnetz, falls doch einmal etwas durchrutscht (z. B. ein Bug in einem Check selbst).

import type { HealthErgebnis, HealthStatus } from './types'
import { schlechtererStatus } from './types'
import { pruefeApiKey, type PruefeApiKeyDeps } from './pruefe-api-key'
import { pruefeErreichbarkeit, type PruefeErreichbarkeitDeps } from './pruefe-erreichbarkeit'
import { pruefeMikrofon, type PruefeMikrofonDeps } from './pruefe-mikrofon'
import { pruefeHotkeyHook, type PruefeHotkeyHookDeps } from './pruefe-hotkey-hook'

export interface DiagnoseDeps {
  apiKey: PruefeApiKeyDeps
  erreichbarkeit: PruefeErreichbarkeitDeps
  mikrofon: PruefeMikrofonDeps
  hotkeyHook: PruefeHotkeyHookDeps
}

export interface DiagnoseErgebnis {
  gesamtstatus: HealthStatus
  checks: HealthErgebnis[]
}

const CHECK_FEHLGESCHLAGEN = (titel: string): HealthErgebnis => ({
  status: 'fehler',
  titel,
  detail: 'Dieser Check konnte nicht ausgeführt werden (unerwarteter Fehler).'
})

/** Führt einen Check robust aus: ein unerwarteter Wurf wird zu 'fehler' statt die Diagnose abzubrechen. */
async function robust(titel: string, lauf: () => Promise<HealthErgebnis>): Promise<HealthErgebnis> {
  try {
    return await lauf()
  } catch {
    return CHECK_FEHLGESCHLAGEN(titel)
  }
}

export async function fuehreDiagnose(deps: DiagnoseDeps): Promise<DiagnoseErgebnis> {
  const checks = await Promise.all([
    robust('API-Key', () => pruefeApiKey(deps.apiKey)),
    robust('Anbieter-Erreichbarkeit', () => pruefeErreichbarkeit(deps.erreichbarkeit)),
    robust('Mikrofon', () => pruefeMikrofon(deps.mikrofon)),
    robust('Hotkey-Erkennung', () => pruefeHotkeyHook(deps.hotkeyHook))
  ])

  const gesamtstatus = checks.reduce<HealthStatus>(
    (schlechtester, check) => schlechtererStatus(schlechtester, check.status),
    'ok'
  )

  return { gesamtstatus, checks }
}
