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
})
