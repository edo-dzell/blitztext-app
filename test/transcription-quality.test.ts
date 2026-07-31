import { describe, it, expect } from 'vitest'
import {
  shouldRejectRecording,
  cleanedTranscript,
  rohtextAus,
  istStilleAufnahme,
  STILLE_HART,
  STILLE_WEICH,
  STILLE_DYNAMIK,
  STILLE_ABSOLUT
} from '@main/transcription/quality'

// Befund A (v0.8.0): Schwellen-Objekt OHNE `absolut` — reproduziert die reine Dynamik/Hart/Weich-Logik
// von VOR dieser Änderung (die absolute Untergrenze ist optional, s. quality.ts). Für Tests, die
// gezielt das alte Graubereichs-/Divisions-Verhalten isoliert zeigen wollen, unabhängig vom neuen Floor.
const OHNE_ABSOLUTE_UNTERGRENZE = { hart: STILLE_HART, weich: STILLE_WEICH, dynamik: STILLE_DYNAMIK }

describe('shouldRejectRecording', () => {
  it('verwirft Aufnahmen unter 0,3 s und akzeptiert sie ab 0,3 s', () => {
    expect(shouldRejectRecording(0.29)).toBe(true)
    expect(shouldRejectRecording(0.3)).toBe(false)
    expect(shouldRejectRecording(1.2)).toBe(false)
  })

  // v0.8.0 (mindestAufnahmeSekunden): der optionale zweite Parameter löst MINIMUM_RECORDING_SECONDS ab.
  it('mit abweichender mindestSekunden-Schwelle: 0,5s wird abgelehnt, obwohl der Default (0,3s) sie durchließe', () => {
    expect(shouldRejectRecording(0.5)).toBe(false) // Default-Verhalten unverändert
    expect(shouldRejectRecording(0.5, 1.0)).toBe(true) // abweichender Wert kommt an
    expect(shouldRejectRecording(1.0, 1.0)).toBe(false) // Grenze exakt getroffen
  })
})

describe('cleanedTranscript', () => {
  it('entfernt umgebende Leerzeichen und Zeilenumbrüche', () => {
    expect(cleanedTranscript('  hallo welt \n')).toBe('hallo welt')
    expect(cleanedTranscript('\n\n  text  ')).toBe('text')
  })
})

describe('rohtextAus', () => {
  it('liefert den gesäuberten Rohtext (raw rein, getrimmt raus)', () => {
    expect(rohtextAus('  hallo welt \n', 2)).toBe('hallo welt')
    expect(rohtextAus('\n\n  Das ist ein ganz normaler Satz.  ', 2)).toBe(
      'Das ist ein ganz normaler Satz.'
    )
    expect(rohtextAus('Kurz', 0.4)).toBe('Kurz') // kurzes, aber gültiges Wort bei kurzer Dauer
  })

  it('verwirft leeren oder reinen Whitespace-Text (null)', () => {
    expect(rohtextAus('', 2)).toBeNull()
    expect(rohtextAus('   \n  ', 2)).toBeNull()
  })

  it('verwirft Text ohne einen einzigen Buchstaben (null)', () => {
    expect(rohtextAus('123 456', 2)).toBeNull()
    expect(rohtextAus('!!! ...', 2)).toBeNull()
  })

  it('verwirft sehr kurze Aufnahmen (< 0,55 s) mit zu viel Inhalt', () => {
    expect(rohtextAus('eins zwei drei vier fünf', 0.5)).toBeNull() // ≥ 5 Wörter
    expect(rohtextAus('a'.repeat(32), 0.5)).toBeNull() // ≥ 32 Zeichen
    expect(rohtextAus('eins zwei drei vier fünf', 0.55)).toBe('eins zwei drei vier fünf') // Grenze 0,55
  })

  it('verwirft kurze Aufnahmen (< 0,8 s) mit sehr langem Text', () => {
    const long = 'a '.repeat(40).trim() // 79 Zeichen
    expect(rohtextAus(long, 0.7)).toBeNull()
    expect(rohtextAus(long, 0.8)).toBe(long) // Grenze 0,8 greift nicht mehr
  })
})

// v0.7.4 — Stille-Erkennung. Realer Vorfall: Bei garantiert leerer Aufnahme (~1 s) lieferte das Modell
// „Danke." / „Thank you." / „Vielen Dank." und der Text landete im Zielfenster. Das ist die bekannte
// Whisper-Halluzination auf Stille.
describe('istStilleAufnahme', () => {
  it('klar still: Spitze unter der harten Grenze, egal wie dynamisch', () => {
    expect(istStilleAufnahme({ max: 0, median: 0 })).toBe(true)
    expect(istStilleAufnahme({ max: 0.0015, median: 0.0002 })).toBe(true) // Verhältnis 7,5 — trotzdem still
    expect(istStilleAufnahme({ max: STILLE_HART - 0.0001, median: 0.0001 })).toBe(true)
  })

  // v0.8.0 (Befund A): die absolute Untergrenze liegt ÜBER STILLE_WEICH (s. STILLE_ABSOLUT-Kommentar
  // in quality.ts) — „garantiert hörbar, egal wie flach" gilt mit der DEFAULT-Stufe deshalb erst ab
  // STILLE_ABSOLUT, nicht mehr ab STILLE_WEICH. STILLE_WEICH allein reicht nicht mehr als Beweis für
  // hörbares Sprechen (genau das war der reale Fehlalarm: 0,0223 lag bereits über der alten WEICH-Grenze).
  it('klar hörbar: Spitze bei/über der absoluten Untergrenze, egal wie flach', () => {
    expect(istStilleAufnahme({ max: STILLE_ABSOLUT, median: STILLE_ABSOLUT })).toBe(false)
    expect(istStilleAufnahme({ max: 0.3, median: 0.28 })).toBe(false) // gleichmäßig lautes Sprechen
  })

  // Der eigentliche Kern (bei EXPLIZITER Schwelle OHNE absolute Untergrenze — ältere/manuell gebaute
  // Konfigurationen, s. `OHNE_ABSOLUTE_UNTERGRENZE` oben): Im Graubereich entscheidet nicht die
  // Lautstärke, sondern ob der Pegel STÖSST. Mit der DEFAULT-Stufe greift für diese Pegelhöhe inzwischen
  // schon die absolute Untergrenze (s. Testblock „Befund A" unten) — die reine Dynamik-Logik bleibt aber
  // für Aufrufer ohne `absolut` unverändert erhalten.
  it('Graubereich (ohne absolute Untergrenze): flaches Rauschen ist Stille, stoßhaftes Signal ist Sprache', () => {
    // Rauschender Raum ohne Sprache: Spitze dicht am Grundrauschen.
    expect(istStilleAufnahme({ max: 0.012, median: 0.010 }, OHNE_ABSOLUTE_UNTERGRENZE)).toBe(true)
    // „Leises Diktat" im selben Pegelbereich: Spitze weit über dem Grundrauschen (hohe Dynamik).
    expect(istStilleAufnahme({ max: 0.012, median: 0.001 }, OHNE_ABSOLUTE_UNTERGRENZE)).toBe(false)
  })

  // Regression gegen die erste Fassung (bei EXPLIZITER Schwelle ohne absolute Untergrenze): Beide Fälle
  // lagen unter der damaligen 0,005-Schwelle und wurden identisch behandelt — obwohl nur einer davon
  // Stille ist. Die reine Dynamik-Unterscheidung bleibt für Aufrufer ohne `absolut` erhalten.
  it('unterscheidet leises Sprechen von Stille bei GLEICHER Spitze (ohne absolute Untergrenze)', () => {
    const spitze = 0.004
    expect(istStilleAufnahme({ max: spitze, median: spitze * 0.9 }, OHNE_ABSOLUTE_UNTERGRENZE)).toBe(true) // flach → still
    expect(istStilleAufnahme({ max: spitze, median: spitze / 10 }, OHNE_ABSOLUTE_UNTERGRENZE)).toBe(false) // stoßhaft → Sprache
  })

  // Befund A (v0.8.0, Feld-Log): sechs reale Fehlauslösungen — normal lange/kurze Aufnahmen ohne
  // echtes Diktat, deren hohes Spitze:Grundrauschen-Verhältnis (11 bis 111) die reine Dynamik-Logik als
  // „stoßhaft wie Sprache" durchließ (Lauf 5 sogar an der alten WEICH-Abkürzung vorbei, s. o.). Mit der
  // DEFAULT-Stufe (inkl. STILLE_ABSOLUT) fängt die absolute Untergrenze jetzt ALLE sechs — VOR dem
  // Transkriptions-Aufruf. Zum Vergleich: zwei echte Diktate DESSELBEN Nutzers (0,3341/0,3603) bleiben
  // mit großer Marge als hörbar erkannt.
  describe('Befund A: absolute Untergrenze fängt die realen Nicht-Diktate aus dem Feld-Log', () => {
    const nichtDiktate = [
      { lauf: 3, max: 0.0025, median: 0.0002 },
      { lauf: 9, max: 0.0073, median: 0.0001 },
      { lauf: 11, max: 0.0069, median: 0.0002 },
      { lauf: 17, max: 0.0129, median: 0.0002 },
      { lauf: 21, max: 0.0033, median: 0.0003 },
      { lauf: 5, max: 0.0223, median: 0.0002 }
    ]
    for (const { lauf, max, median } of nichtDiktate) {
      it(`Lauf ${lauf} (max=${max}, median=${median}) wird als Stille erkannt`, () => {
        expect(istStilleAufnahme({ max, median })).toBe(true)
      })
    }

    it('echte Diktate desselben Nutzers (max 0,3341 / 0,3603) bleiben mit großer Marge hörbar', () => {
      expect(istStilleAufnahme({ max: 0.3341, median: 0.02 })).toBe(false)
      expect(istStilleAufnahme({ max: 0.3603, median: 0.02 })).toBe(false)
    })
  })

  // Die wichtigste Invariante: Eine fehlende Messung darf NIE eine echte Aufnahme kosten.
  it('ohne Messwert wird nie abgelehnt', () => {
    expect(istStilleAufnahme(null)).toBe(false)
    expect(istStilleAufnahme(undefined)).toBe(false)
  })

  it('unsinnige Messwerte werden ignoriert statt geraten', () => {
    expect(istStilleAufnahme({ max: Number.NaN, median: 0 })).toBe(false)
    expect(istStilleAufnahme({ max: Number.POSITIVE_INFINITY, median: 0 })).toBe(false)
    expect(istStilleAufnahme({ max: -1, median: 0 })).toBe(false)
    expect(istStilleAufnahme({ max: 0.01, median: Number.NaN })).toBe(false)
  })

  // Ohne absolute Untergrenze (isoliert die Divisions-Sicherheit der Dynamik-Berechnung): 0,01 liegt
  // unter STILLE_ABSOLUT (0,05) und würde mit der DEFAULT-Stufe unabhängig von dieser Sicherheitslogik
  // als Stille gewertet (s. Befund-A-Testblock oben) — das ist gewollt, 0,01 liegt klar im per Feld-Log
  // belegten Störgeräusch-Bereich.
  it('Median 0 macht jede Spitze hörbar (sichere Richtung, keine Division durch 0)', () => {
    expect(istStilleAufnahme({ max: 0.01, median: 0 }, OHNE_ABSOLUTE_UNTERGRENZE)).toBe(false)
  })

  // Belegt, warum es diese Funktion überhaupt braucht: Der bestehende Dauer×Länge-Filter kann den
  // realen Fall strukturell nicht fangen — kurzer Text aus normal langer Aufnahme unterläuft jede
  // seiner Schwellen. Fällt dieser Test, ist die Begründung des Guards hinfällig.
  it('der Artefaktfilter allein lässt die Halluzinations-Floskeln durch', () => {
    for (const floskel of ['Danke.', 'Thank you.', 'Vielen Dank.']) {
      expect(rohtextAus(floskel, 1.0)).toBe(floskel)
    }
  })

  // --- v0.8.0 (stilleProfil): optionaler zweiter Parameter, `null` = 'aus' (sicherheitsrelevant) ---

  describe('mit abweichenden Schwellen (stilleProfil)', () => {
    it('schwellen=null (Profil "aus"): lehnt NIE ab — auch eine eindeutig stille Messung nicht', () => {
      expect(istStilleAufnahme({ max: 0, median: 0 }, null)).toBe(false)
      expect(istStilleAufnahme({ max: 0.0001, median: 0.00001 }, null)).toBe(false)
      // Default-Verhalten (kein zweiter Parameter) bleibt unverändert die Referenz dafür, WAS 'aus' abschaltet.
      expect(istStilleAufnahme({ max: 0.0001, median: 0.00001 })).toBe(true)
    })

    it('eine strengere Dynamik-Schwelle lehnt eine Messung ab, die per reiner Dynamik-Logik als hörbar durchgeht', () => {
      const messung = { max: 0.007, median: 0.002 } // Verhältnis 3,5 — mit Dynamik 3 (reine Logik) hörbar
      // v0.8.0 (Befund A): 0,007 liegt unter STILLE_ABSOLUT (0,05) — mit der DEFAULT-Stufe greift daher
      // inzwischen SCHON die absolute Untergrenze (Lauf 9 im Feld-Log hatte fast denselben Pegel,
      // 0,0073/0,0001, und war KEIN Diktat). Um weiterhin zu zeigen, dass eine strengere Dynamik-Schwelle
      // EIGENSTÄNDIG (ohne den neuen Floor) dasselbe Ergebnis liefert, hier explizit ohne `absolut`:
      expect(istStilleAufnahme(messung, OHNE_ABSOLUTE_UNTERGRENZE)).toBe(false) // Dynamik 3: hörbar
      // Abweichende (höhere) Dynamik-Schwelle kommt an: dasselbe Verhältnis liegt jetzt darunter.
      expect(istStilleAufnahme(messung, { hart: 0.002, weich: 0.02, dynamik: 4 })).toBe(true)
      // Und: die DEFAULT-Stufe (inkl. absoluter Untergrenze) lehnt dieselbe Messung ohnehin schon ab.
      expect(istStilleAufnahme(messung)).toBe(true)
    })
  })
})
