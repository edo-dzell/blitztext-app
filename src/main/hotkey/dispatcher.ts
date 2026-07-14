// Multi-Chord-Dispatch (#06): komponiert die reinen Einzel-Chord-Matcher und ordnet jedem Chord
// einen Workflow zu. Arbitriert „ein Workflow zur Zeit" (wie macOS HotkeyService.activeCombo):
// solange einer aktiv ist, werden andere Chords ignoriert; nur sein stop/cancel beendet ihn.
// Hinweis: Chords sollten sich nicht überlappen (kein Subset eines anderen) — bei diskreten
// Down-Events komplettiert sonst der kürzere zuerst und sperrt den längeren. Die Defaults (#06b)
// sind bewusst disjunkt.

import {
  createHotkeyMatcher,
  type HotkeyAction,
  type HotkeyMatcher,
  type KeyEvent,
  type RecordingMode
} from '@main/hotkey/matcher'
import type { WorkflowId } from '@shared/workflows'

export interface Bindung {
  chord: string[]
  workflow: WorkflowId
}

export interface HotkeyDispatcherConfig {
  bindungen: Bindung[]
  mode: RecordingMode
}

export interface DispatchAktion {
  aktion: 'start' | 'stop' | 'cancel'
  workflow: WorkflowId
}

export interface HotkeyDispatcher {
  handle(event: KeyEvent): DispatchAktion | null
  /**
   * Vergisst alle getrackten Tasten (z. B. nach Sperre/Standby — Keyups gingen verloren).
   * Ein gerade aktiver Workflow wird als cancel gemeldet (kein blindes Weiterlaufen).
   */
  setzeZurueck(): DispatchAktion | null
}

export function createHotkeyDispatcher(config: HotkeyDispatcherConfig): HotkeyDispatcher {
  const eintraege = config.bindungen.map((bindung) => ({
    workflow: bindung.workflow,
    matcher: createHotkeyMatcher({ chord: bindung.chord, mode: config.mode })
  }))
  let aktiv: { workflow: WorkflowId; matcher: HotkeyMatcher } | null = null

  return {
    // Perf (B2): früher hier 1 Zwischenarray (`map`) + N Objekt-Spreads + 1-2 `find`-Closures
    // pro Tastendruck (uiohook ist ein globaler Hook — JEDER Tastendruck systemweit läuft
    // hier durch). Jetzt: eine einzige `for`-Schleife ohne Zwischenarray/-objekte. Verhalten
    // bewusst UNVERÄNDERT: die Schleife läuft immer bis zum Ende — jeder Matcher bekommt
    // JEDES Event (Tasten-Tracking der nicht-aktiven/nicht-gewinnenden Matcher muss akkurat
    // bleiben), auch wenn ein früherer Matcher bereits `start` liefert. Ein naiver Loop mit
    // frühem `return` bei `start` würde das brechen (siehe Test „alle registrierten Matcher
    // werden bei JEDEM Event gefüttert…").
    handle(event) {
      if (aktiv) {
        const aktiverMatcher = aktiv.matcher
        let aktionDesAktiven: HotkeyAction | null = null
        for (const e of eintraege) {
          const a = e.matcher.handle(event)
          if (e.matcher === aktiverMatcher) aktionDesAktiven = a
        }
        if (aktionDesAktiven === 'stop' || aktionDesAktiven === 'cancel') {
          const workflow = aktiv.workflow
          aktiv = null
          return { aktion: aktionDesAktiven, workflow }
        }
        return null // ein Workflow aktiv → andere Auslösungen ignorieren
      }

      // „Erster Treffer gewinnt" (wie zuvor durch `treffer.find`) über den `!gefunden`-Guard:
      // ein späterer gleichzeitiger `start` in derselben `eintraege`-Reihenfolge überschreibt
      // `gefunden` NICHT mehr, obwohl sein Matcher trotzdem gefüttert wird.
      let gefunden: { workflow: WorkflowId; matcher: HotkeyMatcher } | null = null
      for (const e of eintraege) {
        const a = e.matcher.handle(event)
        if (a === 'start' && !gefunden) gefunden = { workflow: e.workflow, matcher: e.matcher }
      }
      if (!gefunden) return null
      aktiv = gefunden
      return { aktion: 'start', workflow: gefunden.workflow }
    },

    setzeZurueck() {
      for (const e of eintraege) e.matcher.reset()
      if (!aktiv) return null
      const workflow = aktiv.workflow
      aktiv = null
      return { aktion: 'cancel', workflow }
    }
  }
}
