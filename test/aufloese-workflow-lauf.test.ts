import { describe, it, expect } from 'vitest'
import {
  aufloeseWorkflowLauf,
  chatModellAufloesung,
  findeAnbieter,
  type AnbieterKonfig
} from '@shared/anbieter'
import { BUILTIN_WORKFLOWS, getWorkflow } from '@shared/workflows'

const OPENAI: AnbieterKonfig = {
  id: 'openai',
  vorlage: 'openai',
  label: 'OpenAI',
  baseUrl: 'https://api.openai.com/v1',
  asrModell: 'whisper-1',
  chatModell: 'gpt-4o-mini'
}
const GROQ: AnbieterKonfig = {
  id: 'groq',
  vorlage: 'groq',
  label: 'Groq',
  baseUrl: 'https://api.groq.com/openai/v1',
  asrModell: 'whisper-large-v3-turbo',
  chatModell: 'llama-3.1-8b-instant'
}

describe('aufloeseWorkflowLauf', () => {
  it('nimmt den gepinnten Workflow-Anbieter (Override vor Standard)', () => {
    const w = { anbieterId: 'groq', model: 'eigenes-modell', temperature: 0.7 }
    const lauf = aufloeseWorkflowLauf(w, {
      anbieter: [OPENAI, GROQ],
      standardAnbieterId: 'openai',
      language: 'de'
    })
    expect(lauf.anbieter.id).toBe('groq')
    expect(lauf.baseUrl).toBe('https://api.groq.com/openai/v1')
    expect(lauf.asrModell).toBe('whisper-large-v3-turbo')
    expect(lauf.chatModell).toBe('eigenes-modell') // Workflow-Modell schlägt Anbieter-Default
    expect(lauf.language).toBe('de')
  })

  it('erbt den Standard-Anbieter, wenn der Workflow keinen pinnt', () => {
    const lauf = aufloeseWorkflowLauf(
      { anbieterId: '', model: '', temperature: 0.3 },
      { anbieter: [OPENAI, GROQ], standardAnbieterId: 'groq', language: 'en' }
    )
    expect(lauf.anbieter.id).toBe('groq')
    expect(lauf.chatModell).toBe('llama-3.1-8b-instant') // model '' → Anbieter-Default
  })

  it('fällt auf den Standard-Anbieter zurück, wenn die anbieterId ins Leere zeigt (gelöscht)', () => {
    const lauf = aufloeseWorkflowLauf(
      { anbieterId: 'geloescht', model: '', temperature: 0 },
      { anbieter: [OPENAI], standardAnbieterId: 'openai', language: 'de' }
    )
    expect(lauf.anbieter.id).toBe('openai')
  })

  // --- BYTE-IDENTITÄTS-WÄCHTER: die vier Built-ins bei Werkseinstellungen (OpenAI-Default) ---
  it('löst die vier Built-ins byte-identisch zu v1 auf (Snapshot)', () => {
    const ctx = { anbieter: [OPENAI], standardAnbieterId: 'openai', language: 'de' }
    const snapshot = BUILTIN_WORKFLOWS.map((w) => {
      const l = aufloeseWorkflowLauf(w, ctx)
      return {
        id: w.id,
        anbieter: l.anbieter.id,
        baseUrl: l.baseUrl,
        asrModell: l.asrModell,
        chatModell: l.chatModell,
        temperature: l.temperature,
        language: l.language
      }
    })
    expect(snapshot).toEqual([
      { id: 'transcribe', anbieter: 'openai', baseUrl: 'https://api.openai.com/v1', asrModell: 'whisper-1', chatModell: 'gpt-4o-mini', temperature: 0, language: 'de' },
      { id: 'improve', anbieter: 'openai', baseUrl: 'https://api.openai.com/v1', asrModell: 'whisper-1', chatModell: 'gpt-4o-mini', temperature: 0.3, language: 'de' },
      { id: 'calm', anbieter: 'openai', baseUrl: 'https://api.openai.com/v1', asrModell: 'whisper-1', chatModell: 'gpt-4o', temperature: 0.4, language: 'de' },
      { id: 'emoji', anbieter: 'openai', baseUrl: 'https://api.openai.com/v1', asrModell: 'whisper-1', chatModell: 'gpt-4o-mini', temperature: 0.3, language: 'de' }
    ])
  })

  it('fällt auf das Anbieter-Standardmodell zurück, wenn ein FREMDES Modell gepinnt ist (kein Absturz)', () => {
    const MISTRAL: AnbieterKonfig = {
      id: 'mistral',
      vorlage: 'mistral',
      label: 'Mistral',
      baseUrl: 'https://api.mistral.ai/v1',
      asrModell: 'voxtral-mini-latest',
      chatModell: 'mistral-small-latest'
    }
    // 'gpt-4o-mini' (OpenAI-Modell) gegen Mistral → ungültig → Mistral-Standardmodell statt Absturz.
    const lauf = aufloeseWorkflowLauf(
      { anbieterId: 'mistral', model: 'gpt-4o-mini', temperature: 0.3 },
      { anbieter: [MISTRAL], standardAnbieterId: 'mistral', language: 'de' }
    )
    expect(lauf.chatModell).toBe('mistral-small-latest')
    expect(lauf.chatModellAbgewertet).toBe(true) // v0.4.5: still ersetzt → als Abwertung markiert
    // Ein frei eingegebenes (keiner Vorlage bekanntes) Modell bleibt dagegen respektiert.
    const frei = aufloeseWorkflowLauf(
      { anbieterId: 'mistral', model: 'mein-eigenes-modell', temperature: 0.3 },
      { anbieter: [MISTRAL], standardAnbieterId: 'mistral', language: 'de' }
    )
    expect(frei.chatModell).toBe('mein-eigenes-modell')
    expect(frei.chatModellAbgewertet).toBe(false) // eigenes Modell = keine Abwertung
  })

  it('Built-ins bleiben auf OpenAI gepinnt, auch wenn der Standard auf Groq wechselt', () => {
    const ctx = { anbieter: [OPENAI, GROQ], standardAnbieterId: 'groq', language: 'de' }
    const calm = aufloeseWorkflowLauf(getWorkflow('calm', BUILTIN_WORKFLOWS), ctx)
    // calm pinnt anbieterId 'openai' UND model 'gpt-4o' → unverändert trotz Groq-Standard.
    expect(calm.anbieter.id).toBe('openai')
    expect(calm.chatModell).toBe('gpt-4o')
  })

  // --- A6/D9: Pro-Workflow-ASR-Override entfernt — das ASR-Modell kommt IMMER vom Anbieter ---
  it('Sprach-Override wirkt; das ASR-Modell kommt immer vom Anbieter (Override entfernt)', () => {
    const lauf = aufloeseWorkflowLauf(
      { anbieterId: '', model: '', temperature: 0.3, language: 'en' },
      { anbieter: [OPENAI], standardAnbieterId: 'openai', language: 'de' }
    )
    expect(lauf.language).toBe('en')
    expect(lauf.asrModell).toBe('whisper-1') // Anbieter-ASR, nicht (mehr) überschreibbar
  })

  it('leere Sprache erbt global; ASR vom Anbieter', () => {
    const lauf = aufloeseWorkflowLauf(
      { anbieterId: '', model: '', temperature: 0.3, language: '' },
      { anbieter: [OPENAI], standardAnbieterId: 'openai', language: 'de' }
    )
    expect(lauf.language).toBe('de')
    expect(lauf.asrModell).toBe('whisper-1')
  })
})

describe('chatModellAufloesung (v0.4.5 Ehrlichkeit)', () => {
  const MISTRAL: AnbieterKonfig = {
    id: 'mistral',
    vorlage: 'mistral',
    label: 'Mistral',
    baseUrl: 'https://api.mistral.ai/v1',
    asrModell: 'voxtral-mini-latest',
    chatModell: 'mistral-small-latest'
  }
  it('leeres Modell → Anbieter-Standard, NICHT abgewertet', () => {
    expect(chatModellAufloesung('', MISTRAL)).toEqual({ modell: 'mistral-small-latest', abgewertet: false })
  })
  it('eigenes/unbekanntes Modell bleibt respektiert, NICHT abgewertet', () => {
    expect(chatModellAufloesung('mein-modell', MISTRAL)).toEqual({ modell: 'mein-modell', abgewertet: false })
  })
  it('fremdes (anderem Anbieter bekanntes) Modell → Standard UND abgewertet=true', () => {
    expect(chatModellAufloesung('gpt-4o-mini', MISTRAL)).toEqual({
      modell: 'mistral-small-latest',
      abgewertet: true
    })
  })
  it('eigenes Vorlagen-Modell bleibt, NICHT abgewertet', () => {
    expect(chatModellAufloesung('mistral-large-latest', MISTRAL)).toEqual({
      modell: 'mistral-large-latest',
      abgewertet: false
    })
  })
})

describe('findeAnbieter', () => {
  it('findet nach id, sonst undefined', () => {
    expect(findeAnbieter([OPENAI, GROQ], 'groq')?.id).toBe('groq')
    expect(findeAnbieter([OPENAI], 'fehlt')).toBeUndefined()
  })
})
