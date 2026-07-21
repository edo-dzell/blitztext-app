import { describe, it, expect } from 'vitest'
import { parseRendererLog } from '@main/diagnostics/log-ipc'

// parseRendererLog validiert die aus dem UNTRUSTED Renderer über `log:schreibe` gesendeten
// Nachrichten. Regel: bei strukturellem Verstoß → null; bei ungültigen Feldern → Feld verwerfen,
// Nachricht behalten. Das Ergebnis-`ereignis` trägt IMMER das `renderer.`-Präfix (Spoofing-Schutz).

describe('parseRendererLog — gültige Nachrichten', () => {
  it('übernimmt eine wohlgeformte Nachricht und präfixt das Ereignis', () => {
    const n = parseRendererLog({ stufe: 'info', ereignis: 'recorder.leere_aufnahme' })
    expect(n).toEqual({ stufe: 'info', ereignis: 'renderer.recorder.leere_aufnahme' })
  })

  it('übernimmt gültige Felder (Primitive) unverändert', () => {
    const n = parseRendererLog({
      stufe: 'warnung',
      ereignis: 'pill.fehler',
      felder: { code: 3, name: 'Error', erfolg: false }
    })
    expect(n).toEqual({
      stufe: 'warnung',
      ereignis: 'renderer.pill.fehler',
      felder: { code: 3, name: 'Error', erfolg: false }
    })
  })

  it('akzeptiert alle drei erlaubten Stufen', () => {
    for (const stufe of ['info', 'warnung', 'fehler'] as const) {
      const n = parseRendererLog({ stufe, ereignis: 'a.b' })
      expect(n?.stufe).toBe(stufe)
    }
  })

  it('lässt felder weg, wenn keine gültigen Felder übrig bleiben', () => {
    const n = parseRendererLog({ stufe: 'info', ereignis: 'a.b', felder: {} })
    expect(n).toEqual({ stufe: 'info', ereignis: 'renderer.a.b' })
    expect(n && 'felder' in n).toBe(false)
  })
})

describe('parseRendererLog — verworfene Nachrichten (null)', () => {
  it('verwirft Nicht-Objekte', () => {
    expect(parseRendererLog(null)).toBeNull()
    expect(parseRendererLog(undefined)).toBeNull()
    expect(parseRendererLog('info')).toBeNull()
    expect(parseRendererLog(42)).toBeNull()
    expect(parseRendererLog(['info', 'a.b'])).toBeNull()
  })

  it('verwirft die debug-Stufe (kein debug aus dem Renderer)', () => {
    expect(parseRendererLog({ stufe: 'debug', ereignis: 'a.b' })).toBeNull()
  })

  it('verwirft unbekannte/falsch typisierte Stufen', () => {
    expect(parseRendererLog({ stufe: 'warn', ereignis: 'a.b' })).toBeNull()
    expect(parseRendererLog({ stufe: 'INFO', ereignis: 'a.b' })).toBeNull()
    expect(parseRendererLog({ stufe: 3, ereignis: 'a.b' })).toBeNull()
    expect(parseRendererLog({ ereignis: 'a.b' })).toBeNull()
  })

  it('verwirft fehlenden oder falsch typisierten Ereignis-Slug', () => {
    expect(parseRendererLog({ stufe: 'info' })).toBeNull()
    expect(parseRendererLog({ stufe: 'info', ereignis: 42 })).toBeNull()
  })

  it('verwirft Ereignis-Slugs mit Regex-Verstoß', () => {
    expect(parseRendererLog({ stufe: 'info', ereignis: 'kein gültiger slug!!' })).toBeNull()
    expect(parseRendererLog({ stufe: 'info', ereignis: '' })).toBeNull()
    expect(parseRendererLog({ stufe: 'info', ereignis: 'a b' })).toBeNull()
    expect(parseRendererLog({ stufe: 'info', ereignis: 'a'.repeat(65) })).toBeNull()
  })

  it('akzeptiert einen Slug mit genau 64 Zeichen, verwirft 65', () => {
    expect(parseRendererLog({ stufe: 'info', ereignis: 'a'.repeat(64) })).not.toBeNull()
    expect(parseRendererLog({ stufe: 'info', ereignis: 'a'.repeat(65) })).toBeNull()
  })
})

describe('parseRendererLog — Feld-Defensive', () => {
  it('verwirft ungültige Feld-Keys, behält gültige', () => {
    const n = parseRendererLog({
      stufe: 'info',
      ereignis: 'a.b',
      felder: { gut: 1, 'bö.se': 2, zuLangerKeyDerDeutlichUeberZweiunddreissigZeichenGeht: 3 }
    })
    expect(n?.felder).toEqual({ gut: 1 })
  })

  it('verwirft Nicht-Primitive (Objekte/Arrays/null/functions)', () => {
    const n = parseRendererLog({
      stufe: 'info',
      ereignis: 'a.b',
      felder: { gut: 'ja', obj: { geheim: 'text' }, arr: [1, 2], leer: null }
    })
    expect(n?.felder).toEqual({ gut: 'ja' })
  })

  it('übernimmt höchstens 10 Felder', () => {
    const felder: Record<string, number> = {}
    for (let i = 0; i < 15; i++) felder[`f${i}`] = i
    const n = parseRendererLog({ stufe: 'info', ereignis: 'a.b', felder })
    expect(Object.keys(n?.felder ?? {})).toHaveLength(10)
  })

  it('kürzt String-Werte auf 200 Zeichen', () => {
    const n = parseRendererLog({
      stufe: 'info',
      ereignis: 'a.b',
      felder: { m: 'x'.repeat(500) }
    })
    expect(n?.felder?.['m']).toBe('x'.repeat(200))
  })

  it('ignoriert felder, das kein Objekt ist', () => {
    const n = parseRendererLog({ stufe: 'info', ereignis: 'a.b', felder: 'nope' })
    expect(n).toEqual({ stufe: 'info', ereignis: 'renderer.a.b' })
  })

  it('ignoriert felder als Array', () => {
    const n = parseRendererLog({ stufe: 'info', ereignis: 'a.b', felder: [1, 2, 3] })
    expect(n && 'felder' in n).toBe(false)
  })
})
