import { describe, it, expect } from 'vitest'
import {
  waehleAudioConstraints,
  geraeteliste,
  aufgeloesteGeraetewahl
} from '@renderer/lib/mikrofon-auswahl'

describe('waehleAudioConstraints (W3-ζ)', () => {
  it('ohne deviceId: OS-Standardgerät (rückwärtskompatibel)', () => {
    expect(waehleAudioConstraints(undefined)).toEqual({ audio: true })
  })

  it('mit leerem String: wie ohne deviceId (OS-Standard)', () => {
    expect(waehleAudioConstraints('')).toEqual({ audio: true })
  })

  it('mit deviceId: exact-Constraint auf das gewählte Gerät', () => {
    expect(waehleAudioConstraints('mic-123')).toEqual({
      audio: { deviceId: { exact: 'mic-123' } }
    })
  })
})

describe('geraeteliste (W3-ζ)', () => {
  it('filtert nur audioinput-Geräte heraus', () => {
    const roh = [
      { kind: 'audioinput' as const, deviceId: 'a', label: 'Headset-Mikro' },
      { kind: 'audiooutput' as const, deviceId: 'b', label: 'Lautsprecher' },
      { kind: 'videoinput' as const, deviceId: 'c', label: 'Webcam' },
      { kind: 'audioinput' as const, deviceId: 'd', label: 'USB-Mikro' }
    ]
    expect(geraeteliste(roh)).toEqual([
      { id: 'a', label: 'Headset-Mikro' },
      { id: 'd', label: 'USB-Mikro' }
    ])
  })

  it('leere Liste ⇒ leere Liste', () => {
    expect(geraeteliste([])).toEqual([])
  })

  it('nur Nicht-Audio-Eingänge ⇒ leere Liste', () => {
    expect(geraeteliste([{ kind: 'audiooutput' as const, deviceId: 'b', label: 'Lautsprecher' }])).toEqual([])
  })
})

describe('aufgeloesteGeraetewahl (W3-ζ, Fallback bei verschwundenem Gerät)', () => {
  it('keine gespeicherte Wahl ⇒ OS-Standard (undefined)', () => {
    expect(aufgeloesteGeraetewahl(undefined, ['a', 'b'])).toBeUndefined()
  })

  it('gespeicherte Wahl noch verfügbar ⇒ bleibt erhalten', () => {
    expect(aufgeloesteGeraetewahl('b', ['a', 'b'])).toBe('b')
  })

  it('gespeicherte Wahl nicht mehr verfügbar ⇒ Fallback auf OS-Standard (undefined)', () => {
    expect(aufgeloesteGeraetewahl('weg', ['a', 'b'])).toBeUndefined()
  })

  it('leere Verfügbarkeitsliste ⇒ Fallback auf OS-Standard', () => {
    expect(aufgeloesteGeraetewahl('a', [])).toBeUndefined()
  })

  it('gespeicherte Wahl als leerer String ⇒ wie keine Wahl (OS-Standard)', () => {
    expect(aufgeloesteGeraetewahl('', ['a'])).toBeUndefined()
  })
})
