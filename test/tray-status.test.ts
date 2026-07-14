import { describe, it, expect } from 'vitest'
import { phaseTooltip, baueTrayMenuTemplate } from '@main/window/tray-status'

describe('phaseTooltip', () => {
  it('spiegelt jede Workflow-Phase in einen Tooltip', () => {
    expect(phaseTooltip({ status: 'idle' })).toBe('Blitztext')
    expect(phaseTooltip({ status: 'aufnehmen' })).toBe('Blitztext — Aufnahme …')
    expect(phaseTooltip({ status: 'transkribieren' })).toBe('Blitztext — Transkribiere …')
    expect(phaseTooltip({ status: 'umschreiben' })).toBe('Blitztext — Schreibe um …')
    expect(phaseTooltip({ status: 'fertig', text: 'hallo' })).toBe('Blitztext — Fertig')
  })

  it('trägt die Fehlermeldung in den Tooltip', () => {
    expect(phaseTooltip({ status: 'fehler', art: 'anbieter', message: 'OpenAI-Fehler' })).toBe(
      'Blitztext — Fehler: OpenAI-Fehler'
    )
  })

  it('zeigt Teil-Erfolg im Tooltip', () => {
    expect(phaseTooltip({ status: 'teilErfolg', rohtext: 'x', warnung: 'w', grund: 'umschreibfehler' })).toBe(
      'Blitztext — Rohtext in Zwischenablage'
    )
  })

  // --- A4a: istWiederholung-Flag (additiv) — Retry-Hinweis im Tooltip ---

  it('zeigt bei istWiederholung: true einen Retry-Hinweis im Tooltip', () => {
    expect(phaseTooltip({ status: 'transkribieren', istWiederholung: true })).toBe(
      'Blitztext — Transkribiere … (erneuter Versuch)'
    )
    expect(phaseTooltip({ status: 'umschreiben', istWiederholung: true })).toBe(
      'Blitztext — Schreibe um … (erneuter Versuch)'
    )
  })

  it('zeigt ohne istWiederholung den unveränderten Standard-Tooltip', () => {
    expect(phaseTooltip({ status: 'transkribieren' })).toBe('Blitztext — Transkribiere …')
    expect(phaseTooltip({ status: 'umschreiben', istWiederholung: false })).toBe(
      'Blitztext — Schreibe um …'
    )
  })

  // --- A2: dauertLaenger-Flag (additiv, optionale Tooltip-Ergänzung) ---

  it('zeigt bei dauertLaenger: true einen Hinweis im Tooltip', () => {
    expect(phaseTooltip({ status: 'transkribieren', dauertLaenger: true })).toBe(
      'Blitztext — Transkribiere … (dauert länger als üblich)'
    )
    expect(phaseTooltip({ status: 'umschreiben', dauertLaenger: true })).toBe(
      'Blitztext — Schreibe um … (dauert länger als üblich)'
    )
  })
})

describe('baueTrayMenuTemplate (F1)', () => {
  const aktionen = {
    einstellungenOeffnen: () => {},
    abbrechen: () => {},
    erneutVersuchen: () => {},
    beenden: () => {}
  }

  const finde = (
    template: ReturnType<typeof baueTrayMenuTemplate>,
    label: string
  ): { label?: string; enabled?: boolean } | undefined => template.find((e) => e.label === label)

  it('enthält den Retry-Eintrag „Letzte Aufnahme erneut verarbeiten"', () => {
    const t = baueTrayMenuTemplate(
      { beschaeftigt: false, kannErneutVersuchen: false },
      aktionen
    )
    expect(finde(t, 'Letzte Aufnahme erneut verarbeiten')).toBeDefined()
  })

  it('aktiviert den Retry-Eintrag nur, wenn kannErneutVersuchen true ist', () => {
    const aus = baueTrayMenuTemplate({ beschaeftigt: false, kannErneutVersuchen: false }, aktionen)
    expect(finde(aus, 'Letzte Aufnahme erneut verarbeiten')!.enabled).toBe(false)

    const an = baueTrayMenuTemplate({ beschaeftigt: false, kannErneutVersuchen: true }, aktionen)
    expect(finde(an, 'Letzte Aufnahme erneut verarbeiten')!.enabled).toBe(true)
  })

  it('aktiviert „Abbrechen" nur bei laufendem Workflow (beschaeftigt)', () => {
    const aus = baueTrayMenuTemplate({ beschaeftigt: false, kannErneutVersuchen: false }, aktionen)
    expect(finde(aus, 'Abbrechen')!.enabled).toBe(false)
    const an = baueTrayMenuTemplate({ beschaeftigt: true, kannErneutVersuchen: false }, aktionen)
    expect(finde(an, 'Abbrechen')!.enabled).toBe(true)
  })

  it('verdrahtet die Klick-Aktionen auf die Einträge', () => {
    let retry = 0
    let abbruch = 0
    const t = baueTrayMenuTemplate(
      { beschaeftigt: true, kannErneutVersuchen: true },
      { ...aktionen, erneutVersuchen: () => retry++, abbrechen: () => abbruch++ }
    )
    finde(t, 'Letzte Aufnahme erneut verarbeiten')
    t.find((e) => e.label === 'Letzte Aufnahme erneut verarbeiten')!.click!()
    t.find((e) => e.label === 'Abbrechen')!.click!()
    expect(retry).toBe(1)
    expect(abbruch).toBe(1)
  })

  // --- C5: Update-Hintergrund-Check — optionaler Menüeintrag ---

  it('fügt KEINEN Update-Eintrag ein, wenn updateVerfuegbar fehlt/null ist (Regressionsschutz)', () => {
    const ohneFeld = baueTrayMenuTemplate({ beschaeftigt: false, kannErneutVersuchen: false }, aktionen)
    expect(ohneFeld).toHaveLength(5) // 3 Einträge + 2 Separatoren (Bestand, unverändert)
    expect(ohneFeld.some((e) => e.label?.startsWith('Update verfügbar'))).toBe(false)

    const mitNull = baueTrayMenuTemplate(
      { beschaeftigt: false, kannErneutVersuchen: false, updateVerfuegbar: null },
      aktionen
    )
    expect(mitNull).toHaveLength(5)
    expect(mitNull.some((e) => e.label?.startsWith('Update verfügbar'))).toBe(false)
  })

  it('fügt einen „Update verfügbar…"-Eintrag + Separator ein, wenn updateVerfuegbar gesetzt ist', () => {
    const t = baueTrayMenuTemplate(
      {
        beschaeftigt: false,
        kannErneutVersuchen: false,
        updateVerfuegbar: { url: 'https://example.invalid/release', version: '0.6.0' }
      },
      aktionen
    )
    expect(t).toHaveLength(7) // 3 Einträge + Update-Separator + Update-Eintrag + Separator + Beenden
    expect(finde(t, 'Update verfügbar – v0.6.0 ansehen…')).toBeDefined()
  })

  it('ruft aktionen.oeffneUpdateSeite beim Klick auf den Update-Eintrag auf', () => {
    let geoeffnet = 0
    const t = baueTrayMenuTemplate(
      {
        beschaeftigt: false,
        kannErneutVersuchen: false,
        updateVerfuegbar: { url: 'https://example.invalid/release', version: '0.6.0' }
      },
      { ...aktionen, oeffneUpdateSeite: () => geoeffnet++ }
    )
    t.find((e) => e.label === 'Update verfügbar – v0.6.0 ansehen…')!.click!()
    expect(geoeffnet).toBe(1)
  })

  // --- Bugfix (W2-F1): version = REMOTE-Version, nicht die lokale; leere version ⇒ Fallback-Label ---

  it('zeigt bei leerer version (kein neueVersion ermittelbar) ein Label OHNE Versionsnummer statt einer falschen', () => {
    const t = baueTrayMenuTemplate(
      {
        beschaeftigt: false,
        kannErneutVersuchen: false,
        updateVerfuegbar: { url: 'https://example.invalid/release', version: '' }
      },
      aktionen
    )
    expect(finde(t, 'Update verfügbar – ansehen…')).toBeDefined()
    expect(t.some((e) => e.label?.includes('vansehen') || /v\s*ansehen/.test(e.label ?? ''))).toBe(false)
  })

  it('hält die Reihenfolge stabil: Update-Eintrag steht vor dem letzten Separator/„Beenden"', () => {
    const t = baueTrayMenuTemplate(
      {
        beschaeftigt: false,
        kannErneutVersuchen: false,
        updateVerfuegbar: { url: 'https://example.invalid/release', version: '1.2.3' }
      },
      aktionen
    )
    const labels = t.map((e) => e.label ?? `<separator>`)
    expect(labels).toEqual([
      'Einstellungen öffnen…',
      'Abbrechen',
      'Letzte Aufnahme erneut verarbeiten',
      '<separator>',
      'Update verfügbar – v1.2.3 ansehen…',
      '<separator>',
      'Beenden'
    ])
  })
})
