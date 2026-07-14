// Check 3: ist mindestens ein Mikrofon verfügbar? Der Main-Prozess hat KEINEN direkten Zugriff auf
// Medien-Geräte (das ist Renderer-/Browser-API-Territorium, `navigator.mediaDevices.enumerateDevices`).
// Der Port liefert deshalb bewusst nur eine bereits ermittelte Geräte-ANZAHL statt eines
// Geräte-Zugriffs — die Ermittlung selbst passiert im Renderer.
//
// Verdrahtung 3.2: die Renderer-Seite ruft `navigator.mediaDevices.enumerateDevices()` auf, filtert
// auf `kind === 'audioinput'` und liefert die Anzahl über IPC an den Main-Prozess (oder der Check
// läuft direkt im Renderer/Preload-Kontext — je nachdem, wo die Ampel-UI rendert). `geraete.anzahl`
// ist genau diese Zahl. 0 Geräte ⇒ fehler (kein Diktieren ohne Mikrofon möglich), Ermittlungsfehler
// (z. B. Berechtigung verweigert) werden vom Port selbst als Wurf signalisiert.

import type { HealthErgebnis } from './types'

/** Minimaler Port: die vom Renderer eingespeiste Zahl verfügbarer Audio-Eingabegeräte. */
export interface MikrofonPort {
  anzahl(): Promise<number>
}

export interface PruefeMikrofonDeps {
  geraete: MikrofonPort
}

export async function pruefeMikrofon(deps: PruefeMikrofonDeps): Promise<HealthErgebnis> {
  let anzahl: number
  try {
    anzahl = await deps.geraete.anzahl()
  } catch {
    return {
      status: 'fehler',
      titel: 'Mikrofon',
      detail: 'Verfügbare Mikrofone konnten nicht ermittelt werden (evtl. Berechtigung verweigert).'
    }
  }

  if (anzahl <= 0) {
    return {
      status: 'fehler',
      titel: 'Mikrofon',
      detail: 'Kein Mikrofon gefunden. Bitte ein Aufnahmegerät anschließen oder aktivieren.'
    }
  }

  return {
    status: 'ok',
    titel: 'Mikrofon',
    detail: anzahl === 1 ? 'Ein Mikrofon verfügbar.' : `${anzahl} Mikrofone verfügbar.`
  }
}
