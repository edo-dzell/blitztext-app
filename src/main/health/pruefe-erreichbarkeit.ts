// Check 2: ist der Anbieter erreichbar? Leichter Netz-Check (z. B. Modell-Liste abrufen) hinter
// einem Holer-Port — kein echtes fetch im Test. Netzfehler sind bewusst NICHT fatal: eine tote
// Leitung heißt nicht, dass Diktieren unmöglich ist (Retry/Offline-Puffer greifen im Workflow), also
// 'warnung' statt 'fehler'. Nur eine eindeutige Autorisierungsablehnung (401/403 — der Key selbst ist
// falsch) ist ein harter 'fehler', weil kein Retry das beheben kann.
//
// Verdrahtung 3.2: `holer.pingeAnbieter` ist ein schlanker Adapter um `fetch` gegen einen leichten
// Anbieter-Endpunkt (z. B. GET /models) mit kurzem Timeout — NICHT der volle TranscriptionProvider.
// Optional/lazy: die 3.2-UI sollte diesen Check nur bei Bedarf (Button „erneut prüfen") oder mit
// eigenem Timeout-Budget auslösen, damit die Diagnose-Seite nicht auf einen hängenden Request wartet.

import type { HealthErgebnis } from './types'

export interface ErreichbarkeitsErgebnis {
  erreichbar: boolean
  /** Gesetzt, wenn der Anbieter eine Autorisierung ausdrücklich ablehnt (Status 401/403). */
  autorisierungAbgelehnt?: boolean
}

/** Minimaler Holer-Port: ein leichter Erreichbarkeits-Ping gegen den aktiven Anbieter. */
export interface ErreichbarkeitsPort {
  pingeAnbieter(baseUrl: string): Promise<ErreichbarkeitsErgebnis>
}

export interface PruefeErreichbarkeitDeps {
  holer: ErreichbarkeitsPort
  anbieter: { label: string; baseUrl: string }
}

export async function pruefeErreichbarkeit(
  deps: PruefeErreichbarkeitDeps
): Promise<HealthErgebnis> {
  const { anbieter } = deps

  let ergebnis: ErreichbarkeitsErgebnis
  try {
    ergebnis = await deps.holer.pingeAnbieter(anbieter.baseUrl)
  } catch {
    // Netzfehler (Timeout, DNS, offline, …) → warnung, kein fehler (siehe Header-Kommentar).
    return {
      status: 'warnung',
      titel: 'Anbieter-Erreichbarkeit',
      detail: `„${anbieter.label}" ist gerade nicht erreichbar. Netzwerk prüfen oder später erneut versuchen.`
    }
  }

  if (ergebnis.autorisierungAbgelehnt) {
    return {
      status: 'fehler',
      titel: 'Anbieter-Erreichbarkeit',
      detail: `„${anbieter.label}" hat den API-Key abgelehnt. Bitte Key in den Einstellungen prüfen.`
    }
  }

  if (!ergebnis.erreichbar) {
    return {
      status: 'warnung',
      titel: 'Anbieter-Erreichbarkeit',
      detail: `„${anbieter.label}" antwortet gerade nicht wie erwartet.`
    }
  }

  return {
    status: 'ok',
    titel: 'Anbieter-Erreichbarkeit',
    detail: `„${anbieter.label}" ist erreichbar.`
  }
}
