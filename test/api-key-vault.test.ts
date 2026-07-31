import { describe, it, expect } from 'vitest'
import { createApiKeyVault, migriereLegacyApiKey } from '@main/secrets/api-key-vault'
import type { SecretCipher, CiphertextFile } from '@main/secrets/api-key-store'

function fakeCipher(available = true): SecretCipher {
  return {
    isEncryptionAvailable: () => available,
    async encrypt(plain) {
      return new TextEncoder().encode('ENC:' + plain)
    },
    async decrypt(data) {
      const s = new TextDecoder().decode(data)
      if (!s.startsWith('ENC:')) throw new Error('kaputt')
      return s.slice(4)
    }
  }
}

// In-Memory-Datei je anbieterId (eine Map als „Dateisystem"). `beiseiteGelegt` zählt je anbieterId,
// wie oft die (optionale) Korruptions-Rettung gegriffen hat — Muster wie history-store.test.ts.
function fakeVault(available = true, aufKorruption?: (anbieterId: string) => void) {
  const dateien = new Map<string, Uint8Array>()
  const beiseiteGelegt = new Map<string, number>()
  const dateiFuer = (id: string): CiphertextFile => ({
    async read() {
      return dateien.get(id) ?? null
    },
    async write(d) {
      dateien.set(id, d)
    },
    async remove() {
      dateien.delete(id)
    },
    async beiseiteLegen() {
      beiseiteGelegt.set(id, (beiseiteGelegt.get(id) ?? 0) + 1)
      dateien.delete(id) // „umbenannt" → beim nächsten read weg
    }
  })
  return {
    vault: createApiKeyVault({ cipher: fakeCipher(available), dateiFuer, aufKorruption }),
    dateien,
    beiseiteGelegt
  }
}

function file(initial: Uint8Array | null = null): CiphertextFile & { data: Uint8Array | null } {
  const f = {
    data: initial,
    async read() {
      return f.data
    },
    async write(d: Uint8Array) {
      f.data = d
    },
    async remove() {
      f.data = null
    }
  }
  return f
}

describe('createApiKeyVault', () => {
  it('hält Keys pro Anbieter getrennt (set/get)', async () => {
    const { vault } = fakeVault()
    await vault.set('openai', 'sk-openai-123')
    await vault.set('groq', 'gsk-groq-456')
    expect(await vault.get('openai')).toBe('sk-openai-123')
    expect(await vault.get('groq')).toBe('gsk-groq-456')
    expect(await vault.get('mistral')).toBeNull()
  })

  it('has spiegelt die Existenz je Anbieter', async () => {
    const { vault } = fakeVault()
    expect(await vault.has('openai')).toBe(false)
    await vault.set('openai', 'sk-x')
    expect(await vault.has('openai')).toBe(true)
  })

  it('maske liefert die ersten 6 Zeichen, null ohne Key', async () => {
    const { vault } = fakeVault()
    await vault.set('openai', 'sk-proj-geheim')
    expect(await vault.maske('openai')).toBe('sk-pro')
    expect(await vault.maske('groq')).toBeNull()
  })

  it('clear entfernt nur den Key des einen Anbieters', async () => {
    const { vault } = fakeVault()
    await vault.set('openai', 'a')
    await vault.set('groq', 'b')
    await vault.clear('openai')
    expect(await vault.has('openai')).toBe(false)
    expect(await vault.has('groq')).toBe(true)
  })

  it('persistiert einen leeren Key nicht (Nicht-Existenz = nicht gesetzt)', async () => {
    const { vault } = fakeVault()
    await vault.set('openai', 'echt')
    await vault.set('openai', '   ')
    expect(await vault.has('openai')).toBe(false)
  })

  it('fehlertolerantes Decrypt: kaputtes Chiffrat → get null statt Wurf', async () => {
    const { vault, dateien } = fakeVault()
    dateien.set('openai', new TextEncoder().encode('NICHT-ENTSCHLUESSELBAR'))
    expect(await vault.get('openai')).toBeNull()
    expect(await vault.has('openai')).toBe(false)
  })

  it('set wirft, wenn Verschlüsselung nicht verfügbar', async () => {
    const { vault } = fakeVault(false)
    await expect(vault.set('openai', 'x')).rejects.toThrow(/Verschlüsselung/)
  })

  // --- A1: kaputtes Chiffrat darf nie still überschrieben werden ---
  describe('Korruptions-Rettung (A1)', () => {
    it('kaputtes Chiffrat: has() meldet weiterhin „kein Key", ABER die Datei wurde vorher gesichert + der Störfall gemeldet (MIT anbieterId, ohne Key-Material)', async () => {
      const gemeldet: string[] = []
      const { vault, dateien, beiseiteGelegt } = fakeVault(true, (anbieterId) => gemeldet.push(anbieterId))
      dateien.set('openai', new TextEncoder().encode('NICHT-ENTSCHLUESSELBAR'))

      expect(await vault.has('openai')).toBe(false) // unverändertes Verhalten nach außen

      expect(beiseiteGelegt.get('openai')).toBe(1) // aber vorher beiseitegelegt
      expect(gemeldet).toEqual(['openai']) // Störfall gemeldet, NUR die anbieterId
    })

    it('Datei existiert NICHT: kein beiseiteLegen, kein Störfall-Callback (kein Lärm bei Erstnutzung/unbekanntem Anbieter)', async () => {
      const gemeldet: string[] = []
      const { vault, beiseiteGelegt } = fakeVault(true, (anbieterId) => gemeldet.push(anbieterId))

      expect(await vault.has('openai')).toBe(false)

      expect(beiseiteGelegt.size).toBe(0)
      expect(gemeldet).toEqual([])
    })

    it('set() überschreibt ein kaputtes altes Chiffrat NICHT still — legt es vorher beiseite, der neue Key ist danach lesbar', async () => {
      const gemeldet: string[] = []
      const { vault, dateien, beiseiteGelegt } = fakeVault(true, (anbieterId) => gemeldet.push(anbieterId))
      dateien.set('openai', new TextEncoder().encode('NICHT-ENTSCHLUESSELBAR'))

      // set() OHNE vorherigen has()/get()/maske()-Aufruf — der Nutzer trägt „arglos" einen neuen Key ein.
      await vault.set('openai', 'sk-neu')

      expect(beiseiteGelegt.get('openai')).toBe(1) // altes Chiffrat wurde gesichert, nicht überschrieben
      expect(gemeldet).toEqual(['openai'])
      expect(await vault.get('openai')).toBe('sk-neu') // neuer Key ist verlässlich lesbar
    })

    it('mehrere Anbieter: Störfall wird je anbieterId separat gezählt/gemeldet', async () => {
      const gemeldet: string[] = []
      const { vault, dateien } = fakeVault(true, (anbieterId) => gemeldet.push(anbieterId))
      dateien.set('openai', new TextEncoder().encode('KAPUTT-1'))
      dateien.set('groq', new TextEncoder().encode('KAPUTT-2'))

      expect(await vault.has('openai')).toBe(false)
      expect(await vault.has('groq')).toBe(false)

      expect(gemeldet.sort()).toEqual(['groq', 'openai'])
    })

    it('Fake-Port OHNE beiseiteLegen: wirft nicht, meldet trotzdem den Störfall (optionale Methode)', async () => {
      let gemeldet = 0
      let data: Uint8Array | null = new TextEncoder().encode('NICHT-ENTSCHLUESSELBAR')
      const minimaleDatei: CiphertextFile = {
        async read() {
          return data
        },
        async write(d) {
          data = d
        },
        async remove() {
          data = null
        }
      }
      const vault = createApiKeyVault({
        cipher: fakeCipher(),
        dateiFuer: () => minimaleDatei,
        aufKorruption: () => gemeldet++
      })

      await expect(vault.has('openai')).resolves.toBe(false)
      expect(gemeldet).toBe(1)
    })

    it('ohne aufKorruption-Callback: kaputtes Chiffrat wird trotzdem beiseitegelegt (No-Op-Default)', async () => {
      const { vault, dateien, beiseiteGelegt } = fakeVault()
      dateien.set('openai', new TextEncoder().encode('NICHT-ENTSCHLUESSELBAR'))

      await expect(vault.has('openai')).resolves.toBe(false)
      expect(beiseiteGelegt.get('openai')).toBe(1)
    })
  })
})

describe('migriereLegacyApiKey', () => {
  it('übernimmt den alten Single-Key auf die Zieldatei und räumt den alten Pfad', async () => {
    const legacy = file(new TextEncoder().encode('ENC:sk-alt'))
    const ziel = file(null)
    await migriereLegacyApiKey({ legacy, ziel })
    expect(ziel.data).not.toBeNull()
    expect(new TextDecoder().decode(ziel.data!)).toBe('ENC:sk-alt')
    expect(legacy.data).toBeNull() // alter Pfad geräumt
  })

  it('ist idempotent: zweiter Lauf ohne Legacy ist ein No-Op', async () => {
    const legacy = file(null)
    const ziel = file(new TextEncoder().encode('ENC:sk-neu'))
    await migriereLegacyApiKey({ legacy, ziel })
    expect(new TextDecoder().decode(ziel.data!)).toBe('ENC:sk-neu') // unverändert
  })

  it('überschreibt ein vorhandenes Ziel nicht, räumt aber Legacy (abgebrochener Vorlauf)', async () => {
    const legacy = file(new TextEncoder().encode('ENC:sk-alt'))
    const ziel = file(new TextEncoder().encode('ENC:sk-schon-da'))
    await migriereLegacyApiKey({ legacy, ziel })
    expect(new TextDecoder().decode(ziel.data!)).toBe('ENC:sk-schon-da') // Ziel gewinnt
    expect(legacy.data).toBeNull()
  })
})
