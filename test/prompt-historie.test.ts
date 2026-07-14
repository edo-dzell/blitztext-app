import { describe, it, expect } from 'vitest'
import {
  mitNeuemPrompt,
  findePromptVersion,
  historieNachSpeichern,
  PROMPT_HISTORIE_MAX,
  type PromptVersion
} from '@shared/workflows'

function v(id: string, text = 't' + id): PromptVersion {
  return { id, zeitstempelMs: Number(id) || 0, text, quelle: 'manuell' }
}

describe('Prompt-Historie', () => {
  it('mitNeuemPrompt hängt vorne an (neueste zuerst), non-destruktiv', () => {
    const h1 = mitNeuemPrompt(undefined, v('1'))
    const h2 = mitNeuemPrompt(h1, v('2'))
    expect(h2.map((x) => x.id)).toEqual(['2', '1'])
    expect(h1.map((x) => x.id)).toEqual(['1']) // Original unverändert
  })

  it('deckelt auf das Maximum (älteste fallen raus)', () => {
    let h: PromptVersion[] = []
    for (let i = 0; i < PROMPT_HISTORIE_MAX + 5; i++) h = mitNeuemPrompt(h, v(String(i)))
    expect(h).toHaveLength(PROMPT_HISTORIE_MAX)
    expect(h[0]!.id).toBe(String(PROMPT_HISTORIE_MAX + 4)) // neueste vorn
  })

  it('findePromptVersion findet per id, sonst undefined', () => {
    const h = mitNeuemPrompt(mitNeuemPrompt(undefined, v('1')), v('2'))
    expect(findePromptVersion(h, '1')?.text).toBe('t1')
    expect(findePromptVersion(h, 'x')).toBeUndefined()
    expect(findePromptVersion(undefined, '1')).toBeUndefined()
  })
})

describe('historieNachSpeichern (R3/#26)', () => {
  const neu = v('99', 'neu')
  it('hängt an, wenn statischer Prompt sich geändert hat', () => {
    const r = historieNachSpeichern(
      { systemPrompt: 'alt' },
      { promptModus: 'statisch', systemPrompt: 'neuer text', promptHistorie: undefined },
      neu
    )
    expect(r?.map((x) => x.id)).toEqual(['99'])
  })
  it('hängt NICHT an, wenn unverändert', () => {
    const r = historieNachSpeichern(
      { systemPrompt: 'gleich' },
      { promptModus: 'statisch', systemPrompt: 'gleich', promptHistorie: [v('1')] },
      neu
    )
    expect(r?.map((x) => x.id)).toEqual(['1'])
  })
  it('hängt NICHT an bei berechnetem Prompt', () => {
    const r = historieNachSpeichern(
      { systemPrompt: '' },
      { promptModus: 'berechnet', systemPrompt: '', promptHistorie: undefined },
      neu
    )
    expect(r).toBeUndefined()
  })
  it('hängt NICHT an bei leerem statischem Prompt', () => {
    const r = historieNachSpeichern(
      { systemPrompt: 'x' },
      { promptModus: 'statisch', systemPrompt: '   ', promptHistorie: undefined },
      neu
    )
    expect(r).toBeUndefined()
  })
  it('deckelt beim Anhängen', () => {
    let h: PromptVersion[] = []
    for (let i = 0; i < PROMPT_HISTORIE_MAX; i++) h = mitNeuemPrompt(h, v(String(i)))
    const r = historieNachSpeichern(
      { systemPrompt: 'alt' },
      { promptModus: 'statisch', systemPrompt: 'ganz neu', promptHistorie: h },
      neu
    )
    expect(r).toHaveLength(PROMPT_HISTORIE_MAX)
    expect(r?.[0]!.id).toBe('99')
  })
})
