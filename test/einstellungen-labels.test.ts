import { describe, it, expect } from 'vitest'
import {
  mitStandardMarkierung,
  formatSekunden,
  stilleProfilLabel,
  netzwerkProfilLabel,
  pillenAnzeigedauerProfilLabel,
  retryVersucheLabel,
  verlaufMaximumLabel,
  statistikKompaktierungTageLabel,
  updateIntervallLabel,
  preisUebersichtZusammenfassung
} from '@renderer/lib/einstellungen-labels'
import {
  MINDEST_AUFNAHME_SEKUNDEN_STUFEN,
  MINDEST_AUFNAHME_SEKUNDEN_DEFAULT,
  STILLE_PROFIL_STUFEN,
  NETZWERK_PROFIL_STUFEN,
  PILLEN_ANZEIGEDAUER_PROFIL_STUFEN,
  UPDATE_INTERVALL_STUNDEN_STUFEN
} from '@shared/laufzeit-profile'

describe('mitStandardMarkierung', () => {
  it('lässt den Text unverändert, wenn nicht Standard', () => {
    expect(mitStandardMarkierung('Streng', false)).toBe('Streng')
  })
  it('hängt „ (Standard)" an, wenn Standard', () => {
    expect(mitStandardMarkierung('Normal', true)).toBe('Normal (Standard)')
  })
})

describe('formatSekunden', () => {
  it('formatiert Nachkommawerte mit deutschem Komma', () => {
    expect(formatSekunden(0.3)).toBe('0,3 s')
    expect(formatSekunden(0.1)).toBe('0,1 s')
    expect(formatSekunden(0.5)).toBe('0,5 s')
  })
  it('zeigt ganze Werte ohne Nachkommastelle', () => {
    expect(formatSekunden(1.0)).toBe('1 s')
  })
  it('deckt jede MINDEST_AUFNAHME_SEKUNDEN_STUFEN-Stufe ohne Wurf ab', () => {
    for (const s of MINDEST_AUFNAHME_SEKUNDEN_STUFEN) {
      expect(() => formatSekunden(s)).not.toThrow()
    }
    expect(formatSekunden(MINDEST_AUFNAHME_SEKUNDEN_DEFAULT)).toBe('0,3 s')
  })
})

describe('stilleProfilLabel', () => {
  it('liefert für jede Stufe ein nicht-leeres Label', () => {
    for (const p of STILLE_PROFIL_STUFEN) {
      expect(stilleProfilLabel(p).length).toBeGreaterThan(0)
    }
  })
  it('benennt „aus" als Abschalten der Prüfung', () => {
    expect(stilleProfilLabel('aus')).toContain('keine Prüfung')
  })
  it('unterscheidet vorsichtig/normal/streng', () => {
    const labels = STILLE_PROFIL_STUFEN.map(stilleProfilLabel)
    expect(new Set(labels).size).toBe(labels.length)
  })
})

describe('netzwerkProfilLabel', () => {
  it('liefert für jede Stufe ein nicht-leeres, eindeutiges Label', () => {
    const labels = NETZWERK_PROFIL_STUFEN.map(netzwerkProfilLabel)
    expect(labels.every((l) => l.length > 0)).toBe(true)
    expect(new Set(labels).size).toBe(labels.length)
  })
})

describe('pillenAnzeigedauerProfilLabel', () => {
  it('liefert für jede Stufe ein nicht-leeres, eindeutiges Label', () => {
    const labels = PILLEN_ANZEIGEDAUER_PROFIL_STUFEN.map(pillenAnzeigedauerProfilLabel)
    expect(labels.every((l) => l.length > 0)).toBe(true)
    expect(new Set(labels).size).toBe(labels.length)
  })
})

describe('retryVersucheLabel', () => {
  it('formatiert als „N×"', () => {
    expect(retryVersucheLabel(1)).toBe('1×')
    expect(retryVersucheLabel(4)).toBe('4×')
  })
})

describe('verlaufMaximumLabel', () => {
  it('formatiert kleine Zahlen ohne Trennzeichen', () => {
    expect(verlaufMaximumLabel(200)).toBe('200 Einträge')
  })
  it('nutzt deutsches Tausender-Trennzeichen ab 1000', () => {
    expect(verlaufMaximumLabel(1000)).toBe('1.000 Einträge')
  })
})

describe('statistikKompaktierungTageLabel', () => {
  it('formatiert als „N Tage"', () => {
    expect(statistikKompaktierungTageLabel(90)).toBe('90 Tage')
  })
})

describe('updateIntervallLabel', () => {
  it('zeigt Stunden für Nicht-24er-Vielfache', () => {
    expect(updateIntervallLabel(6)).toBe('6 Std.')
    expect(updateIntervallLabel(12)).toBe('12 Std.')
  })
  it('zeigt glatte Tage für 24er-Vielfache (Singular bei genau 1 Tag)', () => {
    expect(updateIntervallLabel(24)).toBe('1 Tag')
    expect(updateIntervallLabel(72)).toBe('3 Tage')
    expect(updateIntervallLabel(168)).toBe('7 Tage')
  })
  it('deckt jede UPDATE_INTERVALL_STUNDEN_STUFEN-Stufe ohne Wurf ab', () => {
    for (const s of UPDATE_INTERVALL_STUNDEN_STUFEN) {
      expect(() => updateIntervallLabel(s)).not.toThrow()
    }
  })
})

describe('preisUebersichtZusammenfassung', () => {
  it('formatiert Anzahl + Kurs mit 4 Nachkommastellen und deutschem Komma', () => {
    expect(preisUebersichtZusammenfassung(0, 0.92)).toBe('0 Preis-Overrides aktiv · Kurs 0,9200')
  })
  it('rundet auf 4 Nachkommastellen', () => {
    expect(preisUebersichtZusammenfassung(3, 0.923456)).toBe('3 Preis-Overrides aktiv · Kurs 0,9235')
  })
})
