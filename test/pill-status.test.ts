import { describe, it, expect } from 'vitest'
import { pillenStatus } from '@main/window/pill-status'

describe('pillenStatus', () => {
  // v0.8.0 (Befund 9): DIESER Test schrieb bislang fest, dass die Phase 'aufnehmen' SOFORT „🎙 Aufnahme …"
  // zeigt — das WAR genau der irreführende Zustand aus Befund 9: der Runner setzt die Phase 'aufnehmen',
  // BEVOR mediaRecorder.start() im Renderer überhaupt gelaufen ist, die Pille log also fälschlich schon
  // „Aufnahme" bei langsamem Gerätestart (Defender-Erstscan, Bluetooth-Mikro) — der Nutzer sprach in genau
  // diesem Fenster los, und der Anfang fehlte im Transkript. Bewusst umgeschrieben (kein Abschwächen!):
  // OHNE die neue, additive Bestätigung (`bestaetigt`, siehe runner.ts) zeigt die Pille jetzt „Starte …";
  // ERST nach der Bestätigung (mediaRecorder.start() im Renderer erfolgreich) zeigt sie wie bisher
  // „🎙 Aufnahme …". Die zweite Zeile unten (mit bestaetigt:true) ist der einzige Weg, das alte Label zu
  // bekommen — es ist NICHT verschwunden, nur an eine Bedingung geknüpft.
  it('zeigt „Starte …" ohne Bestätigung, „Aufnahme …" NACH Bestätigung (Befund 9)', () => {
    expect(pillenStatus({ status: 'aufnehmen' })).toEqual({ sichtbar: true, label: '⏳ Starte …' })
    expect(pillenStatus({ status: 'aufnehmen', bestaetigt: false })).toEqual({
      sichtbar: true,
      label: '⏳ Starte …'
    })
    expect(pillenStatus({ status: 'aufnehmen', bestaetigt: true })).toEqual({
      sichtbar: true,
      label: '🎙 Aufnahme …'
    })
  })

  it('zeigt die aktiven Phasen mit Label', () => {
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

    // --- v0.8.0 (pillenAnzeigedauerProfil): optionaler zweiter Parameter, Default = die AUTO_HIDE_*-Werte ---

    describe('mit abweichenden Anzeigedauer-Werten (pillenAnzeigedauerProfil)', () => {
      const kurz = { basisMs: 2000, obergrenzeMs: 4000, msProZeichen: 30 }

      it('kurzer Fehlertext trifft die ABWEICHENDE Basis (2000), nicht den Default (4000)', () => {
        const s = pillenStatus({ status: 'fehler', art: 'anbieter', message: 'kurz' }, kurz)
        expect(s.dauerMs).toBe(2000)
        // Kontrollprobe: ohne den Parameter bleibt der Default (4000) unverändert.
        expect(pillenStatus({ status: 'fehler', art: 'anbieter', message: 'kurz' }).dauerMs).toBe(4000)
      })

      it('sehr langer Fehlertext trifft die ABWEICHENDE Obergrenze (4000), nicht den Default (8000)', () => {
        const s = pillenStatus({ status: 'fehler', art: 'anbieter', message: 'x'.repeat(200) }, kurz)
        expect(s.dauerMs).toBe(4000)
      })

      it('gilt genauso für teilErfolg (nicht nur fehler)', () => {
        const s = pillenStatus(
          { status: 'teilErfolg', rohtext: 'x', warnung: 'w', grund: 'umschreibfehler' },
          kurz
        )
        expect(s.dauerMs).toBe(2000)
      })
    })
  })
})
