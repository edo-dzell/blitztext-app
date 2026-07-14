// Echter Erreichbarkeits-Port für die Selbstdiagnose (Staffel 3.2). Leichter Ping gegen den aktiven
// Anbieter: GET <baseUrl>/models mit kurzem Timeout. Kein voller TranscriptionProvider, kein Key-
// Versand — nur „antwortet der Endpunkt und lehnt er nicht hart die Autorisierung ab?". 401/403 =
// Autorisierung abgelehnt (harter Fehler, der Key stimmt nicht); jeder andere erreichte Status zählt
// als erreichbar (auch 404 auf /models heißt: Server da). Netzfehler wirft → der Check wertet das als
// warnung (siehe pruefe-erreichbarkeit.ts).

import type { ErreichbarkeitsPort } from './pruefe-erreichbarkeit'
import { istSichereAnbieterUrl } from '@shared/anbieter-url-guard'

const STANDARD_TIMEOUT_MS = 5000

export interface ErreichbarkeitsAdapterDeps {
  /** Optionaler API-Key-Holer des aktiven Anbieters — falls vorhanden, als Bearer mitschicken, damit
   *  401/403 verlässlich ein „Key falsch" statt ein generisches „nicht erreichbar" liefert. */
  getApiKey?: () => Promise<string | null>
  /** Injizierbar für Tests; Default: globales fetch. */
  fetchFn?: typeof fetch
  timeoutMs?: number
}

/** Baut den echten fetch-basierten Erreichbarkeits-Port. */
export function createErreichbarkeitsAdapter(deps: ErreichbarkeitsAdapterDeps = {}): ErreichbarkeitsPort {
  const fetchFn = deps.fetchFn ?? fetch
  const timeoutMs = deps.timeoutMs ?? STANDARD_TIMEOUT_MS

  return {
    async pingeAnbieter(baseUrl: string) {
      // F2 (Security-Review P1): Hart-Block VOR dem Key-tragenden fetch — http zu einem fremden Host
      // würde den Bearer-Key im Klartext senden. localhost/127.0.0.1/::1 mit http bleibt erlaubt
      // (lokales ASR). Der Aufrufer (pruefe-erreichbarkeit.ts) wertet jeden Wurf als transiente
      // 'warnung' (Netzfehler) — für einen harten Konfigurationsfehler unpassend UND würde hier gar
      // nicht erst erreicht, weil wir vor jedem Netzversuch blocken. Statt zu werfen also
      // `erreichbar:false` liefern (ohne `autorisierungAbgelehnt`, das hieße fälschlich „Key falsch"):
      // truthful „nicht erreichbar wie erwartet", ohne Netzversuch und ohne Key-Leak.
      if (!istSichereAnbieterUrl(baseUrl)) {
        return { erreichbar: false }
      }

      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      try {
        const key = deps.getApiKey ? await deps.getApiKey() : null
        const headers: Record<string, string> = {}
        if (key) headers['Authorization'] = `Bearer ${key}`
        const url = `${baseUrl.replace(/\/+$/, '')}/models`
        const antwort = await fetchFn(url, { method: 'GET', headers, signal: controller.signal })
        if (antwort.status === 401 || antwort.status === 403) {
          return { erreichbar: false, autorisierungAbgelehnt: true }
        }
        // Jeder erreichte HTTP-Status (auch 404/500) heißt: der Server hat geantwortet → erreichbar.
        return { erreichbar: true }
      } finally {
        clearTimeout(timer)
      }
    }
  }
}
