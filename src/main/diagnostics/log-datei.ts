import { app } from 'electron'
import { appendFileSync, statSync, renameSync, rmSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { LogSenke } from './ereignis-log'

// Datei-Senke für das Ereignislog (v0.7.2). Muster: settings-file.ts/stats-file.ts (Pfad injizierbar,
// Default via app.getPath), Windows-AV-Kontext wie ciphertext-file.ts — hier aber bewusst SYNCHRON und
// OHNE Retry-Loop: eine app.fatal-Zeile muss auf Disk sein, BEVOR der Aufrufer (Crash-Handler)
// weiterläuft, und ein AV-Lock darf den Aufrufer NIE blockieren (lieber übergroße Datei als hängen).
//
// Redaction ist Sache des Ports (ereignis-log.ts); die Senke sieht nur fertige, text-freie Zeilen.

const STANDARD_MAX_BYTES = 1_000_000

// Nur die synchronen fs-Funktionen, die wir brauchen — injizierbar für Tests (rename-Fehler simulieren).
type FsTeil = Pick<
  typeof import('node:fs'),
  'appendFileSync' | 'statSync' | 'renameSync' | 'rmSync' | 'mkdirSync'
>

export interface LogDateiOptionen {
  /** Voller Pfad der aktiven Log-Datei. Default `<userData>/logs/blitztext.log`. */
  pfad?: string
  /** Rotationsschwelle in Bytes (vor dem Append geprüft). Default 1_000_000. */
  maxBytes?: number
  /** Injizierbare fs-Teilmenge für Tests. Default `node:fs` (synchron). */
  fs?: FsTeil
}

/** Verzeichnis, in dem das Log liegt — für `shell.openPath` in der LogsKarte / IPC `log:oeffneOrdner`. */
export function logOrdnerPfad(): string {
  return join(app.getPath('userData'), 'logs')
}

/**
 * Rotationsziel neben der aktiven Datei: `…/blitztext.log` → `…/blitztext.alt.log`. Bei einem Pfad
 * ohne `.log`-Endung (untypisch, nur Tests) wird `.alt` angehängt, damit alt≠aktiv garantiert bleibt.
 */
function altPfadVon(pfad: string): string {
  return /\.log$/i.test(pfad) ? pfad.replace(/\.log$/i, '.alt.log') : pfad + '.alt'
}

export function createLogDateiSenke(opts: LogDateiOptionen = {}): LogSenke {
  const pfad = opts.pfad ?? join(app.getPath('userData'), 'logs', 'blitztext.log')
  const altPfad = altPfadVon(pfad)
  const maxBytes = opts.maxBytes ?? STANDARD_MAX_BYTES
  const fs = opts.fs ?? { appendFileSync, statSync, renameSync, rmSync, mkdirSync }

  // Größe im Speicher mitführen (kein statSync pro Zeile). Initial aus der Datei, ENOENT → 0.
  let groesse = 0
  try {
    groesse = fs.statSync(pfad).size
  } catch {
    groesse = 0 // ENOENT o. Ä.: es gibt (noch) keine Datei → Größe 0
  }

  // Genau EIN console.error beim ersten unerwarteten Fehlschlag, danach still (keine Konsolen-Flut,
  // und niemals über das Log selbst → keine Rekursion).
  let fehlerGemeldet = false
  const meldeEinmal = (grund: unknown): void => {
    if (fehlerGemeldet) return
    fehlerGemeldet = true
    const code = (grund as NodeJS.ErrnoException)?.code ?? ''
    console.error(`[ereignislog] Schreiben ins Log fehlgeschlagen (${code || 'unbekannt'})`)
  }

  // Rotation: erst alt entfernen, dann aktiv→alt umbenennen. Wirft der rename (EPERM/EBUSY/EEXIST
  // durch AV-Locks) → Rotation ÜBERSPRINGEN und einfach weiterschreiben. Kein Sleep, kein Retry-Loop.
  const rotiereBeiBedarf = (naechsteBytes: number): void => {
    if (groesse + naechsteBytes <= maxBytes) return
    if (groesse === 0) return // eine einzelne übergroße Zeile: nichts zu rotieren
    try {
      fs.rmSync(altPfad, { force: true })
      fs.renameSync(pfad, altPfad)
      groesse = 0
    } catch {
      // Rotation nicht möglich (Datei gesperrt) → weiterschreiben in die aktive Datei.
    }
  }

  return {
    schreibeZeile(zeile: string): void {
      const daten = zeile + '\n'
      const bytes = Buffer.byteLength(daten, 'utf-8')

      rotiereBeiBedarf(bytes)

      try {
        fs.appendFileSync(pfad, daten, 'utf-8')
        groesse += bytes
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          // Ordner fehlt (erster Start / gelöschter logs-Ordner) → einmal anlegen und erneut anhängen.
          try {
            fs.mkdirSync(dirname(pfad), { recursive: true })
            fs.appendFileSync(pfad, daten, 'utf-8')
            groesse += bytes
          } catch (retryFehler) {
            meldeEinmal(retryFehler) // nie werfen — der Aufrufer darf nicht gestört werden
          }
          return
        }
        meldeEinmal(error) // jeder andere Fehler: gefangen, genau ein console.error, danach still
      }
    },
    setzeZurueck(): void {
      // Nach dem Löschen der Log-Dateien (IPC `log:loeschen`): die mitgeführte Größe muss auf 0, sonst
      // rotierte die nächste Zeile die frisch neu erzeugte, praktisch leere Datei überflüssigerweise.
      groesse = 0
    }
  }
}
