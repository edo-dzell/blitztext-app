import { describe, it, expect } from 'vitest'
import { preisModellListen } from '@renderer/lib/preis-modelle'
import type { AnbieterKonfig } from '@shared/anbieter'

const anbieter = (
  vorlage: string,
  extra: Partial<AnbieterKonfig> = {}
): AnbieterKonfig => ({
  id: vorlage,
  vorlage,
  label: vorlage,
  baseUrl: '',
  asrModell: '',
  chatModell: '',
  ...extra
})

describe('preisModellListen', () => {
  it('ohne Anbieter: nur die PREISE-Defaults (OpenAI/Groq/Mistral), nach ASR/Chat getrennt', () => {
    const { asr, chat } = preisModellListen()
    expect(asr).toContain('whisper-1')
    expect(asr).toContain('whisper-large-v3-turbo')
    expect(chat).toContain('gpt-4o-mini')
    expect(chat).toContain('llama-3.3-70b-versatile')
    // Mistral hat jetzt eigene PREISE-Defaults (PEN-2) → erscheint unabhängig davon,
    // ob ein Mistral-Anbieter konfiguriert ist.
    expect(chat).toContain('mistral-small-latest')
    expect(asr).toContain('voxtral-mini-latest')
  })

  it('mit Mistral-Anbieter: dessen Katalog-Modelle erscheinen (der eigentliche Fix)', () => {
    const { asr, chat } = preisModellListen([anbieter('mistral')])
    expect(asr).toContain('voxtral-mini-latest')
    expect(chat).toContain('mistral-small-latest')
    expect(chat).toContain('mistral-large-latest')
    // Defaults bleiben zusätzlich erhalten (auch ohne Mistral-Anbieter, s.o.)
    expect(chat).toContain('gpt-4o-mini')
  })

  it('custom-Anbieter: frei eingetragene Modelle werden mitgenommen', () => {
    const { asr, chat } = preisModellListen([
      anbieter('custom', { asrModell: 'mein-asr', chatModell: 'mein-chat' })
    ])
    expect(asr).toContain('mein-asr')
    expect(chat).toContain('mein-chat')
  })

  it('bestehende Override-Keys werden nach gesetztem Feld eingeordnet', () => {
    const { asr, chat } = preisModellListen([], {
      'fremd-asr': { asrProMinuteUsd: 0.01 },
      'fremd-chat': { inputPro1MUsd: 1, outputPro1MUsd: 2 }
    })
    expect(asr).toContain('fremd-asr')
    expect(chat).toContain('fremd-chat')
  })

  it('keine Duplikate, wenn ein Anbieter-Modell schon in PREISE steht', () => {
    const { chat } = preisModellListen([anbieter('openai')])
    expect(chat.filter((id) => id === 'gpt-4o-mini')).toHaveLength(1)
  })
})
