import { describe, it, expect } from 'vitest'
import { pruefeApiKey, type ApiKeyPort } from '@main/health/pruefe-api-key'

function port(vorhanden: boolean): ApiKeyPort {
  return { async has() { return vorhanden } }
}

describe('pruefeApiKey', () => {
  it('ok, wenn ein Key für den Standard-Anbieter hinterlegt ist', async () => {
    const ergebnis = await pruefeApiKey({
      apiKeys: port(true),
      anbieter: { id: 'openai', label: 'OpenAI' }
    })
    expect(ergebnis.status).toBe('ok')
    expect(ergebnis.detail).toContain('OpenAI')
  })

  it('fehler, wenn kein Key hinterlegt ist', async () => {
    const ergebnis = await pruefeApiKey({
      apiKeys: port(false),
      anbieter: { id: 'groq', label: 'Groq' }
    })
    expect(ergebnis.status).toBe('fehler')
    expect(ergebnis.detail).toContain('Groq')
  })

  it('ok ohne Key-Prüfung bei keinKeyNoetig (lokaler Anbieter, L1)', async () => {
    const wirftPort: ApiKeyPort = {
      async has() {
        throw new Error('darf nicht aufgerufen werden')
      }
    }
    const ergebnis = await pruefeApiKey({
      apiKeys: wirftPort,
      anbieter: { id: 'local', label: 'Lokal', keinKeyNoetig: true }
    })
    expect(ergebnis.status).toBe('ok')
  })

  it('fehler, wenn der Port wirft (Tresor nicht lesbar)', async () => {
    const ergebnis = await pruefeApiKey({
      apiKeys: {
        async has() {
          throw new Error('Tresor kaputt')
        }
      },
      anbieter: { id: 'openai', label: 'OpenAI' }
    })
    expect(ergebnis.status).toBe('fehler')
  })
})
