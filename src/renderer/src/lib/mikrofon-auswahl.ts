// Reine Mikrofon-Geräteauswahl-Logik (W3-ζ, Slice v0.5.0). Kein React, kein Electron-API-Zugriff —
// node-testbar. Behebt: getUserMedia({audio:true}) ignoriert mehrere Mikrofone still zugunsten des
// OS-Standardgeräts. Die eigentliche Verdrahtung (Settings lesen/schreiben, EinstellungenView-Dropdown)
// macht Staffel 3.2 — diese Datei liefert nur die reinen Funktionen, die recorder.ts und 3.2 nutzen.

/** Eine für die UI/den Vergleich reduzierte Geräte-Info (nur was gebraucht wird). */
export interface MikrofonGeraet {
  id: string
  label: string
}

/**
 * Baut die getUserMedia-Constraints aus einer optionalen, gespeicherten deviceId. Ohne deviceId (oder
 * leerer String) bleibt es beim bisherigen Verhalten `{ audio: true }` (OS-Standardgerät) —
 * rückwärtskompatibel für alle, die noch keine Auswahl getroffen haben.
 */
export function waehleAudioConstraints(deviceId?: string): MediaStreamConstraints {
  if (!deviceId) return { audio: true }
  return { audio: { deviceId: { exact: deviceId } } }
}

/**
 * Reduziert das Ergebnis von navigator.mediaDevices.enumerateDevices() auf die Audio-Eingabegeräte
 * (kind === 'audioinput'), als schlanke {id,label}-Liste fürs Dropdown in 3.2.
 */
export function geraeteliste(
  enumerateResult: readonly Pick<MediaDeviceInfo, 'kind' | 'deviceId' | 'label'>[]
): MikrofonGeraet[] {
  return enumerateResult
    .filter((g) => g.kind === 'audioinput')
    .map((g) => ({ id: g.deviceId, label: g.label }))
}

/**
 * Fallback-Logik: wenn die gespeicherte deviceId nicht (mehr) unter den verfügbaren Geräten ist (Gerät
 * abgesteckt, Treiber weg, o.ä.), fällt die Auswahl auf das OS-Standardgerät zurück (undefined ⇒
 * waehleAudioConstraints liefert dann wieder {audio:true}). Keine gespeicherte Wahl ⇒ ebenfalls
 * OS-Standard.
 */
export function aufgeloesteGeraetewahl(
  gespeicherteId: string | undefined,
  verfuegbareIds: readonly string[]
): string | undefined {
  if (!gespeicherteId) return undefined
  return verfuegbareIds.includes(gespeicherteId) ? gespeicherteId : undefined
}
