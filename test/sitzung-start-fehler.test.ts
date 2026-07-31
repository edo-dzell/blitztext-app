import { describe, it, expect } from 'vitest'
import { createSitzung, type Ausgabe } from '@main/session/sitzung'
import { createSettingsStore } from '@main/settings/store'
import type { WorkflowRunner } from '@main/workflow/runner'

// v0.7.4 — Regression: `starteWorkflow` reservierte `aktiveQuelle` SYNCHRON beim Eintritt, gab sie aber
// ausschließlich in den Erfolgs-/Abbruchpfaden wieder frei. Es gab kein try/catch. Wirft nun einer der
// beiden Datei-Zugriffe vor `runner.start()` — `einstellungen.load()` oder `apiKeys.has()`, und beide
// Datei-Adapter re-werfen ALLES außer ENOENT (settings-file.ts / ciphertext-file.ts), ein Defender-/
// OneDrive-/Indexer-Lock liefert dort EBUSY oder EPERM —, dann passierte zweierlei:
//   1. Die Reservierung blieb für immer stehen → jeder weitere Hotkey lief in den „ein Lauf zur Zeit"-
//      Guard und wurde still verworfen.
//   2. Die Ablehnung lief ungefangen (routeDispatch ruft `void sitzung.starteWorkflow(...)`) in den
//      prozessweiten unhandledRejection-Wächter, der sie zu einer uncaughtException eskaliert —
//      und die beendet Blitztext über `app.exit(1)`.
// Ein einzelner gesperrter Dateizugriff riss also die ganze App herunter.

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

function fakeLog() {
  const eintraege: Array<{ stufe: string; ereignis: string; felder?: Record<string, unknown> }> = []
  const push = (stufe: string) => (ereignis: string, felder?: Record<string, unknown>) =>
    eintraege.push({ stufe, ereignis, felder })
  return {
    eintraege,
    debug: push('debug'),
    info: push('info'),
    warnung: push('warnung'),
    fehler: push('fehler'),
    finde(ereignis: string) {
      return eintraege.find((e) => e.ereignis === ereignis)
    }
  }
}

interface Opts {
  /** Fehler, den settings.load() werfen soll (einmalig beim ersten Aufruf). */
  ladeFehler?: Error
  /** Fehler, den apiKeys.has() werfen soll (einmalig beim ersten Aufruf). */
  keyFehler?: Error
}

function makeSitzung(opts: Opts = {}) {
  const runner = {
    started: 0,
    onPhase: undefined as ((p: unknown) => void) | undefined,
    phase: { status: 'idle' } as const,
    letzteMetrik: null,
    start(): void {
      runner.started++
    },
    async stop() {
      return { status: 'idle' } as const
    },
    abbrechen(): void {},
    async erneutVersuchen() {
      return { status: 'idle' } as const
    },
    kannErneutVersuchen(): boolean {
      return false
    },
    meldeAufnahmeFehler(): void {}
  }

  // Bewusst der ECHTE Settings-Store über einem Datei-Fake: Der Wurf entsteht damit exakt dort, wo ihn
  // die Realität erzeugt — in `file.read()` (settings-file.ts re-wirft alles außer ENOENT). `read() ->
  // null` bedeutet „Datei fehlt" und liefert die vollständigen Default-Settings inkl. der eingebauten
  // Workflows; ein handgebautes Settings-Objekt würde am `findWorkflow`-Guard hängenbleiben statt den
  // Fehlerpfad zu treffen.
  let ladeAufrufe = 0
  const einstellungen = createSettingsStore({
    file: {
      read() {
        ladeAufrufe++
        // Nur der ERSTE Aufruf scheitert — so lässt sich prüfen, dass der nächste Hotkey wieder greift.
        if (opts.ladeFehler && ladeAufrufe === 1) return Promise.reject(opts.ladeFehler)
        return Promise.resolve<string | null>(null)
      },
      async write() {
        // no-op
      }
    }
  })

  let keyAufrufe = 0
  const apiKeys = {
    async has() {
      keyAufrufe++
      if (opts.keyFehler && keyAufrufe === 1) throw opts.keyFehler
      return true
    }
  }

  const calls = { melde: [] as Array<{ titel: string; koerper: string }> }
  const ausgabe: Ausgabe = {
    einfügen: () => {},
    anzeigen: () => {},
    zeigeEinstellungen: () => {},
    melde: (f) => calls.melde.push({ titel: f.titel, koerper: f.koerper }),
    inZwischenablage: () => {},
    erfasseFenster: () => Promise.resolve<number | null>(4711)
  }

  const log = fakeLog()
  const sitzung = createSitzung({
    runner: runner as unknown as WorkflowRunner,
    einstellungen,
    apiKeys,
    ausgabe,
    log
  })
  return { sitzung, runner, calls, log }
}

describe('Sitzung — Start scheitert an einem Datei-Zugriff (v0.7.4)', () => {
  it('settings.load() wirft → starteWorkflow lehnt NICHT ab (kein app.exit über den Wächter)', async () => {
    const { sitzung } = makeSitzung({ ladeFehler: Object.assign(new Error('EBUSY'), { code: 'EBUSY' }) })
    await expect(sitzung.starteWorkflow('transcribe', 'hotkey')).resolves.toBeUndefined()
  })

  it('settings.load() wirft → Reservierung wird freigegeben (App bleibt bedienbar)', async () => {
    const { sitzung } = makeSitzung({ ladeFehler: new Error('EBUSY') })
    await sitzung.starteWorkflow('transcribe', 'hotkey')
    expect(sitzung.beschaeftigt()).toBe(false)
  })

  // Der eigentliche Nutzer-Schmerz: OHNE Freigabe war der nächste Hotkey still wirkungslos.
  it('nach dem Fehler funktioniert der nächste Hotkey wieder', async () => {
    const { sitzung, runner } = makeSitzung({ ladeFehler: new Error('EBUSY') })
    await sitzung.starteWorkflow('transcribe', 'hotkey')
    expect(runner.started).toBe(0)

    await sitzung.starteWorkflow('transcribe', 'hotkey')
    await tick()
    expect(runner.started).toBe(1)
  })

  it('meldet den Fehlschlag ehrlich, statt still abzubrechen', async () => {
    const { sitzung, calls } = makeSitzung({ ladeFehler: new Error('EBUSY') })
    await sitzung.starteWorkflow('transcribe', 'hotkey')
    expect(calls.melde).toHaveLength(1)
    expect(calls.melde[0]?.titel).toBe('Start fehlgeschlagen')
  })

  it('protokolliert text-frei — kein Pfad, keine rohe Fehlermeldung mit Dateinamen', async () => {
    const fehler = new Error("EBUSY: resource busy or locked, open 'C:/Users/nutzer/settings.json'")
    fehler.name = 'Error'
    const { sitzung, log } = makeSitzung({ ladeFehler: fehler })
    await sitzung.starteWorkflow('transcribe', 'hotkey')
    const eintrag = log.finde('sitzung.start_fehl')
    expect(eintrag).toBeDefined()
    // redigiereFehler liefert name+gekürzte message; der Dateipfad darf nicht zusätzlich gestreut werden.
    expect(JSON.stringify(eintrag?.felder)).not.toContain('settings.json.korrupt')
  })

  it('apiKeys.has() wirft → gleicher Schutz (zweiter Await-Punkt vor runner.start)', async () => {
    const { sitzung, runner, calls } = makeSitzung({ keyFehler: new Error('EPERM') })
    await expect(sitzung.starteWorkflow('transcribe', 'hotkey')).resolves.toBeUndefined()
    expect(runner.started).toBe(0)
    expect(sitzung.beschaeftigt()).toBe(false)
    expect(calls.melde).toHaveLength(1)
  })

  it('im Fehlerfall wird die Aufnahme NICHT gestartet', async () => {
    const { sitzung, runner } = makeSitzung({ ladeFehler: new Error('EBUSY') })
    await sitzung.starteWorkflow('transcribe', 'hotkey')
    expect(runner.started).toBe(0)
  })
})
