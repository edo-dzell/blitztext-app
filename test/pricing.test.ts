import { describe, it, expect } from 'vitest'
import {
  asrKostenUsd,
  chatKostenUsd,
  eurAus,
  laufKosten,
  EUR_PRO_USD,
  aufgelosteTabelle,
  zeileKostenUsd,
  PREISE,
  preiseAusProvidernAbleiten
} from '@shared/pricing'
import { PROVIDER } from '@shared/providers'

describe('pricing', () => {
  it('whisper-1: 0,006 USD pro Minute', () => {
    expect(asrKostenUsd('whisper-1', 60)).toBeCloseTo(0.006, 6)
    expect(asrKostenUsd('whisper-1', 30)).toBeCloseTo(0.003, 6)
  })

  it('gpt-4o-mini: Input/Output je 1M Token', () => {
    // 1M Input + 1M Output = 0.15 + 0.60
    expect(chatKostenUsd('gpt-4o-mini', 1_000_000, 1_000_000)).toBeCloseTo(0.75, 6)
  })

  it('gpt-4o: 2.50 / 10.00 pro 1M', () => {
    expect(chatKostenUsd('gpt-4o', 1_000_000, 0)).toBeCloseTo(2.5, 6)
    expect(chatKostenUsd('gpt-4o', 0, 1_000_000)).toBeCloseTo(10.0, 6)
  })

  it('groq whisper-large-v3-turbo: 0,04 USD/Stunde', () => {
    expect(asrKostenUsd('whisper-large-v3-turbo', 3600)).toBeCloseTo(0.04, 6)
  })

  it('moderne OpenAI-Transcribe-Modelle sind als Minuten-Näherung bepreist (#21)', () => {
    expect(asrKostenUsd('gpt-4o-mini-transcribe', 60)).toBeCloseTo(0.003, 6)
    expect(asrKostenUsd('gpt-4o-transcribe', 60)).toBeCloseTo(0.006, 6)
  })

  it('unbekanntes Modell → null (keine Schätzung)', () => {
    expect(asrKostenUsd('irgendwas-unbekanntes', 60)).toBeNull()
    expect(chatKostenUsd('irgendwas-unbekanntes', 1000, 1000)).toBeNull()
  })

  // --- v0.5.0 PEN-2: Mistral-Default-Preise (Quelle: https://mistral.ai/pricing/api/, Stand 2026-07) ---

  it('mistral-small-latest: 0.15 / 0.60 USD pro 1M (Mistral Small 4)', () => {
    expect(chatKostenUsd('mistral-small-latest', 1_000_000, 0)).toBeCloseTo(0.15, 6)
    expect(chatKostenUsd('mistral-small-latest', 0, 1_000_000)).toBeCloseTo(0.6, 6)
  })

  it('mistral-large-latest: 0.50 / 1.50 USD pro 1M (Mistral Large 3)', () => {
    expect(chatKostenUsd('mistral-large-latest', 1_000_000, 0)).toBeCloseTo(0.5, 6)
    expect(chatKostenUsd('mistral-large-latest', 0, 1_000_000)).toBeCloseTo(1.5, 6)
  })

  it('voxtral-mini-latest: 0.003 USD pro Minute (Voxtral Mini Transcribe 2)', () => {
    expect(asrKostenUsd('voxtral-mini-latest', 60)).toBeCloseTo(0.003, 6)
    expect(asrKostenUsd('voxtral-mini-latest', 30)).toBeCloseTo(0.0015, 6)
  })

  it('laufKosten: Mistral ASR (Voxtral) + Mistral Chat (Small) realistische Nutzung', () => {
    const k = laufKosten({
      asrModell: 'voxtral-mini-latest',
      dauerSekunden: 120, // 2 min → 0,006 USD
      chatModell: 'mistral-small-latest',
      usage: { promptTokens: 2000, completionTokens: 500 }
    })
    // Chat: 2000/1e6*0.15 + 500/1e6*0.6 = 0.0003 + 0.0003 = 0.0006
    expect(k.usd).toBeCloseTo(0.006 + 0.0006, 6)
    expect(k.eur).toBeCloseTo((0.006 + 0.0006) * 0.86, 6)
  })

  // --- v0.2.x #16: EUR-Schätzung + Lauf-Kosten je Eintrag (VL-2) ---

  it('eurAus rechnet mit der festen Schätz-Konstante', () => {
    expect(EUR_PRO_USD).toBe(0.86)
    expect(eurAus(1)).toBeCloseTo(0.86, 6)
    expect(eurAus(0)).toBe(0)
  })

  it('laufKosten summiert ASR (pro Minute) + Chat (Token) in USD und EUR', () => {
    const k = laufKosten({
      asrModell: 'whisper-1',
      dauerSekunden: 60, // 1 min → 0,006 USD
      chatModell: 'gpt-4o-mini',
      usage: { promptTokens: 1_000_000, completionTokens: 1_000_000 } // 0,75 USD
    })
    expect(k.usd).toBeCloseTo(0.756, 6)
    expect(k.eur).toBeCloseTo(0.756 * 0.86, 6)
  })

  it('laufKosten nimmt den bekannten Teil, wenn nur ASR bepreist ist', () => {
    const k = laufKosten({ asrModell: 'whisper-1', dauerSekunden: 60 })
    expect(k.usd).toBeCloseTo(0.006, 6)
    expect(k.eur).toBeCloseTo(0.006 * 0.86, 6)
  })

  it('laufKosten → null/null, wenn nichts bepreist ist', () => {
    expect(laufKosten({ asrModell: 'irgendwas-unbekanntes', dauerSekunden: 60 })).toEqual({
      usd: null,
      eur: null
    })
  })

  // --- v0.3 P7: editierbare Preise (Overrides) + editierbarer Kurs ---

  it('aufgelosteTabelle mischt Overrides feldweise (Override gewinnt, fehlende Felder Default)', () => {
    const t = aufgelosteTabelle({ 'gpt-4o-mini': { inputPro1MUsd: 1 } })
    expect(t['gpt-4o-mini']!.inputPro1MUsd).toBe(1) // Override gewinnt
    expect(t['gpt-4o-mini']!.outputPro1MUsd).toBe(0.6) // fehlendes Feld bleibt Default
    expect(t['gpt-4o']!.inputPro1MUsd).toBe(2.5) // unangetastetes Modell unverändert
  })

  it('aufgelosteTabelle kennt auch reine Override-Modelle (neue id)', () => {
    const t = aufgelosteTabelle({ 'eigenes-modell': { inputPro1MUsd: 9, outputPro1MUsd: 9 } })
    expect(chatKostenUsd('eigenes-modell', 1_000_000, 0, t)).toBeCloseTo(9, 6)
  })

  it('asr/chatKostenUsd nutzen die übergebene Tabelle', () => {
    const t = aufgelosteTabelle({ 'whisper-1': { asrProMinuteUsd: 0.012 } })
    expect(asrKostenUsd('whisper-1', 60, t)).toBeCloseTo(0.012, 6)
  })

  it('eurAus mit abweichendem Kurs', () => {
    expect(eurAus(10, 0.9)).toBeCloseTo(9, 6)
  })

  it('zeileKostenUsd: ASR + Chat, null wenn ein Teil unbekannt', () => {
    const zeile = {
      asrModell: 'whisper-1',
      audioSekunden: 60,
      chatModell: 'gpt-4o-mini',
      promptTokens: 1_000_000,
      completionTokens: 1_000_000
    }
    expect(zeileKostenUsd(zeile)).toBeCloseTo(0.756, 6)
    expect(zeileKostenUsd({ ...zeile, chatModell: '' })).toBeCloseTo(0.006, 6) // reine Transkription
    expect(zeileKostenUsd({ ...zeile, chatModell: 'unbekannt' })).toBeNull()
  })

  it('laufKosten honoriert overrides + kurs', () => {
    const k = laufKosten(
      { asrModell: 'whisper-1', dauerSekunden: 60 },
      { overrides: { 'whisper-1': { asrProMinuteUsd: 0.012 } }, kurs: 0.9 }
    )
    expect(k.usd).toBeCloseTo(0.012, 6)
    expect(k.eur).toBeCloseTo(0.012 * 0.9, 6)
  })

  // --- D3: PREISE wird aus der Provider-Registry abgeleitet (Drift-Schutz providers↔pricing) ---

  it('PREISE enthält exakt die bisherigen Schlüssel + Werte (Drift-Schutz-Beweis: hartkodierte Alt-Literale)', () => {
    // Diese Erwartungstabelle sind bewusst die alten, wörtlich kopierten PREISE-Literale von vor D3.
    // Bricht dieser Test, hat sich ein Preis in providers.ts verändert (gewollt oder als Drift).
    expect(PREISE).toEqual({
      'whisper-1': { asrProMinuteUsd: 0.006 },
      'gpt-4o-transcribe': { asrProMinuteUsd: 0.006 },
      'gpt-4o-mini-transcribe': { asrProMinuteUsd: 0.003 },
      'gpt-4o-mini': { inputPro1MUsd: 0.15, outputPro1MUsd: 0.6 },
      'gpt-4o': { inputPro1MUsd: 2.5, outputPro1MUsd: 10.0 },
      'whisper-large-v3-turbo': { asrProMinuteUsd: 0.04 / 60 },
      'whisper-large-v3': { asrProMinuteUsd: 0.111 / 60 },
      'llama-3.1-8b-instant': { inputPro1MUsd: 0.05, outputPro1MUsd: 0.08 },
      'llama-3.3-70b-versatile': { inputPro1MUsd: 0.59, outputPro1MUsd: 0.79 },
      'voxtral-mini-latest': { asrProMinuteUsd: 0.003 },
      'mistral-small-latest': { inputPro1MUsd: 0.15, outputPro1MUsd: 0.6 },
      'mistral-large-latest': { inputPro1MUsd: 0.5, outputPro1MUsd: 1.5 }
    })
  })

  it('preiseAusProvidernAbleiten() liefert dieselbe Tabelle wie die exportierte PREISE-Konstante', () => {
    expect(preiseAusProvidernAbleiten()).toEqual(PREISE)
  })

  it('jedes Modell in PROVIDER mit preis-Feld landet in PREISE', () => {
    for (const provider of PROVIDER) {
      for (const modell of [...provider.asrModelle, ...provider.chatModelle]) {
        if (modell.preis) {
          expect(PREISE[modell.id]).toEqual(modell.preis)
        }
      }
    }
  })

  it('PREISE enthält keine Einträge ohne zugehöriges Registry-Modell', () => {
    const registryIds = new Set(
      PROVIDER.flatMap((p) => [...p.asrModelle, ...p.chatModelle]).map((m) => m.id)
    )
    for (const id of Object.keys(PREISE)) {
      expect(registryIds.has(id)).toBe(true)
    }
  })
})
