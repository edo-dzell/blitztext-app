import { describe, it, expect } from 'vitest'
import { createPasteService, type EinfügeStrategie } from '@main/output/paste-service'

function fakeZwischenablage(initial = '') {
  let inhalt = initial
  return {
    lies: () => inhalt,
    schreib: (t: string) => {
      inhalt = t
    }
  }
}

function strategie(name: 'helfer' | 'powershell', erfolg: boolean) {
  const spy = { name, aufrufe: 0 }
  const s: EinfügeStrategie = {
    name,
    versuch: async () => {
      spy.aufrufe++
      return erfolg
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

    zwischenablage.schreib('etwas anderes vom Nutzer') // Nutzer kopiert zwischenzeitlich etwas
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
