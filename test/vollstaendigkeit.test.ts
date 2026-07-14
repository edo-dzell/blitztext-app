import { describe, it, expect } from 'vitest'
import { inhaltswoerter, wirktUnvollstaendig } from '@shared/vollstaendigkeit'

// v0.7.1 Stufe 3 (5. Vorfallsklasse „Weglassen"): deterministischer Vollständigkeits-Detektor gegen
// stillschweigend verworfene Aussagen. EMPIRISCH begründet: 4 identische Diktate des realen 14.7.2026-
// Vorfallssatzes lieferten mit der reinen Prompt-Härtung nur 1/4 vollständige Endtexte — die frühere
// „bewusst kein Laufzeit-Detektor"-Entscheidung (docs/umschreib-treue.md) ist damit widerlegt.
// Auf PRÄZISION getunt (wie treue-klassifikator): Negativ-Kontrollen dürfen NIE auslösen.

const ROHTEXT_VORFALL =
  'Der sagt zwar keine Aufnahme erkannt, aber ich bin jetzt mal gespannt, was jetzt funktioniert.'

describe('inhaltswoerter', () => {
  it('extrahiert Tokens ab 4 Zeichen ohne Stopwörter/Satzzeichen', () => {
    expect(inhaltswoerter(ROHTEXT_VORFALL)).toEqual([
      'sagt',
      'keine',
      'aufnahme',
      'erkannt',
      'gespannt',
      'funktioniert'
    ])
  })

  it('ignoriert kurze Wörter (<4 Zeichen) und Stopwörter', () => {
    expect(inhaltswoerter('ich bin da und du bist doch schon wieder hier')).toEqual(['hier'])
  })
})

describe('wirktUnvollstaendig — der reale 14.7.2026-Vorfall', () => {
  it('erkennt den Vorfall: erster Teilsatz komplett weggelassen', () => {
    const endtext = 'Ich bin jetzt gespannt, was jetzt funktioniert.'
    expect(wirktUnvollstaendig(ROHTEXT_VORFALL, endtext)).toBe(true)
  })

  it('erkennt eine Variante: zweiter (Schluss-)Teilsatz weggelassen', () => {
    const roh =
      'Der sagt zwar keine Aufnahme erkannt, aber ich bin jetzt mal gespannt, was jetzt ' +
      'funktioniert und ob die neue Version stabil läuft.'
    const endtext = 'Er sagt zwar „keine Aufnahme erkannt".'
    expect(wirktUnvollstaendig(roh, endtext)).toBe(true)
  })
})

describe('wirktUnvollstaendig — Negativ-Kontrollen (dürfen NIE auslösen)', () => {
  const faelle: Array<[string, string, string]> = [
    [
      '(a) RICHTIG-Fassung des Vorfalls: beide Aussagen bleiben erhalten',
      ROHTEXT_VORFALL,
      'Er sagt zwar „keine Aufnahme erkannt", aber ich bin jetzt gespannt, was funktioniert.'
    ],
    [
      '(b) reine Füllwort-/Versprecher-Glättung (ähm/mal/jetzt raus)',
      'ähm ich geh morgen mal ins büro und kümmer mich jetzt um die rechnung',
      'Ich gehe morgen ins Büro und kümmere mich um die Rechnung.'
    ],
    [
      '(c) Ton-Umformung du→förmlich, Inhaltswörter bleiben erhalten',
      'kannst du mir bitte das protokoll von der besprechung schicken',
      'Könnten Sie mir bitte das Protokoll von der Besprechung schicken?'
    ],
    [
      '(d) kurzes Diktat unter 8 Wörtern — Wort-Statistik zu instabil',
      'schick mir den bericht bitte',
      'Schicken Sie mir bitte den Bericht.'
    ],
    [
      '(e) Emoji-Anreicherung — Inhaltswörter bleiben, nur Emojis kommen hinzu',
      'ich geh morgen ins büro und kümmer mich um die rechnung',
      'Ich gehe morgen ins Büro 🏢 und kümmere mich um die Rechnung 📄✅'
    ]
  ]
  for (const [label, roh, end] of faelle) {
    it(`kein Fehlalarm: ${label}`, () => {
      expect(wirktUnvollstaendig(roh, end)).toBe(false)
    })
  }
})
