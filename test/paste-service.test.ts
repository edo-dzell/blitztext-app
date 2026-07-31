import { describe, it, expect } from 'vitest'
import { createPasteService, type EinfügeStrategie } from '@main/output/paste-service'

function fakeZwischenablage(initial = '') {
  let inhalt = initial
  return {
    lies: () => inhalt,
    schreib: async (t: string) => {
      inhalt = t
    }
  }
}

// Befund 12: EinfügeStrategie.versuch() liefert seit der Drift-Härtung ein dreiwertiges Ergebnis statt
// `boolean`. Dieser Test-Helfer bildet den bisherigen boolean-Parameter (Aufrufer wollen weiterhin nur
// "erfolgreich ja/nein" ausdrücken) intern auf 'erfolg'/'fehlschlag' ab — 'drift' wird gezielt über
// die separate `driftStrategie()`-Hilfe unten simuliert, damit die bestehenden Aufrufstellen unverändert
// bleiben.
function strategie(name: 'helfer' | 'powershell', erfolg: boolean) {
  const spy = { name, aufrufe: 0 }
  const s: EinfügeStrategie = {
    name,
    versuch: async () => {
      spy.aufrufe++
      return erfolg ? 'erfolg' : 'fehlschlag'
    }
  }
  return { s, spy }
}

/** Simuliert eine Strategie, die den Weg-B-Drift meldet (Befund 12: Exit-Code 2 der Helfer-Strategie). */
function driftStrategie(name: 'helfer' | 'powershell') {
  const spy = { name, aufrufe: 0 }
  const s: EinfügeStrategie = {
    name,
    versuch: async () => {
      spy.aufrufe++
      return 'drift'
    }
  }
  return { s, spy }
}

describe('createPasteService', () => {
  it('Helfer erfolgreich: Text in die Zwischenablage geschrieben, Helfer versucht, Erfolg', async () => {
    const zwischenablage = fakeZwischenablage('alt')
    const helfer = strategie('helfer', true)
    let hinweise = 0

    const service = createPasteService({
      zwischenablage,
      strategien: [helfer.s],
      zeigeManuellenHinweis: () => {
        hinweise++
      }
    })

    const ergebnis = await service.einfügen('neuer text')

    expect(zwischenablage.lies()).toBe('neuer text')
    expect(helfer.spy.aufrufe).toBe(1)
    expect(ergebnis).toMatchObject({ erfolg: true, strategie: 'helfer' })
    expect(hinweise).toBe(0)
  })

  it('Helfer scheitert → PowerShell erfolgreich (Reihenfolge eingehalten)', async () => {
    const helfer = strategie('helfer', false)
    const powershell = strategie('powershell', true)

    const service = createPasteService({
      zwischenablage: fakeZwischenablage(),
      strategien: [helfer.s, powershell.s],
      zeigeManuellenHinweis: () => {}
    })

    const ergebnis = await service.einfügen('text')

    expect(helfer.spy.aufrufe).toBe(1)
    expect(powershell.spy.aufrufe).toBe(1)
    expect(ergebnis).toMatchObject({ erfolg: true, strategie: 'powershell' })
  })

  it('beide scheitern: Hinweis, kein Erfolg, Text bleibt in der Zwischenablage', async () => {
    const zwischenablage = fakeZwischenablage('alt')
    const helfer = strategie('helfer', false)
    const powershell = strategie('powershell', false)
    let hinweise = 0

    const service = createPasteService({
      zwischenablage,
      strategien: [helfer.s, powershell.s],
      zeigeManuellenHinweis: () => {
        hinweise++
      }
    })

    const ergebnis = await service.einfügen('text')

    expect(ergebnis).toEqual({ erfolg: false })
    expect(hinweise).toBe(1)
    expect(zwischenablage.lies()).toBe('text') // nicht wiederhergestellt — Nutzer kann manuell einfügen
  })

  it('liest die vorherige Zwischenablage vor dem Schreiben; wiederherstellen() stellt sie zurück', async () => {
    const zwischenablage = fakeZwischenablage('vorher')
    const service = createPasteService({
      zwischenablage,
      strategien: [strategie('helfer', true).s],
      zeigeManuellenHinweis: () => {}
    })

    const ergebnis = await service.einfügen('eingefügt')
    expect(zwischenablage.lies()).toBe('eingefügt') // Text liegt zum Einfügen bereit

    if (!ergebnis.erfolg) throw new Error('sollte erfolgreich sein')
    ergebnis.wiederherstellen()
    expect(zwischenablage.lies()).toBe('vorher') // vorheriger Inhalt zurück
  })

  it('wiederherstellen() überschreibt nicht, wenn die Zwischenablage inzwischen geändert wurde', async () => {
    const zwischenablage = fakeZwischenablage('vorher')
    const service = createPasteService({
      zwischenablage,
      strategien: [strategie('helfer', true).s],
      zeigeManuellenHinweis: () => {}
    })

    const ergebnis = await service.einfügen('eingefügt')
    if (!ergebnis.erfolg) throw new Error('sollte erfolgreich sein')

    await zwischenablage.schreib('etwas anderes vom Nutzer') // Nutzer kopiert zwischenzeitlich etwas
    ergebnis.wiederherstellen()

    expect(zwischenablage.lies()).toBe('etwas anderes vom Nutzer') // NICHT überschrieben (Inhalts-Guard)
  })
})

// W3-A (ADR-0011 Weg B, verify-or-degrade): vor dem Einfügen prüft der Service, ob der Fokus vom
// erfassten Paste-Ziel weggewandert ist. Kein Drift → einfügen wie bisher. Drift → NICHT tippen,
// sondern nur die Zwischenablage setzen + Drift-Meldung. Der HWND-Provider ist ein injizierter Port.
describe('createPasteService — Fokus-Drift (Weg B)', () => {
  function baseDeps(currentHwnd: number | null) {
    const zwischenablage = fakeZwischenablage('alt')
    const helfer = strategie('helfer', true)
    const drift: number[] = []
    return {
      zwischenablage,
      helfer,
      drift,
      deps: {
        zwischenablage,
        strategien: [helfer.s],
        zeigeManuellenHinweis: () => {},
        aktuellesFenster: () => currentHwnd,
        zeigeDriftHinweis: () => drift.push(1)
      }
    }
  }

  it('kein Drift (erfasstes == aktuelles Fenster): fügt wie bisher ein', async () => {
    const { deps, zwischenablage, helfer, drift } = baseDeps(100)
    const service = createPasteService(deps)

    const ergebnis = await service.einfügen('text', { fokusRueckkehr: true, erfasstesHwnd: 100 })

    expect(helfer.spy.aufrufe).toBe(1)
    expect(ergebnis).toMatchObject({ erfolg: true })
    expect(zwischenablage.lies()).toBe('text')
    expect(drift).toEqual([])
  })

  it('Drift (erfasstes != aktuelles Fenster): kein Paste, Text in Zwischenablage, Drift-Hinweis', async () => {
    const { deps, zwischenablage, helfer, drift } = baseDeps(200)
    const service = createPasteService(deps)

    const ergebnis = await service.einfügen('text', { fokusRueckkehr: true, erfasstesHwnd: 100 })

    expect(helfer.spy.aufrufe).toBe(0) // keine Strategie ausgeführt (nicht ins fremde Fenster tippen)
    expect(ergebnis).toEqual({ erfolg: false, drift: true })
    expect(zwischenablage.lies()).toBe('text') // Text liegt zum manuellen Einfügen bereit
    expect(drift).toEqual([1])
  })

  it('Feature aus: fügt trotz Drift ein (kein Weg-B-Eingriff)', async () => {
    const { deps, helfer, drift } = baseDeps(200)
    const service = createPasteService(deps)

    const ergebnis = await service.einfügen('text', { fokusRueckkehr: false, erfasstesHwnd: 100 })

    expect(helfer.spy.aufrufe).toBe(1)
    expect(ergebnis).toMatchObject({ erfolg: true })
    expect(drift).toEqual([])
  })

  it('Helfer liefert kein HWND (Provider null): Fallback = einfügen wie bisher (nicht schlechter)', async () => {
    const { deps, helfer, drift } = baseDeps(null)
    const service = createPasteService(deps)

    const ergebnis = await service.einfügen('text', { fokusRueckkehr: true, erfasstesHwnd: 100 })

    expect(helfer.spy.aufrufe).toBe(1)
    expect(ergebnis).toMatchObject({ erfolg: true })
    expect(drift).toEqual([])
  })

  it('kein erfasstes HWND (Provider konnte beim Start nichts merken): Fallback = einfügen', async () => {
    const { deps, helfer, drift } = baseDeps(200)
    const service = createPasteService(deps)

    const ergebnis = await service.einfügen('text', { fokusRueckkehr: true, erfasstesHwnd: null })

    expect(helfer.spy.aufrufe).toBe(1)
    expect(ergebnis).toMatchObject({ erfolg: true })
    expect(drift).toEqual([])
  })

  it('rückwärtskompatibel: einfügen ohne Fokus-Optionen fügt wie bisher ein', async () => {
    const zwischenablage = fakeZwischenablage('alt')
    const helfer = strategie('helfer', true)
    const service = createPasteService({
      zwischenablage,
      strategien: [helfer.s],
      zeigeManuellenHinweis: () => {}
    })

    const ergebnis = await service.einfügen('text')
    expect(helfer.spy.aufrufe).toBe(1)
    expect(ergebnis).toMatchObject({ erfolg: true })
  })
})

// Befund 12 (Fehlerjagd): die Helfer-Strategie kann DURCH SICH SELBST einen Drift melden (natives
// Weg-B-Gate `--paste <hwnd>` im Helfer-Prozess, Exit-Code 2 — unabhängig von der VOR-Prüfung über
// `aktuellesFenster` oben). Vorher landete das im selben `fehlschlag`-Zweig wie jeder andere Fehlschlag
// → die Schleife probierte als Nächstes PowerShell, das KEIN Drift-Gate kennt und blind ins
// (mittlerweile fremde) Vordergrundfenster tippt. Diese Tests sichern die Reaktion auf das
// dreiwertige `EinfügeStrategie.versuch()`-Ergebnis auf reiner Logik-Ebene ab (ohne echten Prozess).
describe('createPasteService — Strategie-Ebene meldet Drift (Befund 12)', () => {
  it('Helfer meldet Drift: KEINE weitere Strategie (PowerShell nie aufgerufen), Drift-Hinweis kommt', async () => {
    const zwischenablage = fakeZwischenablage('alt')
    const helfer = driftStrategie('helfer')
    const powershell = strategie('powershell', true)
    const drift: number[] = []

    const service = createPasteService({
      zwischenablage,
      strategien: [helfer.s, powershell.s],
      zeigeManuellenHinweis: () => {
        throw new Error('darf bei Drift nicht aufgerufen werden')
      },
      zeigeDriftHinweis: () => drift.push(1)
    })

    const ergebnis = await service.einfügen('text')

    expect(helfer.spy.aufrufe).toBe(1)
    expect(powershell.spy.aufrufe).toBe(0) // PowerShell-Fallback wird NIE aufgerufen
    expect(ergebnis).toEqual({ erfolg: false, drift: true })
    expect(zwischenablage.lies()).toBe('text') // Text bleibt zum manuellen Einfügen in der Zwischenablage
    expect(drift).toEqual([1])
  })

  it('Regression: Fehlschlag (nicht Drift) der Helfer-Strategie greift weiterhin auf PowerShell zurück', async () => {
    const helfer = strategie('helfer', false)
    const powershell = strategie('powershell', true)

    const service = createPasteService({
      zwischenablage: fakeZwischenablage(),
      strategien: [helfer.s, powershell.s],
      zeigeManuellenHinweis: () => {}
    })

    const ergebnis = await service.einfügen('text')

    expect(helfer.spy.aufrufe).toBe(1)
    expect(powershell.spy.aufrufe).toBe(1) // unverändertes Verhalten: Fallback greift bei echtem Fehlschlag
    expect(ergebnis).toMatchObject({ erfolg: true, strategie: 'powershell' })
  })
})

// F2 (Review R2, v0.6.0): Regressionsschutz für den Major-Befund — die A1-Umstellung von
// `schreibUeberHelfer` auf spawn+Promise machte `Zwischenablage.schreib` fire-and-forget; der Service
// startete Drift-Prüfung/Strategien, BEVOR das Schreiben abgeschlossen war. Bei langsamem Helfer
// (AV-Scan o.ä.) landete so der ALTE Zwischenablage-Inhalt im Ziel-Fenster — still, ohne Fehler.
describe('createPasteService — Reihenfolge: Zwischenablage-Schreiben VOR Drift-Prüfung/Strategien', () => {
  /** Zwischenablage-Fake mit einem von außen steuerbaren, VERZÖGERTEN schreib() + Aufruf-Protokoll. */
  function fakeVerzoegerteZwischenablage(initial = '') {
    let inhalt = initial
    const protokoll: string[] = []
    let loeseAuf: (() => void) | undefined
    return {
      protokoll,
      // Von außen aufgerufen, um den ausstehenden schreib()-Aufruf gezielt abzuschließen.
      loeseSchreibenAuf: () => loeseAuf?.(),
      api: {
        lies: () => inhalt,
        schreib: (t: string) =>
          new Promise<void>((resolve) => {
            protokoll.push(`schreib-start:${t}`)
            loeseAuf = () => {
              inhalt = t
              protokoll.push(`schreib-ende:${t}`)
              resolve()
            }
          })
      }
    }
  }

  it('Drift-Prüfung (aktuellesFenster) läuft erst NACH abgeschlossenem Zwischenablage-Schreiben', async () => {
    const fake = fakeVerzoegerteZwischenablage('alt')
    const helfer = strategie('helfer', true)

    const service = createPasteService({
      zwischenablage: fake.api,
      strategien: [helfer.s],
      zeigeManuellenHinweis: () => {},
      aktuellesFenster: () => {
        fake.protokoll.push('drift-pruefung')
        return null
      }
    })

    const einfuegenPromise = service.einfügen('neuer text', { fokusRueckkehr: true, erfasstesHwnd: 100 })

    // Solange schreib() noch nicht aufgelöst ist, darf weder die Drift-Prüfung noch eine
    // Einfüge-Strategie gelaufen sein (bei altem fire-and-forget-Code wäre das hier bereits verletzt).
    await Promise.resolve()
    await Promise.resolve()
    expect(fake.protokoll).toEqual(['schreib-start:neuer text'])
    expect(helfer.spy.aufrufe).toBe(0)

    fake.loeseSchreibenAuf()
    await einfuegenPromise

    expect(fake.protokoll).toEqual(['schreib-start:neuer text', 'schreib-ende:neuer text', 'drift-pruefung'])
    expect(helfer.spy.aufrufe).toBe(1)
  })

  it('Paste-Strategie startet erst NACH abgeschlossenem Zwischenablage-Schreiben (ohne Fokus-Kontext)', async () => {
    const fake = fakeVerzoegerteZwischenablage('alt')
    const helfer: { s: EinfügeStrategie; spy: { aufrufe: number } } = {
      spy: { aufrufe: 0 },
      s: {
        name: 'helfer',
        versuch: async () => {
          fake.protokoll.push('strategie-versuch')
          helfer.spy.aufrufe++
          return 'erfolg'
        }
      }
    }

    const service = createPasteService({
      zwischenablage: fake.api,
      strategien: [helfer.s],
      zeigeManuellenHinweis: () => {}
    })

    const einfuegenPromise = service.einfügen('text')

    await Promise.resolve()
    await Promise.resolve()
    expect(fake.protokoll).toEqual(['schreib-start:text'])
    expect(helfer.spy.aufrufe).toBe(0)

    fake.loeseSchreibenAuf()
    await einfuegenPromise

    expect(fake.protokoll).toEqual(['schreib-start:text', 'schreib-ende:text', 'strategie-versuch'])
  })

  it('Regressionsschutz Fallback-Pfad: Helfer scheitert → clipboard.writeText-Fallback → Strategien laufen trotzdem', async () => {
    // Simuliert paste-adapter.ts: schreibUeberHelfer() scheitert, der Fallback (clipboard.writeText)
    // greift — die zurückgegebene Promise löst danach normal auf, der Service darf NICHT vor Abschluss
    // des Fallbacks weiterlaufen.
    let inhalt = 'alt'
    const protokoll: string[] = []
    const zwischenablage = {
      lies: () => inhalt,
      schreib: async (t: string) => {
        protokoll.push('helfer-scheitert')
        // Fallback, wie im echten Adapter: clipboard.writeText(text) im catch/Misserfolgs-Zweig.
        await Promise.resolve()
        inhalt = t
        protokoll.push('fallback-writeText')
      }
    }
    const helfer = strategie('helfer', true)

    const service = createPasteService({
      zwischenablage,
      strategien: [helfer.s],
      zeigeManuellenHinweis: () => {}
    })

    const ergebnis = await service.einfügen('text')

    expect(protokoll).toEqual(['helfer-scheitert', 'fallback-writeText'])
    expect(inhalt).toBe('text')
    expect(helfer.spy.aufrufe).toBe(1)
    expect(ergebnis).toMatchObject({ erfolg: true })
  })
})
