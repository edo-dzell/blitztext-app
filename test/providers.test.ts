import { describe, it, expect } from 'vitest'
import {
  PROVIDER,
  getProvider,
  asrUnterstuetztTextFormat,
  asrBegriffeFeld,
  modelleFuerVorlage
} from '@shared/providers'

describe('Provider-Registry', () => {
  it('enthält OpenAI, Groq, Mistral, lokal und custom', () => {
    expect(PROVIDER.map((p) => p.id)).toEqual(['openai', 'groq', 'mistral', 'lokal', 'custom'])
  })

  it('liefert per id den Descriptor, sonst undefined', () => {
    expect(getProvider('openai')?.baseUrl).toBe('https://api.openai.com/v1')
    expect(getProvider('groq')?.baseUrl).toBe('https://api.groq.com/openai/v1')
    expect(getProvider('unbekannt')).toBeUndefined()
  })

  it('Base-URLs haben keinen Trailing-Slash (außer custom = leer)', () => {
    for (const p of PROVIDER) {
      if (p.anpassbar) continue
      expect(p.baseUrl.endsWith('/')).toBe(false)
      expect(p.baseUrl).not.toBe('')
    }
  })

  it('custom ist anpassbar und hat leere Felder', () => {
    const custom = getProvider('custom')!
    expect(custom.anpassbar).toBe(true)
    expect(custom.baseUrl).toBe('')
    expect(custom.asrModelle).toEqual([])
  })

  it('asrUnterstuetztTextFormat: nur Whisper-Familie kann response_format=text', () => {
    expect(asrUnterstuetztTextFormat('whisper-1')).toBe(true)
    expect(asrUnterstuetztTextFormat('whisper-large-v3')).toBe(true)
    expect(asrUnterstuetztTextFormat('whisper-large-v3-turbo')).toBe(true)
    expect(asrUnterstuetztTextFormat('gpt-4o-transcribe')).toBe(false)
    expect(asrUnterstuetztTextFormat('voxtral-mini-latest')).toBe(false)
  })

  // --- B1: Mistral/Voxtral kennt kein `prompt`-Feld — Begriffe müssen ins Feld `context_bias` ---
  it('asrBegriffeFeld: Voxtral bekommt context_bias, alle anderen (Default) prompt', () => {
    expect(asrBegriffeFeld('voxtral-mini-latest')).toBe('context_bias')
    expect(asrBegriffeFeld('whisper-1')).toBe('prompt')
    expect(asrBegriffeFeld('whisper-large-v3-turbo')).toBe('prompt')
    expect(asrBegriffeFeld('gpt-4o-transcribe')).toBe('prompt')
    expect(asrBegriffeFeld('gpt-4o-mini-transcribe')).toBe('prompt')
    expect(asrBegriffeFeld('Systran/faster-whisper-small')).toBe('prompt')
  })

  // --- v0.2.4 #20: Modell-Registry-Mapping für die Editor-Dropdowns ---
  it('modelleFuerVorlage liefert ASR- + Chat-Modelle des Anbieters', () => {
    const openai = modelleFuerVorlage('openai')
    expect(openai.asr.map((m) => m.id)).toContain('whisper-1')
    expect(openai.chat.map((m) => m.id)).toContain('gpt-4o-mini')
  })

  it('modelleFuerVorlage: unbekannte/eigene Vorlage → leere Listen', () => {
    expect(modelleFuerVorlage('custom')).toEqual({ asr: [], chat: [] })
    expect(modelleFuerVorlage('unbekannt')).toEqual({ asr: [], chat: [] })
  })

  // --- S4: lokales ASR als eigene Vorlage (kein API-Key nötig, kein Bundling) ---

  it("'lokal' ist vorhanden, anpassbar und ohne Preis-Angabe (keine Kostenschätzung für lokal)", () => {
    const lokal = getProvider('lokal')!
    expect(lokal).toBeDefined()
    expect(lokal.anpassbar).toBe(true)
    expect(lokal.baseUrl).toBe('http://localhost:8000/v1')
    expect(lokal.keyHinweis).toMatch(/kein api-key/i)
    expect(lokal.chatModelle).toEqual([])
    expect(lokal.asrModelle).toEqual([
      { id: 'Systran/faster-whisper-small', label: 'faster-whisper small', empfohlen: true }
    ])
    for (const modell of [...lokal.asrModelle, ...lokal.chatModelle]) {
      expect(modell.preis).toBeUndefined()
    }
  })

  it("modelleFuerVorlage('lokal') liefert das faster-whisper-Modell, keine Chat-Modelle", () => {
    const { asr, chat } = modelleFuerVorlage('lokal')
    expect(asr.map((m) => m.id)).toEqual(['Systran/faster-whisper-small'])
    expect(chat).toEqual([])
  })
})
