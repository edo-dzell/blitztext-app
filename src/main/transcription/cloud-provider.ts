// Cloud-Transkription über einen OpenAI-kompatiblen Anbieter (ADR-0001/0008), hinter dem
// TranscriptionProvider-Interface (Naht für lokale/andere Anbieter). fetch + Key + Provider-Config
// sind injizierbar → ohne echtes Netz testbar. Treue Portierung von TranscriptionService.swift.
//
// V2 (Strang B): Base-URL + Modell kommen aus der aktiven Provider-Config (getConfig). Default ist
// exakt v1: OpenAI/whisper-1 → byte-identische URL + response_format=text.

import { asrUnterstuetztTextFormat } from '@shared/providers'
import { leseFehlerDetail, type AnbieterFehler } from '@main/workflow/fehler-klassifikation'
import { pruefeAnbieterUrlSicherheit } from '@shared/anbieter-url-guard'
import { asrPromptText, begriffeFuerAsrPrompt } from '@shared/begriffe'

export interface TranscribeOptions {
  language?: string
  vocabularyHints?: string[]
  /** Abbruch-Signal; wird an fetch durchgereicht. AbortError/TimeoutError werden unverändert geworfen. */
  signal?: AbortSignal
}

export interface TranscriptionProvider {
  transcribe(audio: Blob, options?: TranscribeOptions): Promise<string>
}

export interface TranscriptionConfig {
  /** OpenAI-kompatible Base-URL OHNE Trailing-Slash. */
  baseUrl: string
  model: string
}

const OPENAI_DEFAULT: TranscriptionConfig = {
  baseUrl: 'https://api.openai.com/v1',
  model: 'whisper-1'
}

// Größen-Guard (W1-F): OpenAI-kompatible ASR-Endpunkte limitieren Uploads auf ~25 MB (OpenAI-Doku).
// 24 MB Sicherheitsmarge (statt exakt 25 MB) fängt Rundungs-/Encoding-Overhead ab, bevor der Anbieter
// mit einem 4xx antwortet. Der Guard prüft VOR dem fetch → sofortiger, klarer Fehler statt langem
// Upload-Warten + kryptischer Server-Meldung. Exportiert, damit Tests eine kleine Grenze injizieren können.
export const MAX_UPLOAD_BYTES = 24 * 1024 * 1024

// Fetch-Timeout (W1-F): der Runner-Watchdog (90 s, runner.ts) ist der Backstop für JEDEN hängenden
// Anbieter-Aufruf und klassifiziert bewusst als 'anbieter' (nicht wiederholbar — siehe
// fehler-klassifikation.ts). Ein eigener, KÜRZERER Provider-Timeout liegt darunter, damit ein
// stockender Verbindungsaufbau/Transfer VOR dem Watchdog als Transport-/Verbindungsfehler auffällt
// (`.transport = true` → Fehler-Art 'netzwerk', wiederholbar via mitRetry) statt erst nach 90 s als
// nicht wiederholbarer Anbieter-Fehler zu enden. 60 s lässt große Uploads (bis MAX_UPLOAD_BYTES) auf
// langsamen Leitungen zu und bleibt trotzdem deutlich unter den 90 s des Watchdogs.
export const DEFAULT_FETCH_TIMEOUT_MS = 60_000

export function createCloudTranscriptionProvider(deps: {
  getApiKey: () => Promise<string | null>
  /** Aktive Provider-Config; ohne Angabe = OpenAI/whisper-1 (v1-Verhalten). */
  getConfig?: () => TranscriptionConfig
  /** L1: erlaubt einen Lauf OHNE Key (key-loser lokaler Anbieter) → kein Authorization-Header. */
  erlaubeOhneKey?: () => boolean
  fetchFn?: typeof fetch
  /** Obergrenze für die Audio-Blob-Größe; Default MAX_UPLOAD_BYTES. Injizierbar für Tests. */
  maxUploadBytes?: number
  /** Eigener Fetch-Timeout in ms; Default DEFAULT_FETCH_TIMEOUT_MS. Injizierbar für Tests. */
  fetchTimeoutMs?: number
}): TranscriptionProvider {
  const fetchFn = deps.fetchFn ?? fetch
  const getConfig = deps.getConfig ?? (() => OPENAI_DEFAULT)
  const maxUploadBytes = deps.maxUploadBytes ?? MAX_UPLOAD_BYTES
  const fetchTimeoutMs = deps.fetchTimeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS

  return {
    async transcribe(audio, options = {}) {
      const apiKey = await deps.getApiKey()
      if (!apiKey && !deps.erlaubeOhneKey?.()) {
        throw new Error('OpenAI API-Key fehlt. Bitte in den Einstellungen hinterlegen.')
      }

      if (audio.size > maxUploadBytes) {
        // Bewusst OHNE .status/.transport: die Fehler-Klassifikation (fehler-klassifikation.ts)
        // kennt Fehler-Art 'aufnahme' nur als Urteil des Runners (zu kurz/Artefakt) und leitet sie
        // nie aus strukturierten Feldern ab. Ein "nackter" Error ohne diese Felder landet dort
        // deterministisch auf 'anbieter' — NICHT auf 'netzwerk' (kein sinnloser Retry einer Datei,
        // die so oder so zu groß bleibt) und nicht auf 'konfiguration' (kein Einrichtungsfehler).
        throw new Error(
          'Diktat zu lang für die Übertragung. Bitte kürzer aufnehmen oder in Abschnitten diktieren.'
        )
      }

      const { baseUrl, model } = getConfig()

      // F2 (Security-Review P1): Hart-Block VOR dem Key-tragenden fetch — http zu einem fremden Host
      // würde den Bearer-Key im Klartext senden. localhost/127.0.0.1/::1 mit http bleibt erlaubt
      // (lokales ASR). Der Fehler trägt .status=400 → Fehler-Art 'konfiguration' (kein Retry).
      pruefeAnbieterUrlSicherheit(baseUrl)

      const textFormat = asrUnterstuetztTextFormat(model)

      const form = new FormData()
      form.append('file', audio, 'audio.webm')
      form.append('model', model)
      // Whisper-Familie kann response_format=text; andere (gpt-4o-transcribe*, Voxtral) nur JSON.
      form.append('response_format', textFormat ? 'text' : 'json')
      if (options.language && options.language.trim() !== '') {
        form.append('language', options.language.trim())
      }
      // Terms-Kern: Budget-Guard (Whisper schneidet den prompt-Parameter serverseitig still ab)
      // + Normalisierung liegen in @shared/begriffe, EINE Quelle für alle Aufrufer.
      const promptText = asrPromptText(begriffeFuerAsrPrompt(options.vocabularyHints ?? []))
      if (promptText) form.append('prompt', promptText)

      // Eigener Fetch-Timeout (W1-F, unter dem 90s-Runner-Watchdog): kombiniert mit einem etwaig
      // durchgereichten Abbruch-Signal (Nutzer-Abbruch oder Watchdog des Aufrufers), sodass BEIDE
      // Gründe weiter abbrechen können. `internTimeout.signal` feuert NUR bei unserem eigenen Timer.
      const internTimeout = new AbortController()
      const timeoutTimer = setTimeout(
        () => internTimeout.abort(new DOMException('Zeitüberschreitung.', 'TimeoutError')),
        fetchTimeoutMs
      )
      const combinedSignal = options.signal
        ? AbortSignal.any([options.signal, internTimeout.signal])
        : internTimeout.signal

      let response: Response
      try {
        response = await fetchFn(`${baseUrl}/audio/transcriptions`, {
          method: 'POST',
          headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
          body: form,
          signal: combinedSignal
        })
      } catch (cause) {
        // Unser EIGENER Timeout ist erkennbar an internTimeout.signal.aborted — von einem durchgereichten
        // Nutzer-Abbruch/Watchdog-Timeout des Aufrufers unterscheiden (der unverändert weiterfliegt).
        if (internTimeout.signal.aborted && !(options.signal?.aborted ?? false)) {
          // NICHT als 'TimeoutError' weiterreichen: der Runner (runner.ts) behandelt JEDEN
          // TimeoutError als Watchdog-Timeout → Fehler-Art 'anbieter' (nicht wiederholbar). Unser
          // Timeout liegt bewusst UNTER dem Watchdog und soll als Transport-/Verbindungsfehler
          // gelten → Fehler-Art 'netzwerk', damit der bestehende Retry (mitRetry) greift.
          const fehler = new Error(
            'Netzwerkfehler: Zeitüberschreitung bei der Übertragung zum Anbieter.',
            { cause }
          ) as AnbieterFehler
          fehler.transport = true
          throw fehler
        }
        // Abbruch/Timeout des AUFRUFERS (Nutzer-Abbruch oder dessen Watchdog) unverändert weiterreichen,
        // damit der Aufrufer (Reducer) sie klassifizieren kann.
        if (cause instanceof Error && (cause.name === 'AbortError' || cause.name === 'TimeoutError')) {
          throw cause
        }
        // Transport-Fehler (DNS/offline/Verbindung) — klare deutsche Meldung statt roher TypeError.
        const fehler = new Error(
          'Netzwerkfehler: Keine Verbindung zum Anbieter. Bitte Internetverbindung prüfen.',
          { cause }
        ) as AnbieterFehler
        fehler.transport = true // Transport-/Verbindungsfehler → Fehler-Art netzwerk
        throw fehler
      } finally {
        clearTimeout(timeoutTimer)
      }

      const raw = await response.text()
      if (response.status !== 200) {
        // Fehler-Body verschachtelt (OpenAI: error.message) ODER flach (Mistral: message/detail) — beide lesen.
        let message = `Anbieter-Fehler: Status ${response.status}`
        let providerCode: string | undefined
        try {
          const parsed = JSON.parse(raw) as {
            error?: { message?: string; code?: string; type?: string }
            message?: string
            detail?: unknown
            code?: string
            type?: string
          }
          const detail = leseFehlerDetail(parsed)
          if (detail) message = `Anbieter-Fehler: ${detail}`
          providerCode = parsed.error?.code ?? parsed.error?.type ?? parsed.code ?? parsed.type
        } catch {
          // kein JSON-Fehlerkörper — Status-Meldung bleibt
        }
        const fehler = new Error(message) as AnbieterFehler
        fehler.status = response.status
        if (providerCode) fehler.providerCode = providerCode
        throw fehler
      }

      if (textFormat) return raw.trim()
      // JSON-Antwort: das `text`-Feld extrahieren (OpenAI-kompatibel: { text: "…" }).
      try {
        const parsed = JSON.parse(raw) as { text?: string }
        return (parsed.text ?? '').trim()
      } catch {
        return raw.trim()
      }
    }
  }
}
