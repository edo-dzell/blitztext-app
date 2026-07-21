// Versteckter Aufnahme-Renderer (#03/#11, HITL/Windows). Empfängt start/stop/discard aus dem Main-
// Prozess (über die Preload-Bridge blitztextRecorder), nimmt das Mikrofon via MediaRecorder auf und
// schickt den fertigen Blob (als ArrayBuffer) + die gemessene Dauer zurück. Kein UI — das Fenster
// bleibt unsichtbar. Laufzeit-Abnahme (echtes Mikrofon, Berechtigungen) auf Windows.

import { waehleAudioConstraints } from './lib/mikrofon-auswahl'

declare global {
  interface Window {
    blitztextRecorder: {
      onStart(cb: () => void): void
      onStop(cb: () => void): void
      onDiscard(cb: () => void): void
      sendResult(buffer: ArrayBuffer, durationSeconds: number, mimeType: string): void
      sendError(message: string): void
    }
  }
}

/**
 * Schreibt eine Fehler-Zeile ins Ereignislog (v0.7.2), OHNE je zu werfen — Logging darf die Aufnahme
 * nie stören. Nur redigierte Primitive (name/message, ≤200 Zeichen), NIE Audio-/Diktat-Inhalt. Der
 * Main redigiert/validiert zusätzlich (parseRendererLog).
 */
function logFehlerStill(ereignis: string, felder?: Record<string, string | number | boolean>): void {
  try {
    window.blitztext?.log?.schreibe('fehler', ereignis, felder)
  } catch {
    // Log-Bridge fehlt (z. B. im Recorder-Fenster ohne Isolation) oder wirft → still verschlucken.
  }
}

/** Redigiert einen unbekannten Fehler auf name+message, jeweils auf ≤200 Zeichen gekürzt (kein Leak). */
function redigiereFehlerFelder(err: unknown): { name: string; message: string } {
  if (err instanceof Error) {
    return { name: err.name.slice(0, 200), message: err.message.slice(0, 200) }
  }
  return { name: 'Unknown', message: String(err).slice(0, 200) }
}

let mediaRecorder: MediaRecorder | null = null
let chunks: Blob[] = []
let stream: MediaStream | null = null
let startMs = 0

function aufräumen(): void {
  stream?.getTracks().forEach((t) => t.stop())
  stream = null
  mediaRecorder = null
  chunks = []
}

/**
 * Liest die gewünschte Mikrofon-deviceId aus den Einstellungen (W3-ζ). Staffel 3.2 ergänzt das Feld
 * in BlitztextSettings + die Auswahl-UI — bis dahin liefert settings.get() das Feld nicht, der
 * optionale Zugriff bleibt aber schon fertig verdrahtet (kein weiterer Anschluss hier nötig). Jeder
 * Fehler (z. B. Settings noch nicht erreichbar) fällt auf „kein Wunschgerät" zurück, NIE die Aufnahme
 * blockieren.
 */
async function ermittleGewuenschteDeviceId(): Promise<string | undefined> {
  try {
    const settings = (await window.blitztext.settings.get()) as { mikrofonDeviceId?: string }
    return settings.mikrofonDeviceId
  } catch {
    return undefined
  }
}

async function starteAufnahme(): Promise<void> {
  try {
    const deviceId = await ermittleGewuenschteDeviceId()
    stream = await navigator.mediaDevices.getUserMedia(waehleAudioConstraints(deviceId))
    chunks = []
    mediaRecorder = new MediaRecorder(stream) // Chromium-Default: audio/webm;codecs=opus
    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data)
    }
    startMs = performance.now()
    mediaRecorder.start()
  } catch (err) {
    aufräumen()
    // v0.7.2: zusätzlich (Verhalten von sendError bleibt exakt) ins Ereignislog — Feld-Beleg für die
    // Fehlerjagd „Aufnahme startet nicht". Nur redigierte name/message, nie Audio-Inhalt.
    logFehlerStill('recorder.getusermedia_fehl', redigiereFehlerFelder(err))
    window.blitztextRecorder.sendError(err instanceof Error ? err.message : String(err))
  }
}

function stoppeAufnahme(): void {
  const recorder = mediaRecorder
  if (!recorder) {
    window.blitztextRecorder.sendError('Keine aktive Aufnahme.')
    return
  }
  const durationSeconds = (performance.now() - startMs) / 1000
  recorder.onstop = () => {
    const type = recorder.mimeType || 'audio/webm'
    const blob = new Blob(chunks, { type })
    // electron#42714: getUserMedia kann ohne Mikrofon-Zugriff still ein leeres Track liefern statt zu
    // werfen → leere Aufnahme als Fehler melden (oft Windows-Mikrofon-Datenschutz).
    if (blob.size === 0) {
      // v0.7.2: zusätzlich (sendError-Pfad unverändert) ins Ereignislog. bytes=0 ist eine Länge, kein
      // Inhalt — datenschutzkonform.
      logFehlerStill('recorder.leere_aufnahme', { bytes: 0 })
      window.blitztextRecorder.sendError(
        'Mikrofon lieferte keine Audiodaten — bitte Windows-Mikrofon-Datenschutz prüfen.'
      )
      aufräumen()
      return
    }
    void blob.arrayBuffer().then((buffer) => {
      // MIME-Type MITGEBEN: sonst baut der Main-Prozess einen typlosen Blob → undici sendet
      // application/octet-stream → OpenAI 400 „Unrecognized file format" (RESEARCH §5).
      window.blitztextRecorder.sendResult(buffer, durationSeconds, type)
      aufräumen()
    })
  }
  recorder.stop()
}

function verwerfeAufnahme(): void {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.onstop = null
    mediaRecorder.stop()
  }
  aufräumen()
}

window.blitztextRecorder.onStart(() => void starteAufnahme())
window.blitztextRecorder.onStop(() => stoppeAufnahme())
window.blitztextRecorder.onDiscard(() => verwerfeAufnahme())

export {}
