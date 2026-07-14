// Check 1: liegt für den Standard-Anbieter ein API-Key im Tresor? Reiner Check hinter einem
// schlanken Port — kein echter safeStorage-/Dateisystem-Zugriff im Test.
//
// Verdrahtung 3.2: `apiKeys.has` ist `ApiKeyVault.has` aus `@main/secrets/api-key-vault`
// (Instanz aus der Composition-Root), `anbieter` ist die aktive `AnbieterKonfig` aus den Settings
// (`standardAnbieterId` aufgelöst via `findeAnbieter`, siehe `@shared/anbieter`). Anbieter mit
// `keinKeyNoetig` (lokaler/keyloser Anbieter, L1) brauchen keinen Key → dafür immer 'ok'.

import type { HealthErgebnis } from './types'

/** Minimaler Ausschnitt aus ApiKeyVault — nur die read-only Existenzprüfung. */
export interface ApiKeyPort {
  has(anbieterId: string): Promise<boolean>
}

export interface PruefeApiKeyDeps {
  apiKeys: ApiKeyPort
  anbieter: {
    id: string
    label: string
    /** L1: lokaler/keyloser Anbieter — kein Key erforderlich (siehe AnbieterKonfig). */
    keinKeyNoetig?: boolean
  }
}

export async function pruefeApiKey(deps: PruefeApiKeyDeps): Promise<HealthErgebnis> {
  const { anbieter } = deps

  if (anbieter.keinKeyNoetig) {
    return {
      status: 'ok',
      titel: 'API-Key',
      detail: `„${anbieter.label}" benötigt keinen API-Key (lokaler Anbieter).`
    }
  }

  let vorhanden: boolean
  try {
    vorhanden = await deps.apiKeys.has(anbieter.id)
  } catch {
    return {
      status: 'fehler',
      titel: 'API-Key',
      detail: `Der API-Key-Tresor für „${anbieter.label}" konnte nicht gelesen werden.`
    }
  }

  if (!vorhanden) {
    return {
      status: 'fehler',
      titel: 'API-Key',
      detail: `Kein API-Key für „${anbieter.label}" hinterlegt. Bitte in den Einstellungen eintragen.`
    }
  }

  return {
    status: 'ok',
    titel: 'API-Key',
    detail: `API-Key für „${anbieter.label}" ist hinterlegt.`
  }
}
