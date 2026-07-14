import { describe, it, expect } from 'vitest'
import { commitEingabe, commitAlles } from '@renderer/lib/begriffe-eingabe'

describe('commitEingabe (Komma/Blur, Teil-Commit)', () => {
  it('committet das Fragment vor dem Komma, Rest bleibt in der Eingabezeile', () => {
    const ergebnis = commitEingabe([], 'Acme,')
    expect(ergebnis.begriffe).toEqual(['Acme'])
    expect(ergebnis.restEingabe).toEqual('')
  })

  it('committet nur den Teil vor dem LETZTEN Komma, der Rest danach bleibt Freitext', () => {
    const ergebnis = commitEingabe([], 'Acme, GmbH')
    expect(ergebnis.begriffe).toEqual(['Acme'])
    expect(ergebnis.restEingabe).toEqual(' GmbH')
  })

  it('committet mehrere vollständige Fragmente auf einmal (mehrere Kommas)', () => {
    const ergebnis = commitEingabe([], 'Acme, GmbH, Rest')
    expect(ergebnis.begriffe).toEqual(['Acme', 'GmbH'])
    expect(ergebnis.restEingabe).toEqual(' Rest')
  })

  it('ohne Komma im Eingabetext wird NICHTS committet — alles bleibt restEingabe', () => {
    const ergebnis = commitEingabe(['Bestehend'], 'ohne Komma')
    expect(ergebnis.begriffe).toEqual(['Bestehend'])
    expect(ergebnis.restEingabe).toEqual('ohne Komma')
  })

  it('Trailing-Komma führt zu leerem Rest', () => {
    const ergebnis = commitEingabe([], 'Acme,')
    expect(ergebnis.restEingabe).toEqual('')
  })

  it('leere/Whitespace-only Fragmente verschwinden lautlos', () => {
    const ergebnis = commitEingabe([], '  , Acme, , ')
    expect(ergebnis.begriffe).toEqual(['Acme'])
    expect(ergebnis.restEingabe).toEqual(' ')
  })

  it('Sonderfall nur-Kommas: alles verschwindet, Rest ist leer', () => {
    const ergebnis = commitEingabe([], ',,,')
    expect(ergebnis.begriffe).toEqual([])
    expect(ergebnis.restEingabe).toEqual('')
  })

  it('dedupliziert case-insensitiv gegen bestehende Begriffe (kein Doppel-Chip)', () => {
    const ergebnis = commitEingabe(['Acme'], 'ACME,')
    expect(ergebnis.begriffe).toEqual(['Acme'])
  })

  it('bestehende Reihenfolge bleibt stabil, neue Fragmente hängen hinten an', () => {
    const ergebnis = commitEingabe(['Zeta', 'Alpha'], 'Beta,')
    expect(ergebnis.begriffe).toEqual(['Zeta', 'Alpha', 'Beta'])
  })

  it('trimmt committete Fragmente (Whitespace um das Komma herum)', () => {
    const ergebnis = commitEingabe([], '  Acme  ,')
    expect(ergebnis.begriffe).toEqual(['Acme'])
  })
})

describe('commitAlles (Enter, Voll-Commit)', () => {
  it('committet auch das letzte Fragment ohne abschließendes Komma', () => {
    const ergebnis = commitAlles([], 'Acme, GmbH')
    expect(ergebnis.begriffe).toEqual(['Acme', 'GmbH'])
    expect(ergebnis.restEingabe).toEqual('')
  })

  it('committet einen einzelnen Begriff ganz ohne Komma', () => {
    const ergebnis = commitAlles([], 'Solo')
    expect(ergebnis.begriffe).toEqual(['Solo'])
    expect(ergebnis.restEingabe).toEqual('')
  })

  it('leerer Eingabetext committet nichts Neues, Rest bleibt leer', () => {
    const ergebnis = commitAlles(['Bestehend'], '')
    expect(ergebnis.begriffe).toEqual(['Bestehend'])
    expect(ergebnis.restEingabe).toEqual('')
  })

  it('Sonderfall nur-Kommas: alles verschwindet', () => {
    const ergebnis = commitAlles([], ',,,')
    expect(ergebnis.begriffe).toEqual([])
    expect(ergebnis.restEingabe).toEqual('')
  })

  it('dedupliziert case-insensitiv beim Voll-Commit', () => {
    const ergebnis = commitAlles(['Acme'], 'acme, GmbH')
    expect(ergebnis.begriffe).toEqual(['Acme', 'GmbH'])
  })

  it('Reihenfolge bleibt stabil (bestehend zuerst, dann neue Fragmente in Eingabereihenfolge)', () => {
    const ergebnis = commitAlles(['Zeta'], 'Alpha, Beta')
    expect(ergebnis.begriffe).toEqual(['Zeta', 'Alpha', 'Beta'])
  })
})
