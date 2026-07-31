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
      '(d) kurzes Diktat unter 15 Wörtern (v0.8.0, Befund C) — Wort-Statistik zu instabil',
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

// Befund C (v0.8.0, Feld-Log): ein reales 6-Sekunden-Diktat (53 Zeichen Rohtext, 68 Zeichen — LÄNGERER
// — Endtext) wurde als 'unvollstaendig' eingestuft; ob wirklich etwas fehlte, ist nicht mehr feststellbar.
// UNTERSUCHUNG: 53 Zeichen Rohtext entsprechen ~8-9 Wörtern — nahe der (damaligen) Mindestschwelle von
// 8 Wörtern, wo die Wort-Statistik naturgemäß instabil ist. Konstruierte 8-14-Wort-Diktate mit
// PLAUSIBLER, vollständiger Politur (Höflichkeitsform, 2-3 naheliegende Synonyme — KEIN Aussagen-
// Verlust) belegen: bei so wenigen Inhaltswörtern (4-7 typisch) reißen schon 2-3 Synonymersetzungen
// zuverlässig sowohl MIN_FEHLENDE_WOERTER (3) als auch MIN_FEHLQUOTE (40%) — der Detektor löst bei
// JEDEM dieser Fälle fälschlich aus. ERGEBNIS: Fehlalarm eindeutig belegt → MIN_WOERTER_ROHTEXT wurde
// von 8 auf 15 angehoben (kleinste Schwelle, die alle Fälle unten ausschließt, aber beide bekannten
// echten Vorfälle — 15 bzw. 22 Wörter — weiter erkennt).
describe('wirktUnvollstaendig — Befund C: Fehlalarm bei kurzen Diktaten (v0.8.0, Rot-Beweise)', () => {
  const fehlalarmKandidaten: Array<[string, string, string]> = [
    [
      '8 Wörter, 3 Synonyme (schick→sende, kurz→zeitnah, zahlen→werte)',
      'schick mir bitte kurz die aktuellen zahlen zu',
      'Bitte sende mir zeitnah die neuesten Werte zu.'
    ],
    [
      '9 Wörter, du bleibt du (KEINE Anrede-Änderung), 2 Synonyme',
      'ruf mich bitte kurz zurück wenn du kannst',
      'Ruf mich bitte zeitnah zurück, wenn du Zeit findest.'
    ],
    [
      '9 Wörter, Höflichkeitsform + Synonyme (sache→vorgang, erledigt→abgeschlossen)',
      'meld dich bitte kurz wenn die Sache erledigt ist',
      'Bitte melden Sie sich, sobald der Vorgang abgeschlossen ist.'
    ],
    [
      'reale Größenordnung (44 Zeichen Rohtext, nahe am gemeldeten 53/68-Vorfall)',
      'ruf mich bitte kurz zurück wenn du Zeit hast',
      'Bitte rufen Sie mich zurück, sobald Sie Gelegenheit haben.'
    ],
    [
      '14 Wörter, mehrere Synonyme, ENDTEXT LÄNGER als Rohtext (wie im realen Vorfall)',
      'schick mir bitte heute noch kurz die neuen Zahlen vom Projekt und dem Kunden',
      'Bitte senden Sie mir noch heute zeitnah die aktuellen Werte des Vorhabens und des Auftraggebers.'
    ]
  ]
  for (const [label, roh, end] of fehlalarmKandidaten) {
    it(`kein Fehlalarm mehr (war einer VOR der Anhebung auf 15 Wörter): ${label}`, () => {
      expect(wirktUnvollstaendig(roh, end)).toBe(false)
    })
  }

  // Belegt, dass die Anhebung den Detektor nicht funktionslos macht: ab 15 Wörtern greift er weiterhin,
  // wenn ein GANZER Nebensatz (eigenständige Aussage, nicht nur Wortwahl) stillschweigend verschwindet.
  it('bei 15+ Wörtern erkennt der Detektor weiterhin einen echten, satten Aussagen-Verlust', () => {
    const roh =
      'Bitte schick mir die Unterlagen für das Projekt bis spätestens Freitag Mittag zu, das ist wichtig'
    const end = 'Bitte schick mir die Unterlagen zu.'
    expect(wirktUnvollstaendig(roh, end)).toBe(true)
  })
})
