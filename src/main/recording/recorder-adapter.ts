// Recorder-Adapter (#03/#11, HITL/Windows): erfüllt den Recorder-Port des Runners. MediaRecorder ist
// eine Renderer-API → der Main-Prozess kann nicht direkt aufnehmen. Topologie (Designentscheidung
// #11): ein VERSTECKTER Renderer (recorder.html) nimmt auf und schickt den Audio-Blob per IPC zurück.
// start/stop/discard sind Befehle an dieses Fenster; stop() löst auf, sobald 'recorder:result' kommt.
// Nicht headless verifizierbar (echtes Mikrofon/MediaRecorder) — Laufzeit-Abnahme auf Windows.
//
// W1-A (P0): Der Renderer kann während einer Aufnahme sterben (Crash, UAC/Win+L, Kill). Zwei Risiken:
//  (1) `webContents.send(...)` auf ein zerstörtes Fenster WIRFT synchron → ungefangen bis
//      `uncaughtException` → `app.exit(1)` (App-Tod). Deshalb JEDER send() hinter einem Guard;
//      discard() schluckt zusätzlich alles (darf den idle-Übergang des Runners nie killen).
//  (2) Stirbt der Renderer, während stop() auf 'recorder:result'/'recorder:error' wartet, kommt keiner
//      der once-Listener je → ewiger Hänger. Deshalb lauschen wir am webContents auf
//      'render-process-gone' und 'destroyed' und lösen wartende stop()-Promises mit Fehler auf.

import { ipcMain, type BrowserWindow, type IpcMainEvent } from 'electron'
import type { Recorder, RecordingResult } from '@main/workflow/runner'
import { NOOP_EREIGNISLOG, type EreignisLog } from '@main/diagnostics/ereignis-log'

interface RecorderErgebnis {
  buffer: ArrayBuffer
  durationSeconds: number
  mimeType: string
}

// Duck-typed: ruft isDestroyed() nur, wenn vorhanden (minimale Test-Fakes haben es nicht → gelten als
// lebendig). Ein echtes BrowserWindow/webContents liefert die Methode immer.
function istZerstoert(o: { isDestroyed?: () => boolean } | null | undefined): boolean {
  return !!o && typeof o.isDestroyed === 'function' && o.isDestroyed()
}

// Zerstörtes/nicht mehr sendbares Fenster? Reihenfolge bindend: erst das Fenster, dann webContents —
// sonst greift man auf ein bereits zerstörtes webContents zu.
function istSendbar(fenster: BrowserWindow): boolean {
  return !istZerstoert(fenster) && !!fenster.webContents && !istZerstoert(fenster.webContents)
}

// Sicher an das Recorder-Fenster senden; no-op (und NIE werfend), wenn nicht sendbar. Meldet über den
// Rückgabewert, ob gesendet wurde — stop() macht daraus einen Fehler statt eines ewigen Hängers.
function sendeSicher(fenster: BrowserWindow, channel: string): boolean {
  if (!istSendbar(fenster)) return false
  try {
    fenster.webContents.send(channel)
    return true
  } catch {
    // Race: zwischen Guard und send zerstört. Trotzdem nie werfen.
    return false
  }
}

export function createRecorder(fenster: BrowserWindow, deps?: { log?: EreignisLog }): Recorder {
  // v0.7.2 Ereignislog: optionale, text-freie Diagnose — nur Kanal-Namen/Fehler-Meta, nie Audio/Text.
  const log = deps?.log ?? NOOP_EREIGNISLOG

  // Bricht einen wartenden stop()-Promise ab (z. B. bei discard oder Renderer-Tod); null, wenn kein
  // stop läuft. Wird beim Aufräumen genullt, damit ein Renderer-Tod-Event keinen alten stop trifft.
  let brichLaufendenStopAb: ((fehler: Error) => void) | null = null

  // Renderer-Tod (Crash/Kill) reißt einen wartenden stop() aus dem Hänger: die once-Listener auf
  // ipcMain feuern dann nie → wir lösen den offenen stop() selbst mit Fehler auf. Einmal registriert,
  // greift für die Lebensdauer des (pro Aufnahme neu erzeugten) Fensters.
  const beiRendererTod = (): void => {
    // Feld-Beleg für die Fehlerjagd: unterscheidet stillen Renderer-Tod von einem Timeout.
    log.fehler('recorder.renderer_tot')
    brichLaufendenStopAb?.(new Error('Aufnahme-Fenster wurde beendet.'))
  }
  // webContents kann bei einem bereits zerstörten Fenster fehlen — dann gibt es nichts zu binden.
  // .on nur, wenn vorhanden (minimale Test-Fakes ohne EventEmitter überspringen das gefahrlos).
  const wc = fenster.webContents as (typeof fenster.webContents & { on?: unknown }) | undefined
  if (wc && !istZerstoert(wc) && typeof wc.on === 'function') {
    wc.on('render-process-gone', beiRendererTod)
    wc.on('destroyed', beiRendererTod)
  }

  return {
    start() {
      // sendeSicher bleibt generisch; das Ergebnis wird hier zum Feld-Beleg (Kanal), nie im Helfer.
      if (!sendeSicher(fenster, 'recorder:start')) log.warnung('recorder.sende_fehl', { kanal: 'start' })
      // v0.7.2 debug: nur der Umstand „Start-Befehl abgesetzt" — kein Audio/Text, keine Felder.
      else log.debug('recorder.start_gesendet')
    },
    discard() {
      // discard() darf NIE werfen: der Runner ruft es fire-and-forget aus abbrechen() und geht danach
      // nach idle — ein Throw hier würde diesen Übergang killen (P0).
      if (!sendeSicher(fenster, 'recorder:discard')) log.warnung('recorder.sende_fehl', { kanal: 'discard' })
      // Einen evtl. wartenden stop() rejecten, damit der Await nicht hängt (#03/S-8).
      brichLaufendenStopAb?.(new DOMException('Aufnahme verworfen.', 'AbortError'))
    },
    stop() {
      // Doppel-stop-Schutz: läuft bereits ein stop(), dessen Listener zuerst sauber abräumen und
      // ablehnen — sonst hinterließe der überschriebene brichLaufendenStopAb verwaiste once-Listener,
      // und der erste stop() hinge für immer.
      brichLaufendenStopAb?.(new DOMException('Aufnahme abgelöst durch erneutes Stoppen.', 'AbortError'))
      return new Promise<RecordingResult>((resolve, reject) => {
        const aufraeumen = (): void => {
          ipcMain.removeListener('recorder:result', onResult)
          ipcMain.removeListener('recorder:error', onError)
          brichLaufendenStopAb = null
        }
        const onResult = (_e: IpcMainEvent, data: RecorderErgebnis): void => {
          aufraeumen()
          // MIME-Type setzen, sonst sendet undici application/octet-stream → OpenAI 400 (RESEARCH §5).
          resolve({
            audio: new Blob([data.buffer], { type: data.mimeType || 'audio/webm' }),
            durationSeconds: data.durationSeconds
          })
        }
        const onError = (_e: IpcMainEvent, message: string): void => {
          aufraeumen()
          // Nur die (redigiert gekürzte) Meldung — kein Audio, kein Diktattext. Der Formatierer
          // schneidet zusätzlich auf 200 Zeichen und filtert Steuerzeichen.
          log.fehler('recorder.fehler', { message: (message ?? '').slice(0, 200) })
          reject(new Error(message))
        }
        brichLaufendenStopAb = (fehler: Error): void => {
          aufraeumen()
          reject(fehler)
        }
        ipcMain.once('recorder:result', onResult)
        ipcMain.once('recorder:error', onError)
        // Zerstörtes Fenster: gar nicht erst warten — der Renderer würde nie antworten (ewiger Hänger).
        // aufraeumen() entfernt die eben registrierten Listener wieder und meldet den Fehler.
        if (!sendeSicher(fenster, 'recorder:stop')) {
          aufraeumen()
          log.warnung('recorder.sende_fehl', { kanal: 'stop' })
          reject(new Error('Aufnahme-Fenster nicht verfügbar.'))
        } else {
          // v0.7.2 debug: nur der Umstand „Stop-Befehl abgesetzt" — kein Audio/Text, keine Felder.
          log.debug('recorder.stop_gesendet')
        }
      })
    }
  }
}
