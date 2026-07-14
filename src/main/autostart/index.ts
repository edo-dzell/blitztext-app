// Öffentliche Schnittstelle des Autostart-Moduls (W3-γ). Bewusst NICHT in composition-root/index.ts/
// settings/EinstellungenView verdrahtet — das ist Staffel 3.2. Dieses Modul liefert nur:
// Interface + reine Logik + eine Default-Port-Implementierung (Registry-Run-Key, Windows-only).

export type { RegistrySchreiber } from './autostart-port'
export {
  createAutostart,
  AUTOSTART_WERTNAME,
  type Autostart,
  type AutostartDeps,
  type AutostartStatus
} from './autostart'
export { createRegistrySchreiber, type RegistrySchreiberDeps } from './registry-schreiber'

import { createAutostart, type Autostart } from './autostart'
import { createRegistrySchreiber } from './registry-schreiber'

/** Verdrahtet die Default-Registry-Implementierung. Windows-only (siehe registry-schreiber.ts). */
export function createDefaultAutostart(): Autostart {
  return createAutostart({ registry: createRegistrySchreiber() })
}
