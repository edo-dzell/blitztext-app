// v0.7.2 „Ereignislog" — Verdrahtung im Workflow-Kern (Slice C). Prüft mit einem Fake-EreignisLog,
// dass die richtigen Ereignisse an den richtigen Stellen TEXT-FREI geloggt werden:
//   - runner.transition() loggt jeden Phasenwechsel (workflow.phase) inkl. `zeichen=`-LÄNGE statt Text,
//   - der Anbieter-Retry-Hook loggt `anbieter.retry` je Fehlversuch,
//   - die Sitzung loggt stille Abbrüche (start_ohne_key, start_entwertet).
// Kritisch: NIE Roh-/Endtext in den geloggten Feldern (nur Längen/Status/Ids/redigierte Fehler).

import { describe, it, expect } from 'vitest'
import { createWorkflowRunner, type WorkflowRunnerDeps } from '@main/workflow/runner'
import { createSitzung, type Ausgabe, type Sitzung } from '@main/session/sitzung'
import { routeDispatch } from '@main/composition-root'
import { createSettingsStore, type BlitztextSettings } from '@main/settings/store'
import type { EreignisLog, LogFelder } from '@main/diagnostics/ereignis-log'
import * as quality from '@main/transcription/quality'
import { resolveSystemPrompt } from '@main/rewrite/prompt-builder'
import { getWorkflow, BUILTIN_WORKFLOWS } from '@shared/workflows'

const audio = new Blob(['x'], { type: 'audio/webm' })
const def = (id: string) => getWorkflow(id, BUILTIN_WORKFLOWS)

interface LogAufruf {
  stufe: 'debug' | 'info' | 'warnung' | 'fehler'
  ereignis: string
  felder: LogFelder
}

/** Fake-EreignisLog, das jeden Aufruf sammelt (Stufe/Ereignis/Felder) — für Asserts. */
function fakeLog(): { log: EreignisLog; aufrufe: LogAufruf[] } {
  const aufrufe: LogAufruf[] = []
  const mach = (stufe: LogAufruf['stufe']) => (ereignis: string, felder?: LogFelder) => {
    aufrufe.push({ stufe, ereignis, felder: felder ?? {} })
  }
  return {
    aufrufe,
    log: {
      debug: mach('debug'),
      info: mach('info'),
      warnung: mach('warnung'),
      fehler: mach('fehler')
    }
  }
}

function fakeRecorder(durationSeconds: number) {
  return {
    start(): void {},
    async stop() {
      return { audio, durationSeconds }
    },
    discard(): void {}
  }
}

function runnerDeps(overrides: Partial<WorkflowRunnerDeps> = {}): WorkflowRunnerDeps {
  return {
    recorder: fakeRecorder(1.5),
    transcription: { async transcribe() { return 'roh' } },
    rewrite: { async rewrite() { return { text: 'umgeschrieben' } } },
    resolveSystemPrompt,
    quality,
    ...overrides
  }
}

describe('Ereignislog-Verdrahtung: runner.transition()', () => {
  it('reine Transkription: loggt aufnehmen → transkribieren → fertig, zeichen = Endtext-Länge (kein Text)', async () => {
    const { log, aufrufe } = fakeLog()
    const runner = createWorkflowRunner(
      runnerDeps({ log, transcription: { async transcribe() { return '  hallo welt  ' } } })
    )

    runner.start({ def: def('transcribe'), chatModell: 'gpt-4o-mini' })
    await runner.stop()

    const phasen = aufrufe.filter((a) => a.ereignis === 'workflow.phase')
    // aufnehmen, transkribieren, fertig
    expect(phasen.map((p) => p.felder.status)).toEqual(['aufnehmen', 'transkribieren', 'fertig'])
    const fertig = phasen[phasen.length - 1]!
    // 'hallo welt' = 10 Zeichen; die LÄNGE wird geloggt, NIE der Text selbst.
    expect(fertig.felder.zeichen).toBe(10)
    // Redaction: kein einziges Feld enthält den Endtext.
    for (const p of phasen) {
      expect(JSON.stringify(p.felder)).not.toContain('hallo')
    }
  })

  it('umschreiben-Erfolg: loggt vier Phasen und zeichen = Länge des umgeschriebenen Endtexts', async () => {
    const { log, aufrufe } = fakeLog()
    const runner = createWorkflowRunner(
      runnerDeps({
        log,
        transcription: { async transcribe() { return 'rohtext' } },
        rewrite: { async rewrite() { return { text: 'poliert!' } } }
      })
    )

    runner.start({ def: def('improve'), chatModell: 'gpt-4o-mini' })
    await runner.stop()

    const phasen = aufrufe.filter((a) => a.ereignis === 'workflow.phase')
    expect(phasen.map((p) => p.felder.status)).toEqual([
      'aufnehmen',
      'transkribieren',
      'umschreiben',
      'fertig'
    ])
    expect(phasen[phasen.length - 1]!.felder.zeichen).toBe('poliert!'.length)
    expect(phasen[phasen.length - 1]!.stufe).toBe('info')
  })

  it('Fehler-Phase: loggt art + gekürzte message, NIE ein Transkript', async () => {
    const { log, aufrufe } = fakeLog()
    const runner = createWorkflowRunner(
      runnerDeps({
        log,
        transcription: {
          async transcribe() {
            throw new Error('OpenAI-Fehler: Rate limit erreicht')
          }
        }
      })
    )

    runner.start({ def: def('transcribe'), chatModell: 'gpt-4o-mini' })
    await runner.stop()

    const fehler = aufrufe.filter((a) => a.ereignis === 'workflow.phase' && a.felder.status === 'fehler')
    expect(fehler).toHaveLength(1)
    expect(fehler[0]!.felder.art).toBe('anbieter')
    expect(fehler[0]!.felder.message).toBe('OpenAI-Fehler: Rate limit erreicht')
  })

  it('Fehler-Phase: message wird auf 200 Zeichen (+…) gekürzt', async () => {
    const { log, aufrufe } = fakeLog()
    const lange = 'x'.repeat(500)
    const runner = createWorkflowRunner(
      runnerDeps({
        log,
        transcription: {
          async transcribe() {
            throw new Error(lange)
          }
        }
      })
    )

    runner.start({ def: def('transcribe'), chatModell: 'gpt-4o-mini' })
    await runner.stop()

    const fehler = aufrufe.find((a) => a.ereignis === 'workflow.phase' && a.felder.status === 'fehler')
    const message = fehler?.felder.message as string
    expect(message.length).toBe(201) // 200 + '…'
    expect(message.endsWith('…')).toBe(true)
  })

  it('Teil-Erfolg (Umschreibfehler): loggt grund + zeichen = Rohtext-Länge (kein Text)', async () => {
    const { log, aufrufe } = fakeLog()
    const runner = createWorkflowRunner(
      runnerDeps({
        log,
        transcription: { async transcribe() { return 'geretteter rohtext' } },
        rewrite: {
          async rewrite() {
            throw new Error('Umschreiben kaputt')
          }
        },
        // Retry ausschalten, damit der Umschreibfehler direkt terminal wird.
        sleep: async () => {}
      })
    )

    runner.start({ def: def('improve'), chatModell: 'gpt-4o-mini' })
    await runner.stop()

    const teil = aufrufe.find(
      (a) => a.ereignis === 'workflow.phase' && a.felder.status === 'teilErfolg'
    )
    expect(teil).toBeDefined()
    expect(teil!.felder.grund).toBe('umschreibfehler')
    expect(teil!.felder.zeichen).toBe('geretteter rohtext'.length)
    expect(JSON.stringify(teil!.felder)).not.toContain('rohtext') // kein Text, nur Länge
  })

  it('Anbieter-Retry: loggt anbieter.retry je Fehlversuch (versuch + redigierter Fehler)', async () => {
    const { log, aufrufe } = fakeLog()
    let n = 0
    const runner = createWorkflowRunner(
      runnerDeps({
        log,
        sleep: async () => {},
        transcription: {
          async transcribe() {
            n++
            if (n < 2) {
              // Transport-Fehler (transport:true) → als 'netzwerk' klassifiziert → retrybar.
              throw Object.assign(new Error('Netzwerkfehler'), { transport: true })
            }
            return 'roh'
          }
        }
      })
    )

    runner.start({ def: def('transcribe'), chatModell: 'gpt-4o-mini' })
    await runner.stop()

    const retries = aufrufe.filter((a) => a.ereignis === 'anbieter.retry')
    expect(retries).toHaveLength(1)
    expect(retries[0]!.stufe).toBe('warnung')
    expect(retries[0]!.felder.versuch).toBe(1)
    // Redigierter Fehler: nur name+message, keine Innereien (kein `transport`-Feld o. Ä.).
    expect(retries[0]!.felder.name).toBe('Error')
    expect(retries[0]!.felder.message).toBe('Netzwerkfehler')
    expect(retries[0]!.felder).not.toHaveProperty('transport')
  })

  it('ohne log-Dep: Runner arbeitet unverändert (kein Throw)', async () => {
    const runner = createWorkflowRunner(runnerDeps())
    runner.start({ def: def('transcribe'), chatModell: 'gpt-4o-mini' })
    const terminal = await runner.stop()
    expect(terminal.status).toBe('fertig')
  })

  it('debug: workflow.transkribiert loggt zeichen als LÄNGE (Zahl), nie den Transkript-Text', async () => {
    const { log, aufrufe } = fakeLog()
    const geheim = 'ABSOLUT GEHEIMES DIKTAT'
    const runner = createWorkflowRunner(
      runnerDeps({ log, transcription: { async transcribe() { return geheim } } })
    )

    runner.start({ def: def('transcribe'), chatModell: 'gpt-4o-mini' })
    await runner.stop()

    const transkribiert = aufrufe.find((a) => a.stufe === 'debug' && a.ereignis === 'workflow.transkribiert')
    expect(transkribiert).toBeDefined()
    expect(transkribiert!.felder.zeichen).toBe(geheim.length)
    expect(typeof transkribiert!.felder.zeichen).toBe('number')
    // Redaction: kein debug-Feld enthält den Transkript-String.
    for (const a of aufrufe.filter((x) => x.stufe === 'debug')) {
      expect(JSON.stringify(a.felder)).not.toContain('GEHEIM')
    }
    // debug: workflow.aufnahme mit reinen Zahlen (Dauer + Bytes).
    const aufnahme = aufrufe.find((a) => a.stufe === 'debug' && a.ereignis === 'workflow.aufnahme')
    expect(aufnahme).toBeDefined()
    expect(typeof aufnahme!.felder.dauerSekunden).toBe('number')
    expect(typeof aufnahme!.felder.bytes).toBe('number')
  })

  it('debug: workflow.umgeschrieben loggt zeichen als LÄNGE, nie den Endtext', async () => {
    const { log, aufrufe } = fakeLog()
    const runner = createWorkflowRunner(
      runnerDeps({
        log,
        transcription: { async transcribe() { return 'roh' } },
        rewrite: { async rewrite() { return { text: 'GEHEIM poliert' } } }
      })
    )

    runner.start({ def: def('improve'), chatModell: 'gpt-4o-mini' })
    await runner.stop()

    const um = aufrufe.find((a) => a.stufe === 'debug' && a.ereignis === 'workflow.umgeschrieben')
    expect(um).toBeDefined()
    expect(um!.felder.zeichen).toBe('GEHEIM poliert'.length)
    expect(JSON.stringify(um!.felder)).not.toContain('poliert')
  })

  // v0.8.0 (Befund B, Feld-Log): „Keine Aufnahme erkannt." deckte bislang ZWEI ursächlich verschiedene
  // Fälle ab (zu kurz gehalten / lang genug, aber Transkription leer) — im Feld-Log nur per Code-Analyse
  // zu trennen. Jetzt zwei eigene Log-Ereignisse, damit die Trennung auch OHNE Code-Analyse möglich ist.
  it('Kurzaufnahme-Guard: loggt workflow.zu_kurz mit gerundeter Dauer, NICHT workflow.leere_transkription', async () => {
    const { log, aufrufe } = fakeLog()
    const runner = createWorkflowRunner(runnerDeps({ log, recorder: fakeRecorder(0.2) }))

    runner.start({ def: def('transcribe'), chatModell: 'gpt-4o-mini' })
    const terminal = await runner.stop()

    const treffer = aufrufe.find((a) => a.ereignis === 'workflow.zu_kurz')
    expect(treffer).toBeDefined()
    expect(treffer!.stufe).toBe('info')
    expect(treffer!.felder.dauerSekunden).toBe(0.2)
    expect(aufrufe.some((a) => a.ereignis === 'workflow.leere_transkription')).toBe(false)
    expect(terminal).toMatchObject({
      status: 'fehler',
      art: 'aufnahme',
      message: 'Zu kurz aufgenommen — bitte die Taste länger gedrückt halten.'
    })
  })

  it('leere/artefaktige Transkription: loggt workflow.leere_transkription, NICHT workflow.zu_kurz', async () => {
    const { log, aufrufe } = fakeLog()
    const runner = createWorkflowRunner(
      runnerDeps({ log, recorder: fakeRecorder(1.5), transcription: { async transcribe() { return '' } } })
    )

    runner.start({ def: def('transcribe'), chatModell: 'gpt-4o-mini' })
    const terminal = await runner.stop()

    const treffer = aufrufe.find((a) => a.ereignis === 'workflow.leere_transkription')
    expect(treffer).toBeDefined()
    expect(treffer!.stufe).toBe('info')
    expect(treffer!.felder.dauerSekunden).toBe(1.5)
    expect(aufrufe.some((a) => a.ereignis === 'workflow.zu_kurz')).toBe(false)
    expect(terminal).toMatchObject({
      status: 'fehler',
      art: 'aufnahme',
      message: 'Kein verwertbarer Text erkannt — bitte erneut versuchen.'
    })
  })
})

// --- Sitzung-Gates: stille Abbrüche werden sichtbar (TEXT-FREI: nur Ids/Quelle/Status) ---

function makeSitzung(opts: {
  hasKey?: boolean
  settings?: Partial<BlitztextSettings>
  log: EreignisLog
}) {
  const recorder = fakeRecorder(1.5)
  const runner = createWorkflowRunner({
    recorder,
    transcription: { async transcribe() { return 'roh' } },
    rewrite: { async rewrite() { return { text: 'um' } } },
    resolveSystemPrompt,
    quality
  })
  let content: string | null = opts.settings ? JSON.stringify(opts.settings) : null
  const einstellungen = createSettingsStore({
    file: {
      async read() {
        return content
      },
      async write(next) {
        content = next
      }
    }
  })
  const ausgabe: Ausgabe = {
    einfügen: () => {},
    anzeigen: () => {},
    zeigeEinstellungen: () => {},
    melde: () => {},
    inZwischenablage: () => {},
    erfasseFenster: async () => null
  }
  const apiKeys = {
    async has() {
      return opts.hasKey ?? true
    }
  }
  const sitzung = createSitzung({ runner, einstellungen, apiKeys, ausgabe, log: opts.log })
  return { sitzung }
}

describe('Ereignislog-Verdrahtung: Sitzung-Gates', () => {
  it('kein API-Key + hotkey: loggt sitzung.start_ohne_key mit anbieter-Id + quelle', async () => {
    const { log, aufrufe } = fakeLog()
    const { sitzung } = makeSitzung({ hasKey: false, log })

    await sitzung.starteWorkflow('transcribe', 'hotkey')

    const treffer = aufrufe.find((a) => a.ereignis === 'sitzung.start_ohne_key')
    expect(treffer).toBeDefined()
    expect(treffer!.stufe).toBe('warnung')
    expect(treffer!.felder.quelle).toBe('hotkey')
    expect(typeof treffer!.felder.anbieter).toBe('string')
  })

  it('debug: sitzung.start loggt workflow-Id + quelle-Enum (kein Text)', async () => {
    const { log, aufrufe } = fakeLog()
    const { sitzung } = makeSitzung({ log })

    await sitzung.starteWorkflow('transcribe', 'manuell')

    const treffer = aufrufe.find((a) => a.stufe === 'debug' && a.ereignis === 'sitzung.start')
    expect(treffer).toBeDefined()
    expect(treffer!.felder.workflow).toBe('transcribe')
    expect(treffer!.felder.quelle).toBe('manuell')
  })

  it('unbekannter Workflow: loggt sitzung.workflow_unbekannt mit Workflow-Id + quelle', async () => {
    const { log, aufrufe } = fakeLog()
    const { sitzung } = makeSitzung({ log })

    // Absichtlich unbekannte Id (verwaister Hotkey) — WorkflowId ist `string`, daher kein Typfehler.
    await sitzung.starteWorkflow('gibt-es-nicht', 'hotkey')

    const treffer = aufrufe.find((a) => a.ereignis === 'sitzung.workflow_unbekannt')
    expect(treffer).toBeDefined()
    expect(treffer!.stufe).toBe('warnung')
    expect(treffer!.felder.workflow).toBe('gibt-es-nicht')
    expect(treffer!.felder.quelle).toBe('hotkey')
  })

  it('debug: routeDispatch loggt hotkey.aktion NUR bei echter Aktion, mit aktion+workflow-Enum', () => {
    const { log, aufrufe } = fakeLog()
    const stub: Pick<Sitzung, 'starteWorkflow' | 'stoppe' | 'brichAb'> = {
      starteWorkflow: async () => {},
      stoppe: async () => {},
      brichAb: () => {}
    }

    // Kein Dispatch (null, Hot-Path) → NICHTS geloggt.
    routeDispatch(null, stub, log)
    expect(aufrufe.some((a) => a.ereignis === 'hotkey.aktion')).toBe(false)

    // Echte Start-Aktion → genau ein hotkey.aktion mit reinen Enum/Id-Feldern.
    routeDispatch({ aktion: 'start', workflow: 'transcribe' }, stub, log)
    const treffer = aufrufe.filter((a) => a.stufe === 'debug' && a.ereignis === 'hotkey.aktion')
    expect(treffer).toHaveLength(1)
    expect(treffer[0]!.felder.aktion).toBe('start')
    expect(treffer[0]!.felder.workflow).toBe('transcribe')
  })

  it('Abbruch während des Starts: loggt sitzung.start_entwertet (veraltet-Ausstieg)', async () => {
    const { log, aufrufe } = fakeLog()
    const { sitzung } = makeSitzung({ log })

    // starteWorkflow läuft in seine Awaits; brichAb() erhöht die Generation → der Start steigt am
    // nächsten veraltet()-Check aus und loggt start_entwertet, ohne runner.start() abzuschließen.
    const p = sitzung.starteWorkflow('transcribe', 'hotkey')
    sitzung.brichAb()
    await p

    const treffer = aufrufe.find((a) => a.ereignis === 'sitzung.start_entwertet')
    expect(treffer).toBeDefined()
    expect(treffer!.stufe).toBe('info')
    expect(treffer!.felder.quelle).toBe('hotkey')
  })
})

// --- Befund 10 (v0.8.0): Lauf-Kennung + Gesamtdauer verbinden die Zeilen EINES Laufs im Ereignislog ---

describe('Ereignislog-Verdrahtung: Befund 10 (Lauf-Kennung + Gesamtdauer)', () => {
  it('mehrere workflow.phase-Zeilen EINES Laufs tragen dieselbe Lauf-Kennung (RunInput.laufKennung)', async () => {
    const { log, aufrufe } = fakeLog()
    const runner = createWorkflowRunner(runnerDeps({ log }))

    runner.start({ def: def('transcribe'), chatModell: 'gpt-4o-mini', laufKennung: 42 })
    await runner.stop()

    const phasen = aufrufe.filter((a) => a.ereignis === 'workflow.phase')
    // aufnehmen, transkribieren, fertig — alle drei mit derselben Kennung.
    expect(phasen.length).toBeGreaterThanOrEqual(3)
    for (const p of phasen) expect(p.felder.lauf).toBe(42)
  })

  it('ohne laufKennung bleibt das lauf-Feld in den Phasen-Zeilen weg (Altweg/Bestandstests unverändert)', async () => {
    const { log, aufrufe } = fakeLog()
    const runner = createWorkflowRunner(runnerDeps({ log }))

    runner.start({ def: def('transcribe'), chatModell: 'gpt-4o-mini' })
    await runner.stop()

    const phasen = aufrufe.filter((a) => a.ereignis === 'workflow.phase')
    expect(phasen.length).toBeGreaterThan(0)
    for (const p of phasen) expect(p.felder.lauf).toBeUndefined()
  })

  it('debug: workflow.transkribiert/umgeschrieben tragen ebenfalls die Lauf-Kennung', async () => {
    const { log, aufrufe } = fakeLog()
    const runner = createWorkflowRunner(
      runnerDeps({ log, rewrite: { async rewrite() { return { text: 'poliert' } } } })
    )

    runner.start({ def: def('improve'), chatModell: 'gpt-4o-mini', laufKennung: 7 })
    await runner.stop()

    const transkribiert = aufrufe.find((a) => a.ereignis === 'workflow.transkribiert')
    const umgeschrieben = aufrufe.find((a) => a.ereignis === 'workflow.umgeschrieben')
    expect(transkribiert?.felder.lauf).toBe(7)
    expect(umgeschrieben?.felder.lauf).toBe(7)
  })

  it('Sitzung: ein erfolgreicher Hotkey-Lauf protokolliert die Gesamtdauer, mit derselben Lauf-Kennung wie die Runner-Phasen', async () => {
    const { log, aufrufe } = fakeLog()
    const recorder = fakeRecorder(1.5)
    const runner = createWorkflowRunner(
      runnerDeps({ log, recorder, transcription: { async transcribe() { return 'roh' } } })
    )
    let content: string | null = null
    const einstellungen = createSettingsStore({
      file: {
        async read() {
          return content
        },
        async write(next) {
          content = next
        }
      }
    })
    const ausgabe: Ausgabe = {
      einfügen: () => {},
      anzeigen: () => {},
      zeigeEinstellungen: () => {},
      melde: () => {},
      inZwischenablage: () => {},
      erfasseFenster: async () => null
    }
    const apiKeys = {
      async has() {
        return true
      }
    }
    const sitzung = createSitzung({ runner, einstellungen, apiKeys, ausgabe, log })

    await sitzung.starteWorkflow('transcribe', 'hotkey')
    await sitzung.stoppe()

    // (b) Gesamtdauer protokolliert, IMMER sichtbar (info-Stufe, nicht hinter dem Debug-Schalter).
    const gesamt = aufrufe.find((a) => a.ereignis === 'sitzung.lauf_fertig')
    expect(gesamt).toBeDefined()
    expect(gesamt!.stufe).toBe('info')
    expect(typeof gesamt!.felder.dauerMs).toBe('number')
    expect(gesamt!.felder.dauerMs as number).toBeGreaterThanOrEqual(0)

    // (a) dieselbe Lauf-Kennung taucht in mehreren Runner-Log-Zeilen DIESES Laufs auf (kein neuer Zähler
    // — dieselbe laufGeneration, die starteWorkflow beim Auslösen vergeben hat).
    const laufKennung = gesamt!.felder.lauf
    expect(typeof laufKennung).toBe('number')
    const phasenMitKennung = aufrufe.filter(
      (a) => a.ereignis === 'workflow.phase' && a.felder.lauf === laufKennung
    )
    expect(phasenMitKennung.length).toBeGreaterThanOrEqual(2)
  })
})
