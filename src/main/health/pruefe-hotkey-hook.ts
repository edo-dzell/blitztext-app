// Check 4: läuft der globale Tastatur-Hook (uiohook)? Ohne ihn feuert kein Hotkey → Diktieren ist
// faktisch tot, deshalb 'fehler' (nicht 'warnung') wenn er nicht aktiv ist.
//
// Verdrahtung 3.2: `hook.istAktiv` liefert, ob `starteUiohookQuelle` (`@main/hotkey/uiohook-source`)
// erfolgreich gestartet wurde — dessen `hook.start()` ist in try/catch gekapselt und liefert im
// Fehlerfall einen No-Op-Stop-Thunk zurück, OHNE das selbst zu signalisieren. Für diesen Check muss
// die Composition-Root den Erfolg/Misserfolg von `starteUiohookQuelle` (bzw. einen äquivalenten
// Laufstatus des Dispatchers) in einem kleinen Stück Zustand ablegen, das `istAktiv()` abfragt.

import type { HealthErgebnis } from './types'

/** Minimaler Port: läuft der uiohook-Dispatcher gerade? */
export interface HotkeyHookPort {
  istAktiv(): Promise<boolean>
}

export interface PruefeHotkeyHookDeps {
  hook: HotkeyHookPort
}

export async function pruefeHotkeyHook(deps: PruefeHotkeyHookDeps): Promise<HealthErgebnis> {
  let aktiv: boolean
  try {
    aktiv = await deps.hook.istAktiv()
  } catch {
    return {
      status: 'fehler',
      titel: 'Hotkey-Erkennung',
      detail: 'Der Status der globalen Tastenerkennung konnte nicht ermittelt werden.'
    }
  }

  if (!aktiv) {
    return {
      status: 'fehler',
      titel: 'Hotkey-Erkennung',
      detail:
        'Die globale Tastenerkennung läuft nicht. Hotkeys lösen nicht aus — App neu starten oder Berechtigungen prüfen.'
    }
  }

  return {
    status: 'ok',
    titel: 'Hotkey-Erkennung',
    detail: 'Die globale Tastenerkennung ist aktiv.'
  }
}
