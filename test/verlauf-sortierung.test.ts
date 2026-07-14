import { describe, it, expect } from 'vitest'
import { istNeuesteZuerst, toggleSortierung } from '@renderer/lib/verlauf-sortierung'

describe('istNeuesteZuerst', () => {
  it('liefert true für neuesteZuerst', () => {
    expect(istNeuesteZuerst('neuesteZuerst')).toBe(true)
  })

  it('liefert false für aeltesteZuerst', () => {
    expect(istNeuesteZuerst('aeltesteZuerst')).toBe(false)
  })
})

describe('toggleSortierung', () => {
  it('wechselt von neuesteZuerst zu aeltesteZuerst', () => {
    expect(toggleSortierung('neuesteZuerst')).toBe('aeltesteZuerst')
  })

  it('wechselt von aeltesteZuerst zu neuesteZuerst', () => {
    expect(toggleSortierung('aeltesteZuerst')).toBe('neuesteZuerst')
  })

  it('ist involutorisch: zweimal togglen liefert den Ausgangswert', () => {
    const start = 'neuesteZuerst' as const
    expect(toggleSortierung(toggleSortierung(start))).toBe(start)
  })
})
