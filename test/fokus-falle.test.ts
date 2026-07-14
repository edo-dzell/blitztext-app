import { describe, it, expect } from 'vitest'
import { naechstesFokusZiel } from '@renderer/lib/fokus-falle'

// Reine Tab-Zyklus-Logik der Fokus-Falle in Bestaetigung.tsx. Das eigentliche `.focus()`-Verhalten
// (Autofokus beim Öffnen, tatsächlicher DOM-Fokuswechsel) ist ohne jsdom in diesem Projekt nicht
// node-testbar (vitest.config.ts: environment 'node', kein @testing-library/react) — bestätigt via
// Windows-HITL zusammen mit dem restlichen Dialog-Verhalten.
describe('naechstesFokusZiel', () => {
  it('Tab (vorwärts) geht von Index 0 auf 1', () => {
    expect(naechstesFokusZiel(2, 0, false)).toBe(1)
  })

  it('Tab (vorwärts) zyklisiert vom letzten zurück zum ersten', () => {
    expect(naechstesFokusZiel(2, 1, false)).toBe(0)
  })

  it('Shift+Tab (rückwärts) geht von Index 1 auf 0', () => {
    expect(naechstesFokusZiel(2, 1, true)).toBe(0)
  })

  it('Shift+Tab (rückwärts) zyklisiert vom ersten zurück zum letzten', () => {
    expect(naechstesFokusZiel(2, 0, true)).toBe(1)
  })

  it('unbekannter aktueller Fokus (-1) landet vorwärts auf dem ersten Element', () => {
    expect(naechstesFokusZiel(2, -1, false)).toBe(0)
  })

  it('unbekannter aktueller Fokus (-1) landet rückwärts auf dem letzten Element', () => {
    expect(naechstesFokusZiel(2, -1, true)).toBe(1)
  })

  it('ohne fokussierbare Elemente liefert -1 (keine Falle möglich)', () => {
    expect(naechstesFokusZiel(0, -1, false)).toBe(-1)
  })

  it('funktioniert auch mit mehr als zwei Zielen (allgemeiner Fall)', () => {
    expect(naechstesFokusZiel(3, 2, false)).toBe(0)
    expect(naechstesFokusZiel(3, 0, true)).toBe(2)
    expect(naechstesFokusZiel(3, 1, false)).toBe(2)
  })
})
