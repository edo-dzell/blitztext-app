// Kuratierte Registry OpenAI-kompatibler Anbieter (ADR-0008, V2 Strang B). Framework-unabhängige
// Domänendaten — Main, Preload, Renderer und Tests teilen dieselbe Quelle. Ein aktiver Anbieter
// liefert BEIDES: Transkription (ASR) UND Umschreiben (Chat), über eine OpenAI-kompatible Base-URL.
//
// Recherche-bestätigt (Stand 2026-06): exakte baseUrls, Modellnamen, Endpoint-Form.
// `response_format=text` unterstützt nur die Whisper-Familie; gpt-4o-transcribe* und Voxtral nur JSON
// (der TranscriptionProvider verzweigt automatisch anhand des Modellnamens).
//
// D3 (Strang-Konsolidierung): Preise leben als Daten HIER an der Registry (je Modell optional
// `preis`); pricing.ts generiert daraus PREISE (`preiseAusProvidernAbleiten`) statt einer separat
// gepflegten Tabelle → kein Drift zwischen „welche Modelle gibt es" und „was kosten sie". providers.ts
// importiert bewusst NICHTS aus pricing.ts (Abhängigkeitsrichtung: pricing → providers).

/** Preis-Angaben für ein Modell (ASR pro Minute bzw. Chat pro 1 Mio. Token; alle Felder optional). */
export interface ModellPreis {
  /** ASR-Preis pro Audiominute (USD). */
  asrProMinuteUsd?: number
  /** Chat-Preis pro 1 Mio. Input-Token (USD). */
  inputPro1MUsd?: number
  /** Chat-Preis pro 1 Mio. Output-Token (USD). */
  outputPro1MUsd?: number
}

export interface ModellInfo {
  id: string
  label: string
  empfohlen?: boolean
  /** Preis-Schätzung (USD), sofern recherchiert. Quelle für die generierte PREISE-Tabelle (pricing.ts). */
  preis?: ModellPreis
}

export interface ProviderDescriptor {
  id: string
  label: string
  /** OpenAI-kompatible Base-URL OHNE Trailing-Slash (z. B. 'https://api.openai.com/v1'). */
  baseUrl: string
  asrModelle: ModellInfo[]
  chatModelle: ModellInfo[]
  keyHinweis: string
  docsUrl?: string
  /** true = Nutzer trägt Base-URL/Modelle frei ein ('custom'). */
  anpassbar?: boolean
}

export const PROVIDER: readonly ProviderDescriptor[] = [
  {
    id: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    // Preise: Transcribe-Preise als Minuten-Näherung — die ganze Tabelle ist eine Schätzung (USD).
    asrModelle: [
      { id: 'whisper-1', label: 'Whisper v1', empfohlen: true, preis: { asrProMinuteUsd: 0.006 } },
      {
        id: 'gpt-4o-transcribe',
        label: 'GPT-4o Transcribe',
        preis: { asrProMinuteUsd: 0.006 }
      },
      {
        id: 'gpt-4o-mini-transcribe',
        label: 'GPT-4o mini Transcribe',
        preis: { asrProMinuteUsd: 0.003 }
      }
    ],
    chatModelle: [
      {
        id: 'gpt-4o-mini',
        label: 'GPT-4o mini',
        empfohlen: true,
        preis: { inputPro1MUsd: 0.15, outputPro1MUsd: 0.6 }
      },
      { id: 'gpt-4o', label: 'GPT-4o', preis: { inputPro1MUsd: 2.5, outputPro1MUsd: 10.0 } }
    ],
    keyHinweis: 'sk-…',
    docsUrl: 'https://platform.openai.com/api-keys'
  },
  {
    id: 'groq',
    label: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    // Preise: Audio pro Stunde → pro Minute umgerechnet.
    asrModelle: [
      {
        id: 'whisper-large-v3-turbo',
        label: 'Whisper large v3 turbo',
        empfohlen: true,
        preis: { asrProMinuteUsd: 0.04 / 60 }
      },
      { id: 'whisper-large-v3', label: 'Whisper large v3', preis: { asrProMinuteUsd: 0.111 / 60 } }
    ],
    chatModelle: [
      {
        id: 'llama-3.1-8b-instant',
        label: 'Llama 3.1 8B instant',
        empfohlen: true,
        preis: { inputPro1MUsd: 0.05, outputPro1MUsd: 0.08 }
      },
      {
        id: 'llama-3.3-70b-versatile',
        label: 'Llama 3.3 70B versatile',
        preis: { inputPro1MUsd: 0.59, outputPro1MUsd: 0.79 }
      }
    ],
    keyHinweis: 'gsk_…',
    docsUrl: 'https://console.groq.com/keys'
  },
  {
    id: 'mistral',
    label: 'Mistral (Voxtral)',
    baseUrl: 'https://api.mistral.ai/v1',
    // Preise: Stand 2026-07, vor Rechnungsrelevanz prüfen. Quelle: https://mistral.ai/pricing/api/
    // 'latest'-Alias löst aktuell auf: mistral-small-latest → Mistral Small 4, mistral-large-latest →
    // Mistral Large 3, voxtral-mini-latest → Voxtral Mini Transcribe 2 (Transcriptions-Endpoint).
    asrModelle: [
      {
        id: 'voxtral-mini-latest',
        label: 'Voxtral mini',
        empfohlen: true,
        preis: { asrProMinuteUsd: 0.003 }
      }
    ],
    chatModelle: [
      {
        id: 'mistral-small-latest',
        label: 'Mistral Small',
        empfohlen: true,
        preis: { inputPro1MUsd: 0.15, outputPro1MUsd: 0.6 }
      },
      {
        id: 'mistral-large-latest',
        label: 'Mistral Large',
        preis: { inputPro1MUsd: 0.5, outputPro1MUsd: 1.5 }
      }
    ],
    keyHinweis: 'API-Key',
    docsUrl: 'https://console.mistral.ai/api-keys'
  },
  {
    id: 'custom',
    label: 'Eigener Anbieter (OpenAI-kompatibel)',
    baseUrl: '',
    asrModelle: [],
    chatModelle: [],
    keyHinweis: 'API-Key',
    anpassbar: true
  }
]

export function getProvider(id: string): ProviderDescriptor | undefined {
  return PROVIDER.find((p) => p.id === id)
}

/**
 * ASR- + Chat-Modelle der Registry-Vorlage eines Anbieters — für die Editor-Dropdowns (W-5/S-4).
 * Unbekannte/eigene Vorlage → leere Listen (der Nutzer trägt das Modell frei ein).
 */
export function modelleFuerVorlage(vorlage: string): { asr: ModellInfo[]; chat: ModellInfo[] } {
  const p = getProvider(vorlage)
  return { asr: p?.asrModelle ?? [], chat: p?.chatModelle ?? [] }
}

/**
 * Unterstützt das ASR-Modell `response_format=text`? Nur die Whisper-Familie (OpenAI whisper-1,
 * Groq whisper-large-v3*). gpt-4o-transcribe*, Voxtral und unbekannte Modelle → JSON anfordern und
 * das `text`-Feld parsen. Bewahrt das v1-Verhalten (whisper-1 → text, byte-identisch).
 */
export function asrUnterstuetztTextFormat(model: string): boolean {
  return model.startsWith('whisper')
}
