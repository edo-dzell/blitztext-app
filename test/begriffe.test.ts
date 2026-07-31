import { describe, it, expect } from 'vitest'
import {
  normalisiereBegriffe,
  begriffeFuerAsrPrompt,
  asrPromptText,
  begriffeFuerRewritePrompt,
  begriffeFuerContextBias,
  ASR_PROMPT_BUDGET_ZEICHEN,
  ASR_CONTEXT_BIAS_MAX_EINTRAEGE
} from '@shared/begriffe'

describe('normalisiereBegriffe', () => {
  it('trimmt jeden Begriff', () => {
    expect(normalisiereBegriffe(['  Acme  ', ' GmbH'])).toEqual(['Acme', 'GmbH'])
  })

  it('verwirft leere und Whitespace-only Einträge (Leerstring-Artefakt-Fix)', () => {
    expect(normalisiereBegriffe(['Acme', '', '   ', 'GmbH'])).toEqual(['Acme', 'GmbH'])
  })

  it('dedupliziert case-insensitive, Erstschreibweise gewinnt', () => {
    expect(normalisiereBegriffe(['Acme', 'ACME', 'acme', 'GmbH'])).toEqual(['Acme', 'GmbH'])
  })

  it('erhält die Insertion-Order stabil', () => {
    expect(normalisiereBegriffe(['Zeta', 'Alpha', 'Beta'])).toEqual(['Zeta', 'Alpha', 'Beta'])
  })

  it('liefert [] für eine leere Liste', () => {
    expect(normalisiereBegriffe([])).toEqual([])
  })

  it('liefert [] wenn nach Trim/Filter nichts übrig bleibt', () => {
    expect(normalisiereBegriffe(['', '   ', '\t\n'])).toEqual([])
  })
})

describe('begriffeFuerAsrPrompt (Budget-Guard)', () => {
  it('lässt eine Liste unverändert, die klar unter dem Budget liegt', () => {
    const begriffe = ['Acme', 'GmbH', 'Blitztext']
    expect(begriffeFuerAsrPrompt(begriffe)).toEqual(begriffe)
  })

  it('behält exakt an der Budget-Grenze passende Begriffe (join-Länge inkl. ", ")', () => {
    // Zwei Begriffe à 10 Zeichen + Trenner ", " (2 Zeichen) = 22 Zeichen exakt.
    const a = 'A'.repeat(10)
    const b = 'B'.repeat(10)
    const grenze = a.length + 2 + b.length // 22
    expect(begriffeFuerAsrPrompt([a, b], grenze)).toEqual([a, b])
    // Ein Zeichen weniger Budget → der ältere ("a") fällt raus, der neuere ("b") bleibt.
    expect(begriffeFuerAsrPrompt([a, b], grenze - 1)).toEqual([b])
  })

  it('bevorzugt bei Überschreitung die NEUESTEN (Ende der Liste) — älteste fallen zuerst raus', () => {
    const alt = 'A'.repeat(50)
    const mitte = 'B'.repeat(50)
    const neu = 'C'.repeat(50)
    // Budget reicht nur für zwei der drei Begriffe (je 50 + Trenner).
    const budget = 50 + 2 + 50
    expect(begriffeFuerAsrPrompt([alt, mitte, neu], budget)).toEqual([mitte, neu])
  })

  it('gibt das Ergebnis in ORIGINAL-Reihenfolge zurück, nicht in Auswahl-Reihenfolge', () => {
    const alt = 'A'.repeat(50)
    const mitte = 'B'.repeat(50)
    const neu = 'C'.repeat(50)
    const budget = 50 + 2 + 50
    const ergebnis = begriffeFuerAsrPrompt([alt, mitte, neu], budget)
    expect(ergebnis).toEqual([mitte, neu])
    expect(ergebnis.indexOf(mitte)).toBeLessThan(ergebnis.indexOf(neu))
  })

  it('ist idempotent: ein bereits passendes Ergebnis erneut angewandt bleibt gleich', () => {
    const begriffe = ['Acme', 'GmbH', 'Blitztext', 'Widget']
    const einmal = begriffeFuerAsrPrompt(begriffe)
    const zweimal = begriffeFuerAsrPrompt(einmal)
    expect(zweimal).toEqual(einmal)
  })

  it('ist idempotent auch wenn tatsächlich gekürzt werden musste', () => {
    const viele = Array.from({ length: 50 }, (_, i) => `Begriff-${i}-`.repeat(3))
    const einmal = begriffeFuerAsrPrompt(viele)
    const zweimal = begriffeFuerAsrPrompt(einmal)
    expect(zweimal).toEqual(einmal)
  })

  it('nutzt den Default ASR_PROMPT_BUDGET_ZEICHEN, wenn kein Limit übergeben wird', () => {
    const langerBegriff = 'X'.repeat(ASR_PROMPT_BUDGET_ZEICHEN + 100)
    const kurzerBegriff = 'kurz'
    // Der lange (ältere) Begriff sprengt allein schon das Budget → nur der neuere bleibt.
    expect(begriffeFuerAsrPrompt([langerBegriff, kurzerBegriff])).toEqual([kurzerBegriff])
  })

  it('leere Liste bleibt leer', () => {
    expect(begriffeFuerAsrPrompt([])).toEqual([])
  })
})

describe('asrPromptText', () => {
  it('liefert null bei leerer Liste', () => {
    expect(asrPromptText([])).toBeNull()
  })

  it('liefert exakt den heutigen Wortlaut', () => {
    expect(asrPromptText(['Acme', 'GmbH'])).toBe('Eigennamen und Begriffe: Acme, GmbH')
  })
})

// --- B1: Mistrals context_bias hat eine Anzahl-Obergrenze statt Whispers Zeichen-Budget ---
describe('begriffeFuerContextBias (Anzahl-Guard für Mistral/Voxtral)', () => {
  it('lässt eine Liste unverändert, die klar unter der Obergrenze liegt', () => {
    const begriffe = ['Acme', 'GmbH', 'Blitztext']
    expect(begriffeFuerContextBias(begriffe)).toEqual(begriffe)
  })

  it('normalisiert zuerst (trim/leer raus/Dedupe) wie begriffeFuerAsrPrompt', () => {
    expect(begriffeFuerContextBias(['Acme', '', '  ', 'GmbH', 'acme'])).toEqual(['Acme', 'GmbH'])
  })

  it('kappt auf die injizierte Obergrenze, NEUESTE ZUERST, Original-Reihenfolge im Ergebnis', () => {
    const begriffe = ['alt', 'mitte', 'neu']
    expect(begriffeFuerContextBias(begriffe, 2)).toEqual(['mitte', 'neu'])
  })

  it('nutzt den Default ASR_CONTEXT_BIAS_MAX_EINTRAEGE (100), wenn keine Grenze übergeben wird', () => {
    const begriffe = Array.from({ length: 130 }, (_, i) => `Begriff-${i}`)
    const ergebnis = begriffeFuerContextBias(begriffe)
    expect(ergebnis).toHaveLength(ASR_CONTEXT_BIAS_MAX_EINTRAEGE)
    expect(ergebnis).toEqual(begriffe.slice(30))
  })

  it('behält alle Begriffe GENAU an der Obergrenze (kein Off-by-one)', () => {
    const begriffe = Array.from({ length: ASR_CONTEXT_BIAS_MAX_EINTRAEGE }, (_, i) => `B-${i}`)
    expect(begriffeFuerContextBias(begriffe)).toEqual(begriffe)
  })

  it('leere Liste bleibt leer', () => {
    expect(begriffeFuerContextBias([])).toEqual([])
  })

  it('ist idempotent auch wenn tatsächlich gekürzt werden musste', () => {
    const viele = Array.from({ length: 150 }, (_, i) => `Begriff-${i}`)
    const einmal = begriffeFuerContextBias(viele)
    const zweimal = begriffeFuerContextBias(einmal)
    expect(zweimal).toEqual(einmal)
  })
})

describe('begriffeFuerRewritePrompt', () => {
  it('liefert null bei leerer Liste', () => {
    expect(begriffeFuerRewritePrompt([])).toBeNull()
  })

  it('liefert exakt den heutigen Wortlaut', () => {
    expect(begriffeFuerRewritePrompt(['Acme', 'GmbH'])).toBe(
      'Wichtig: Diese Eigennamen und Fachbegriffe müssen exakt so geschrieben werden: Acme, GmbH'
    )
  })
})
