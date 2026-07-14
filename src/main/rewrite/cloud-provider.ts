// Umschreiben über OpenAI Chat Completions (ADR-0001), hinter dem RewriteProvider-Interface.
// fetch + Key injizierbar → ohne echtes Netz testbar. Treue Portierung von LLMService.swift.
// Modell/Temperatur kommen vom Aufrufer (gpt-4o-mini@0.3 improve/emoji, gpt-4o@0.4 calm).

import { leseFehlerDetail, type AnbieterFehler } from '@main/workflow/fehler-klassifikation'
import { pruefeAnbieterUrlSicherheit } from '@shared/anbieter-url-guard'

export interface RewriteErgebnis {
  text: string
  /** Token-Verbrauch laut Anbieter (für die Kostenstatistik, Strang D); fehlt, wenn nicht geliefert. */
  usage?: { promptTokens: number; completionTokens: number }
  /**
   * true, wenn der Anbieter `finish_reason: 'length'` meldete (Token-Limit erreicht, Text abgeschnitten).
   * Der Runner behandelt das als Teil-Erfolg (grund='abgeschnitten') statt den Text als vollen Erfolg
   * einzufügen. Fehlt/false bei allen anderen finish_reason-Werten (inkl. fehlendem Feld, ältere/andere
   * Anbieter-Antworten) — Verhalten bleibt dort unverändert (W1-D).
   */
  abgeschnitten?: boolean
}

export interface RewriteProvider {
  rewrite(
    input: { system: string; user: string },
    opts: { model: string; temperature: number; signal?: AbortSignal }
  ): Promise<RewriteErgebnis>
}

const OPENAI_BASE_URL = 'https://api.openai.com/v1'

export function createCloudRewriteProvider(deps: {
  getApiKey: () => Promise<string | null>
  /** OpenAI-kompatible Base-URL OHNE Trailing-Slash; ohne Angabe = OpenAI (v1-Verhalten). */
  getBaseUrl?: () => string
  /** L1: erlaubt einen Lauf OHNE Key (key-loser lokaler Anbieter) → kein Authorization-Header. */
  erlaubeOhneKey?: () => boolean
  fetchFn?: typeof fetch
}): RewriteProvider {
  const fetchFn = deps.fetchFn ?? fetch
  const getBaseUrl = deps.getBaseUrl ?? (() => OPENAI_BASE_URL)

  return {
    async rewrite(input, opts) {
      const apiKey = await deps.getApiKey()
      if (!apiKey && !deps.erlaubeOhneKey?.()) {
        throw new Error('OpenAI API-Key fehlt. Bitte in den Einstellungen hinterlegen.')
      }

      // F2 (Security-Review P1): Hart-Block VOR dem Key-tragenden fetch — http zu einem fremden Host
      // würde den Bearer-Key im Klartext senden. localhost/127.0.0.1/::1 mit http bleibt erlaubt
      // (lokales ASR/Chat). Der Fehler trägt .status=400 → Fehler-Art 'konfiguration' (kein Retry).
      pruefeAnbieterUrlSicherheit(getBaseUrl())

      let response: Response
      try {
        response = await fetchFn(`${getBaseUrl()}/chat/completions`, {
          method: 'POST',
          headers: apiKey
            ? { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }
            : { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: opts.model,
            temperature: opts.temperature,
            messages: [
              { role: 'system', content: input.system },
              { role: 'user', content: input.user }
            ]
          }),
          signal: opts.signal
        })
      } catch (cause) {
        // Abbruch/Timeout unverändert weiterreichen, damit der Aufrufer (Reducer) sie klassifizieren kann.
        if (cause instanceof Error && (cause.name === 'AbortError' || cause.name === 'TimeoutError')) {
          throw cause
        }
        // Transport-Fehler (DNS/offline/Verbindung) — klare deutsche Meldung statt roher TypeError.
        const fehler = new Error(
          'Netzwerkfehler: Keine Verbindung zu OpenAI. Bitte Internetverbindung prüfen.',
          { cause }
        ) as AnbieterFehler
        fehler.transport = true // Transport-/Verbindungsfehler → Fehler-Art netzwerk
        throw fehler
      }

      const raw = await response.text()

      if (response.status !== 200) {
        // Anbieterneutrales Präfix (Mehr-Anbieter). Fehler-Body verschachtelt (OpenAI: error.message)
        // ODER FLACH (Mistral: message; manche: detail) — beide Formen lesen, sonst geht z. B. die
        // „Invalid model"-Ursache bei Mistral/Groq verloren und es bliebe nur „Status 400".
        let message = `KI-Fehler: Status ${response.status}`
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
          if (detail) message = `KI-Fehler: ${detail}`
          providerCode = parsed.error?.code ?? parsed.error?.type ?? parsed.code ?? parsed.type
        } catch {
          // kein JSON-Fehlerkörper
        }
        const fehler = new Error(message) as AnbieterFehler
        fehler.status = response.status
        if (providerCode) fehler.providerCode = providerCode
        throw fehler
      }

      let content = ''
      let refusal: string | undefined
      let finishReason: string | undefined
      let usage: RewriteErgebnis['usage']
      try {
        const parsed = JSON.parse(raw) as {
          choices?: {
            message?: { content?: string | null; refusal?: string | null }
            finish_reason?: string
          }[]
          usage?: { prompt_tokens?: number; completion_tokens?: number }
        }
        const choice = parsed.choices?.[0]
        content = (choice?.message?.content ?? '').trim()
        refusal = choice?.message?.refusal ?? undefined
        finishReason = choice?.finish_reason
        if (parsed.usage) {
          usage = {
            promptTokens: parsed.usage.prompt_tokens ?? 0,
            completionTokens: parsed.usage.completion_tokens ?? 0
          }
        }
      } catch {
        // ungültiger Body — als leere Antwort behandeln
      }

      // Content-Filter mancher Anbieter (Status 200, aber `message.refusal` gesetzt bzw. `content: null`
      // ohne jeden Text): kein transientes Problem, also kein sinnloser Netzwerk-Retry — klarer,
      // anbieter-klassifizierter Fehler (kein .status/.transport → klassifiziere() liefert 'anbieter').
      // Den refusal-Text NICHT wörtlich in die Meldung übernehmen (kann ein Injection-Echo sein) — nur
      // als Grund benennen, dass der Anbieter abgelehnt hat.
      if (content === '') {
        if (refusal) {
          throw new Error(
            'KI-Fehler: Der Anbieter hat die Anfrage abgelehnt (Inhaltsfilter). Bitte den Text prüfen oder einen anderen Workflow versuchen.'
          )
        }
        throw new Error('Keine Antwort erhalten. Bitte nochmal versuchen.')
      }

      // finish_reason:'length' = Token-Limit erreicht, Text abgeschnitten. Trotzdem den (unvollständigen)
      // Text zurückgeben — der Runner entscheidet, rettet ihn als Teil-Erfolg statt Totalverlust.
      const abgeschnitten = finishReason === 'length' ? true : undefined
      return { text: content, usage, abgeschnitten }
    }
  }
}
