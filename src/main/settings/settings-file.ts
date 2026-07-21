import { app } from 'electron'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { ersetzeAtomar } from '@main/fs/ersetze-atomar'
import type { SettingsFile } from './store'

// Einstellungs-Datei im benutzergebundenen userData-Verzeichnis — pro Benutzer (ADR-0005/ADR-0006:
// portabel = Daten in %APPDATA%, wandern nicht mit). Pfad injizierbar → ohne Electron testbar.
// Muster wie ciphertext-file.ts (#01).
export function createSettingsFile(
  filePath: string = join(app.getPath('userData'), 'settings.json')
): SettingsFile {
  return {
    async read() {
      try {
        return await readFile(filePath, 'utf-8')
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
        throw error
      }
    },
    async write(content) {
      // Atomar (v0.7.3, A3): erst in .tmp schreiben, dann Windows-erprobt umbenennen — ein Absturz
      // mitten im Schreiben lässt die alte Zieldatei unversehrt, statt sie halb zu überschreiben.
      await mkdir(dirname(filePath), { recursive: true })
      const tmp = `${filePath}.tmp`
      await writeFile(tmp, content, 'utf-8')
      await ersetzeAtomar(tmp, filePath)
    },
    // Korruptions-Rettung (v0.7.3, A3): eine unlesbare Datei nach settings.json.korrupt verschieben,
    // damit der nächste Start sie nicht erneut ablehnt. Best effort — wirft NIE (der Start soll auch
    // dann mit Defaults weiterlaufen, wenn selbst das Umbenennen scheitert, z. B. AV-Lock erschöpft).
    async beiseiteLegen() {
      try {
        await ersetzeAtomar(filePath, `${filePath}.korrupt`)
      } catch {
        // bewusst geschluckt: die Rettung ist optional, der Start hat Vorrang
      }
    }
  }
}
