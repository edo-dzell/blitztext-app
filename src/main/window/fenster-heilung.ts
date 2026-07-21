// Fenster-Selbstheilung (v0.7.3, B1): die versteckten, app-langlebigen Renderer (Recorder/Pille) werden
// EINMAL beim Start geladen (nie pro Aufnahme neu erzeugt, electron#8649). Stirbt ein solcher Renderer
// mitten im Betrieb (Grafiktreiber-Crash, OOM, GPU-Reset), sendet das webContents 'render-process-gone'
// und der Prozess ist tot: jeder `webContents.send(...)` verpufft, MediaRecorder/Pille funktionieren nie
// wieder — bis zum App-Neustart. Dieser Helfer lauscht auf 'render-process-gone' und lädt den Renderer
// per `webContents.reload()` neu (NIE ein neues Fenster erzeugen — die Adapter-Closures, z. B. der
// recorder-adapter, halten eine Referenz auf DIESES webContents; reload erhält sie, ein neues Fenster
// würde die Verdrahtung ins Leere laufen lassen).
//
// Grenzen (bewusst): 'destroyed' wird NICHT behandelt (= App-Ende/Fenster-Abbau → Reload wäre falsch).
// Ein Crash-Loop-Deckel (gleitendes Zeitfenster) bricht die Heilung nach `maxReloads` Neuladungen ab,
// damit ein sofort wieder abstürzender Renderer nicht in einer endlosen Reload-Schleife die CPU frisst.
//
// Duck-typed wie fenster-bereitschaft.ts/send-to-window.ts — KEIN Electron-Import, node-testbar mit
// Fake-Fenstern (webContents als EventEmitter). Wirft NIE.

import { NOOP_EREIGNISLOG, type EreignisLog } from '@main/diagnostics/ereignis-log'

// Minimal duck-typed: nur was wir wirklich anfassen. Die Ereignis-/Hörer-Parameter sind bewusst weit
// (string/beliebige Signatur), damit ein echtes BrowserWindow.webContents mit seinen streng typisierten
// on/removeListener-Overloads strukturell zuweisbar bleibt (analog fenster-bereitschaft.ts).
interface HeilungWebContents {
  isDestroyed?: () => boolean
  reload?: () => unknown
  on?: (ereignis: any, hoerer: any) => unknown
  removeListener?: (ereignis: any, hoerer: any) => unknown
}

export interface HeilungFenster {
  isDestroyed?: () => boolean
  webContents?: HeilungWebContents | null
}

export interface FensterHeilungOptionen {
  /** Das app-langlebige, versteckte Fenster (Recorder/Pille). */
  fenster: HeilungFenster
  /** Reines Enum fürs Log-Feld (text-frei) und die Diagnose — NIE ein freier Text. */
  name: 'recorder' | 'pille'
  /** Text-freies Ereignislog (optional, No-Op-Default). */
  log?: EreignisLog
  /** Crash-Loop-Deckel: höchstens so viele Reloads im gleitenden `fensterMs`-Fenster. Default 3. */
  maxReloads?: number
  /** Breite des gleitenden Zeitfensters für den Deckel (ms). Default 60000. */
  fensterMs?: number
  /** Uhr, injizierbar für Tests. Default Date.now. */
  jetzt?: () => number
  /**
   * Optionaler Callback nach dem Aufgeben der Heilung (Deckel erreicht) — der Aufrufer entscheidet, ob
   * er den Nutzer benachrichtigt (Recorder: Notification) oder nur loggt (Pille). No-Op-Default.
   */
  beiAufgabe?: () => void
}

export interface FensterHeilung {
  /** Entfernt den 'render-process-gone'-Listener (will-quit). Idempotent. */
  entferne(): void
}

function istZerstoert(o: { isDestroyed?: () => boolean } | null | undefined): boolean {
  return !!o && typeof o.isDestroyed === 'function' && o.isDestroyed()
}

/**
 * Montiert die Selbstheilung auf ein Fenster. Lauscht auf 'render-process-gone' des webContents und lädt
 * den Renderer per reload() neu — begrenzt durch einen gleitenden Crash-Loop-Deckel. Gibt `{entferne()}`
 * zurück (will-quit). Wirft NIE; fehlendes/zerstörtes webContents → No-Op-Heilung (nur `entferne()`).
 */
export function montiereFensterHeilung(opts: FensterHeilungOptionen): FensterHeilung {
  const log = opts.log ?? NOOP_EREIGNISLOG
  const maxReloads = opts.maxReloads ?? 3
  const fensterMs = opts.fensterMs ?? 60000
  const jetzt = opts.jetzt ?? Date.now
  const name = opts.name

  const wc = opts.fenster.webContents
  // Zeitstempel der jüngsten Reloads (gleitendes Fenster). Alte Einträge werden bei jedem Crash geprunt.
  const reloadZeiten: number[] = []
  // true, sobald der Deckel erreicht ist: keine weiteren Reload-Versuche, kein weiteres beiAufgabe.
  let aufgegeben = false

  const beiRendererTod = (): void => {
    // Nach dem Aufgeben (Deckel erreicht) still bleiben: keine weiteren Reload-Versuche UND kein weiteres
    // renderer_tot-Log — ein sofort-wieder-abstürzender Renderer soll das Log nicht endlos zumüllen. Der
    // Deckel-Übergang selbst (aufgegeben noch false beim Eintritt) loggt renderer_tot regulär.
    if (aufgegeben) return
    // Feld-Beleg (text-frei): welcher der beiden versteckten Renderer starb.
    log.warnung('fenster.renderer_tot', { fenster: name })
    // Zerstörtes Fenster/webContents = App-Abbau, KEIN reload (der Renderer soll nicht wieder leben).
    if (istZerstoert(opts.fenster) || istZerstoert(wc)) return

    // Gleitendes Fenster: alte Crash-Zeitpunkte außerhalb `fensterMs` verwerfen, dann diesen zählen.
    const t = jetzt()
    const grenze = t - fensterMs
    while (reloadZeiten.length > 0 && reloadZeiten[0]! <= grenze) reloadZeiten.shift()
    if (reloadZeiten.length >= maxReloads) {
      aufgegeben = true
      log.fehler('fenster.heilung_aufgegeben', { fenster: name })
      opts.beiAufgabe?.()
      return
    }
    reloadZeiten.push(t)

    // reload() kann in einer Race (Fenster zwischen Guard und Aufruf zerstört) werfen — nie eskalieren.
    try {
      wc?.reload?.()
      log.info('fenster.neu_geladen', { fenster: name })
    } catch (err) {
      // Reload gescheitert: den Zähler-Eintrag zurücknehmen wäre riskant (Loop-Schutz) → belassen.
      // Text-frei: nur der Umstand, dass reload nicht durchkam.
      log.fehler('fenster.neu_geladen_fehl', { fenster: name })
      void err
    }
  }

  // .on nur, wenn ein lebendes webContents mit EventEmitter vorliegt (minimale Test-Fakes ohne on
  // überspringen das gefahrlos; der Aufrufer bekommt trotzdem ein gültiges entferne()).
  const gebunden = !!wc && !istZerstoert(wc) && typeof wc.on === 'function'
  if (gebunden) wc!.on!('render-process-gone', beiRendererTod)

  return {
    entferne() {
      if (gebunden && typeof wc!.removeListener === 'function') {
        wc!.removeListener('render-process-gone', beiRendererTod)
      }
    }
  }
}
