import { describe, it, expect } from 'vitest'
import {
  pruefeErreichbarkeit,
  type ErreichbarkeitsPort,
  type ErreichbarkeitsErgebnis
} from '@main/health/pruefe-erreichbarkeit'

function port(ergebnis: ErreichbarkeitsErgebnis | (() => never)): ErreichbarkeitsPort {
  return {
    async pingeAnbieter() {
      if (typeof ergebnis === 'function') return ergebnis()
      return ergebnis
    }
  }
}

describe('pruefeErreichbarkeit', () => {
  it('ok, wenn der Anbieter erreichbar ist', async () => {
    const r = await pruefeErreichbarkeit({
      holer: port({ erreichbar: true }),
      anbieter: { label: 'OpenAI', baseUrl: 'https://api.openai.com/v1' }
    })
    expect(r.status).toBe('ok')
  })

  it('warnung bei Netzfehler (Port wirft), kein fehler', async () => {
    const r = await pruefeErreichbarkeit({
      holer: port(() => {
        throw new Error('ETIMEDOUT')
      }),
      anbieter: { label: 'OpenAI', baseUrl: 'https://api.openai.com/v1' }
    })
    expect(r.status).toBe('warnung')
  })

  it('warnung, wenn der Anbieter unerwartet antwortet (erreichbar=false ohne Ablehnung)', async () => {
    const r = await pruefeErreichbarkeit({
      holer: port({ erreichbar: false }),
      anbieter: { label: 'Groq', baseUrl: 'https://api.groq.com/openai/v1' }
    })
    expect(r.status).toBe('warnung')
  })

  it('fehler, wenn die Autorisierung ausdrücklich abgelehnt wird (401/403)', async () => {
    const r = await pruefeErreichbarkeit({
      holer: port({ erreichbar: false, autorisierungAbgelehnt: true }),
      anbieter: { label: 'Mistral', baseUrl: 'https://api.mistral.ai/v1' }
    })
    expect(r.status).toBe('fehler')
  })
})
