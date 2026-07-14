// Opt-in Update-Hinweis (Zusatz V6, W3-G/W3-δ): fragt die GitHub-Releases-API des öffentlichen Forks
// nach der neuesten Version und vergleicht sie mit der lokalen `app.getVersion()`. KEIN Auto-Update
// (lädt/installiert nichts), KEINE Telemetrie (kein Nutzer-Identifikator im Request — nur ein
// anonymer GitHub-API-Aufruf wie ihn jeder Browser machen könnte). Reiner Kern hinter zwei injizierbaren
// Ports (Holer=HTTP, Speicher=Cache-Zustand) → ohne echtes Netz/Dateisystem testbar (ADR-Stil wie
// cloud-provider.ts/history-store.ts). Die Verdrahtung (Opt-in-Flag, UI-Anzeige in Über/Hilfe) macht
// Staffel 3.2 — dieses Modul bekommt „ob überhaupt gefragt werden darf" nur als Parameter, entscheidet
// selbst nichts über Einstellungen.

import { istNeuer as istNeuerIntern } from './semver-vergleich'
export { istNeuer } from './semver-vergleich'

export interface UpdateErgebnis {
  /** Lokale Version laut `app.getVersion()` (unverändert durchgereicht, für die Anzeige „Du hast X"). */
  aktuelleVersion: string
  /** true nur bei einer ECHTEN Versionserhöhung (istNeuer) UND erfolgreichem Abruf. */
  neuVerfuegbar: boolean
  /** Release-Seite zum Anzeigen/Verlinken; leer, wenn kein neueres Release bekannt ist. */
  url: string
}

/** Minimaler HTTP-Port — kapselt `fetch`, damit Tests nie echt ins Netz gehen. */
export interface Holer {
  fetch(url: string, init?: { headers?: Record<string, string> }): Promise<{
    status: number
    headers: { get(name: string): string | null }
    json(): Promise<unknown>
  }>
}

/** Zwischengespeicherter Zustand einer vorherigen Prüfung — reicht für den ETag-/Zeit-Cache. */
export interface UpdateCacheEintrag {
  /** ms seit Epoch der letzten (erfolgreichen ODER 304-bestätigten) Prüfung. */
  geprueftAmMs: number
  /** ETag-Header der letzten 200er-Antwort, falls der Server einen geliefert hat. */
  etag?: string
  /** Letztes bekanntes Ergebnis — wird bei Cache-Treffer/304 unverändert zurückgegeben. */
  letztesErgebnis: UpdateErgebnis
}

/** Injizierbarer Speicher-Port für den Cache-Zustand (z. B. settings-store/eine kleine JSON-Datei). */
export interface UpdateCacheSpeicher {
  lesen(): Promise<UpdateCacheEintrag | null>
  schreiben(eintrag: UpdateCacheEintrag): Promise<void>
}

const STANDARD_MINDESTABSTAND_MS = 24 * 60 * 60 * 1000 // 1x/Tag reicht — kein Anfrage-Spam bei jedem Start

/** GitHub-Releases-API des öffentlichen Forks (siehe publish-public-fork). */
const RELEASES_URL = 'https://api.github.com/repos/edo-dzell/blitztext-app-windows/releases/latest'

function leerErgebnis(aktuelleVersion: string): UpdateErgebnis {
  return { aktuelleVersion, neuVerfuegbar: false, url: '' }
}

function istGithubRelease(wert: unknown): wert is { tag_name: unknown; html_url: unknown } {
  return typeof wert === 'object' && wert !== null && 'tag_name' in wert
}

/**
 * Prüft (falls fällig) auf ein neueres Release. Ruft NUR auf, wenn der Aufrufer per `optIn: true`
 * bestätigt, dass der Nutzer dem zugestimmt hat (die eigentliche Einstellung/Verdrahtung macht 3.2).
 * Robustheit: jeder Fehler (Netz, Rate-Limit, kaputtes JSON, unerwartete Form) endet still bei
 * `neuVerfuegbar: false` — nie ein Absturz, nie ein nerviger Fehlerdialog beim Start.
 */
export async function pruefeAufUpdate(deps: {
  /** Muss vom Aufrufer explizit gesetzt sein (Opt-in-Einstellung, 3.2-Verdrahtung). Default: false. */
  optIn: boolean
  /** Lokale Version, i. d. R. `app.getVersion()`. */
  lokaleVersion: string
  holer: Holer
  speicher: UpdateCacheSpeicher
  /** Für Tests injizierbar; Default `Date.now`. */
  jetztMs?: () => number
  /** Mindestabstand zwischen zwei echten Netzabfragen (Default 24h). */
  mindestabstandMs?: number
}): Promise<UpdateErgebnis> {
  const jetzt = (deps.jetztMs ?? Date.now)()
  const mindestabstand = deps.mindestabstandMs ?? STANDARD_MINDESTABSTAND_MS

  if (!deps.optIn) {
    return leerErgebnis(deps.lokaleVersion)
  }

  let cache: UpdateCacheEintrag | null
  try {
    cache = await deps.speicher.lesen()
  } catch {
    cache = null // kaputter/fehlender Cache → wie „kein Cache" behandeln, nicht abstürzen
  }

  // Cache noch frisch → gar nicht erst fragen (spart Anfragen, GitHub-Rate-Limit-schonend).
  if (cache && jetzt - cache.geprueftAmMs < mindestabstand) {
    return { ...cache.letztesErgebnis, aktuelleVersion: deps.lokaleVersion }
  }

  try {
    const headers: Record<string, string> = { Accept: 'application/vnd.github+json' }
    if (cache?.etag) headers['If-None-Match'] = cache.etag

    const antwort = await deps.holer.fetch(RELEASES_URL, { headers })

    if (antwort.status === 304 && cache) {
      // Server bestätigt „nichts Neues" — Cache-Zeitstempel auffrischen, Ergebnis unverändert lassen.
      const neuesErgebnis = { ...cache.letztesErgebnis, aktuelleVersion: deps.lokaleVersion }
      await sicherSchreiben(deps.speicher, {
        geprueftAmMs: jetzt,
        etag: cache.etag,
        letztesErgebnis: neuesErgebnis
      })
      return neuesErgebnis
    }

    if (antwort.status !== 200) {
      // Rate-Limit (403/429) oder sonstiger Fehlstatus → still „kein Update", aber NICHT als Cache
      // festschreiben (nächster Start darf es erneut versuchen, sobald das Limit zurückgesetzt ist).
      return leerErgebnis(deps.lokaleVersion)
    }

    const body = await antwort.json()
    if (!istGithubRelease(body) || typeof body.tag_name !== 'string') {
      return leerErgebnis(deps.lokaleVersion)
    }

    const remoteVersion = body.tag_name
    const url = typeof body.html_url === 'string' ? body.html_url : ''
    const neuVerfuegbar = istNeuerIntern(remoteVersion, deps.lokaleVersion)
    const ergebnis: UpdateErgebnis = {
      aktuelleVersion: deps.lokaleVersion,
      neuVerfuegbar,
      url: neuVerfuegbar ? url : ''
    }

    const etag = antwort.headers.get('etag') ?? undefined
    await sicherSchreiben(deps.speicher, { geprueftAmMs: jetzt, etag, letztesErgebnis: ergebnis })

    return ergebnis
  } catch {
    // Netzfehler (DNS/offline/Timeout) oder kaputtes JSON (antwort.json() wirft) → still, kein Absturz.
    return leerErgebnis(deps.lokaleVersion)
  }
}

async function sicherSchreiben(speicher: UpdateCacheSpeicher, eintrag: UpdateCacheEintrag): Promise<void> {
  try {
    await speicher.schreiben(eintrag)
  } catch {
    // Cache-Schreibfehler (voll/Rechte) darf die Prüfung selbst nicht scheitern lassen — beim nächsten
    // Start wird einfach erneut gefragt.
  }
}

