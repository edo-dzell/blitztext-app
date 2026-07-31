import { describe, it, expect } from 'vitest'
import { erstellePillenSteuerung } from '@main/window/pillen-steuerung'

// Fake-Pillen-Fenster: zeichnet alle Zugriffe auf, damit Reihenfolge und Sichtbarkeitszustand
// prüfbar sind. Muster analog test/fenster-heilung.test.ts / test/fenster-bereitschaft.test.ts.
function fakeFenster(
  opts: { zerstoert?: boolean; wcZerstoert?: boolean; sichtbarNachShow?: boolean } = {}
) {
  const aufrufe: string[] = []
  const gesendet: Array<{ kanal: string; args: unknown[] }> = []
  let sichtbar = false
  const webContents = {
    destroyed: opts.wcZerstoert ?? false,
    isDestroyed(): boolean {
      return this.destroyed
    },
    send(kanal: string, ...args: unknown[]): void {
      aufrufe.push('send')
      gesendet.push({ kanal, args })
    }
  }
  return {
    aufrufe,
    gesendet,
    bounds: null as { x: number; y: number; width: number; height: number } | null,
    destroyed: opts.zerstoert ?? false,
    isDestroyed(): boolean {
      return this.destroyed
    },
    webContents,
    getSize(): number[] {
      return [320, 88]
    },
    setBounds(b: { x: number; y: number; width: number; height: number }): void {
      aufrufe.push('setBounds')
      this.bounds = b
    },
    showInactive(): void {
      aufrufe.push('showInactive')
      // Der Kern der Fehlerklasse: „gezeigt" heißt nicht „sichtbar". Über diesen Schalter lässt sich
      // ein Fenster nachbilden, das nach showInactive() eben NICHT sichtbar wird.
      sichtbar = opts.sichtbarNachShow ?? true
    },
    hide(): void {
      aufrufe.push('hide')
      sichtbar = false
    },
    isVisible(): boolean {
      return sichtbar
    }
  }
}

// Minimaler Fake-Log: sammelt Aufrufe je Stufe (ereignis + felder) für die Feld-Assertions.
function fakeLog() {
  const eintraege: Array<{ stufe: string; ereignis: string; felder?: Record<string, unknown> }> = []
  const push = (stufe: string) => (ereignis: string, felder?: Record<string, unknown>) =>
    eintraege.push({ stufe, ereignis, felder })
  return {
    eintraege,
    debug: push('debug'),
    info: push('info'),
    warnung: push('warnung'),
    fehler: push('fehler'),
    ereignisse(): string[] {
      return eintraege.map((e) => e.ereignis)
    },
    finde(ereignis: string) {
      return eintraege.find((e) => e.ereignis === ereignis)
    }
  }
}

const FLAECHE = { x: 0, y: 0, width: 1920, height: 1040 }

function baue(fenster: ReturnType<typeof fakeFenster> | null, log = fakeLog()) {
  const steuerung = erstellePillenSteuerung({
    fenster: fenster as never,
    ermittleArbeitsflaeche: () => FLAECHE,
    log
  })
  return { steuerung, log }
}

describe('erstellePillenSteuerung — zeige()', () => {
  it('sendet das Label, positioniert und zeigt fokusfrei — in dieser Reihenfolge', () => {
    const f = fakeFenster()
    const { steuerung } = baue(f)
    steuerung.zeige('🎙 Aufnahme …')
    expect(f.aufrufe).toEqual(['send', 'setBounds', 'showInactive'])
    expect(f.gesendet[0]).toEqual({ kanal: 'pill:status', args: ['🎙 Aufnahme …'] })
  })

  it('positioniert unten mittig auf der übergebenen Arbeitsfläche', () => {
    const f = fakeFenster()
    const { steuerung } = baue(f)
    steuerung.zeige('x')
    // 1920 breit, Pille 320 → zentriert bei 800; unten: 1040 - 88 - 12 (Rand) = 940.
    expect(f.bounds).toEqual({ x: 800, y: 940, width: 320, height: 88 })
  })

  it('fragt die Arbeitsfläche bei JEDEM Zeigen neu ab (Display-Wechsel zwischen zwei Läufen)', () => {
    const f = fakeFenster()
    let flaeche = FLAECHE
    const steuerung = erstellePillenSteuerung({
      fenster: f as never,
      ermittleArbeitsflaeche: () => flaeche,
      log: fakeLog()
    })
    steuerung.zeige('a')
    expect(f.bounds?.x).toBe(800)
    flaeche = { x: 1920, y: 0, width: 1280, height: 1000 }
    steuerung.zeige('b')
    expect(f.bounds?.x).toBe(1920 + Math.round((1280 - 320) / 2))
  })

  it('protokolliert den TATSÄCHLICHEN Sichtbarkeitszustand nach dem Zeigen', () => {
    const f = fakeFenster({ sichtbarNachShow: true })
    const { steuerung, log } = baue(f)
    steuerung.zeige('🎙 Aufnahme …')
    expect(log.finde('pille.gezeigt')?.felder).toMatchObject({ sichtbar: true })
  })

  // Das ist der Feld-Beleg, der der Fehlerjagd „Pille fehlt" komplett gefehlt hat: Der Code lief
  // fehlerfrei durch, meldete nichts — und trotzdem war nichts zu sehen. Jetzt steht es im Log.
  it('meldet sichtbar:false, wenn das Fenster nach showInactive() NICHT sichtbar ist', () => {
    const f = fakeFenster({ sichtbarNachShow: false })
    const { steuerung, log } = baue(f)
    steuerung.zeige('🎙 Aufnahme …')
    expect(log.finde('pille.gezeigt')?.felder).toMatchObject({ sichtbar: false })
  })

  it('gibt niemals Text ins Log — nur die Label-LÄNGE', () => {
    const f = fakeFenster()
    const { steuerung, log } = baue(f)
    steuerung.zeige('⚠️ Geheimer Fehlertext')
    const felder = log.finde('pille.gezeigt')?.felder ?? {}
    expect(felder['zeichen']).toBe('⚠️ Geheimer Fehlertext'.length)
    expect(JSON.stringify(felder)).not.toContain('Geheimer')
  })
})

describe('erstellePillenSteuerung — nicht sendbares Fenster', () => {
  it('zerstörtes Fenster → keine Zugriffe, EINE Warnung', () => {
    const f = fakeFenster({ zerstoert: true })
    const { steuerung, log } = baue(f)
    steuerung.zeige('a')
    steuerung.zeige('b')
    steuerung.zeige('c')
    expect(f.aufrufe).toEqual([])
    expect(log.ereignisse().filter((e) => e === 'pille.nicht_verfuegbar')).toHaveLength(1)
  })

  it('zerstörtes webContents → ebenfalls kein Zugriff (Reihenfolge Fenster vor webContents)', () => {
    const f = fakeFenster({ wcZerstoert: true })
    const { steuerung, log } = baue(f)
    steuerung.zeige('a')
    expect(f.aufrufe).toEqual([])
    expect(log.finde('pille.nicht_verfuegbar')).toBeDefined()
  })

  it('fehlendes Fenster (null) → No-Op, wirft nicht', () => {
    const { steuerung } = baue(null)
    expect(() => steuerung.zeige('a')).not.toThrow()
    expect(() => steuerung.verstecke()).not.toThrow()
    expect(() => steuerung.waermeAuf()).not.toThrow()
  })

  // Regression: Die Vorgängerfassung setzte das Einmal-Flag NIE zurück — ein einziger früher Ausfall
  // (z. B. während eines Renderer-Reloads) machte jeden späteren Ausfall für die gesamte App-Laufzeit
  // stumm. Damit war die Diagnose eines wiederkehrenden Problems strukturell unmöglich.
  it('scharfe Warnung nach Rückkehr des Fensters — und erneut bei erneutem Ausfall', () => {
    const f = fakeFenster({ wcZerstoert: true })
    const { steuerung, log } = baue(f)
    steuerung.zeige('a')
    expect(log.ereignisse().filter((e) => e === 'pille.nicht_verfuegbar')).toHaveLength(1)

    f.webContents.destroyed = false // Fenster kommt zurück (Reload fertig)
    steuerung.zeige('b')
    expect(log.finde('pille.wieder_verfuegbar')).toBeDefined()

    f.webContents.destroyed = true // und fällt erneut aus
    steuerung.zeige('c')
    expect(log.ereignisse().filter((e) => e === 'pille.nicht_verfuegbar')).toHaveLength(2)
  })
})

describe('erstellePillenSteuerung — waermeAuf()', () => {
  it('zeigt und versteckt einmalig, ohne ein Label zu senden', () => {
    const f = fakeFenster()
    const { steuerung } = baue(f)
    steuerung.waermeAuf()
    expect(f.aufrufe).toEqual(['setBounds', 'showInactive', 'hide'])
    expect(f.gesendet).toEqual([]) // kein pill:status — der nächste echte Lauf setzt den Text
    expect(f.isVisible()).toBe(false)
  })

  it('protokolliert das Ergebnis als pille.warmup', () => {
    const f = fakeFenster()
    const { steuerung, log } = baue(f)
    steuerung.waermeAuf()
    expect(log.finde('pille.warmup')?.felder).toMatchObject({ sichtbar: true })
  })

  // Das Aufwärmen läuft einmal pro App-Start und ist die aussagekräftigste Diagnosezeile. Sie darf
  // NICHT am Debug-Schalter hängen — sonst fehlt sie genau bei den Nutzern, die nichts umgestellt haben.
  it('protokolliert auf info-Stufe (nicht debug), im Gegensatz zum regulären Zeigen', () => {
    const f = fakeFenster()
    const { steuerung, log } = baue(f)
    steuerung.waermeAuf()
    steuerung.zeige('🎙 Aufnahme …')
    expect(log.finde('pille.warmup')?.stufe).toBe('info')
    expect(log.finde('pille.gezeigt')?.stufe).toBe('debug')
  })

  it('nicht sendbares Fenster → kein hide(), keine Ausnahme', () => {
    const f = fakeFenster({ zerstoert: true })
    const { steuerung } = baue(f)
    expect(() => steuerung.waermeAuf()).not.toThrow()
    expect(f.aufrufe).toEqual([])
  })
})

// Befund B (Feld-Log 2026-07-31): die Pille sprang während EINES Laufs auf den falschen Monitor, weil
// arbeitsflaecheFuerPille() (index.ts) bei JEDEM Zeigen neu unter dem aktuellen Mauszeiger nachschaut —
// wanderte der Zeiger während der Verarbeitung (Fokuswechsel des Nutzers), sprang die Pille hinterher
// und landete auf einem Monitor, den der Nutzer gerade nicht ansah. laufBeginnt()/laufEndet() geben
// index.ts einen expliziten Anker: einmal beim Phasenbeginn ermitteln, für den ganzen Lauf festhalten.
describe('erstellePillenSteuerung — Lauf-Anker der Arbeitsfläche (Befund B)', () => {
  it('laufBeginnt() fragt die Arbeitsfläche EINMAL ab — nachfolgende zeige()-Aufrufe im selben Lauf bleiben konstant', () => {
    const f = fakeFenster()
    let flaeche = FLAECHE
    let aufrufe = 0
    const steuerung = erstellePillenSteuerung({
      fenster: f as never,
      ermittleArbeitsflaeche: () => {
        aufrufe += 1
        return flaeche
      },
      log: fakeLog()
    })

    steuerung.laufBeginnt()
    expect(aufrufe).toBe(1)

    steuerung.zeige('🎙 Aufnahme …')
    const ersteBounds = f.bounds
    expect(aufrufe).toBe(1) // KEIN erneuter Abruf durch zeige() selbst

    // Der „Zeiger" wandert (Fokuswechsel während der Verarbeitung) — die Pille darf trotzdem nicht folgen.
    flaeche = { x: 1920, y: 0, width: 1280, height: 1000 }
    steuerung.zeige('⏳ Transkribiere …')
    expect(aufrufe).toBe(1) // weiterhin keine neue Abfrage
    expect(f.bounds).toEqual(ersteBounds) // exakt dieselbe Position wie beim Lauf-Beginn

    steuerung.zeige('📋 Rohtext in Zwischenablage')
    expect(f.bounds).toEqual(ersteBounds)
  })

  it('ein neuer laufBeginnt()-Aufruf ermittelt die Arbeitsfläche erneut (nächster Lauf)', () => {
    const f = fakeFenster()
    let flaeche = FLAECHE
    const steuerung = erstellePillenSteuerung({
      fenster: f as never,
      ermittleArbeitsflaeche: () => flaeche,
      log: fakeLog()
    })

    steuerung.laufBeginnt()
    steuerung.zeige('a')
    expect(f.bounds?.x).toBe(800)

    flaeche = { x: 1920, y: 0, width: 1280, height: 1000 }
    steuerung.laufBeginnt() // neuer Lauf beginnt auf einem anderen Monitor
    steuerung.zeige('b')
    expect(f.bounds?.x).toBe(1920 + Math.round((1280 - 320) / 2))
  })

  it('laufEndet() gibt den Anker frei — eine Anzeige OHNE laufenden Lauf ermittelt wieder frisch', () => {
    const f = fakeFenster()
    let flaeche = FLAECHE
    const steuerung = erstellePillenSteuerung({
      fenster: f as never,
      ermittleArbeitsflaeche: () => flaeche,
      log: fakeLog()
    })

    steuerung.laufBeginnt()
    steuerung.zeige('a')
    expect(f.bounds?.x).toBe(800)

    steuerung.laufEndet()
    flaeche = { x: 1920, y: 0, width: 1280, height: 1000 }
    // Kein laufBeginnt() vor diesem zeige() — z. B. das einmalige Aufwärmen vor dem allerersten Lauf.
    steuerung.zeige('b')
    expect(f.bounds?.x).toBe(1920 + Math.round((1280 - 320) / 2))
  })

  it('ohne aktiven Lauf (nie laufBeginnt() aufgerufen) bleibt das bisherige Verhalten: JEDES Zeigen fragt frisch ab', () => {
    const f = fakeFenster()
    let flaeche = FLAECHE
    const steuerung = erstellePillenSteuerung({
      fenster: f as never,
      ermittleArbeitsflaeche: () => flaeche,
      log: fakeLog()
    })

    steuerung.zeige('a')
    expect(f.bounds?.x).toBe(800)
    flaeche = { x: 1920, y: 0, width: 1280, height: 1000 }
    steuerung.zeige('b')
    expect(f.bounds?.x).toBe(1920 + Math.round((1280 - 320) / 2))
  })

  it('waermeAuf() (App-Start, kein laufender Lauf) fragt weiterhin frisch ab', () => {
    const f = fakeFenster()
    let flaeche = FLAECHE
    const steuerung = erstellePillenSteuerung({
      fenster: f as never,
      ermittleArbeitsflaeche: () => flaeche,
      log: fakeLog()
    })
    steuerung.waermeAuf()
    expect(f.bounds?.x).toBe(800)
  })
})

describe('erstellePillenSteuerung — wirft nie', () => {
  // Kritisch: zeige() läuft SYNCHRON aus runner.transition(). Ein Wurf hier riss früher den kompletten
  // Aufnahme-Start mit (deps.recorder.start() steht in runner.start() direkt hinter transition()).
  it('werfendes showInactive() wird geschluckt und text-frei vermerkt', () => {
    const f = fakeFenster()
    f.showInactive = () => {
      throw new Error('Object has been destroyed')
    }
    const { steuerung, log } = baue(f)
    expect(() => steuerung.zeige('a')).not.toThrow()
    expect(log.finde('pille.zeigen_fehl')).toBeDefined()
    expect(JSON.stringify(log.eintraege)).not.toContain('destroyed')
  })

  it('werfendes hide() wird geschluckt', () => {
    const f = fakeFenster()
    f.hide = () => {
      throw new Error('Object has been destroyed')
    }
    const { steuerung } = baue(f)
    expect(() => steuerung.verstecke()).not.toThrow()
  })
})
