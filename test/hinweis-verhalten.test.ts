import { describe, it, expect } from 'vitest'
import { blendetAutomatischAus, istDringend } from '../src/renderer/src/lib/hinweis-verhalten'
import type { HinweisTyp } from '../src/renderer/src/components/Hinweis'

// C4/A4b: isolierte Tests für die Verzweigungslogik der Toast-Typen (erfolg/info/fehler), ausgelagert
// aus Hinweis.tsx, damit sie ohne React getestet werden kann. Regel: alles blendet automatisch aus
// außer Fehler; nur Fehler gilt als dringend (alert-Live-Region).

const ALLE_TYPEN: HinweisTyp[] = ['erfolg', 'info', 'fehler']

describe('blendetAutomatischAus', () => {
  it('erfolg blendet automatisch aus', () => {
    expect(blendetAutomatischAus('erfolg')).toBe(true)
  })

  it('info blendet automatisch aus', () => {
    expect(blendetAutomatischAus('info')).toBe(true)
  })

  it('fehler blendet NICHT automatisch aus (bleibt bis manuell geschlossen)', () => {
    expect(blendetAutomatischAus('fehler')).toBe(false)
  })
})

describe('istDringend', () => {
  it('erfolg ist nicht dringend', () => {
    expect(istDringend('erfolg')).toBe(false)
  })

  it('info ist nicht dringend', () => {
    expect(istDringend('info')).toBe(false)
  })

  it('fehler ist dringend (alert-Live-Region)', () => {
    expect(istDringend('fehler')).toBe(true)
  })
})

describe('blendetAutomatischAus/istDringend — Komplementärität', () => {
  it('für jeden Typ gilt: genau einer von beiden ist wahr (nie beide, nie keiner)', () => {
    for (const typ of ALLE_TYPEN) {
      expect(blendetAutomatischAus(typ)).toBe(!istDringend(typ))
    }
  })
})
