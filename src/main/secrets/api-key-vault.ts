// API-Key-Tresor (v0.2.3, ADR-0010): EIN verschlüsselter Key pro Anbieter, jeder in einer eigenen
// Datei (`api-key-<anbieterId>.bin`). Kein Sammel-Blob → kein Read-Modify-Write, kein Schreib-Race,
// Korruption bleibt auf einen Anbieter isoliert. Reiner Kern hinter injizierten Ports (Cipher + eine
// Datei-Fabrik je anbieterId) → ohne echtes safeStorage/fs testbar.

import type { SecretCipher, CiphertextFile } from './api-key-store'

export interface ApiKeyVault {
  has(anbieterId: string): Promise<boolean>
  get(anbieterId: string): Promise<string | null>
  set(anbieterId: string, key: string): Promise<void>
  clear(anbieterId: string): Promise<void>
  /** Erste Zeichen des Keys zur Wiedererkennung (S-2); null, wenn keiner hinterlegt ist. */
  maske(anbieterId: string): Promise<string | null>
}

const MASKE_LAENGE = 6

export function createApiKeyVault(deps: {
  cipher: SecretCipher
  dateiFuer: (anbieterId: string) => CiphertextFile
  /**
   * Störfall-Callback (A1, Muster wörtlich wie `SettingsStore.aufKorruption` in settings/store.ts):
   * feuert mit der betroffenen `anbieterId` (NIE Key-Material), wenn ein Key-Chiffrat EXISTIERT, aber
   * nicht entschlüsselbar ist (anderer Benutzer/Profil, DPAPI-Bindungswechsel, Korruption). Optional,
   * No-Op-Default; der Kern loggt/benachrichtigt bewusst NICHT selbst — das übernimmt index.ts.
   */
  aufKorruption?: (anbieterId: string) => void
}): ApiKeyVault {
  async function leseKey(anbieterId: string): Promise<string | null> {
    const datei = deps.dateiFuer(anbieterId)
    const data = await datei.read()
    if (data === null) return null // Datei existiert nicht → kein Key, KEIN Störfall
    try {
      return await deps.cipher.decrypt(data)
    } catch {
      // Nicht entschlüsselbar, ABER die Datei EXISTIERT (anderer Benutzer/Profil/Korruption,
      // RESEARCH R2) → NICHT stillschweigend wie „kein Key" behandeln: has()/maske() würden sonst
      // einen arglosen Neu-Eintrag des Keys anstoßen, dessen set() das alte Chiffrat überschreibt.
      // Stattdessen beiseite legen (Muster settings-file.ts, .korrupt-Suffix) UND melden — beides
      // BEVOR wir wie bisher „kein Key" zurückgeben (kein Crash beim Start).
      await datei.beiseiteLegen?.()
      deps.aufKorruption?.(anbieterId)
      return null
    }
  }

  return {
    async has(anbieterId) {
      return (await leseKey(anbieterId)) !== null
    },
    async get(anbieterId) {
      return leseKey(anbieterId)
    },
    async set(anbieterId, key) {
      const datei = deps.dateiFuer(anbieterId)
      if (key.trim() === '') {
        // Leeren Key nicht persistieren — Nicht-Existenz der Datei = „nicht gesetzt".
        await datei.remove()
        return
      }
      if (!deps.cipher.isEncryptionAvailable()) {
        throw new Error('Verschlüsselung nicht verfügbar')
      }
      // Ein vorhandenes, aber kaputtes altes Chiffrat NIE stillschweigend überschreiben — auch dann
      // nicht, wenn set() ohne vorherigen has()/maske()/get()-Aufruf direkt aufgerufen wird. leseKey()
      // legt ein defektes Chiffrat beiseite + meldet den Störfall; ein gültiges wird nur gelesen und
      // verworfen (kein zusätzlicher Seiteneffekt).
      await leseKey(anbieterId)
      await datei.write(await deps.cipher.encrypt(key))
    },
    async clear(anbieterId) {
      await deps.dateiFuer(anbieterId).remove()
    },
    async maske(anbieterId) {
      const key = await leseKey(anbieterId)
      if (key === null || key === '') return null
      return key.slice(0, MASKE_LAENGE)
    }
  }
}

/**
 * Migriert den alten Single-Key (`api-key.bin`) auf die anbieter-spezifische Datei des Standard-
 * Anbieters. Idempotent + verlustfrei: das Chiffrat wird 1:1 übernommen (gleicher Cipher), die alte
 * Datei danach geräumt. Reihenfolge-Invariante (ADR-0010): läuft NACH der Settings-Migration (die die
 * `standardAnbieterId` liefert) und VOR dem ersten Vault-Zugriff.
 */
export async function migriereLegacyApiKey(deps: {
  legacy: CiphertextFile
  ziel: CiphertextFile
}): Promise<void> {
  const alt = await deps.legacy.read()
  if (alt === null) return // nichts zu migrieren
  const vorhanden = await deps.ziel.read()
  if (vorhanden === null) {
    await deps.ziel.write(alt) // Ziel existiert nicht → Chiffrat übernehmen (nicht überschreiben)
  }
  await deps.legacy.remove() // alten Pfad räumen (auch wenn das Ziel schon existierte)
}
