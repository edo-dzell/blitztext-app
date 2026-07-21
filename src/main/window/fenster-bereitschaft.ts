// Erstlauf-Härtung gegen das Fenster-Lade-Race (H1): der uiohook-Hook (index.ts) startet, sobald der
// App-Bootstrap durch ist — die versteckten Renderer (Recorder/Pille) werden aber fire-and-forget per
// loadFile/loadURL geladen. Ein `webContents.send()` an ein noch nicht fertig geladenes Fenster
// verpufft (der Renderer hat seinen ipcRenderer-Listener noch nicht registriert). Beim allerersten
// Hotkey nach Kaltstart kann so recorder:start / pill:status ins Leere gehen.
//
// Dieser Helfer wartet (mit Timeout als harter Obergrenze) darauf, dass jedes übergebene Fenster
// fertig geladen ist. Duck-typed wie recorder-adapter.ts/send-to-window.ts — KEIN Electron-Import,
// node-testbar mit Fake-Fenstern (webContents als EventEmitter). Wirft NIE: der Hook muss auch bei
// Timeout/Ladefehler unbedingt starten (Fallback statt Blockade).

// Minimal duck-typed: nur was wir wirklich anfassen. Die Ereignis-/Hörer-Parameter sind bewusst weit
// (string/beliebige Signatur), damit ein echtes BrowserWindow.webContents mit seinen streng typisierten
// once/removeListener-Overloads strukturell zuweisbar bleibt (analog Cast in recorder-adapter.ts).
interface BereitschaftWebContents {
  isDestroyed?: () => boolean
  isLoading?: () => boolean
  once?: (ereignis: any, hoerer: any) => unknown
  removeListener?: (ereignis: any, hoerer: any) => unknown
}

export interface BereitschaftFenster {
  isDestroyed?: () => boolean
  webContents?: BereitschaftWebContents | null
}

function istZerstoert(o: { isDestroyed?: () => boolean } | null | undefined): boolean {
  return !!o && typeof o.isDestroyed === 'function' && o.isDestroyed()
}

// Ein einzelnes Fenster: löst auf, sobald es fertig geladen ist. Sofort, wenn es fehlt/zerstört ist
// oder gar nicht (mehr) lädt — WICHTIG: did-finish-load kann schon VOR diesem Aufruf gefeuert haben,
// dann steht isLoading() bereits auf false und ein once-Listener käme nie. Sonst einmalig auf
// 'did-finish-load' UND 'did-fail-load' lauschen (Ladefehler zählt als „fertig", damit der Hook nicht
// ewig wartet); nach dem ersten Ereignis beide Listener entfernen.
function warteAufEines(fenster: BereitschaftFenster | null | undefined): Promise<void> {
  return new Promise<void>((resolve) => {
    const wc = fenster?.webContents
    if (!wc || istZerstoert(fenster) || istZerstoert(wc)) {
      resolve()
      return
    }
    // Kein isLoading() (Test-Fake ohne die Methode) → als lebendig-aber-geladen behandeln.
    if (typeof wc.isLoading !== 'function' || !wc.isLoading()) {
      resolve()
      return
    }
    if (typeof wc.once !== 'function') {
      // Kann nicht lauschen → nicht hängen bleiben, der Timeout im Aufrufer bleibt als Netz.
      resolve()
      return
    }
    const fertig = (): void => {
      if (typeof wc.removeListener === 'function') {
        wc.removeListener('did-finish-load', fertig)
        wc.removeListener('did-fail-load', fertig)
      }
      resolve()
    }
    wc.once('did-finish-load', fertig)
    wc.once('did-fail-load', fertig)
  })
}

/**
 * Wartet, bis alle übergebenen Fenster fertig geladen sind — oder bis `timeoutMs` erreicht ist.
 * Wirft NIE. `bereit:false` bedeutet Timeout (der Aufrufer startet den Hook trotzdem als Fallback).
 * `dauerMs` = gemessene Wartezeit für die Diagnose.
 */
export function warteAufFensterBereit(
  fenster: Array<BereitschaftFenster | null | undefined>,
  timeoutMs: number,
  jetzt: () => number = Date.now
): Promise<{ bereit: boolean; dauerMs: number }> {
  const start = jetzt()
  const alleFertig = Promise.all(fenster.map((f) => warteAufEines(f))).then(() => true as const)

  let timer: ReturnType<typeof setTimeout> | undefined
  const beiTimeout = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs)
  })

  return Promise.race([alleFertig, beiTimeout])
    .then((bereit) => ({ bereit, dauerMs: jetzt() - start }))
    .catch(() => ({ bereit: false, dauerMs: jetzt() - start }))
    .finally(() => {
      if (timer !== undefined) clearTimeout(timer)
    })
}
