// Echter Cache-Speicher-Adapter für pruefeAufUpdate (Staffel 3.2). Eine kleine JSON-Datei im
// userData-Verzeichnis (nicht der Settings-Slice — der Cache ist reiner Netz-Zustand: Zeitstempel/
// ETag/letztes Ergebnis, gehört nicht in die vom Nutzer editierten Einstellungen und darf verworfen
// werden). Muster wie settings-file.ts: Pfad injizierbar → ohne Electron testbar, ENOENT ⇒ null,
// kaputter Inhalt ⇒ null (die reine Logik behandelt beides als „kein Cache").

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { UpdateCacheEintrag, UpdateCacheSpeicher } from './update-hinweis'

function istEintrag(wert: unknown): wert is UpdateCacheEintrag {
  if (typeof wert !== 'object' || wert === null) return false
  const o = wert as Record<string, unknown>
  return typeof o.geprueftAmMs === 'number' && typeof o.letztesErgebnis === 'object' && o.letztesErgebnis !== null
}

/** JSON-Datei-basierter Cache-Port. `filePath` i. d. R. `<userData>/update-cache.json`. */
export function createUpdateCacheFile(filePath: string): UpdateCacheSpeicher {
  return {
    async lesen() {
      let roh: string
      try {
        roh = await readFile(filePath, 'utf-8')
      } catch {
        return null // ENOENT o. Ä. → kein Cache
      }
      try {
        const parsed: unknown = JSON.parse(roh)
        return istEintrag(parsed) ? parsed : null
      } catch {
        return null // kaputter JSON → wie kein Cache
      }
    },
    async schreiben(eintrag: UpdateCacheEintrag) {
      await mkdir(dirname(filePath), { recursive: true })
      await writeFile(filePath, JSON.stringify(eintrag), 'utf-8')
    }
  }
}
