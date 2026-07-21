import { describe, it, expect } from 'vitest'
import { createSitzung, type Ausgabe, type EinfügeKontext } from '@main/session/sitzung'
import { createWorkflowRunner } from '@main/workflow/runner'
import { createSettingsStore } from '@main/settings/store'
import * as quality from '@main/transcription/quality'
import { resolveSystemPrompt } from '@main/rewrite/prompt-builder'

// v0.7.2 (Erstlauf-Fix A + B): der allererste Spawn von win-paste.exe --hwnd (Defender-Erstscan, bis
// 2000ms) hing im kritischen Pfad VOR runner.start(). Ließ der Nutzer vorher los, lief stoppe() ins
// idle-Leere (Runner-Phantom-Stop) — und weil stoppe() die laufGeneration NICHT erhöhte, startete der
// in-flight-Start die Aufnahme NACH dem Loslassen (Geister-Aufnahme, Mikro offen). Fix A schließt den
// verlorenen Stop (Generation synchron erhöhen). Fix B nimmt die HWND-Erfassung ganz aus dem
// kritischen Pfad (Versprechen statt Await), sodass runner.start() nicht mehr darauf wartet.

const audio = new Blob(['x'], { type: 'audio/webm' })

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

/** Ein von außen manuell auflösbares Promise (kontrollierte Deferreds für die Race-Tests). */
function deferred<T>() {
  let resolve!: (wert: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

interface ErstlaufOpts {
  transcript?: string
  /** Steuert das erfasseFenster-Tor selbst: liefert ein Promise, das der Test manuell auflöst. */
  erfasseFensterTor?: { promise: Promise<number | null> }
  /** Lässt erfasseFenster ablehnen (rejected) — der Fix darf daraus null machen, nie werfen. */
  erfasseFensterWirft?: Error
  /** Steuert das settings.load-Tor: der read() hängt, bis der Test es auflöst. */
  ladeTor?: { promise: Promise<string | null> }
}

function makeErstlaufSitzung(opts: ErstlaufOpts = {}) {
  const recorder = {
    started: 0,
    stopped: 0,
    discarded: 0,
    start(): void {
      recorder.started++
    },
    async stop() {
      recorder.stopped++
      return { audio, durationSeconds: 1.5 }
    },
    discard(): void {
      recorder.discarded++
    }
  }
  const runner = createWorkflowRunner({
    recorder,
    transcription: {
      async transcribe() {
        return opts.transcript ?? 'roh'
      }
    },
    rewrite: {
      async rewrite() {
        return { text: 'umgeschrieben' }
      }
    },
    resolveSystemPrompt,
    quality
  })

  const einstellungen = createSettingsStore({
    file: {
      // Ohne Lade-Tor sofort auflösen (Default-Settings = null); mit Tor hängen, bis der Test es öffnet.
      read() {
        return opts.ladeTor ? opts.ladeTor.promise : Promise.resolve<string | null>(null)
      },
      async write() {
        // no-op
      }
    }
  })

  const calls = {
    einfügen: [] as string[],
    einfügenKontext: [] as Array<EinfügeKontext | undefined>,
    anzeigen: [] as string[],
    erfasseFenster: 0
  }
  const ausgabe: Ausgabe = {
    einfügen: (t, kontext) => {
      calls.einfügen.push(t)
      calls.einfügenKontext.push(kontext)
    },
    anzeigen: (t) => calls.anzeigen.push(t),
    zeigeEinstellungen: () => {},
    melde: () => {},
    inZwischenablage: () => {},
    erfasseFenster: () => {
      calls.erfasseFenster++
      if (opts.erfasseFensterWirft) return Promise.reject(opts.erfasseFensterWirft)
      if (opts.erfasseFensterTor) return opts.erfasseFensterTor.promise
      return Promise.resolve<number | null>(4711)
    }
  }

  const apiKeys = {
    async has() {
      return true
    }
  }

  const sitzung = createSitzung({ runner, einstellungen, apiKeys, ausgabe })
  return { sitzung, calls, recorder }
}

describe('Sitzung — Erstlauf-Race (v0.7.2)', () => {
  it('Fix A: Loslassen während ein Start noch in seinen Awaits hängt startet KEINE Geister-Aufnahme', async () => {
    // REPRODUKTION des verlorenen Stops. Mit dem ALTEN Code war das rot: stoppe() erhöhte die
    // laufGeneration NICHT, also blieb der in-flight-Start „aktuell" und rief nach dem Loslassen doch
    // runner.start() → Aufnahme ohne Stop, Mikro offen. Wir hängen den Start hier im settings.load-Tor
    // (ein Await, der auch nach Fix B noch VOR runner.start() liegt) — exakt die „Start hängt zwischen
    // seinen Awaits"-Situation, in der das reale Erstlauf-erfasseFenster den Spawn zäh machte.
    const ladeTor = deferred<string | null>()
    const { sitzung, recorder } = makeErstlaufSitzung({ ladeTor })

    // down: Start beginnt, reserviert synchron, hängt dann im load-Await.
    const startP = sitzung.starteWorkflow('transcribe', 'hotkey')
    await tick()
    expect(recorder.started).toBe(0) // hängt noch vor runner.start()

    // up: der Nutzer lässt los, BEVOR der Start durch ist. stoppe() findet den Runner idle
    // (noch nicht gestartet) → Phantom-Stop-Schutz → verarbeiteTerminal no-op. Fix A erhöht dabei die
    // Generation und entwertet den in-flight-Start.
    await sitzung.stoppe()

    // DANN erst löst das Lade-Tor auf; der in-flight-Start läuft weiter — darf aber NICHT mehr starten.
    ladeTor.resolve(null)
    await startP
    await tick()

    expect(recorder.started).toBe(0) // KEINE Geister-Aufnahme
    expect(sitzung.beschaeftigt()).toBe(false)
  })

  it('Fix B: runner.start läuft SOFORT, obwohl erfasseFenster noch hängt (nicht mehr blockiert)', async () => {
    // Der zähe Erstlauf-Spawn (erfasseFenster) hängt hier dauerhaft. Vor Fix B blockierte das
    // runner.start(); jetzt darf die Aufnahme trotzdem sofort beginnen.
    const erfasseFensterTor = deferred<number | null>()
    const { sitzung, calls, recorder } = makeErstlaufSitzung({
      transcript: 'hallo',
      erfasseFensterTor
    })

    await sitzung.starteWorkflow('transcribe', 'hotkey')

    // Aufnahme läuft, obwohl erfasseFenster noch offen ist.
    expect(recorder.started).toBe(1)
    expect(calls.erfasseFenster).toBe(1)

    // Loslassen: stoppe() löst das Versprechen auf und reicht das HWND an einfügen durch.
    const stopP = sitzung.stoppe()
    await tick()
    erfasseFensterTor.resolve(4711)
    await stopP
    await tick()

    expect(calls.einfügen).toEqual(['hallo'])
    expect(calls.einfügenKontext[0]).toEqual({ fokusRueckkehr: true, erfasstesHwnd: 4711 })
  })

  it('Fix B: erfasseFenster rejected → hwnd null, kein Throw, Lauf normal', async () => {
    const { sitzung, calls } = makeErstlaufSitzung({
      transcript: 'hallo',
      erfasseFensterWirft: new Error('Helfer-Spawn fehlgeschlagen')
    })

    await sitzung.starteWorkflow('transcribe', 'hotkey')
    await expect(sitzung.stoppe()).resolves.toBeUndefined()
    await tick()

    expect(calls.einfügen).toEqual(['hallo'])
    expect(calls.einfügenKontext[0]).toEqual({ fokusRueckkehr: true, erfasstesHwnd: null })
  })

  it('manuell: keine Fenster-Erfassung (unverändert)', async () => {
    const { sitzung, calls } = makeErstlaufSitzung({ transcript: 'angezeigt' })

    await sitzung.starteWorkflow('transcribe', 'manuell')
    await sitzung.stoppe()

    expect(calls.erfasseFenster).toBe(0)
    expect(calls.anzeigen).toEqual(['angezeigt'])
    expect(calls.einfügen).toEqual([])
  })
})
