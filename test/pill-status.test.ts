import { describe, it, expect } from 'vitest'
import { pillenStatus } from '@main/window/pill-status'

describe('pillenStatus', () => {
  it('zeigt die aktiven Phasen mit Label', () => {
    expect(pillenStatus({ status: 'aufnehmen' })).toEqual({ sichtbar: true, label: '🎙 Aufnahme …' })
    expect(pillenStatus({ status: 'transkribieren' }).sichtbar).toBe(true)
    expect(pillenStatus({ status: 'umschreiben' }).sichtbar).toBe(true)
  })

  it('versteckt die Pille bei idle und fertig', () => {
    expect(pillenStatus({ status: 'idle' }).sichtbar).toBe(false)
    expect(pillenStatus({ status: 'fertig', text: 'x' }).sichtbar).toBe(false)
  })

  it('zeigt Fehler mit Meldung', () => {
    const s = pillenStatus({ status: 'fehler', art: 'anbieter', message: 'OpenAI-Fehler' })
    expect(s.sichtbar).toBe(true)
    expect(s.label).toContain('OpenAI-Fehler')
  })

  it('zeigt Teil-Erfolg (Rohtext in Zwischenablage)', () => {
    const s = pillenStatus({ status: 'teilErfolg', rohtext: 'x', warnung: 'w', grund: 'umschreibfehler' })
    expect(s.sichtbar).toBe(true)
    expect(s.label).toContain('Zwischenablage')
  })

  // --- A4a: istWiederholung-Flag (additiv) — Retry-Hinweis im Label ---

  it('zeigt bei istWiederholung: true einen Retry-Hinweis im Label (transkribieren/umschreiben)', () => {
    const t = pillenStatus({ status: 'transkribieren', istWiederholung: true })
    expect(t.label).toContain('erneuter Versuch')
    const u = pillenStatus({ status: 'umschreiben', istWiederholung: true })
    expect(u.label).toContain('erneuter Versuch')
  })

  it('zeigt ohne istWiederholung das unveränderte Standard-Label', () => {
    expect(pillenStatus({ status: 'transkribieren' }).label).toBe('⏳ Transkribiere …')
    expect(pillenStatus({ status: 'umschreiben' }).label).toBe('✍️ Schreibe um …')
    expect(pillenStatus({ status: 'transkribieren', istWiederholung: false }).label).toBe(
      '⏳ Transkribiere …'
    )
  })

  // --- A2: dauertLaenger-Flag (additiv) — Zwischenmeldung im Label ---

  it('zeigt bei dauertLaenger: true einen Hinweis im Label (transkribieren/umschreiben)', () => {
    const t = pillenStatus({ status: 'transkribieren', dauertLaenger: true })
    expect(t.label).toBe('⏳ Transkribiere … (dauert länger als üblich)')
    const u = pillenStatus({ status: 'umschreiben', dauertLaenger: true })
    expect(u.label).toBe('✍️ Schreibe um … (dauert länger als üblich)')
  })

  it('kombiniert istWiederholung UND dauertLaenger im selben Label (beide additiv aktiv)', () => {
    const t = pillenStatus({ status: 'transkribieren', istWiederholung: true, dauertLaenger: true })
    expect(t.label).toBe('⏳ Transkribiere … (erneuter Versuch, dauert länger als üblich)')
  })

  // --- A3: dauerMs (Anzeigedauer nach Textlänge, nur fehler/teilErfolg) ---

  describe('dauerMs', () => {
    it('bleibt bei aktiven Phasen (aufnehmen/transkribieren/umschreiben) undefined — kein Auto-Hide', () => {
      expect(pillenStatus({ status: 'aufnehmen' }).dauerMs).toBeUndefined()
      expect(pillenStatus({ status: 'transkribieren' }).dauerMs).toBeUndefined()
      expect(pillenStatus({ status: 'umschreiben' }).dauerMs).toBeUndefined()
    })

    it('kurzer Fehlertext → dauerMs === 4000 (Regressionsschutz, unverändertes Verhalten)', () => {
      const s = pillenStatus({ status: 'fehler', art: 'anbieter', message: 'kurz' })
      expect(s.dauerMs).toBe(4000)
    })

    it('kurzer Teil-Erfolg-Text → dauerMs === 4000', () => {
      const s = pillenStatus({ status: 'teilErfolg', rohtext: 'x', warnung: 'w', grund: 'umschreibfehler' })
      expect(s.dauerMs).toBe(4000)
    })

    it('langer Fehlertext → dauerMs deutlich > 4000, aber gedeckelt bei der Obergrenze (8000)', () => {
      const langeMeldung = 'x'.repeat(200)
      const s = pillenStatus({ status: 'fehler', art: 'anbieter', message: langeMeldung })
      expect(s.dauerMs).toBeGreaterThan(4000)
      expect(s.dauerMs).toBe(8000)
    })

    it('mittellanger Fehlertext liegt zwischen Basis- und Obergrenze', () => {
      // Label = '⚠️ ' + 100 Zeichen (Label-Länge deutlich über 4000/60≈67, unter 8000/60≈133 Zeichen)
      // → über der Basis (4000), aber unter der Obergrenze (8000).
      const s = pillenStatus({ status: 'fehler', art: 'anbieter', message: 'y'.repeat(100) })
      expect(s.dauerMs).toBeGreaterThan(4000)
      expect(s.dauerMs).toBeLessThan(8000)
    })
  })
})
