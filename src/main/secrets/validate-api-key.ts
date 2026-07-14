// Leichter Validierungs-Call gegen den aktiven OpenAI-kompatiblen Anbieter für das Onboarding
// (ADR-0004/0008 / Issue #01). fetch + baseUrl injizierbar → ohne echtes Netz testbar.

import type { ApiKeyValidation } from '@shared/api-key'
import { istSichereAnbieterUrl } from '@shared/anbieter-url-guard'

export type { ApiKeyValidation }

const OPENAI_BASE_URL = 'https://api.openai.com/v1'

export interface ValidateOptions {
  /** OpenAI-kompatible Base-URL OHNE Trailing-Slash; Default OpenAI (v1-Verhalten). */
  baseUrl?: string
  fetchFn?: typeof fetch
}

export async function validateApiKey(
  key: string,
  { baseUrl = OPENAI_BASE_URL, fetchFn = fetch }: ValidateOptions = {}
): Promise<ApiKeyValidation> {
  if (key.trim() === '') return { status: 'invalid' }

  // F2 (Security-Review P1): Hart-Block VOR dem Key-tragenden fetch — http zu einem fremden Host
  // würde den Bearer-Key im Klartext senden. localhost/127.0.0.1/::1 mit http bleibt erlaubt (lokales
  // ASR). validateApiKey hat kein AnbieterFehler-Kontrakt (kein .status/.transport-Wurf) — die
  // Ablehnung wird direkt als 'network-error' mit klarer deutscher Meldung zurückgegeben (kein Retry-
  // Signal nötig, der Aufruf findet ohnehin nicht statt).
  if (!istSichereAnbieterUrl(baseUrl)) {
    return {
      status: 'network-error',
      message:
        `Unsichere Anbieter-URL: „${baseUrl}" ist unverschlüsseltes http zu einem fremden Host. ` +
        'Bitte eine https-URL hinterlegen (http:// ist nur für localhost/127.0.0.1/::1 erlaubt).'
    }
  }

  try {
    const response = await fetchFn(`${baseUrl}/models`, {
      headers: { Authorization: `Bearer ${key}` }
    })

    if (response.status === 200) return { status: 'valid' }
    if (response.status === 401) return { status: 'invalid' }
    return { status: 'network-error', message: `HTTP ${response.status}` }
  } catch (error) {
    return {
      status: 'network-error',
      message: error instanceof Error ? error.message : String(error)
    }
  }
}
