import { describe, it, expect } from 'vitest'
import { pruefeMikrofon, type MikrofonPort } from '@main/health/pruefe-mikrofon'

function port(anzahl: number): MikrofonPort {
  return { async anzahl() { return anzahl } }
}

describe('pruefeMikrofon', () => {
  it('ok, wenn mindestens ein Mikrofon verfügbar ist', async () => {
    const r = await pruefeMikrofon({ geraete: port(1) })
    expect(r.status).toBe('ok')
  })

  it('ok mit mehreren Mikrofonen (Detail nennt die Anzahl)', async () => {
    const r = await pruefeMikrofon({ geraete: port(3) })
    expect(r.status).toBe('ok')
    expect(r.detail).toContain('3')
  })

  it('fehler, wenn keine Mikrofone verfügbar sind', async () => {
    const r = await pruefeMikrofon({ geraete: port(0) })
    expect(r.status).toBe('fehler')
  })

  it('fehler, wenn der Port wirft (z. B. Berechtigung verweigert)', async () => {
    const wirftPort: MikrofonPort = {
      async anzahl() {
        throw new Error('NotAllowedError')
      }
    }
    const r = await pruefeMikrofon({ geraete: wirftPort })
    expect(r.status).toBe('fehler')
  })
})
