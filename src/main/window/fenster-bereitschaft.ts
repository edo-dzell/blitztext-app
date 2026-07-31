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
//
// v0.7.4: Der Rückgabewert UNTERSCHEIDET jetzt Erfolg von Ladefehler. Vorher liefen beide Ereignisse in
// denselben Callback und der Aufrufer bekam ausschließlich „fertig" zu sehen — ein gescheitertes
// pill.html/recorder.html war damit strukturell unsichtbar: das Fenster blieb lebendig (isDestroyed()
// false), jedes spätere send() lief ins Leere, showInactive() zeigte ein leeres Fenster, und KEIN
// einziges Log-Ereignis existierte dafür. Genau diese Lücke hat die Fehlersuche „Pille fehlt" blockiert.
function warteAufEines(fenster: BereitschaftFenster | null | undefined): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const wc = fenster?.webContents
    if (!wc || istZerstoert(fenster) || istZerstoert(wc)) {
      resolve(true)
      return
    }
    // Kein isLoading() (Test-Fake ohne die Methode) → als lebendig-aber-geladen behandeln.
    if (typeof wc.isLoading !== 'function' || !wc.isLoading()) {
      resolve(true)
      return
    }
    if (typeof wc.once !== 'function') {
      // Kann nicht lauschen → nicht hängen bleiben, der Timeout im Aufrufer bleibt als Netz.
      resolve(true)
      return
    }
    const abraeumen = (): void => {
      if (typeof wc.removeListener === 'function') {
        wc.removeListener('did-finish-load', gelungen)
        wc.removeListener('did-fail-load', gescheitert)
      }
    }
    const gelungen = (): void => {
      abraeumen()
      resolve(true)
    }
    const gescheitert = (): void => {
      abraeumen()
      resolve(false)
    }
    wc.once('did-finish-load', gelungen)
    wc.once('did-fail-load', gescheitert)
  })
}

export interface Bereitschaft {
  /** false = Timeout (der Aufrufer startet den Hook trotzdem als Fallback). */
  bereit: boolean
  /** Gemessene Wartezeit für die Diagnose. */
  dauerMs: number
  /**
   * v0.7.4: Indizes der Fenster (bezogen auf das übergebene Array), deren Laden mit 'did-fail-load'
   * endete. Leer = alles sauber geladen. Bei Timeout leer, weil das Ergebnis dann noch offen ist —
   * ein späterer Ladefehler wird über `protokolliereLadefehler` erfasst, nicht hier.
   */
  ladefehler: number[]
}

/**
 * Wartet, bis alle übergebenen Fenster fertig geladen sind — oder bis `timeoutMs` erreicht ist.
 * Wirft NIE.
 */
export function warteAufFensterBereit(
  fenster: Array<BereitschaftFenster | null | undefined>,
  timeoutMs: number,
  jetzt: () => number = Date.now
): Promise<Bereitschaft> {
  const start = jetzt()
  const alleFertig = Promise.all(fenster.map((f) => warteAufEines(f))).then((ergebnisse) => ({
    bereit: true,
    ladefehler: ergebnisse.flatMap((ok, i) => (ok ? [] : [i]))
  }))

  let timer: ReturnType<typeof setTimeout> | undefined
  const beiTimeout = new Promise<{ bereit: boolean; ladefehler: number[] }>((resolve) => {
    timer = setTimeout(() => resolve({ bereit: false, ladefehler: [] }), timeoutMs)
  })

  return Promise.race([alleFertig, beiTimeout])
    .then((r) => ({ ...r, dauerMs: jetzt() - start }))
    .catch(() => ({ bereit: false, ladefehler: [], dauerMs: jetzt() - start }))
    .finally(() => {
      if (timer !== undefined) clearTimeout(timer)
    })
}

/**
 * v0.7.4: Dauerhafter 'did-fail-load'-Wächter für ein app-langlebiges Fenster. `warteAufFensterBereit`
 * deckt nur das ERSTE Laden beim Start ab; ein Fenster kann auch später scheitern (Reload nach einem
 * Renderer-Crash, siehe fenster-heilung.ts). Ohne diesen Wächter bliebe das erneut unsichtbar: das
 * Fenster lebt weiter, `send()` läuft ins Leere, `showInactive()` zeigt eine leere Fläche.
 * Duck-typed, wirft NIE. Gibt `{entferne()}` zurück (will-quit), idempotent.
 */
export function protokolliereLadefehler(
  fenster: BereitschaftFenster | null | undefined,
  name: 'recorder' | 'pille',
  log: { warnung(ereignis: string, felder?: Record<string, string | number | boolean>): void }
): { entferne(): void } {
  const wc = fenster?.webContents as
    | (BereitschaftWebContents & { on?: (e: any, h: any) => unknown })
    | null
    | undefined
  const beiFehler = (): void => log.warnung('fenster.ladefehler', { fenster: name })
  const gebunden =
    !!wc && !istZerstoert(fenster) && !istZerstoert(wc) && typeof wc.on === 'function'
  if (gebunden) wc!.on!('did-fail-load', beiFehler)
  return {
    entferne() {
      if (gebunden && typeof wc!.removeListener === 'function') {
        wc!.removeListener('did-fail-load', beiFehler)
      }
    }
  }
}
