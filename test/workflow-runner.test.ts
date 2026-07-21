import { describe, it, expect, vi } from 'vitest'
import {
  createWorkflowRunner,
  entferneSteuerzeichen,
  type WorkflowRunnerDeps,
  type WorkflowPhase
} from '@main/workflow/runner'
import * as quality from '@main/transcription/quality'
import { resolveSystemPrompt, buildSystemPrompt, kapsleTranskript } from '@main/rewrite/prompt-builder'
import { getWorkflow, BUILTIN_WORKFLOWS, promptKennungFuer } from '@shared/workflows'

const audio = new Blob(['x'], { type: 'audio/webm' })

// Bequeme Auflösung einer eingebauten Definition für die RunInput.
const def = (id: string) => getWorkflow(id, BUILTIN_WORKFLOWS)

function fakeRecorder(durationSeconds: number) {
  return {
    start(): void {},
    async stop() {
      return { audio, durationSeconds }
    },
    discard(): void {}
  }
}

function makeDeps(overrides: Partial<WorkflowRunnerDeps> = {}): WorkflowRunnerDeps {
  return {
    recorder: fakeRecorder(1.5),
    transcription: { async transcribe() { return 'roh' } },
    rewrite: { async rewrite() { return { text: 'umgeschrieben' } } },
    resolveSystemPrompt,
    quality,
    ...overrides
  }
}

describe('createWorkflowRunner', () => {
  it('transcribe: start → aufnehmen, stop → fertig mit gesäubertem Rohtext, kein Umschreiben', async () => {
    let rewriteCalled = false
    const runner = createWorkflowRunner(
      makeDeps({
        transcription: { async transcribe() { return '  hallo welt  ' } },
        rewrite: {
          async rewrite() {
            rewriteCalled = true
            return { text: 'x' }
          }
        }
      })
    )

    runner.start({ def: def('transcribe'), chatModell: 'gpt-4o-mini' })
    expect(runner.phase).toEqual({ status: 'aufnehmen' })

    const terminal = await runner.stop()
    expect(terminal).toEqual({ status: 'fertig', text: 'hallo welt' })
    expect(runner.phase).toEqual({ status: 'fertig', text: 'hallo welt' })
    expect(rewriteCalled).toBe(false)
  })

  it('Kurzaufnahme-Guard: zu kurze Aufnahme → fehler, Transkription wird nicht aufgerufen', async () => {
    let transcribeCalled = false
    const runner = createWorkflowRunner(
      makeDeps({
        recorder: fakeRecorder(0.2),
        transcription: {
          async transcribe() {
            transcribeCalled = true
            return 'x'
          }
        }
      })
    )

    runner.start({ def: def('transcribe'), chatModell: 'gpt-4o-mini' })
    const terminal = await runner.stop()

    expect(terminal).toEqual({ status: 'fehler', art: 'aufnahme', message: 'Keine Aufnahme erkannt.' })
    expect(transcribeCalled).toBe(false)
  })

  it('Artefakt-Guard: kurze Aufnahme mit artefakt-verdächtigem Rohtext → fehler', async () => {
    // 0,4 s + ≥5 Wörter erfüllt isLikelyArtifact (recordingSeconds < 0,55).
    const runner = createWorkflowRunner(
      makeDeps({
        recorder: fakeRecorder(0.4),
        transcription: { async transcribe() { return 'ein zwei drei vier fünf' } }
      })
    )

    runner.start({ def: def('transcribe'), chatModell: 'gpt-4o-mini' })
    const terminal = await runner.stop()

    expect(terminal).toEqual({ status: 'fehler', art: 'aufnahme', message: 'Keine Aufnahme erkannt.' })
  })

  it('Provider-Fehler: wirft die Transkription, geht der Runner mit deren Meldung nach fehler', async () => {
    const runner = createWorkflowRunner(
      makeDeps({
        transcription: {
          async transcribe() {
            throw new Error('OpenAI-Fehler: Rate limit erreicht')
          }
        }
      })
    )

    runner.start({ def: def('transcribe'), chatModell: 'gpt-4o-mini' })
    const terminal = await runner.stop()

    expect(terminal).toEqual({
      status: 'fehler',
      art: 'anbieter',
      message: 'OpenAI-Fehler: Rate limit erreicht'
    })
  })

  it('improve: durchläuft umschreiben und ruft rewrite mit Rohtext, Prompt und Routing auf', async () => {
    const phases: string[] = []
    let rewriteInput: { system: string; user: string } | undefined
    let rewriteOpts: { model: string; temperature: number } | undefined
    const settings = { tone: 'formal' as const }

    const runner = createWorkflowRunner(
      makeDeps({
        transcription: { async transcribe() { return '  rohtext hier  ' } },
        rewrite: {
          async rewrite(input, opts) {
            rewriteInput = input
            rewriteOpts = opts
            return { text: '  fertige nachricht  ' }
          }
        }
      })
    )
    runner.onPhase = (p) => phases.push(p.status)

    runner.start({ def: def('improve'), chatModell: 'gpt-4o-mini', rewriteSettings: settings })
    const terminal = await runner.stop()

    expect(phases).toEqual(['aufnehmen', 'transkribieren', 'umschreiben', 'fertig'])
    expect(terminal).toEqual({ status: 'fertig', text: 'fertige nachricht' })
    // System-Prompt = die volle Laufzeit-Auflösung (inkl. Daten-Rahmen), Rohtext gekapselt gesendet.
    expect(rewriteInput).toEqual({
      system: resolveSystemPrompt(def('improve'), settings),
      user: kapsleTranskript('rohtext hier')
    })
    // Basis bleibt der v1-Builder-Text als Präfix; der Rohtext steckt zwischen den Markierungen.
    expect(rewriteInput?.system.startsWith(buildSystemPrompt('improve', settings))).toBe(true)
    expect(rewriteInput?.user).toContain('rohtext hier')
    expect(rewriteOpts).toMatchObject({ model: 'gpt-4o-mini', temperature: 0.3 })
  })

  it('entfernt vom Modell zurückgespiegelte Transkript-Markierungen aus dem Endtext', async () => {
    const runner = createWorkflowRunner(
      makeDeps({
        transcription: { async transcribe() { return 'roh' } },
        rewrite: {
          async rewrite() {
            return { text: '<transkript>\nfertige nachricht\n</transkript>' }
          }
        }
      })
    )
    runner.start({ def: def('improve'), chatModell: 'gpt-4o-mini' })
    const terminal = await runner.stop()
    expect(terminal).toEqual({ status: 'fertig', text: 'fertige nachricht' })
  })

  it('calm: routet das Umschreiben auf gpt-4o @ 0.4', async () => {
    let rewriteOpts: { model: string; temperature: number } | undefined
    const runner = createWorkflowRunner(
      makeDeps({
        rewrite: {
          async rewrite(_input, opts) {
            rewriteOpts = opts
            return { text: 'ruhig' }
          }
        }
      })
    )

    // 0.3.1: der Runner nutzt das AUFGELÖSTE chatModell (sitzung übergibt lauf.chatModell). Für calm
    // @OpenAI ist das 'gpt-4o' (gepinntes Modell, für OpenAI gültig) — Temperatur kommt aus def.
    runner.start({ def: def('calm'), chatModell: 'gpt-4o' })
    await runner.stop()

    expect(rewriteOpts).toMatchObject({ model: 'gpt-4o', temperature: 0.4 })
  })

  it('nutzt das aufgelöste chatModell statt des gepinnten def.model (Built-in gegen Mistral, 0.3.1)', async () => {
    let rewriteOpts: { model: string } | undefined
    const runner = createWorkflowRunner(
      makeDeps({
        rewrite: {
          async rewrite(_input, opts) {
            rewriteOpts = opts
            return { text: 'x' }
          }
        }
      })
    )
    // improve pinnt 'gpt-4o-mini' (OpenAI); gegen Mistral löst die Sitzung auf 'mistral-small-latest'
    // auf. Der Runner MUSS dieses nutzen — sonst ginge gpt-4o-mini an Mistral (Absturz, der Bug).
    runner.start({ def: def('improve'), chatModell: 'mistral-small-latest' })
    await runner.stop()
    expect(rewriteOpts?.model).toBe('mistral-small-latest')
  })

  it('vocabularyHints: ab 0,9 s Aufnahme werden customTerms an die Transkription übergeben', async () => {
    let options: { language?: string; vocabularyHints?: string[] } | undefined
    const runner = createWorkflowRunner(
      makeDeps({
        recorder: fakeRecorder(0.9),
        transcription: {
          async transcribe(_audio, opts) {
            options = opts
            return 'hallo'
          }
        }
      })
    )

    runner.start({ def: def('transcribe'), chatModell: 'gpt-4o-mini', customTerms: ['Acme', 'Blitztext'] })
    await runner.stop()

    expect(options?.vocabularyHints).toEqual(['Acme', 'Blitztext'])
  })

  it('vocabularyHints: unter 0,9 s Aufnahme bleiben sie leer', async () => {
    let options: { language?: string; vocabularyHints?: string[] } | undefined
    const runner = createWorkflowRunner(
      makeDeps({
        recorder: fakeRecorder(0.6),
        transcription: {
          async transcribe(_audio, opts) {
            options = opts
            return 'hallo'
          }
        }
      })
    )

    runner.start({ def: def('transcribe'), chatModell: 'gpt-4o-mini', customTerms: ['Acme'] })
    await runner.stop()

    expect(options?.vocabularyHints).toEqual([])
  })

  it('start() startet die Aufnahme über den Recorder', () => {
    let started = 0
    const runner = createWorkflowRunner(
      makeDeps({
        recorder: {
          start() {
            started++
          },
          async stop() {
            return { audio, durationSeconds: 1.5 }
          },
          discard() {}
        }
      })
    )

    runner.start({ def: def('transcribe'), chatModell: 'gpt-4o-mini' })

    expect(started).toBe(1)
    expect(runner.phase).toEqual({ status: 'aufnehmen' })
  })

  it('abbrechen() verwirft eine laufende Aufnahme und geht nach idle', () => {
    let discarded = 0
    const runner = createWorkflowRunner(
      makeDeps({
        recorder: {
          start() {},
          async stop() {
            return { audio, durationSeconds: 1.5 }
          },
          discard() {
            discarded++
          }
        }
      })
    )

    runner.start({ def: def('transcribe'), chatModell: 'gpt-4o-mini' })
    runner.abbrechen()

    expect(runner.phase).toEqual({ status: 'idle' })
    expect(discarded).toBe(1)
  })

  it('abbrechen() im Leerlauf tut nichts', () => {
    let discarded = 0
    const runner = createWorkflowRunner(
      makeDeps({
        recorder: {
          start() {},
          async stop() {
            return { audio, durationSeconds: 1.5 }
          },
          discard() {
            discarded++
          }
        }
      })
    )

    runner.abbrechen()

    expect(runner.phase).toEqual({ status: 'idle' })
    expect(discarded).toBe(0)
  })

  // --- v0.2.x #02: Abbruch in Anbieter-Phasen + Watchdog ---

  // Eine Transkription, die hängt, bis ihr Signal abgebrochen wird.
  function haengendeTranskription() {
    return {
      async transcribe(_audio: Blob, opts?: { signal?: AbortSignal }) {
        return await new Promise<string>((_resolve, reject) => {
          opts?.signal?.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError'))
          )
        })
      }
    }
  }

  it('abbrechen() während der Transkription bricht den Anbieter-Aufruf ab und geht STILL nach idle', async () => {
    const runner = createWorkflowRunner(makeDeps({ transcription: haengendeTranskription() }))

    runner.start({ def: def('transcribe'), chatModell: 'm' })
    const stopP = runner.stop()
    await new Promise((r) => setTimeout(r, 0))
    expect(runner.phase).toEqual({ status: 'transkribieren', istWiederholung: false })

    runner.abbrechen()
    const terminal = await stopP

    expect(terminal).toEqual({ status: 'idle' })
    expect(runner.phase).toEqual({ status: 'idle' })
  })

  it('Watchdog-Timeout → fehler art anbieter mit Zeitüberschreitungs-Meldung', async () => {
    let fireWatchdog: () => void = () => {}
    const runner = createWorkflowRunner(
      makeDeps({
        transcription: haengendeTranskription(),
        starteWatchdog: (onTimeout) => {
          fireWatchdog = onTimeout
          return () => {}
        }
      })
    )

    runner.start({ def: def('transcribe'), chatModell: 'm' })
    const stopP = runner.stop()
    await new Promise((r) => setTimeout(r, 0))
    fireWatchdog()
    const terminal = await stopP

    expect(terminal).toEqual({
      status: 'fehler',
      art: 'anbieter',
      message: 'Zeitüberschreitung beim Anbieter.'
    })
  })

  // --- Regression: Phantom-Stop-Schutz (Dispatcher/Sitzung-Desync bei langem Umschreiben) ---

  function zaehlenderRecorder(durationSeconds = 1.5) {
    const z = { starts: 0, stops: 0, discards: 0 }
    return {
      z,
      start(): void {
        z.starts++
      },
      async stop() {
        z.stops++
        return { audio, durationSeconds }
      },
      discard(): void {
        z.discards++
      }
    }
  }

  it('stop() ohne laufende Aufnahme (Phase ≠ aufnehmen) ist ein No-Op und ruft den Recorder NICHT', async () => {
    const rec = zaehlenderRecorder()
    const runner = createWorkflowRunner(makeDeps({ recorder: rec }))

    const terminal = await runner.stop() // nie gestartet → Phase idle

    expect(terminal).toEqual({ status: 'idle' })
    expect(rec.z.stops).toBe(0)
  })

  it('ein zweiter stop() nach Abschluss löst KEINEN weiteren recorder.stop() aus (Phantom-Stop)', async () => {
    const rec = zaehlenderRecorder()
    const runner = createWorkflowRunner(
      makeDeps({ recorder: rec, transcription: { async transcribe() { return 'hallo' } } })
    )

    runner.start({ def: def('transcribe'), chatModell: 'm' })
    const erst = await runner.stop()
    expect(erst.status).toBe('fertig')
    expect(rec.z.stops).toBe(1)

    // Desync: Phase ist 'fertig' → no-op, kein zweiter recorder.stop(), keine Zustandsänderung.
    const zweit = await runner.stop()
    expect(zweit).toEqual(erst)
    expect(rec.z.stops).toBe(1)
  })

  it('Recorder-Fehler beim Stoppen → fehler/aufnahme statt uncaught rejection', async () => {
    const runner = createWorkflowRunner(
      makeDeps({
        recorder: {
          start() {},
          async stop(): Promise<{ audio: Blob; durationSeconds: number }> {
            throw new Error('Keine aktive Aufnahme.')
          },
          discard() {}
        }
      })
    )

    runner.start({ def: def('transcribe'), chatModell: 'm' })
    const terminal = await runner.stop()

    expect(terminal).toEqual({ status: 'fehler', art: 'aufnahme', message: 'Keine aktive Aufnahme.' })
  })

  it('stoppt den Watchdog nach erfolgreichem Lauf', async () => {
    let cancelled = 0
    const runner = createWorkflowRunner(
      makeDeps({ starteWatchdog: () => () => { cancelled++ } })
    )

    runner.start({ def: def('transcribe'), chatModell: 'm' })
    await runner.stop()

    expect(cancelled).toBe(1)
  })

  // --- A3: Teil-Erfolg (Rohtext nie verlieren) + A1-Klassifikation ---

  it('Teil-Erfolg: Umschreib-Fehler bei vorhandenem Rohtext → teilErfolg (Rohtext erhalten), Metrik gesetzt', async () => {
    const runner = createWorkflowRunner(
      makeDeps({
        transcription: { async transcribe() { return '  mein rohtext  ' } },
        rewrite: { async rewrite() { throw new Error('KI-Fehler: kaputt') } }
      })
    )

    runner.start({ def: def('improve'), chatModell: 'gpt-4o-mini' })
    const terminal = await runner.stop()

    expect(terminal).toEqual({
      status: 'teilErfolg',
      rohtext: 'mein rohtext',
      warnung: 'KI-Fehler: kaputt',
      grund: 'umschreibfehler'
    })
    expect(runner.letzteMetrik).toMatchObject({
      rohtext: 'mein rohtext',
      endtext: 'mein rohtext',
      umgeschrieben: false
    })
  })

  // --- v0.4.5 (ADR-0018): Treue-Detektor → Teil-Erfolg statt falschem Einfügen ---

  it('Treue-Detektor: schlägt an → teilErfolg grund=beantwortet (Rohtext gerettet, kein Einfügen)', async () => {
    const runner = createWorkflowRunner(
      makeDeps({
        transcription: { async transcribe() { return 'gib mir eine empfehlung wie du das machst' } },
        rewrite: { async rewrite() { return { text: 'Ich würde das so machen.' } } },
        // Detektor-Stub, der diesen Lauf als „beantwortet" markiert.
        treueDetektor: { wirktBeantwortet: () => true }
      })
    )

    runner.start({ def: def('improve'), chatModell: 'gpt-4o-mini' })
    const terminal = await runner.stop()

    expect(terminal).toMatchObject({ status: 'teilErfolg', grund: 'beantwortet' })
    expect(terminal).toMatchObject({ rohtext: 'gib mir eine empfehlung wie du das machst' })
    // Wie ein Teil-Erfolg protokolliert: umgeschrieben=false, endtext=rohtext (kein falscher Endtext).
    expect(runner.letzteMetrik).toMatchObject({ umgeschrieben: false })
  })

  it('Treue-Detektor: schlägt NICHT an → normaler fertig-Abschluss (Endtext eingefügt)', async () => {
    const runner = createWorkflowRunner(
      makeDeps({
        rewrite: { async rewrite() { return { text: 'sauber poliert' } } },
        treueDetektor: { wirktBeantwortet: () => false }
      })
    )

    runner.start({ def: def('improve'), chatModell: 'gpt-4o-mini' })
    const terminal = await runner.stop()

    expect(terminal).toEqual({ status: 'fertig', text: 'sauber poliert' })
  })

  // --- v0.7.1 Stufe 3: Vollständigkeits-Detektor (5. Vorfallsklasse „Weglassen") ---

  const ROHTEXT_VORFALL =
    'Der sagt zwar keine Aufnahme erkannt, aber ich bin jetzt mal gespannt, was jetzt funktioniert.'

  it('Vollständigkeits-Detektor: improve + realer Vorfallssatz mit weggelassenem Teilsatz → teilErfolg grund=unvollstaendig', async () => {
    const runner = createWorkflowRunner(
      makeDeps({
        transcription: { async transcribe() { return ROHTEXT_VORFALL } },
        rewrite: { async rewrite() { return { text: 'Ich bin jetzt gespannt, was jetzt funktioniert.' } } }
      })
    )

    runner.start({ def: def('improve'), chatModell: 'gpt-4o-mini' })
    const terminal = await runner.stop()

    expect(terminal).toMatchObject({ status: 'teilErfolg', grund: 'unvollstaendig' })
    expect(terminal).toMatchObject({ rohtext: ROHTEXT_VORFALL })
    expect(runner.letzteMetrik).toMatchObject({ umgeschrieben: false })
  })

  it('Vollständigkeits-Detektor: emoji + vollständiger Endtext → normaler fertig-Abschluss', async () => {
    const runner = createWorkflowRunner(
      makeDeps({
        transcription: { async transcribe() { return ROHTEXT_VORFALL } },
        rewrite: {
          async rewrite() {
            return {
              text: 'Er sagt zwar „keine Aufnahme erkannt" 🙈, aber ich bin jetzt gespannt, was funktioniert 🚀.'
            }
          }
        }
      })
    )

    runner.start({ def: def('emoji'), chatModell: 'gpt-4o-mini' })
    const terminal = await runner.stop()

    expect(terminal.status).toBe('fertig')
  })

  it('Vollständigkeits-Detektor: calm bleibt AUSGESCHLOSSEN, obwohl Inhaltswörter fehlen (Verdichten ist beabsichtigt)', async () => {
    const runner = createWorkflowRunner(
      makeDeps({
        transcription: { async transcribe() { return ROHTEXT_VORFALL } },
        rewrite: { async rewrite() { return { text: 'Ich bin jetzt gespannt, was jetzt funktioniert.' } } }
      })
    )

    runner.start({ def: def('calm'), chatModell: 'gpt-4o-mini' })
    const terminal = await runner.stop()

    expect(terminal.status).toBe('fertig')
  })

  it('Vollständigkeits-Detektor: bei gesetzter ausgabeSprache AUSGESCHLOSSEN (Übersetzung matcht Wörter nie)', async () => {
    const runner = createWorkflowRunner(
      makeDeps({
        transcription: { async transcribe() { return ROHTEXT_VORFALL } },
        rewrite: {
          async rewrite() {
            return { text: 'I am now curious what will work.' }
          }
        }
      })
    )

    runner.start({
      def: { ...def('improve'), ausgabeSprache: 'en' },
      chatModell: 'gpt-4o-mini'
    })
    const terminal = await runner.stop()

    expect(terminal.status).toBe('fertig')
  })

  it('Vollständigkeits-Detektor: custom-Workflow (statisch) bleibt AUSGESCHLOSSEN — Nutzer-Prompts dürfen kürzen', async () => {
    const customDef = {
      ...def('improve'),
      id: 'mein-stichpunkt-workflow',
      builtin: false,
      promptModus: 'statisch' as const,
      systemPrompt: 'Fasse den Text in Stichpunkten zusammen.'
    }
    const runner = createWorkflowRunner(
      makeDeps({
        transcription: { async transcribe() { return ROHTEXT_VORFALL } },
        rewrite: { async rewrite() { return { text: 'Gespannt, was funktioniert.' } } }
      })
    )

    runner.start({ def: customDef, chatModell: 'gpt-4o-mini' })
    const terminal = await runner.stop()

    expect(terminal.status).toBe('fertig')
  })

  // --- W1-D: finish_reason='length' (abgeschnitten) → Teil-Erfolg statt vollem Erfolg ---

  it('Provider meldet abgeschnitten:true → teilErfolg grund=abgeschnitten (Rohtext gerettet, kein Einfügen)', async () => {
    const runner = createWorkflowRunner(
      makeDeps({
        transcription: { async transcribe() { return '  mein rohtext  ' } },
        rewrite: {
          async rewrite() {
            return { text: 'abgeschnittener tex', abgeschnitten: true }
          }
        }
      })
    )

    runner.start({ def: def('improve'), chatModell: 'gpt-4o-mini' })
    const terminal = await runner.stop()

    expect(terminal).toMatchObject({
      status: 'teilErfolg',
      rohtext: 'mein rohtext',
      grund: 'abgeschnitten'
    })
    expect(runner.letzteMetrik).toMatchObject({
      rohtext: 'mein rohtext',
      endtext: 'mein rohtext',
      umgeschrieben: false
    })
  })

  // --- W3-μ (V5): promptKennung in der Metrik — nur bei Umschreib-Erfolg, sonst undefined ---

  it('promptKennung: bei Umschreib-Erfolg gesetzt (builtin:<id>@<hash> des aufgelösten Prompts)', async () => {
    const runner = createWorkflowRunner(
      makeDeps({
        rewrite: { async rewrite() { return { text: 'sauber poliert' } } }
      })
    )

    runner.start({ def: def('improve'), chatModell: 'gpt-4o-mini' })
    await runner.stop()

    const erwarteterSystem = resolveSystemPrompt(def('improve'), undefined)
    expect(runner.letzteMetrik).toMatchObject({
      umgeschrieben: true,
      promptKennung: promptKennungFuer(def('improve'), erwarteterSystem)
    })
    expect(runner.letzteMetrik?.promptKennung).toMatch(/^builtin:improve@[0-9a-f]{8}$/)
  })

  it('promptKennung: bei reiner Transkription (kein Umschreiben) undefined', async () => {
    const runner = createWorkflowRunner(makeDeps())

    runner.start({ def: def('transcribe'), chatModell: 'gpt-4o-mini' })
    await runner.stop()

    expect(runner.letzteMetrik).toMatchObject({ umgeschrieben: false })
    expect(runner.letzteMetrik?.promptKennung).toBeUndefined()
  })

  it('promptKennung: bei Teil-Erfolg (Umschreib-Fehler) undefined (kein Endtext aus dem Modell)', async () => {
    const runner = createWorkflowRunner(
      makeDeps({
        transcription: { async transcribe() { return '  mein rohtext  ' } },
        rewrite: { async rewrite() { throw new Error('KI-Fehler: kaputt') } }
      })
    )

    runner.start({ def: def('improve'), chatModell: 'gpt-4o-mini' })
    await runner.stop()

    expect(runner.letzteMetrik?.promptKennung).toBeUndefined()
  })

  it('Provider ohne abgeschnitten-Flag (bzw. false) → normaler fertig-Abschluss (unverändert)', async () => {
    const runner = createWorkflowRunner(
      makeDeps({
        rewrite: { async rewrite() { return { text: 'sauber poliert' } } }
      })
    )

    runner.start({ def: def('improve'), chatModell: 'gpt-4o-mini' })
    const terminal = await runner.stop()

    expect(terminal).toEqual({ status: 'fertig', text: 'sauber poliert' })
  })

  it('Transkriptions-Fehler (kein Rohtext) bleibt fehler; transport-Marker → art netzwerk', async () => {
    const runner = createWorkflowRunner(
      makeDeps({
        transcription: {
          async transcribe() {
            throw Object.assign(new Error('Netzwerkfehler: weg'), { transport: true })
          }
        }
      })
    )

    runner.start({ def: def('improve'), chatModell: 'gpt-4o-mini' })
    const terminal = await runner.stop()

    expect(terminal).toMatchObject({ status: 'fehler', art: 'netzwerk' })
  })

  // --- A4: netzwerk-Retry (nur transient) ---

  it('netzwerk-Retry: ein transienter Transport-Fehler wird wiederholt → fertig', async () => {
    let n = 0
    const runner = createWorkflowRunner(
      makeDeps({
        transcription: {
          async transcribe() {
            n++
            if (n < 2) throw Object.assign(new Error('Netzwerkfehler'), { transport: true })
            return 'endlich da'
          }
        },
        sleep: async () => {}
      })
    )

    runner.start({ def: def('transcribe'), chatModell: 'm' })
    const terminal = await runner.stop()

    expect(terminal).toEqual({ status: 'fertig', text: 'endlich da' })
    expect(n).toBe(2)
  })

  // --- P0 (W1-A): discard()-Throw darf die idle-Transition nicht killen ---

  it('abbrechen(): ein Throw im recorder.discard() blockiert die idle-Transition NICHT', () => {
    const runner = createWorkflowRunner(
      makeDeps({
        recorder: {
          start() {},
          async stop() {
            return { audio, durationSeconds: 1.5 }
          },
          discard() {
            throw new Error('Fenster zerstört beim Verwerfen')
          }
        }
      })
    )

    runner.start({ def: def('transcribe'), chatModell: 'm' })
    expect(() => runner.abbrechen()).not.toThrow()
    expect(runner.phase).toEqual({ status: 'idle' })
  })

  // --- P0 (W1-A): Aufnahme-Watchdog gegen ewigen Hänger in Phase 'aufnehmen' ---

  it('Aufnahme-Watchdog: hängt recorder.stop(), feuert der Aufnahme-Watchdog → fehler art aufnahme', async () => {
    let fireAufnahme: () => void = () => {}
    let aufnahmeWatchdogGestartet = false
    // Recorder, dessen stop() nie auflöst (toter Renderer) — nur der Watchdog kann den Hänger lösen.
    const runner = createWorkflowRunner(
      makeDeps({
        recorder: {
          start() {},
          stop() {
            return new Promise<{ audio: Blob; durationSeconds: number }>(() => {})
          },
          discard() {}
        },
        starteAufnahmeWatchdog: (onTimeout) => {
          aufnahmeWatchdogGestartet = true
          fireAufnahme = onTimeout
          return () => {}
        }
      })
    )

    runner.start({ def: def('transcribe'), chatModell: 'm' })
    const stopP = runner.stop()
    await new Promise((r) => setTimeout(r, 0))
    expect(aufnahmeWatchdogGestartet).toBe(true)
    expect(runner.phase).toEqual({ status: 'aufnehmen' })

    fireAufnahme()
    const terminal = await stopP

    expect(terminal).toMatchObject({ status: 'fehler', art: 'aufnahme' })
    // Kein Dauer-„beschäftigt": Phase ist ein Terminal-Zustand (nicht mehr 'aufnehmen').
    expect(runner.phase.status).toBe('fehler')
  })

  it('Aufnahme-Watchdog: Default feuert nach der Aufnahme-Frist (fake timers)', async () => {
    // Fake-Timer eng auf setTimeout/clearTimeout begrenzt (kein globaler Date/Promise-Patch), damit
    // parallel laufende Testdateien mit echten Timern (transcription-provider) nicht kollidieren.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const runner = createWorkflowRunner(
        makeDeps({
          recorder: {
            start() {},
            stop() {
              return new Promise<{ audio: Blob; durationSeconds: number }>(() => {})
            },
            discard() {}
          }
        })
      )

      runner.start({ def: def('transcribe'), chatModell: 'm' })
      const stopP = runner.stop()

      // Vor der Frist: noch in der Aufnahme-Phase.
      await vi.advanceTimersByTimeAsync(1000)
      expect(runner.phase.status).toBe('aufnehmen')

      // Nach der Aufnahme-Frist (großzügiger Default, ~10 min): Watchdog feuert → Fehler.
      await vi.advanceTimersByTimeAsync(10 * 60_000)
      const terminal = await stopP
      expect(terminal).toMatchObject({ status: 'fehler', art: 'aufnahme' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('Aufnahme-Watchdog: erfolgreicher stop() stoppt den Aufnahme-Watchdog wieder', async () => {
    let cancelled = 0
    const runner = createWorkflowRunner(
      makeDeps({
        starteAufnahmeWatchdog: () => () => {
          cancelled++
        }
      })
    )

    runner.start({ def: def('transcribe'), chatModell: 'm' })
    await runner.stop()

    expect(cancelled).toBe(1)
  })

  it('konfiguration-Fehler (401) wird NICHT wiederholt', async () => {
    let n = 0
    const runner = createWorkflowRunner(
      makeDeps({
        transcription: {
          async transcribe() {
            n++
            throw Object.assign(new Error('Ungültiger Key'), { status: 401 })
          }
        },
        sleep: async () => {}
      })
    )

    runner.start({ def: def('transcribe'), chatModell: 'm' })
    const terminal = await runner.stop()

    expect(terminal).toMatchObject({ status: 'fehler', art: 'konfiguration' })
    expect(n).toBe(1)
  })

  // --- MAL-1 (Security-P1, W2-B): Steuerzeichen-Filter gegen Terminal-Escape-Injection ---

  describe('entferneSteuerzeichen', () => {
    it('entfernt ein nacktes ESC-Byte', () => {
      expect(entferneSteuerzeichen('vor\x1bnach')).toBe('vornach')
    })

    it('entfernt eine CSI-Farbsequenz (SGR)', () => {
      expect(entferneSteuerzeichen('vor\x1b[31mrot\x1b[0mnach')).toBe('vorrotnach')
    })

    it('entfernt eine CSI-Cursor-Sequenz mit Parametern', () => {
      expect(entferneSteuerzeichen('vor\x1b[2;5Hnach')).toBe('vornach')
    })

    it('entfernt eine OSC-Titel-Sequenz, mit BEL abgeschlossen', () => {
      expect(entferneSteuerzeichen('vor\x1b]0;böser titel\x07nach')).toBe('vornach')
    })

    it('entfernt eine OSC-Titel-Sequenz, mit ST (ESC \\\\) abgeschlossen', () => {
      expect(entferneSteuerzeichen('vor\x1b]0;böser titel\x1b\\nach')).toBe('vornach')
    })

    it('entfernt einen Mix aus C0-Steuerzeichen (BEL, BS, FF, VT)', () => {
      expect(entferneSteuerzeichen('a\x07b\x08c\x0cd\x0be')).toBe('abcde')
    })

    it('normalisiert \\r\\n zu \\n und einzelnes \\r zu \\n', () => {
      expect(entferneSteuerzeichen('zeile1\r\nzeile2\rzeile3')).toBe('zeile1\nzeile2\nzeile3')
    })

    it('entfernt C1-Steuerzeichen (U+0080–U+009F)', () => {
      expect(entferneSteuerzeichen('vor\u0090nach')).toBe('vornach')
    })

    it('entfernt den Unicode-Zeilentrenner U+2028 (und U+2029)', () => {
      expect(entferneSteuerzeichen('vor\u2028nach\u2029ende')).toBe('vornachende')
    })

    it('entfernt DEL (0x7F)', () => {
      expect(entferneSteuerzeichen('vor\x7fnach')).toBe('vornach')
    })

    it('lässt Umlaute, Emoji und normale Interpunktion byte-identisch', () => {
      const text = 'Ärger, Übermut & Größe: 100% fertig! 🎉🚀 (Test) – „Zitat"?'
      expect(entferneSteuerzeichen(text)).toBe(text)
    })

    it('lässt \\n und \\t unangetastet', () => {
      const text = 'zeile1\n\tzeile2 mit tab\nzeile3'
      expect(entferneSteuerzeichen(text)).toBe(text)
    })

    it('lässt mehrzeiligen Fließtext ohne Steuerzeichen byte-identisch', () => {
      const text = 'Erster Satz.\nZweiter Satz mit Umlauten: äöüß.\n\nDritter Absatz.'
      expect(entferneSteuerzeichen(text)).toBe(text)
    })
  })

  it('Integration Endtext-Pfad: eine ESC/CSI-Sequenz im umgeschriebenen Text wird vor fertig gefiltert', async () => {
    const runner = createWorkflowRunner(
      makeDeps({
        rewrite: {
          async rewrite() {
            return { text: 'harmloser text\x1b[31mrot\x1b[0mweiter' }
          }
        }
      })
    )

    runner.start({ def: def('improve'), chatModell: 'gpt-4o-mini' })
    const terminal = await runner.stop()

    expect(terminal).toEqual({ status: 'fertig', text: 'harmloser textrotweiter' })
    expect(runner.letzteMetrik?.endtext).toBe('harmloser textrotweiter')
  })

  it('Integration Teil-Erfolg-Pfad: eine OSC-Sequenz im Rohtext wird vor teilErfolg gefiltert', async () => {
    const runner = createWorkflowRunner(
      makeDeps({
        transcription: {
          async transcribe() {
            return 'mein rohtext\x1b]0;boese titelaenderung\x07 rest'
          }
        },
        rewrite: { async rewrite() { throw new Error('KI-Fehler: kaputt') } }
      })
    )

    runner.start({ def: def('improve'), chatModell: 'gpt-4o-mini' })
    const terminal = await runner.stop()

    expect(terminal).toEqual({
      status: 'teilErfolg',
      rohtext: 'mein rohtext rest',
      warnung: 'KI-Fehler: kaputt',
      grund: 'umschreibfehler'
    })
    expect(runner.letzteMetrik?.rohtext).toBe('mein rohtext rest')
  })

  // --- W3-B: Audio-Retry (flüchtig gehaltenes Blob, kein neues Diktat) ---

  it('Audio-Retry nach Anbieter-Fehler: erneutVersuchen transkribiert dasselbe Audio erneut, kein Recorder-Neustart', async () => {
    const rec = zaehlenderRecorder()
    let versuch = 0
    const transkribiert: Blob[] = []
    const runner = createWorkflowRunner(
      makeDeps({
        recorder: rec,
        transcription: {
          async transcribe(a) {
            transkribiert.push(a)
            versuch++
            // Anbieter-Fehler (kein transport-Marker) → NICHT vom internen mitRetry wiederholt →
            // terminal 'fehler', Audio gehalten für den manuellen Retry.
            if (versuch === 1) throw new Error('OpenAI-Fehler: 500')
            return 'endlich da'
          }
        },
        sleep: async () => {}
      })
    )

    runner.start({ def: def('transcribe'), chatModell: 'm' })
    const ersterTerminal = await runner.stop()
    expect(ersterTerminal).toMatchObject({ status: 'fehler', art: 'anbieter' })
    expect(runner.kannErneutVersuchen()).toBe(true)
    expect(rec.z.starts).toBe(1)
    expect(rec.z.stops).toBe(1)

    const zweiterTerminal = await runner.erneutVersuchen()
    expect(zweiterTerminal).toEqual({ status: 'fertig', text: 'endlich da' })
    // Kein neues Diktat: der Recorder wurde NICHT erneut gestartet/gestoppt.
    expect(rec.z.starts).toBe(1)
    expect(rec.z.stops).toBe(1)
    // Dasselbe Audio-Blob wurde erneut transkribiert.
    expect(transkribiert[0]).toBe(transkribiert[1])
  })

  it('erfolgreicher Lauf verwirft das gehaltene Audio (kein Retry danach)', async () => {
    const runner = createWorkflowRunner(
      makeDeps({ transcription: { async transcribe() { return 'ok' } } })
    )
    runner.start({ def: def('transcribe'), chatModell: 'm' })
    await runner.stop()
    expect(runner.kannErneutVersuchen()).toBe(false)
    // erneutVersuchen ohne gehaltenes Audio ist ein No-Op (bleibt im aktuellen Terminal).
    const terminal = await runner.erneutVersuchen()
    expect(terminal).toEqual({ status: 'fertig', text: 'ok' })
  })

  it('Audio-Retry bleibt bei Teil-Erfolg möglich: erneutVersuchen läuft ab Transkription neu', async () => {
    const rec = zaehlenderRecorder()
    let rewriteN = 0
    const runner = createWorkflowRunner(
      makeDeps({
        recorder: rec,
        transcription: { async transcribe() { return 'mein rohtext' } },
        rewrite: {
          async rewrite() {
            rewriteN++
            if (rewriteN === 1) throw new Error('KI-Fehler: kaputt')
            return { text: 'jetzt sauber' }
          }
        }
      })
    )

    runner.start({ def: def('improve'), chatModell: 'gpt-4o-mini' })
    const ersterTerminal = await runner.stop()
    expect(ersterTerminal).toMatchObject({ status: 'teilErfolg', grund: 'umschreibfehler' })
    expect(runner.kannErneutVersuchen()).toBe(true)

    const zweiterTerminal = await runner.erneutVersuchen()
    expect(zweiterTerminal).toEqual({ status: 'fertig', text: 'jetzt sauber' })
    expect(rec.z.starts).toBe(1) // kein neues Diktat
  })

  it('Aufnahme-Fehler (zu kurz) hält KEIN Audio (nichts Brauchbares zum Wiederholen)', async () => {
    const runner = createWorkflowRunner(makeDeps({ recorder: fakeRecorder(0.2) }))
    runner.start({ def: def('transcribe'), chatModell: 'm' })
    const terminal = await runner.stop()
    expect(terminal).toMatchObject({ status: 'fehler', art: 'aufnahme' })
    expect(runner.kannErneutVersuchen()).toBe(false)
  })

  it('erneutVersuchen ohne vorherigen Lauf (idle) ist ein No-Op', async () => {
    const runner = createWorkflowRunner(makeDeps())
    const terminal = await runner.erneutVersuchen()
    expect(terminal).toEqual({ status: 'idle' })
    expect(runner.kannErneutVersuchen()).toBe(false)
  })

  // --- A4a: istWiederholung-Flag (additiv) — Retry sichtbar in Pille/Tray ---

  it('erneutVersuchen() liefert Phasen mit istWiederholung: true während Transkription/Umschreiben', async () => {
    const rec = zaehlenderRecorder()
    const phasen: WorkflowPhase[] = []
    let versuch = 0
    const runner = createWorkflowRunner(
      makeDeps({
        recorder: rec,
        transcription: {
          async transcribe() {
            versuch++
            if (versuch === 1) throw new Error('OpenAI-Fehler: 500')
            return 'mein rohtext'
          }
        },
        rewrite: { async rewrite() { return { text: 'umgeschrieben' } } },
        sleep: async () => {}
      })
    )
    runner.start({ def: def('improve'), chatModell: 'gpt-4o-mini' })
    const ersterTerminal = await runner.stop()
    expect(ersterTerminal).toMatchObject({ status: 'fehler', art: 'anbieter' })

    runner.onPhase = (p) => phasen.push(p)
    const zweiterTerminal = await runner.erneutVersuchen()

    expect(zweiterTerminal).toEqual({ status: 'fertig', text: 'umgeschrieben' })
    expect(phasen).toContainEqual({ status: 'transkribieren', istWiederholung: true })
    expect(phasen).toContainEqual({ status: 'umschreiben', istWiederholung: true })
  })

  it('ein frischer stop()-Lauf liefert istWiederholung: undefined/false (kein falsches Retry-Label)', async () => {
    const phasen: WorkflowPhase[] = []
    const runner = createWorkflowRunner(makeDeps())
    runner.onPhase = (p) => phasen.push(p)

    runner.start({ def: def('improve'), chatModell: 'gpt-4o-mini' })
    await runner.stop()

    const transkribierenPhase = phasen.find((p) => p.status === 'transkribieren')
    const umschreibenPhase = phasen.find((p) => p.status === 'umschreiben')
    expect(transkribierenPhase).toMatchObject({ istWiederholung: false })
    expect(umschreibenPhase).toMatchObject({ istWiederholung: false })
  })

  // --- A2: „Dauert länger …"-Zwischenmeldung (additiver Timer, Generation-Guard) ---

  it('feuert nach Ablauf des Zwischen-Timers eine zweite onPhase-Emission mit dauertLaenger: true, solange die Phase noch aktiv ist', async () => {
    let fireZwischenmeldung: () => void = () => {}
    let zwischenmeldungGestartet = 0
    const phasen: WorkflowPhase[] = []
    // Transkription hängt, bis wir sie manuell auflösen — hält die Phase 'transkribieren' aktiv, damit
    // der Zwischen-Timer feuern kann, während sie noch läuft.
    let loeseTranskription: (v: string) => void = () => {}
    const runner = createWorkflowRunner(
      makeDeps({
        transcription: {
          async transcribe() {
            return await new Promise<string>((resolve) => {
              loeseTranskription = resolve
            })
          }
        },
        starteZwischenmeldungsTimer: (onTimeout) => {
          zwischenmeldungGestartet++
          fireZwischenmeldung = onTimeout
          return () => {}
        }
      })
    )
    runner.onPhase = (p) => phasen.push(p)

    runner.start({ def: def('transcribe'), chatModell: 'm' })
    const stopP = runner.stop()
    await new Promise((r) => setTimeout(r, 0))
    expect(zwischenmeldungGestartet).toBe(1)

    fireZwischenmeldung()
    expect(phasen).toContainEqual({
      status: 'transkribieren',
      istWiederholung: false,
      dauertLaenger: true
    })

    // Lauf sauber beenden (kein hängendes Promise).
    loeseTranskription('hallo')
    await stopP
  })

  it('Guard: feuert NICHT, wenn die Phase inzwischen gewechselt hat (Timer aus einer verlassenen Phase)', async () => {
    let fireZwischenmeldung: () => void = () => {}
    const phasen: WorkflowPhase[] = []
    const runner = createWorkflowRunner(
      makeDeps({
        transcription: { async transcribe() { return 'hallo' } },
        starteZwischenmeldungsTimer: (onTimeout) => {
          fireZwischenmeldung = onTimeout
          return () => {}
        }
      })
    )

    runner.start({ def: def('transcribe'), chatModell: 'm' })
    await runner.stop() // Lauf ist bereits terminal ('fertig'), bevor der Timer feuert.
    runner.onPhase = (p) => phasen.push(p)

    // Der beim Start der (längst verlassenen) Phase gemerkte Callback feuert jetzt verspätet.
    fireZwischenmeldung()

    expect(phasen).toEqual([]) // keine Wirkung mehr — Generation-Guard hat gegriffen.
    expect(runner.phase).toEqual({ status: 'fertig', text: 'hallo' })
  })

  it('Timer wird beim Phasenwechsel/Abbruch gestoppt (kein Leak)', async () => {
    let gestoppt = 0
    let gestartet = 0
    const runner = createWorkflowRunner(
      makeDeps({
        starteZwischenmeldungsTimer: () => {
          gestartet++
          return () => {
            gestoppt++
          }
        }
      })
    )

    runner.start({ def: def('improve'), chatModell: 'gpt-4o-mini' })
    await runner.stop()

    // Zwei Phasen durchlaufen (transkribieren, umschreiben) → je ein Timer gestartet UND gestoppt.
    expect(gestartet).toBe(2)
    expect(gestoppt).toBe(2)
  })

  it('Timer wird auch bei Abbruch während der Transkription gestoppt', async () => {
    let gestoppt = 0
    const runner = createWorkflowRunner(
      makeDeps({
        transcription: haengendeTranskription(),
        starteZwischenmeldungsTimer: () => () => {
          gestoppt++
        }
      })
    )

    runner.start({ def: def('transcribe'), chatModell: 'm' })
    const stopP = runner.stop()
    await new Promise((r) => setTimeout(r, 0))

    runner.abbrechen()
    await stopP

    expect(gestoppt).toBe(1)
  })

  it('pill-/tray-Label bleiben unbeeinflusst vom Zwischenmeldungs-Timer, solange er nicht feuert', async () => {
    const runner = createWorkflowRunner(
      makeDeps({ starteZwischenmeldungsTimer: () => () => {} })
    )
    runner.start({ def: def('transcribe'), chatModell: 'm' })
    await runner.stop()
    expect(runner.phase).toEqual({ status: 'fertig', text: 'roh' })
  })

  // --- v0.7.3 (A1): Laufkapsel — Interleaving-Races zweier Läufe im selben Runner ---
  //
  // Vor der Kapselung lagen `abgebrochen`/`controller`/`istTimeout` als RUNNER-WEITE Closures. Startete
  // ein zweiter Lauf B, während der erste Lauf A noch in-flight hing (abgebrochen oder langsam), teilten
  // sich beide diesen Zustand → A's später catch/abschluss las den von B frisch gesetzten Wert und
  // schrieb falsch (Fehlermeldung eines abgebrochenen Laufs, oder Überschreiben des frischen Zustands).
  // Die LaufKontext-Kapsel + istAktuell-Guard verhindert das. Alle Läufe sind hier DETERMINISTISCH über
  // manuell auflösbare deferreds getaktet (kein setTimeout-Timing).

  /** Ein von außen auflösbares Promise (kontrollierte Deferreds für die Race-Tests). */
  function deferred<T>() {
    let resolve!: (wert: T) => void
    let reject!: (grund: unknown) => void
    const promise = new Promise<T>((res, rej) => {
      resolve = res
      reject = rej
    })
    return { promise, resolve, reject }
  }

  it('Race: Abbruch von Lauf A + sofortiger Neustart als Lauf B — A trifft B NICHT (kein falscher Fehler)', async () => {
    // Zwei Transkriptionen nacheinander; jede hängt an ihrem eigenen deferred, das wir manuell steuern.
    const tore = [deferred<string>(), deferred<string>()]
    let n = 0
    const runner = createWorkflowRunner(
      makeDeps({
        transcription: {
          async transcribe(_audio, opts) {
            const meins = tore[n++]!
            // Abbruch-Signal → wie der echte Provider mit AbortError ablehnen.
            opts?.signal?.addEventListener('abort', () =>
              meins.reject(new DOMException('Aborted', 'AbortError'))
            )
            return meins.promise
          }
        }
      })
    )

    // Lauf A: start → stop; Transkription hängt (Tor 0 offen).
    runner.start({ def: def('transcribe'), chatModell: 'm' })
    const stopA = runner.stop()
    await tick()
    expect(runner.phase.status).toBe('transkribieren')

    // A abbrechen: der A-Lauf wird abgebrochen (aktuellerLauf=null, still nach idle). Sein hängendes
    // Transkriptions-Promise lehnt gleich mit AbortError ab — sein catch muss den Alt-Lauf-Schutz greifen.
    runner.abbrechen()
    expect(runner.phase).toEqual({ status: 'idle' })
    const terminalA = await stopA
    expect(terminalA).toEqual({ status: 'idle' })

    // Lauf B: SOFORT ein frisches Diktat starten und stoppen (Tor 1). Mit dem ALTEN Code teilte sich B
    // den `abgebrochen`-Zustand mit A; A's noch abzuwickelnder catch hätte B's frisch gesetzten Zustand
    // gesehen. Jetzt ist B ein eigener LaufKontext.
    runner.start({ def: def('transcribe'), chatModell: 'm' })
    const stopB = runner.stop()
    await tick()
    expect(runner.phase.status).toBe('transkribieren') // B läuft sauber, KEIN aufgezwungener idle/fehler

    tore[1]!.resolve('bee sauber')
    const terminalB = await stopB
    // B kommt sauber durch — A's abgebrochener Lauf hat B NICHT verfälscht.
    expect(terminalB).toEqual({ status: 'fertig', text: 'bee sauber' })
    expect(runner.phase).toEqual({ status: 'fertig', text: 'bee sauber' })
  })

  it('Race: veralteter Lauf A liefert seinen Erfolg SPÄT — überschreibt weder Phase noch letzteAufnahme von B', async () => {
    // Lauf A hängt in der Transkription; wir brechen ihn ab und starten B (frisches Diktat). DANACH lösen
    // wir A's Transkription doch noch mit Erfolg auf — der veraltete A-abschluss darf NICHTS schreiben.
    const torA = deferred<string>()
    let n = 0
    const runner = createWorkflowRunner(
      makeDeps({
        transcription: {
          async transcribe() {
            if (n++ === 0) {
              // Lauf A: NICHT auf abort reagieren — wir lösen ihn bewusst später mit ERFOLG auf, um den
              // „veralteter Erfolg schreibt durch"-Bug zu treffen (nicht nur den Abbruch-Pfad).
              return torA.promise
            }
            return 'bee frisch' // Lauf B: sofort fertig
          }
        }
      })
    )

    // Lauf A starten + stoppen (hängt im Tor A).
    runner.start({ def: def('transcribe'), chatModell: 'm' })
    const stopA = runner.stop()
    await tick()
    expect(runner.phase.status).toBe('transkribieren')

    // A abbrechen → aktuellerLauf=null, idle. A's Transkription hängt weiter (Tor A noch offen).
    runner.abbrechen()
    expect(runner.phase).toEqual({ status: 'idle' })

    // Lauf B: frisches Diktat, läuft komplett durch → 'fertig', kein gehaltenes Audio mehr.
    runner.start({ def: def('transcribe'), chatModell: 'm' })
    const terminalB = await runner.stop()
    expect(terminalB).toEqual({ status: 'fertig', text: 'bee frisch' })
    expect(runner.kannErneutVersuchen()).toBe(false) // B war erfolgreich → Audio verworfen

    // JETZT löst A's Transkription doch noch mit Erfolg auf. Mit dem ALTEN Code liefe A's Rest durch bis
    // abschluss(): das hätte die Phase auf A's Ergebnis gesetzt UND letzteAufnahme angefasst. istAktuell
    // fängt das ab: der A-Lauf ist längst nicht mehr aktuell → still, kein Schreiben.
    torA.resolve('aah alt und veraltet')
    // stopA lief bereits durch (idle nach Abbruch); der interne verarbeiteAufnahme-Rest wickelt sich ab.
    await stopA.catch(() => undefined)
    await tick()
    await tick()

    // Phase + Retry-Basis unverändert von B — A hat NICHTS überschrieben.
    expect(runner.phase).toEqual({ status: 'fertig', text: 'bee frisch' })
    expect(runner.letzteMetrik?.endtext).toBe('bee frisch')
    expect(runner.kannErneutVersuchen()).toBe(false)
  })

  it('Abbruch während Transkription verwirft das gehaltene Audio → kannErneutVersuchen() === false (W3-B-Invariante)', async () => {
    // Regression: abbrechen() setzt aktuellerLauf=null; der catch des abgebrochenen Laufs greift danach
    // den istAktuell-Alt-Lauf-Schutz und erreicht den `lauf.abgebrochen`-Zweig NIE mehr. Ohne den Fix in
    // abbrechen() (letzteAufnahme=null) bliebe das gehaltene Audio gesetzt und die Tray-Aktion „Erneut
    // versuchen" böte VERWORFENES Audio an — Widerspruch zur Invariante sitzung.ts:354.
    const tor = deferred<string>()
    const runner = createWorkflowRunner(
      makeDeps({
        transcription: {
          async transcribe(_audio, opts) {
            opts?.signal?.addEventListener('abort', () =>
              tor.reject(new DOMException('Aborted', 'AbortError'))
            )
            return tor.promise
          }
        }
      })
    )

    runner.start({ def: def('transcribe'), chatModell: 'm' })
    const stopP = runner.stop()
    await tick()
    expect(runner.phase.status).toBe('transkribieren') // Audio ist ab hier gehalten (letzteAufnahme=recording)

    // Abbruch mitten in der Transkription: Audio muss verworfen werden → kein Retry auf Verworfenem.
    runner.abbrechen()
    expect(runner.phase).toEqual({ status: 'idle' })
    expect(runner.kannErneutVersuchen()).toBe(false)

    // Auch nachdem der abgebrochene Lauf sein spätes AbortError-Reject abgewickelt hat: weiterhin false,
    // Phase idle unberührt (der Alt-Lauf-Schutz darf keinen Zustand mehr schreiben).
    await stopP
    await tick()
    await tick()
    expect(runner.kannErneutVersuchen()).toBe(false)
    expect(runner.phase).toEqual({ status: 'idle' })
  })

  it('Race: externer Aufnahme-Fehler in Phase aufnehmen → fehler; ein späterer Neustart bleibt sauber', async () => {
    // meldeAufnahmeFehler wirkt NUR in Phase 'aufnehmen' (Alt-Lauf-Schutz). Hier: Fehler in der Aufnahme,
    // dann ein frischer Lauf, der normal durchläuft (der externe Fehler darf ihn nicht vergiften).
    const runner = createWorkflowRunner(
      makeDeps({ transcription: { async transcribe() { return 'frisch' } } })
    )

    runner.start({ def: def('transcribe'), chatModell: 'm' })
    expect(runner.phase).toEqual({ status: 'aufnehmen' })

    // Mikrofon fällt während der Aufnahme aus → externer Kanal.
    runner.meldeAufnahmeFehler('Mikrofon exklusiv belegt')
    expect(runner.phase).toEqual({ status: 'fehler', art: 'aufnahme', message: 'Mikrofon exklusiv belegt' })
    expect(runner.kannErneutVersuchen()).toBe(false) // nichts Brauchbares gehalten

    // Frischer Lauf danach: sauber.
    runner.start({ def: def('transcribe'), chatModell: 'm' })
    const terminal = await runner.stop()
    expect(terminal).toEqual({ status: 'fertig', text: 'frisch' })
  })

  it('meldeAufnahmeFehler außerhalb der Aufnahme-Phase ist ein No-Op (Alt-Lauf-Schutz)', async () => {
    // Ein verspäteter externer Fehler, nachdem der Lauf längst 'fertig' ist, darf den Zustand nicht kippen.
    const runner = createWorkflowRunner(makeDeps({ transcription: { async transcribe() { return 'ok' } } }))
    runner.start({ def: def('transcribe'), chatModell: 'm' })
    const terminal = await runner.stop()
    expect(terminal).toEqual({ status: 'fertig', text: 'ok' })

    runner.meldeAufnahmeFehler('zu spät')
    expect(runner.phase).toEqual({ status: 'fertig', text: 'ok' }) // unverändert
  })

  // Kleine Test-Helferzeile: ein Mikro-Tick, damit hängende Promises einen Zyklus laufen.
  function tick(): Promise<void> {
    return new Promise((r) => setTimeout(r, 0))
  }
})
