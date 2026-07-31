// Steuerung der Status-Pille (v0.7.4): Anzeigen/Verstecken/Aufwärmen des fokusfreien Overlay-Fensters.
//
// Warum ein eigenes Modul? Die Pillen-Anzeige lag bislang als drei Closures direkt in index.ts
// (`pilleSichtbar`/`pilleHide`/`positioniertePille`) — Electron-gebunden, nicht exportiert, damit
// KOMPLETT ungetestet. Genau dort saß der einzige blinde Fleck der Fehlerjagd „Pille fehlt": der Code
// lief fehlerfrei durch, meldete nichts, und trotzdem war nichts zu sehen. Duck-typed wie
// fenster-heilung.ts/fenster-bereitschaft.ts/send-to-window.ts — KEIN Electron-Import, node-testbar mit
// Fake-Fenstern. Wirft NIE (ein rein visueller Statushinweis darf den Aufnahme-Pfad nie killen).
//
// Zwei Dinge, die es vorher nicht gab und die diese Fehlerklasse beobachtbar machen:
//  1. `pille.gezeigt` protokolliert den TATSÄCHLICHEN `isVisible()`-Zustand nach dem showInactive() —
//     vorher gab es im Erfolgsfall überhaupt kein Ereignis, „angezeigt" und „nicht angezeigt" waren
//     im Log ununterscheidbar.
//  2. Die Einmal-Warnung `pille.nicht_verfuegbar` ist wieder scharf, sobald das Fenster zurückkommt —
//     vorher machte EIN früher Ausfall alle späteren für immer stumm (Flag ohne Reset).
//
// Aufwärmen (`waermeAuf`, Kandidat gegen electron#32001): Ein mit `show:false` erzeugtes, transparentes
// Fenster bekommt unter Windows unzuverlässig nie einen ersten Compositor-Frame; ein späteres
// showInactive() findet dann nichts vor, was es darstellen könnte — das Fenster gilt als sichtbar und
// bleibt vollständig unsichtbar. Einmaliges Zeigen+Verstecken direkt nach dem Laden etabliert die
// Zeichenfläche, solange sie noch niemand braucht.

import { NOOP_EREIGNISLOG, type EreignisLog } from '@main/diagnostics/ereignis-log'
import { pillenPosition, type Bereich } from '@main/window/pillen-position'

// Minimal duck-typed: nur was wir wirklich anfassen. Bewusst weite Signaturen, damit ein echtes
// BrowserWindow mit seinen streng typisierten Overloads strukturell zuweisbar bleibt.
interface PillenWebContents {
  isDestroyed?: () => boolean
  send?: (kanal: string, ...args: any[]) => unknown
}

export interface PillenFenster {
  isDestroyed?: () => boolean
  webContents?: PillenWebContents | null
  getSize?: () => number[]
  setBounds?: (bounds: { x: number; y: number; width: number; height: number }) => unknown
  showInactive?: () => unknown
  hide?: () => unknown
  isVisible?: () => boolean
}

export interface PillenSteuerungOptionen {
  /** Das app-langlebige, versteckte Overlay-Fenster. `null` = keins vorhanden (alles wird No-Op). */
  fenster: PillenFenster | null
  /**
   * Arbeitsfläche, auf der die Pille sitzen soll (Aufrufer entscheidet: Display unter dem Cursor,
   * Hauptmonitor, …). OHNE laufenden Lauf (kein vorheriger laufBeginnt(), s. u.) wird bei JEDEM Zeigen
   * frisch abgefragt — ein Display-Wechsel zwischen zwei Läufen darf die Pille nicht off-screen
   * zurücklassen (A8). INNERHALB eines Laufs bleibt der bei laufBeginnt() ermittelte Wert dagegen
   * konstant (Befund B, s. u.).
   */
  ermittleArbeitsflaeche: () => Bereich
  /** Text-freies Ereignislog (optional, No-Op-Default). */
  log?: EreignisLog
}

export interface PillenSteuerung {
  /** Label senden, positionieren, fokusfrei zeigen. Nie werfend. */
  zeige(label: string): void
  /** Ausblenden. Nie werfend. */
  verstecke(): void
  /**
   * Einmaliges Zeigen+Verstecken, um die Zeichenfläche zu etablieren (electron#32001). Nach dem Laden
   * des Renderers aufrufen — vorher gibt es keinen Inhalt, den der Compositor submitten könnte.
   * Protokolliert das Ergebnis (`pille.warmup`), damit im Feld sichtbar ist, ob es überhaupt griff.
   */
  waermeAuf(): void
  /**
   * Befund B (Feld-Log 2026-07-31): markiert den Beginn eines neuen Laufs — ermittelt die Arbeitsfläche
   * SOFORT (über `ermittleArbeitsflaeche()`) und hält sie fest. Jedes nachfolgende `zeige()` verwendet
   * diesen Wert unverändert, bis entweder `laufBeginnt()` erneut aufgerufen wird (nächster Lauf) oder
   * `laufEndet()` den Anker wieder freigibt. Ohne diesen Aufruf bleibt das bisherige Verhalten
   * (frische Abfrage bei jedem `zeige()`) unverändert — Bestandsschutz für alle Aufrufer, die den Anker
   * (noch) nicht kennen.
   *
   * Warum hier und nicht in index.ts? Der Aufrufer (index.ts) kennt die Lauf-Grenzen (Workflow-Phasen),
   * dieses Modul bleibt aber die einzige Stelle, die WEISS, wann `ermittleArbeitsflaeche()` aufgerufen
   * wird — die beiden Zuständigkeiten (wann beginnt ein Lauf / wann wird positioniert) bleiben so
   * sauber getrennt, ohne dass dieses Datei Electron-Wissen (Workflow-Phasen, Cursor, Displays) braucht.
   */
  laufBeginnt(): void
  /**
   * Löst den Lauf-Anker wieder — die nächste Anzeige OHNE laufenden Lauf (z. B. das einmalige
   * Aufwärmen vor dem allerersten Lauf) ermittelt die Arbeitsfläche wieder frisch.
   */
  laufEndet(): void
}

function istZerstoert(o: { isDestroyed?: () => boolean } | null | undefined): boolean {
  return !!o && typeof o.isDestroyed === 'function' && o.isDestroyed()
}

/** Sendbar = Fenster UND webContents vorhanden und nicht zerstört. Reihenfolge bindend (erst Fenster). */
function istSendbar(fenster: PillenFenster | null): boolean {
  if (!fenster || istZerstoert(fenster)) return false
  const wc = fenster.webContents
  return !!wc && !istZerstoert(wc)
}

export function erstellePillenSteuerung(opts: PillenSteuerungOptionen): PillenSteuerung {
  const log = opts.log ?? NOOP_EREIGNISLOG
  const fenster = opts.fenster
  // Einmal-Warnung, damit ein dauerhaft totes Fenster das Log nicht bei jedem Statuswechsel flutet.
  // ANDERS als in der Vorgängerfassung wird sie zurückgesetzt, sobald das Fenster wieder sendbar ist —
  // sonst verschluckt ein einziger früher Ausfall (z. B. während eines Renderer-Reloads) jede spätere
  // Meldung für die gesamte App-Laufzeit.
  let nichtVerfuegbarGemeldet = false

  // Befund B (Feld-Log 2026-07-31): der Lauf-Anker. `null` = kein laufender Lauf bekannt → jede
  // Positionierung fragt `ermittleArbeitsflaeche()` frisch ab (Bestandsverhalten). Gesetzt via
  // laufBeginnt(), gelöscht via laufEndet() — s. Interface-Kommentare oben.
  let laufArbeitsflaeche: Bereich | null = null

  /** Ohne laufenden Lauf frisch ermitteln, sonst den festgehaltenen Lauf-Anker weiterverwenden. */
  function aktuelleArbeitsflaeche(): Bereich {
    return laufArbeitsflaeche ?? opts.ermittleArbeitsflaeche()
  }

  /** Positioniert unten mittig auf der übergebenen Arbeitsfläche, hart in deren Bounds geklemmt (A8). */
  function positioniere(): { x: number; y: number } | null {
    if (typeof fenster?.getSize !== 'function' || typeof fenster.setBounds !== 'function') return null
    const [width = 0, height = 0] = fenster.getSize()
    const { x, y } = pillenPosition(aktuelleArbeitsflaeche(), { width, height })
    fenster.setBounds({ x, y, width, height })
    return { x, y }
  }

  /**
   * Gemeinsamer Zeige-Pfad. `ereignis` trennt den regulären Fall vom Aufwärmen im Log.
   * `stufe`: das reguläre Zeigen läuft mehrfach pro Lauf → debug (sonst flutet es das Log). Das
   * Aufwärmen passiert EINMAL pro App-Start und ist die aussagekräftigste Einzelzeile der Diagnose
   * („konnte das Fenster überhaupt je sichtbar werden?") → info, damit sie auch ohne eingeschalteten
   * Debug-Schalter im Log steht.
   */
  function zeigeIntern(
    label: string | null,
    ereignis: 'pille.gezeigt' | 'pille.warmup',
    stufe: 'debug' | 'info' = 'debug'
  ): boolean {
    if (!istSendbar(fenster)) {
      if (!nichtVerfuegbarGemeldet) {
        nichtVerfuegbarGemeldet = true
        log.warnung('pille.nicht_verfuegbar')
      }
      return false
    }
    // Fenster ist zurück (z. B. nach einem Renderer-Reload) → Warnung wieder scharf stellen.
    if (nichtVerfuegbarGemeldet) {
      nichtVerfuegbarGemeldet = false
      log.info('pille.wieder_verfuegbar')
    }
    try {
      if (label !== null) fenster!.webContents!.send?.('pill:status', label)
      const position = positioniere()
      fenster!.showInactive?.()
      // Der TATSÄCHLICHE Zustand nach dem Zeigen — der einzige Feld-Beleg, der „Fenster wurde gezeigt"
      // von „Fenster ist gezeigt, malt aber nichts" trennt. Reine Zahlen/Booleans, nie Text.
      log[stufe](ereignis, {
        sichtbar: typeof fenster!.isVisible === 'function' ? fenster!.isVisible() : false,
        ...(position ? { x: position.x, y: position.y } : {}),
        zeichen: label === null ? 0 : label.length
      })
      return true
    } catch (err) {
      // Race (Fenster zwischen Guard und Aufruf zerstört) o. Ä. — die Pille ist ein reiner
      // Statushinweis; ein Wurf hier würde den laufenden Aufnahme-Pfad mitreißen (transition() ruft
      // synchron in diesen Code). Also schlucken und text-frei vermerken.
      log.fehler('pille.zeigen_fehl')
      void err
      return false
    }
  }

  return {
    zeige(label) {
      zeigeIntern(label, 'pille.gezeigt')
    },

    verstecke() {
      if (!istSendbar(fenster)) return
      try {
        fenster!.hide?.()
      } catch {
        // hide() auf ein gerade zerstörtes Fenster wirft — nie eskalieren (siehe zeigeIntern).
      }
    },

    waermeAuf() {
      // Label bewusst NICHT setzen: das Aufwärmen soll den Inhalt des nächsten echten Laufs nicht
      // vorwegnehmen. Der initiale HTML-Inhalt (`Blitztext`) reicht, um einen Frame zu erzeugen.
      const gezeigt = zeigeIntern(null, 'pille.warmup', 'info')
      if (!gezeigt) return
      this.verstecke()
    },

    laufBeginnt() {
      // Bewusst OHNE Sendbarkeits-Guard: die Arbeitsfläche wird unabhängig vom Fensterzustand ermittelt
      // und festgehalten — ein gerade nicht sendbares Fenster darf den Anker für den (evtl. später
      // zurückkehrenden) Rest des Laufs nicht verhindern.
      laufArbeitsflaeche = opts.ermittleArbeitsflaeche()
    },

    laufEndet() {
      laufArbeitsflaeche = null
    }
  }
}
