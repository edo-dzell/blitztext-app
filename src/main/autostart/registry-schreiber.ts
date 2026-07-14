// Default-Implementierung des RegistrySchreiber-Ports über das Windows-Bordmittel `reg.exe`.
//
// Wahl reg.exe statt app.setLoginItemSettings (Begründung, siehe autostart-port.ts):
// - Portable .exe hat keinen Installer-Registrierungspfad; Electrons setLoginItemSettings ist für
//   diesen Fall nicht zuverlässig dokumentiert/getestet und bietet zudem kein "lies den Ziel-Pfad des
//   vorhandenen Eintrags" — genau das braucht die Verwaisungs-Prüfung in autostart.ts.
// - reg.exe ist auf jedem Windows vorhanden (kein natives Zusatzmodul wie win-paste.exe nötig),
//   arbeitet direkt auf HKCU (kein Admin), und liefert über stdout/Exit-Code eine einfache,
//   testbare Schnittstelle (Exit-Code 1 bei "Wert nicht gefunden" ist normal, kein Fehler).
// - Gleiches Baumuster wie paste-adapter.ts (spawn, injizierbare spawnFn, windowsHide) — konsistent
//   mit dem Rest der Windows-Interop in dieser Codebase.
//
// NUR auf Windows real ausführbar/wirksam (reg.exe existiert auf macOS/Linux nicht) — HITL auf
// Windows steht aus. Auf anderen Plattformen scheitert jeder Aufruf (spawn-ENOENT) kontrolliert;
// die Aufrufer (autostart.ts) werfen dadurch, verdrahten aber ihrerseits nicht auf — Fehlerbehandlung
// ist Sache von Staffel 3.2.

import { spawn } from 'node:child_process'
import type { RegistrySchreiber } from './autostart-port'

const RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'

interface ProzessErgebnis {
  code: number | null
  stdout: string
}

function fuehreAus(spawnFn: typeof spawn, args: string[]): Promise<ProzessErgebnis> {
  return new Promise((resolve, reject) => {
    let stdout = ''
    try {
      const kind = spawnFn('reg', args, { windowsHide: true })
      kind.stdout?.on('data', (chunk) => {
        stdout += chunk.toString()
      })
      kind.once('error', reject) // z. B. ENOENT auf Nicht-Windows
      kind.once('exit', (code) => resolve({ code, stdout }))
    } catch (error) {
      reject(error)
    }
  })
}

export interface RegistrySchreiberDeps {
  /** Injizierbar für Tests; Default: node:child_process spawn. */
  spawnFn?: typeof spawn
}

/** Registry-basierter Autostart-Port für den HKCU-Run-Key (siehe Datei-Kopf). Windows-only. */
export function createRegistrySchreiber(deps: RegistrySchreiberDeps = {}): RegistrySchreiber {
  const spawnFn = deps.spawnFn ?? spawn

  return {
    async setze(name, pfad) {
      const ergebnis = await fuehreAus(spawnFn, [
        'add',
        RUN_KEY,
        '/v',
        name,
        '/t',
        'REG_SZ',
        '/d',
        pfad,
        '/f'
      ])
      if (ergebnis.code !== 0) {
        throw new Error(`reg add fehlgeschlagen (Exit-Code ${ergebnis.code})`)
      }
    },
    async entferne(name) {
      const ergebnis = await fuehreAus(spawnFn, ['delete', RUN_KEY, '/v', name, '/f'])
      // Exit-Code 1 = Wert existiert nicht → für unser idempotentes "entferne" kein Fehler.
      if (ergebnis.code !== 0 && !istWertNichtGefunden(ergebnis)) {
        throw new Error(`reg delete fehlgeschlagen (Exit-Code ${ergebnis.code})`)
      }
    },
    async liest(name) {
      const ergebnis = await fuehreAus(spawnFn, ['query', RUN_KEY, '/v', name])
      if (ergebnis.code !== 0) return null // Wert nicht vorhanden
      return parseRegQueryWert(ergebnis.stdout, name)
    }
  }
}

function istWertNichtGefunden(ergebnis: ProzessErgebnis): boolean {
  return ergebnis.code === 1
}

/**
 * Parst die Ausgabe von `reg query <key> /v <name>`, z. B.:
 *   HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Run
 *       Blitztext    REG_SZ    "C:\Users\x\AppData\Local\Blitztext\Blitztext.exe"
 * Whitespace-tolerant (reg.exe formatiert Spalten mit variabler Breite je nach Locale/Version).
 */
function parseRegQueryWert(stdout: string, name: string): string | null {
  const zeile = stdout
    .split(/\r?\n/)
    .find((z) => new RegExp(`^\\s*${escapeRegExp(name)}\\s+REG_SZ\\s+`).test(z))
  if (!zeile) return null
  const match = zeile.match(new RegExp(`^\\s*${escapeRegExp(name)}\\s+REG_SZ\\s+(.*)$`))
  return match?.[1] ? match[1].trim() : null
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
