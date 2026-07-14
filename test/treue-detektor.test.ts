import { describe, it, expect } from 'vitest'
import { personProfil, personProfilEn, wirktBeantwortet } from '@shared/treue-klassifikator'
import { createTreueDetektor } from '@main/rewrite/treue-detektor'

// v0.4.5 (ADR-0018): deterministischer Treue-Klassifikator/-Detektor gegen „Modell beantwortet das
// Diktat statt es zu bearbeiten" (Personen-Flip du→ich). Auf PRÄZISION getunt: Negativ-Kontrollen
// dürfen NIE auslösen (sonst stuft die App korrekte Politur fälschlich ab).

describe('personProfil', () => {
  it('zählt 1.- und 2.-Person-Marker und ignoriert Wörter wie „Meinung"', () => {
    expect(personProfil('ich gebe dir mein Wort')).toEqual({ erste: 2, zweite: 1 }) // ich, mein | dir
    // „Meinung" darf NICHT als „mein" zählen (exakte Wortgrenzen).
    expect(personProfil('Das ist meine Meinung')).toEqual({ erste: 1, zweite: 0 })
    // Lowercase „sie" (3. Person) zählt nicht; formelles „Sie" schon.
    expect(personProfil('sie kamen alle')).toEqual({ erste: 0, zweite: 0 })
    expect(personProfil('Können Sie mir helfen')).toEqual({ erste: 1, zweite: 1 }) // mir | Sie
  })
})

describe('personProfilEn — englische Pronomen-Profile', () => {
  it('zählt englische 1.- und 2.-Person-Marker mit Wortgrenzen', () => {
    expect(personProfilEn('I would recommend that you check my notes')).toEqual({ erste: 2, zweite: 1 }) // I, my | you
    // „mine/yours/myself/yourself" werden erfasst; „your" nicht als Teil von „yourself" doppelt.
    expect(personProfilEn('you did it yourself')).toEqual({ erste: 0, zweite: 2 }) // you, yourself
    // Kein Marker → 0/0. „is/his/this" dürfen nicht anschlagen.
    expect(personProfilEn('this is his report')).toEqual({ erste: 0, zweite: 0 })
  })
})

describe('wirktBeantwortet — der reale 14.6.2026-Fall', () => {
  const roh =
    'nichts umsetzen, sondern mir nur eine Empfehlung geben, wie du ohne eine neue Regel hättest, ' +
    'das entsprechend so verarbeiten können, dass du direkt weißt, dass es eine neue E-Mail gibt.'
  const falscherEndtext =
    'Ich hätte die E-Mail so verarbeitet, dass ich direkt erkenne, dass es sich um eine neue ' +
    'E-Mail handelt, ohne eine neue Regel einführen zu müssen.'
  const treuerEndtext =
    'Setze nichts um, sondern gib mir nur eine Empfehlung, wie du das ohne eine neue Regel so ' +
    'hättest verarbeiten können, dass du direkt weißt, dass es eine neue E-Mail gibt.'

  it('erkennt den Personen-Flip du→ich als „beantwortet"', () => {
    expect(wirktBeantwortet(roh, falscherEndtext)).toBe(true)
  })

  it('lässt die TREUE Politur (Anrede bleibt „du") in Ruhe', () => {
    expect(wirktBeantwortet(roh, treuerEndtext)).toBe(false)
  })
})

describe('wirktBeantwortet — Sprachwechsel-Flip (englische Antwort auf deutsches du-Diktat)', () => {
  it('erkennt roh deutsch-du → end englisch-ich als Flip', () => {
    const roh =
      'nichts umsetzen, sondern gib mir nur eine Empfehlung, wie du das ohne eine neue Regel ' +
      'verarbeiten könntest, sodass du direkt weißt, dass es eine neue E-Mail gibt.'
    const enEndtext =
      'I would have processed the email so that I immediately recognize it is a new email, ' +
      'without having to introduce a new rule.'
    expect(wirktBeantwortet(roh, enEndtext)).toBe(true)
  })

  it('erkennt roh englisch-you → end deutsch-ich als Flip', () => {
    const roh = 'do not implement anything, just tell me how you would handle this without a new rule'
    const deEndtext = 'Ich würde das ohne eine neue Regel handhaben.'
    expect(wirktBeantwortet(roh, deEndtext)).toBe(true)
  })

  it('erkennt reinen englischen you→I Flip', () => {
    const roh = 'so how would you actually solve this without rebuilding everything'
    const enEndtext = 'I would solve this by refactoring the module incrementally.'
    expect(wirktBeantwortet(roh, enEndtext)).toBe(true)
  })
})

describe('wirktBeantwortet — Antwort-Präfix-Heuristik (sehr eng)', () => {
  const faelle: Array<[string, string, string]> = [
    ['„Gerne!"', 'wie kann ich das reporting automatisieren', 'Gerne! Du kannst das Reporting per Skript automatisieren.'],
    ['„Gerne helfe ich"', 'wie automatisiere ich das reporting', 'Gerne helfe ich dir dabei, das Reporting zu automatisieren.'],
    ['„Als KI"', 'was hältst du von dem plan', 'Als KI habe ich keine Meinung, aber der Plan wirkt solide.'],
    ['„Ich verstehe deine Frage"', 'wie geht das mit den filtern', 'Ich verstehe deine Frage. Die Filter setzt du so.'],
    ['„Vielen Dank für deine Nachricht"', 'schick mir mal den bericht', 'Vielen Dank für deine Nachricht. Der Bericht folgt gleich.'],
    ['„Sure!"', 'how do i automate the reporting', 'Sure! You can automate the reporting with a script.'],
    ['„Of course!"', 'how do i export this', 'Of course! You can export this via the menu.'],
    ['„As an AI"', 'what do you think of this', 'As an AI, I have no opinion, but it looks fine.']
  ]
  for (const [label, roh, end] of faelle) {
    it(`erkennt Assistenz-Präfix ${label}`, () => {
      expect(wirktBeantwortet(roh, end)).toBe(true)
    })
  }
})

describe('wirktBeantwortet — Negativ-Kontrollen (dürfen NIE auslösen)', () => {
  const faelle: Array<[string, string]> = [
    // 1.-Person-Erzählung, leicht poliert — kein Gegenüber, kein Flip.
    ['ähm ich geh morgen ins büro und kümmer mich um die rechnung', 'Ich gehe morgen ins Büro und kümmere mich um die Rechnung.'],
    // Bitte an „du" — Anrede bleibt erhalten.
    ['kannst du mir bitte das protokoll schicken', 'Kannst du mir bitte das Protokoll schicken?'],
    // Formelle Bitte — „Sie" bleibt „Sie".
    ['können sie mir den bericht bis morgen zusenden', 'Können Sie mir den Bericht bis morgen zusenden?'],
    // Imperativ ohne Anrede-Pronomen — Personen-Achse kann nicht kippen.
    ['bitte schick mir den bericht bis freitag', 'Bitte schicke mir den Bericht bis Freitag.'],
    // Reine Sachaussage ohne Personen.
    ['das meeting ist um drei verschoben worden', 'Das Meeting wurde auf drei Uhr verschoben.'],
    // Zitat/direkte Rede: die Anrede aus dem Zitat wird beim Polieren gekürzt — kein echter Flip.
    [
      'also er sagte zu mir du bist schon wieder zu spät dran und ich habe ihm dann geantwortet ' +
        'dass der zug ausgefallen war',
      'Er sagte zu mir, ich sei zu spät, woraufhin ich erklärte, dass mein Zug ausgefallen war.'
    ],
    // Diktat beginnt SELBST mit „Gerne!" und wird poliert — Präfix steht im Rohtext ⇒ legitim.
    ['gerne mach ich das für dich bis morgen früh fertig', 'Gerne mache ich das für dich bis morgen früh fertig.'],
    // Englisches Ich-Diktat, legitim poliert — kein Gegenüber, kein Flip.
    ['um i will go to the office tomorrow and handle the open invoice', 'I will go to the office tomorrow and handle the open invoice.'],
    // Kurzes 1:1-Pronomen-Diktat (englisch), Anrede bleibt „you".
    ['can you please send me the report by friday', 'Can you please send me the report by Friday?'],
    // Englisches Diktat, das selbst mit „Sure" beginnt (als Inhalt) — poliert, Präfix im Rohtext.
    ['sure send me the file whenever you have a moment', 'Sure, send me the file whenever you have a moment.'],
    // Englische Sachaussage ohne Personen.
    ['the meeting was moved from ten to three in the afternoon', 'The meeting was moved from ten to three in the afternoon.']
  ]
  for (const [roh, end] of faelle) {
    it(`kein Fehlalarm: „${roh.slice(0, 32)}…"`, () => {
      expect(wirktBeantwortet(roh, end)).toBe(false)
    })
  }
})

describe('createTreueDetektor', () => {
  it('delegiert an den geteilten Klassifikator (identische Entscheidung wie eval/)', () => {
    const d = createTreueDetektor()
    expect(d.wirktBeantwortet('frag du mal nach', 'Ich frage nach.')).toBe(true)
    expect(d.wirktBeantwortet('ich frage nach', 'Ich frage nach.')).toBe(false)
  })
})
