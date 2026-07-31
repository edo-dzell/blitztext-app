import { app } from 'electron'
import { readFile, writeFile, rm, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { ersetzeAtomar } from '@main/fs/ersetze-atomar'
import type { CiphertextFile } from './api-key-store'

// Generische Chiffrat-Datei im benutzergebundenen userData-Verzeichnis — pro Benutzer (ADR-0005).
// Pfad injizierbar → ohne Electron testbar. Genutzt für api-key-<id>.bin und (V2) history.bin.
export function createCiphertextFile(filePath: string): CiphertextFile {
  return {
    async read() {
      try {
        return new Uint8Array(await readFile(filePath))
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
        throw error
      }
    },
    async write(data) {
      await mkdir(dirname(filePath), { recursive: true })
      const tmp = `${filePath}.tmp`
      await writeFile(tmp, data)
      await ersetzeAtomar(tmp, filePath)
    },
    async remove() {
      await rm(filePath, { force: true })
    },
    // Korruptions-Rettung (A1) — wörtlich das Muster aus settings-file.ts: nicht wirft, damit ein
    // fehlgeschlagenes Umbenennen (z. B. AV-Lock erschöpft) den Aufrufer nicht zu Fall bringt.
    async beiseiteLegen() {
      try {
        await ersetzeAtomar(filePath, `${filePath}.korrupt`)
      } catch {
        // bewusst geschluckt: die Rettung ist optional, der Aufrufer (Vault/Verlauf) hat Vorrang
      }
    }
  }
}

/** Chiffrat-Datei je Anbieter (v0.2.3, ADR-0010): `api-key-<anbieterId>.bin`. */
export function createApiKeyVaultFile(anbieterId: string): CiphertextFile {
  const sicher = anbieterId.replace(/[^a-zA-Z0-9._-]/g, '_')
  return createCiphertextFile(join(app.getPath('userData'), `api-key-${sicher}.bin`))
}

// Chiffrat-Datei des API-Keys (Default-Pfad).
export function createApiKeyFile(
  filePath: string = join(app.getPath('userData'), 'api-key.bin')
): CiphertextFile {
  return createCiphertextFile(filePath)
}

// Verschlüsselte Verlauf-Datei (V2 Strang D).
export function createHistoryFile(
  filePath: string = join(app.getPath('userData'), 'history.bin')
): CiphertextFile {
  return createCiphertextFile(filePath)
}
