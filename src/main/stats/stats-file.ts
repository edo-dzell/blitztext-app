import { app } from 'electron'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { ersetzeAtomar } from '@main/fs/ersetze-atomar'
import type { StatsFile } from './stats-store'

// Statistik-Datei (text-frei, unverschlüsselt) im userData-Verzeichnis — pro Benutzer (ADR-0005).
// Muster wie settings-file.ts. Pfad injizierbar → ohne Electron testbar.
export function createStatsFile(
  filePath: string = join(app.getPath('userData'), 'stats.json')
): StatsFile {
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
      // Atomar (v0.7.3, A3): tmp schreiben, dann Windows-erprobt umbenennen — ein Absturz mitten im
      // Schreiben lässt die alte Statistik-Datei unversehrt statt sie halb zu überschreiben.
      await mkdir(dirname(filePath), { recursive: true })
      const tmp = `${filePath}.tmp`
      await writeFile(tmp, content, 'utf-8')
      await ersetzeAtomar(tmp, filePath)
    }
  }
}
