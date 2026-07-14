// Echter Holer-Adapter für pruefeAufUpdate (Staffel 3.2). Kapselt Node/Electron-`fetch` gegen die
// GitHub-Releases-API — die reine Update-Logik (update-hinweis.ts) bleibt netzfrei testbar; hier lebt
// der einzige echte Netz-Zugriff. Kurzes Timeout, damit ein hängender Request den App-Start nicht
// aufhält (der Aufruf selbst läuft ohnehin nach dem Start, nicht blockierend).
//
// KEINE Nutzer-Identifikatoren im Request (siehe update-hinweis.ts): nur die durchgereichten Header
// (Accept / optional If-None-Match) und ein statischer User-Agent (von GitHub für die API verlangt).

import type { Holer } from './update-hinweis'

const STANDARD_TIMEOUT_MS = 8000

// GitHub verlangt einen User-Agent-Header; ein statischer, anonymer Wert (kein Nutzer-/Maschinen-Bezug).
const USER_AGENT = 'Blitztext-UpdateCheck'

export interface UpdateHolerDeps {
  /** Injizierbar für Tests; Default: globales fetch (Electron/Node ≥ 18). */
  fetchFn?: typeof fetch
  timeoutMs?: number
}

/** Baut den echten fetch-basierten Holer. */
export function createUpdateHoler(deps: UpdateHolerDeps = {}): Holer {
  const fetchFn = deps.fetchFn ?? fetch
  const timeoutMs = deps.timeoutMs ?? STANDARD_TIMEOUT_MS

  return {
    async fetch(url, init) {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      try {
        const antwort = await fetchFn(url, {
          method: 'GET',
          headers: { 'User-Agent': USER_AGENT, ...(init?.headers ?? {}) },
          signal: controller.signal
        })
        return {
          status: antwort.status,
          headers: { get: (name: string) => antwort.headers.get(name) },
          json: () => antwort.json()
        }
      } finally {
        clearTimeout(timer)
      }
    }
  }
}
