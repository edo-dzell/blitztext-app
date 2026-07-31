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
  /** v0.7.4: Spitze + Grundrauschen der Aufnahme (RMS, 0…1) oder null, wenn keine Messung gelang. */
  pegel?: { max: number; median: number } | null
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
// Befund 7a (v0.8.0): `payload` ist optional — bleibt es weg (stop/discard, wie bisher), sendet
// webContents.send() ganz OHNE zusätzliches Argument (Altweg für den Renderer exakt erhalten). Befund 2
// (v0.8.x): `payload` bewusst `unknown` statt `string` — der 'recorder:start'-Kanal trägt jetzt ein
// kleines Objekt ({ deviceId, lauf }, siehe start()), der Helfer selbst bleibt aber generisch/dumm.
function sendeSicher(fenster: BrowserWindow, channel: string, payload?: unknown): boolean {
  if (!istSendbar(fenster)) return false
  try {
    if (payload === undefined) fenster.webContents.send(channel)
    else fenster.webContents.send(channel, payload)
    return true
  } catch {
    // Race: zwischen Guard und send zerstört. Trotzdem nie werfen.
    return false
  }
}

/** Nutzlast des 'recorder:start'-Kanals (Befund 7a: deviceId; Befund 2: zusätzlich der Lauf-Bezug). */
interface StartNutzlast {
  deviceId?: string
  lauf?: number
}

export function createRecorder(fenster: BrowserWindow, deps?: { log?: EreignisLog }): Recorder {
  // v0.7.2 Ereignislog: optionale, text-freie Diagnose — nur Kanal-Namen/Fehler-Meta, nie Audio/Text.
  const log = deps?.log ?? NOOP_EREIGNISLOG

  // Bricht einen wartenden stop()-Promise ab (z. B. bei discard oder Renderer-Tod); null, wenn kein
  // stop läuft. Wird beim Aufräumen genullt, damit ein Renderer-Tod-Event keinen alten stop trifft.
  let brichLaufendenStopAb: ((fehler: Error) => void) | null = null

  // v0.7.3 (A1): externer Aufnahme-Fehlerkanal. Der Renderer kann einen 'recorder:error' senden, WÄHREND
  // gar kein stop() läuft (Aufnahme läuft noch, aber das Mikrofon fällt aus — z. B. exklusiv belegt,
  // MediaRecorder-Fehler). Der wartende-stop()-once-Listener existiert dann nicht → der Fehler ginge
  // verloren, die Pille zeigte weiter „Aufnahme". `externerFehlerCb` reicht ihn an den Runner
  // (meldeAufnahmeFehler). Wird über onFehler() gesetzt; null = nicht verdrahtet (kein Verhaltensbruch).
  let externerFehlerCb: ((message: string) => void) | null = null
  // true, solange ein stop() auf sein Ergebnis wartet: dann hat der once-Listener in stop() Vorrang und
  // der dauerhafte Listener hält sich raus (keine Doppelverarbeitung desselben recorder:error).
  let stopLaeuft = false

  // v0.8.0 (Befund 9): externer Start-Bestätigungskanal, analog zu externerFehlerCb. Der Renderer sendet
  // 'recorder:gestartet', SOBALD mediaRecorder.start() dort erfolgreich lief — erst dann darf die Pille
  // von „Starte …" auf „Aufnahme …" wechseln (vorher könnte der Nutzer bei langsamem Gerätestart, z. B.
  // Defender-Erstscan oder Bluetooth-Mikro, ins Leere sprechen). Kein stop()-Konkurrenzfall wie beim
  // Fehlerkanal nötig: 'recorder:gestartet' feuert immer VOR jedem stop(), also ohne stopLaeuft-Guard.
  // Befund 2 (v0.8.x): nimmt zusätzlich den (optionalen) Lauf-Bezug entgegen, den der Recorder-Renderer
  // aus seiner Start-Nutzlast zurückspiegelt — durchgereicht bis zu runner.meldeAufnahmeBestaetigt.
  let externerGestartetCb: ((lauf?: number) => void) | null = null

  // Dauerhafter Listener (die Lebensdauer des Adapters, NICHT pro stop() abgeräumt): fängt recorder:error
  // AUSSERHALB eines wartenden stop() ab. Der wartende stop() nutzt seinen eigenen once('recorder:error')
  // — der `stopLaeuft`-Guard verhindert, dass BEIDE denselben Fehler verarbeiten.
  const beiExternemFehler = (_e: IpcMainEvent, message: string): void => {
    if (stopLaeuft) return // der stop()-once-Listener übernimmt → hier nichts tun (keine Doppelmeldung)
    // Feld-Beleg (text-frei): externer Aufnahme-Fehler ohne laufenden stop(). Nur die gekürzte Meldung.
    log.fehler('recorder.fehler_extern', { message: (message ?? '').slice(0, 200) })
    externerFehlerCb?.(message ?? 'Aufnahme fehlgeschlagen.')
  }
  ipcMain.on('recorder:error', beiExternemFehler)

  // v0.8.0 (Befund 9): dauerhafter Listener für die Start-Bestätigung — läuft für die Lebensdauer des
  // Adapters, NICHT pro Lauf neu registriert (gleiches Muster wie beiExternemFehler). Befund 2 (v0.8.x):
  // `lauf` ist die vom Renderer unverändert zurückgespiegelte Start-Nutzlast (s. u.) — reines Durchreichen,
  // die Main-eigene Prüfung „ist das noch der erwartete Lauf?" liegt bewusst beim Runner (istAktuell-
  // Muster), NICHT hier im Adapter (kein zweites, konkurrierendes Konzept).
  const beiExternerBestaetigung = (_e: IpcMainEvent, lauf?: number): void => {
    log.debug('recorder.gestartet_bestaetigt')
    externerGestartetCb?.(lauf)
  }
  ipcMain.on('recorder:gestartet', beiExternerBestaetigung)

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
    // Befund 7a (v0.8.0): deviceId wird als Nutzlast mitgeschickt, statt sie den Recorder-Renderer per
    // IPC (settings:get) nachfragen zu lassen. Ohne Angabe (Altweg, alte Aufrufer/Tests) bleibt der
    // Kanal payload-los — der Renderer fällt dort auf seinen bisherigen IPC-Pull zurück.
    // Befund 2 (v0.8.x): `lauf` (optional) reist als zweites Nutzlast-Feld mit — der Runner erzeugt ihn
    // pro Aufnahme-Versuch frisch, der Recorder-Renderer spiegelt ihn unverändert in seiner Start-
    // Bestätigung zurück (siehe onGestartet/beiExternerBestaetigung). Fehlen BEIDE Felder (Altweg, kein
    // Aufrufer kennt den Lauf-Bezug), bleibt der Kanal wie bisher komplett payload-los.
    start(deviceId?: string, lauf?: number) {
      const payload: StartNutzlast | undefined =
        deviceId === undefined && lauf === undefined ? undefined : { deviceId, lauf }
      // sendeSicher bleibt generisch; das Ergebnis wird hier zum Feld-Beleg (Kanal), nie im Helfer.
      if (!sendeSicher(fenster, 'recorder:start', payload)) {
        log.warnung('recorder.sende_fehl', { kanal: 'start' })
        // v0.7.3 (A1): das Aufnahme-Fenster ist nicht verfügbar → der Runner steht in Phase 'aufnehmen'
        // und bekäme sonst nie ein stop()-Ergebnis (der Nutzer hält evtl. nur kurz und lässt gleich los,
        // aber ohne laufende Aufnahme). Sofort über den externen Fehlerkanal melden, damit die Pille den
        // Fehler zeigt statt endlos „Aufnahme".
        externerFehlerCb?.('Aufnahme-Fenster nicht verfügbar.')
      }
      // v0.7.2 debug: nur der Umstand „Start-Befehl abgesetzt" — kein Audio/Text, keine Felder.
      else log.debug('recorder.start_gesendet')
    },
    onFehler(cb) {
      // v0.7.3 (A1): Composition verdrahtet hier runner.meldeAufnahmeFehler. Ein einzelner Empfänger reicht
      // (ein Runner je Recorder); der letzte Aufruf gewinnt.
      externerFehlerCb = cb
    },
    onGestartet(cb) {
      // v0.8.0 (Befund 9): Composition verdrahtet hier runner.meldeAufnahmeBestaetigt. Gleiches Muster wie
      // onFehler — ein einzelner Empfänger reicht, der letzte Aufruf gewinnt. Befund 2 (v0.8.x): `cb`
      // erhält jetzt zusätzlich den Lauf-Bezug (optional) — reines Durchreichen, siehe StartNutzlast/
      // beiExternerBestaetigung oben.
      externerGestartetCb = cb
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
      // v0.7.3 (A1): ab jetzt hat der stop()-eigene once('recorder:error')-Listener Vorrang; der
      // dauerhafte externe Listener (beiExternemFehler) hält sich per stopLaeuft-Guard raus. Wichtig:
      // der dauerhafte Listener wurde ZUERST registriert und feuert daher vor dem once-Listener — der
      // Guard greift also, bevor aufraeumen() ihn wieder freigibt (keine Doppelverarbeitung).
      stopLaeuft = true
      return new Promise<RecordingResult>((resolve, reject) => {
        const aufraeumen = (): void => {
          ipcMain.removeListener('recorder:result', onResult)
          ipcMain.removeListener('recorder:error', onError)
          brichLaufendenStopAb = null
          stopLaeuft = false // stop() beendet → der dauerhafte externe Listener übernimmt wieder
        }
        const onResult = (_e: IpcMainEvent, data: RecorderErgebnis): void => {
          aufraeumen()
          // MIME-Type setzen, sonst sendet undici application/octet-stream → OpenAI 400 (RESEARCH §5).
          resolve({
            audio: new Blob([data.buffer], { type: data.mimeType || 'audio/webm' }),
            durationSeconds: data.durationSeconds,
            // v0.7.4: Messung durchreichen (null bei fehlgeschlagener Analyse → der Stille-Guard im
            // Runner greift dann bewusst nicht).
            pegel: data.pegel ?? null
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
