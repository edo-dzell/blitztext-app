import { describe, it, expect } from 'vitest'
import { createSitzung, type Ausgabe, type Abschlussdaten } from '@main/session/sitzung'
import type { FehlerMeldung } from '@main/session/fehler-meldung'
import { createWorkflowRunner } from '@main/workflow/runner'
import { createSettingsStore, type BlitztextSettings } from '@main/settings/store'
import * as quality from '@main/transcription/quality'
import { resolveSystemPrompt } from '@main/rewrite/prompt-builder'

const audio = new Blob(['x'], { type: 'audio/webm' })

interface MakeOpts {
  hasKey?: boolean
  durationSeconds?: number
  transcript?: string
  rewritten?: string
  settings?: Partial<BlitztextSettings>
  captureTranscribe?: (options?: { language?: string; vocabularyHints?: string[] }) => void
  /** Transkription hängt, bis ihr Abbruch-Signal feuert (für Abbruch-während-Stopp-Tests). */
  hangUntilAbort?: boolean
  /** Simuliert, ob der Verlauf tatsächlich geschrieben hat (steuert onHistoryChanged, P5b). */
  verlaufGeschrieben?: boolean
  /** Lässt die Transkription werfen (für Fehlerpfad-Tests). */
  transcribeFehler?: Error
  /** Lässt NUR den ersten Transkriptions-Versuch werfen (für Audio-Retry-Tests, W3-B). */
  transcribeFehlerErsterVersuch?: Error
  /** Lässt das Umschreiben werfen (für Teil-Erfolg-Tests). */
  rewriteFehler?: Error
  /** Lässt das Protokoll-Schreiben werfen (für die Crash-Härtung A5). */
  protokollWirft?: boolean
  /** Vom erfasseFenster-Port zurückgegebenes HWND beim Aufnahme-Start (Weg B, W3-A). */
  erfasstesHwnd?: number | null
  /** A1 (v0.6.0, NUR makeSitzungMitTorSteuerung): staut die erfasseFenster-Auflösung in einem eigenen Tor. */
  gateErfasseFenster?: boolean
}

function makeSitzung(opts: MakeOpts = {}) {
  const recorder = {
    started: 0,
    stopped: 0,
    discarded: 0,
    start(): void {
      recorder.started++
    },
    async stop() {
      recorder.stopped++
      return { audio, durationSeconds: opts.durationSeconds ?? 1.5 }
    },
    discard(): void {
      recorder.discarded++
    }
  }
  let transcribeAufrufe = 0
  const runner = createWorkflowRunner({
    recorder,
    transcription: {
      async transcribe(_audio, options) {
        transcribeAufrufe++
        opts.captureTranscribe?.(options)
        if (opts.transcribeFehlerErsterVersuch && transcribeAufrufe === 1) {
          throw opts.transcribeFehlerErsterVersuch
        }
        if (opts.transcribeFehler) throw opts.transcribeFehler
        if (opts.hangUntilAbort) {
          return await new Promise<string>((_resolve, reject) => {
            options?.signal?.addEventListener('abort', () =>
              reject(new DOMException('Aborted', 'AbortError'))
            )
          })
        }
        return opts.transcript ?? 'roh'
      }
    },
    rewrite: {
      async rewrite() {
        if (opts.rewriteFehler) throw opts.rewriteFehler
        return { text: opts.rewritten ?? 'umgeschrieben' }
      }
    },
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

  const calls = {
    einfügen: [] as string[],
    einfügenKontext: [] as Array<{ fokusRueckkehr: boolean; erfasstesHwnd: number | null } | undefined>,
    anzeigen: [] as string[],
    zeigeEinstellungen: 0,
    melde: [] as FehlerMeldung[],
    // W3-B: pro melde-Aufruf der mitgereichte Retry-Callback (oder undefined) — für den Notification-Button.
    meldeErneut: [] as Array<(() => void) | undefined>,
    inZwischenablage: [] as string[],
    erfasseFenster: 0
  }
  const ausgabe: Ausgabe = {
    einfügen: (t, kontext) => {
      calls.einfügen.push(t)
      calls.einfügenKontext.push(kontext)
    },
    anzeigen: (t) => calls.anzeigen.push(t),
    zeigeEinstellungen: () => {
      calls.zeigeEinstellungen++
    },
    melde: (f, aktionen) => {
      calls.melde.push(f)
      calls.meldeErneut.push(aktionen?.erneut)
    },
    inZwischenablage: (t) => calls.inZwischenablage.push(t),
    // A1 (v0.6.0): erfasseFenster ist jetzt async — der Fake liefert direkt ein aufgelöstes Promise
    // (kein künstliches Warten nötig für die bestehenden Tests; siehe makeSitzungMitTorSteuerung für
    // den gate-gesteuerten Race-Test).
    erfasseFenster: async () => {
      calls.erfasseFenster++
      return opts.erfasstesHwnd ?? null
    }
  }

  const apiKeys = {
    async has() {
      return opts.hasKey ?? true
    }
  }

  const protokollDaten: Abschlussdaten[] = []
  const protokoll = {
    aufzeichnen: async (d: Abschlussdaten) => {
      if (opts.protokollWirft) throw new Error('Disk voll')
      protokollDaten.push(d)
      return opts.verlaufGeschrieben ?? true
    }
  }
  const historyChanges = { n: 0 }

  const sitzung = createSitzung({
    runner,
    einstellungen,
    apiKeys,
    ausgabe,
    protokoll,
    onHistoryChanged: () => {
      historyChanges.n++
    }
  })
  return {
    sitzung,
    calls,
    recorder,
    protokollDaten,
    historyChanges,
    transcribeAufrufe: () => transcribeAufrufe
  }
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

describe('createSitzung', () => {
  it('hotkey: starteWorkflow → stoppe fügt den gesäuberten Endtext ins Paste-Ziel ein', async () => {
    const { sitzung, calls } = makeSitzung({ transcript: '  hallo welt  ' })

    await sitzung.starteWorkflow('transcribe', 'hotkey')
    await sitzung.stoppe()

    expect(calls.einfügen).toEqual(['hallo welt'])
    expect(calls.anzeigen).toEqual([])
  })

  it('manuell: stoppe zeigt den Endtext im Fenster statt einzufügen', async () => {
    const { sitzung, calls } = makeSitzung({ transcript: 'angezeigter text' })

    await sitzung.starteWorkflow('transcribe', 'manuell')
    await sitzung.stoppe()

    expect(calls.anzeigen).toEqual(['angezeigter text'])
    expect(calls.einfügen).toEqual([])
  })

  it('kein API-Key + manuell: zeigt die Einstellungen und nimmt gar nicht erst auf', async () => {
    const { sitzung, calls, recorder } = makeSitzung({ hasKey: false })

    await sitzung.starteWorkflow('transcribe', 'manuell')

    expect(calls.zeigeEinstellungen).toBe(1)
    expect(recorder.started).toBe(0)
    expect(calls.einfügen).toEqual([])
    expect(calls.anzeigen).toEqual([])
  })

  it('kein API-Key + hotkey: bricht still ab (keine Einstellungen, keine Aufnahme)', async () => {
    const { sitzung, calls, recorder } = makeSitzung({ hasKey: false })

    await sitzung.starteWorkflow('transcribe', 'hotkey')

    expect(calls.zeigeEinstellungen).toBe(0)
    expect(recorder.started).toBe(0)
    expect(calls.einfügen).toEqual([])
  })

  it('Desync-Schutz: ein zweites stoppe() ohne aktiven Lauf löst keinen Phantom-Stop aus', async () => {
    const { sitzung, calls, recorder, protokollDaten } = makeSitzung({ transcript: 'hallo' })

    await sitzung.starteWorkflow('transcribe', 'hotkey')
    await sitzung.stoppe()
    await tick() // protokolliere ist fire-and-forget
    expect(calls.einfügen).toEqual(['hallo'])
    expect(recorder.stopped).toBe(1)
    expect(protokollDaten.length).toBe(1)

    // Phantom-Stop (Dispatcher-Desync nach verworfenem Zweitstart): kein aktiver Lauf → no-op.
    // Kein zweiter recorder.stop ('Keine aktive Aufnahme'), kein Doppel-Einfügen, kein Doppel-Verlauf.
    await sitzung.stoppe()
    await tick()
    expect(recorder.stopped).toBe(1)
    expect(calls.einfügen).toEqual(['hallo'])
    expect(protokollDaten.length).toBe(1)
  })

  it('ignoriert ein zweites starteWorkflow, solange ein Lauf aktiv ist', async () => {
    const { sitzung, recorder } = makeSitzung()

    await sitzung.starteWorkflow('transcribe', 'hotkey')
    await sitzung.starteWorkflow('improve', 'manuell') // soll verworfen werden

    expect(recorder.started).toBe(1)
  })

  it('brichAb verwirft den laufenden Lauf, gibt nichts aus und gibt die Sitzung frei', async () => {
    const { sitzung, calls, recorder } = makeSitzung()

    await sitzung.starteWorkflow('transcribe', 'hotkey')
    sitzung.brichAb()

    expect(recorder.discarded).toBe(1)
    expect(calls.einfügen).toEqual([])
    expect(calls.anzeigen).toEqual([])

    // nach Abbruch ist die Sitzung wieder frei für eine neue Auslösung
    await sitzung.starteWorkflow('transcribe', 'manuell')
    expect(recorder.started).toBe(2)
  })

  it('Abbruch während eines laufenden Stopps gibt nichts aus und gibt die Sitzung frei', async () => {
    const { sitzung, calls, protokollDaten } = makeSitzung({ hangUntilAbort: true })

    await sitzung.starteWorkflow('transcribe', 'hotkey')
    const stopP = sitzung.stoppe()
    await new Promise((r) => setTimeout(r, 0))

    sitzung.brichAb()
    await stopP

    expect(calls.einfügen).toEqual([])
    expect(calls.anzeigen).toEqual([])
    expect(protokollDaten).toEqual([])
    expect(sitzung.beschaeftigt()).toBe(false)
  })

  it('lädt die Einstellungen und speist Sprache + Eigene Begriffe in die Transkription', async () => {
    let captured: { language?: string; vocabularyHints?: string[] } | undefined
    const { sitzung } = makeSitzung({
      settings: { language: 'en', customTerms: ['Acme', 'Blitztext'] },
      durationSeconds: 1.5,
      captureTranscribe: (o) => {
        captured = o
      }
    })

    await sitzung.starteWorkflow('transcribe', 'manuell')
    await sitzung.stoppe()

    expect(captured?.language).toBe('en')
    expect(captured?.vocabularyHints).toEqual(['Acme', 'Blitztext'])
  })

  it('protokolliert einen fertigen Lauf mit Label + Modellen (Telemetrie aus letzteMetrik)', async () => {
    const { sitzung, protokollDaten } = makeSitzung({
      transcript: 'roh',
      rewritten: 'fertig',
      settings: {
        anbieter: [
          {
            id: 'openai',
            vorlage: 'openai',
            label: 'OpenAI',
            baseUrl: 'https://api.openai.com/v1',
            asrModell: 'whisper-1',
            chatModell: 'gpt-4o-mini'
          }
        ],
        standardAnbieterId: 'openai'
      }
    })

    await sitzung.starteWorkflow('improve', 'hotkey')
    await sitzung.stoppe()

    expect(protokollDaten).toHaveLength(1)
    expect(protokollDaten[0]).toMatchObject({
      workflowId: 'improve',
      workflowLabel: 'Blitztext+',
      rohtext: 'roh',
      endtext: 'fertig',
      asrModell: 'whisper-1',
      chatModell: 'gpt-4o-mini',
      umgeschrieben: true
    })
  })

  it('reine Transkription: protokolliert chatModell="" und umgeschrieben=false', async () => {
    const { sitzung, protokollDaten } = makeSitzung({ transcript: 'nur text' })
    await sitzung.starteWorkflow('transcribe', 'hotkey')
    await sitzung.stoppe()
    expect(protokollDaten[0]).toMatchObject({ chatModell: '', umgeschrieben: false })
  })

  // --- W3-μ (V5): promptKennung reicht von runner.letzteMetrik unverändert bis in Abschlussdaten ---

  it('Umschreib-Workflow: protokolliert eine promptKennung (builtin:<id>@<hash>)', async () => {
    const { sitzung, protokollDaten } = makeSitzung({ transcript: 'roh', rewritten: 'fertig' })
    await sitzung.starteWorkflow('improve', 'hotkey')
    await sitzung.stoppe()

    expect(protokollDaten).toHaveLength(1)
    expect(protokollDaten[0]!.promptKennung).toMatch(/^builtin:improve@[0-9a-f]{8}$/)
  })

  it('reine Transkription: promptKennung bleibt undefined (kein System-Prompt gelaufen)', async () => {
    const { sitzung, protokollDaten } = makeSitzung({ transcript: 'nur text' })
    await sitzung.starteWorkflow('transcribe', 'hotkey')
    await sitzung.stoppe()

    expect(protokollDaten[0]!.promptKennung).toBeUndefined()
  })

  it('leitet die Phasen des Runners an onStatus weiter (für Tray/Fenster)', async () => {
    const { sitzung } = makeSitzung({ transcript: 'hallo' })
    const phasen: string[] = []
    sitzung.onStatus = (p) => phasen.push(p.status)

    await sitzung.starteWorkflow('transcribe', 'manuell')
    await sitzung.stoppe()

    expect(phasen).toEqual(['aufnehmen', 'transkribieren', 'fertig'])
  })

  it('feuert onHistoryChanged genau einmal nach einem geschriebenen Lauf (P5b)', async () => {
    const { sitzung, historyChanges } = makeSitzung({ transcript: 'x' })
    await sitzung.starteWorkflow('transcribe', 'hotkey')
    await sitzung.stoppe()
    await tick() // protokolliere ist fire-and-forget → einen Microtask-Durchlauf abwarten
    expect(historyChanges.n).toBe(1)
  })

  it('feuert onHistoryChanged NICHT, wenn der Verlauf nichts geschrieben hat (inaktiv)', async () => {
    const { sitzung, historyChanges } = makeSitzung({ transcript: 'x', verlaufGeschrieben: false })
    await sitzung.starteWorkflow('transcribe', 'hotkey')
    await sitzung.stoppe()
    await tick()
    expect(historyChanges.n).toBe(0)
  })

  it('feuert onHistoryChanged NICHT bei Abbruch', async () => {
    const { sitzung, historyChanges } = makeSitzung()
    await sitzung.starteWorkflow('transcribe', 'hotkey')
    sitzung.brichAb()
    await tick()
    expect(historyChanges.n).toBe(0)
  })

  it('fehler: meldet einen fehlgeschlagenen Lauf, fügt nichts ein (konfiguration → Sprung-Aktion)', async () => {
    const { sitzung, calls } = makeSitzung({
      transcribeFehler: Object.assign(new Error('Ungültiger Key'), { status: 401 })
    })

    await sitzung.starteWorkflow('improve', 'hotkey')
    await sitzung.stoppe()

    expect(calls.einfügen).toEqual([])
    expect(calls.melde).toHaveLength(1)
    expect(calls.melde[0]).toMatchObject({ aktion: 'einstellungen' }) // 401 → konfiguration
  })

  it('teilErfolg: Umschreib-Fehler legt den Rohtext in die Zwischenablage (nie einfügen) + protokolliert', async () => {
    const { sitzung, calls, protokollDaten } = makeSitzung({
      transcript: 'roher diktattext',
      rewriteFehler: new Error('KI-Fehler: kaputt')
    })

    await sitzung.starteWorkflow('improve', 'hotkey')
    await sitzung.stoppe()
    await tick() // protokolliere ist fire-and-forget

    expect(calls.einfügen).toEqual([])
    expect(calls.inZwischenablage).toEqual(['roher diktattext'])
    expect(calls.melde).toHaveLength(1)
    expect(protokollDaten).toHaveLength(1)
    expect(protokollDaten[0]).toMatchObject({
      rohtext: 'roher diktattext',
      endtext: 'roher diktattext',
      umgeschrieben: false
    })
  })

  it('A5: ein fehlschlagendes Protokoll-Schreiben reißt den Lauf NICHT herunter (Einfügen bleibt)', async () => {
    const { sitzung, calls } = makeSitzung({ transcript: 'hallo', protokollWirft: true })

    await sitzung.starteWorkflow('transcribe', 'hotkey')
    await expect(sitzung.stoppe()).resolves.toBeUndefined()
    await tick()

    // Das Einfügen erfolgte; der nachgelagerte Schreibfehler wurde geschluckt (kein Re-throw).
    expect(calls.einfügen).toEqual(['hallo'])
  })

  // v0.4.5 (ADR-0018): ehrlich statt still — Modell-Downgrade auf den Anbieter-Standard sichtbar machen.
  // Szenario: nur ein Mistral-Anbieter konfiguriert; improve pinnt das OpenAI-Modell 'gpt-4o-mini' →
  // fremd für Mistral → still auf 'mistral-small-latest' abgewertet.
  const NUR_MISTRAL: Partial<BlitztextSettings> = {
    anbieter: [
      {
        id: 'mistral',
        vorlage: 'mistral',
        label: 'Mistral',
        baseUrl: 'https://api.mistral.ai/v1',
        asrModell: 'voxtral-mini-latest',
        chatModell: 'mistral-small-latest'
      }
    ],
    standardAnbieterId: 'mistral'
  }

  it('manuell: warnt nicht-blockierend, wenn das Umschreib-Modell abgewertet wurde', async () => {
    const { sitzung, calls } = makeSitzung({ settings: NUR_MISTRAL })
    await sitzung.starteWorkflow('improve', 'manuell')
    expect(calls.melde).toHaveLength(1)
    expect(calls.melde[0]!.titel).toBe('Modell ersetzt')
    expect(calls.melde[0]!.koerper).toContain('mistral-small-latest')
  })

  it('hotkey: bleibt bei abgewertetem Modell still (keine Notification im Hintergrund)', async () => {
    const { sitzung, calls } = makeSitzung({ settings: NUR_MISTRAL })
    await sitzung.starteWorkflow('improve', 'hotkey')
    expect(calls.melde).toEqual([])
  })

  it('L1: key-loser lokaler Anbieter nimmt auch ohne Key auf (Gate lässt durch)', async () => {
    const { sitzung, recorder } = makeSitzung({
      hasKey: false,
      settings: {
        anbieter: [
          {
            id: 'lokal',
            vorlage: 'custom',
            label: 'Lokal',
            baseUrl: 'http://localhost:8000/v1',
            asrModell: 'whisper-1',
            chatModell: 'x',
            keinKeyNoetig: true
          }
        ],
        standardAnbieterId: 'lokal'
      }
    })

    await sitzung.starteWorkflow('transcribe', 'hotkey')
    expect(recorder.started).toBe(1)
  })

  // W2-A: Race-Härtung von starteWorkflow. Die Guards/Reservierung müssen VOR den Start-Awaits
  // greifen, sonst schlüpfen zwei quasi-gleichzeitige Auslösungen durch (Doppel-Start) bzw. ein
  // brichAb() während der Awaits geht verloren (Start trotzdem). Wir kontrollieren dazu, WANN der
  // erste await (Einstellungen laden) auflöst — über einen manuell gesteuerten read()-Port.
  function makeSitzungMitTorSteuerung(opts: MakeOpts = {}) {
    const recorder = {
      started: 0,
      stopped: 0,
      discarded: 0,
      start(): void {
        recorder.started++
      },
      async stop() {
        recorder.stopped++
        return { audio, durationSeconds: opts.durationSeconds ?? 1.5 }
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
          return { text: opts.rewritten ?? 'umgeschrieben' }
        }
      },
      resolveSystemPrompt,
      quality
    })

    // read() blockiert, bis wir das Tor aufmachen → deterministisches Interleaving der Awaits.
    const content: string | null = opts.settings ? JSON.stringify(opts.settings) : null
    let toreLoesen: Array<() => void> = []
    const einstellungen = createSettingsStore({
      file: {
        read() {
          return new Promise<string | null>((resolve) => {
            toreLoesen.push(() => resolve(content))
          })
        },
        async write() {
          // no-op
        }
      }
    })

    const calls = {
      einfügen: [] as string[],
      anzeigen: [] as string[],
      zeigeEinstellungen: 0,
      melde: [] as FehlerMeldung[],
      inZwischenablage: [] as string[],
      erfasseFenster: 0
    }
    // A1 (v0.6.0): erfasseFenster ist jetzt der DRITTE Await-Punkt in starteWorkflow (nach load/has).
    // Standardmäßig löst der Fake sofort auf (Microtask), damit die bestehenden W2-A-Tests (die nur das
    // load-Tor steuern) unverändert durchlaufen. Ist `gateErfasseFenster` gesetzt, staut der Fake seine
    // Auflösung in einer EIGENEN Tor-Warteschlange — für den neuen Race-Test, der GENAU an diesem Await
    // abbrechen will.
    let toreLoesenFenster: Array<() => void> = []
    const ausgabe: Ausgabe = {
      einfügen: (t) => calls.einfügen.push(t),
      anzeigen: (t) => calls.anzeigen.push(t),
      zeigeEinstellungen: () => {
        calls.zeigeEinstellungen++
      },
      melde: (f) => calls.melde.push(f),
      inZwischenablage: (t) => calls.inZwischenablage.push(t),
      erfasseFenster: () => {
        calls.erfasseFenster++
        if (!opts.gateErfasseFenster) return Promise.resolve(opts.erfasstesHwnd ?? null)
        return new Promise((resolve) => {
          toreLoesenFenster.push(() => resolve(opts.erfasstesHwnd ?? null))
        })
      }
    }

    const apiKeys = {
      async has() {
        return opts.hasKey ?? true
      }
    }

    const sitzung = createSitzung({ runner, einstellungen, apiKeys, ausgabe })
    // Löst alle bislang gestauten read()-Aufrufe auf und lässt die Microtasks durchlaufen.
    async function oeffneTore(): Promise<void> {
      const tore = toreLoesen
      toreLoesen = []
      for (const t of tore) t()
      await tick()
      await tick()
    }
    // A1: analog zu oeffneTore, aber fürs erfasseFenster-Tor (nur relevant mit gateErfasseFenster).
    async function oeffneFensterTor(): Promise<void> {
      const tore = toreLoesenFenster
      toreLoesenFenster = []
      for (const t of tore) t()
      await tick()
      await tick()
    }
    return {
      sitzung,
      calls,
      recorder,
      oeffneTore,
      oeffneFensterTor,
      wartendeTore: () => toreLoesen.length,
      wartendeFensterTore: () => toreLoesenFenster.length
    }
  }

  it('W2-A/1: zwei quasi-gleichzeitige starteWorkflow starten den Runner nur EINMAL', async () => {
    const { sitzung, recorder, oeffneTore } = makeSitzungMitTorSteuerung()

    // Beide Aufrufe treten ein, BEVOR der erste await (load) aufgelöst hat → hier entscheidet sich,
    // ob die Reservierung vor dem await greift. Bei kaputtem Guard: beide passieren → recorder.started == 2.
    const p1 = sitzung.starteWorkflow('transcribe', 'hotkey')
    const p2 = sitzung.starteWorkflow('improve', 'manuell')
    await oeffneTore()
    await Promise.all([p1, p2])

    expect(recorder.started).toBe(1)
  })

  it('W2-A/2: brichAb während des load-Awaits verhindert den Start und hinterlässt keine Reservierung', async () => {
    const { sitzung, recorder, calls, oeffneTore } = makeSitzungMitTorSteuerung()

    const p = sitzung.starteWorkflow('transcribe', 'hotkey')
    // Der Lauf hängt jetzt im load-await. Der Nutzer bricht ab, BEVOR load aufgelöst hat.
    sitzung.brichAb()
    // Erst danach löst load auf; starteWorkflow läuft weiter — darf aber NICHT mehr starten.
    await oeffneTore()
    await p

    expect(recorder.started).toBe(0)
    expect(sitzung.beschaeftigt()).toBe(false)
    expect(calls.einfügen).toEqual([])
    expect(calls.anzeigen).toEqual([])

    // Kein Zustands-Leck: eine frische Auslösung nach dem Abbruch läuft sauber an.
    const p2 = sitzung.starteWorkflow('transcribe', 'hotkey')
    await oeffneTore()
    await p2
    expect(recorder.started).toBe(1)
    expect(sitzung.beschaeftigt()).toBe(true)
  })

  it('W2-A/3: normaler Start/Stop bleibt über das Tor unverändert', async () => {
    const { sitzung, calls, recorder, oeffneTore } = makeSitzungMitTorSteuerung({ transcript: 'hallo' })

    const p = sitzung.starteWorkflow('transcribe', 'hotkey')
    await oeffneTore()
    await p
    expect(recorder.started).toBe(1)
    expect(sitzung.beschaeftigt()).toBe(true)

    await sitzung.stoppe()
    expect(calls.einfügen).toEqual(['hallo'])
    expect(sitzung.beschaeftigt()).toBe(false)
  })

  // v0.7.2 (Erstlauf-Fix B): erfasseFenster() ist KEIN Await-Punkt vor runner.start() mehr — die
  // (beim Erstlauf zähe) HWND-Erfassung läuft parallel als Versprechen. runner.start() beginnt daher
  // SOFORT, unabhängig davon, ob erfasseFenster noch hängt. Ein brichAb() danach räumt normal; das noch
  // laufende erfasseFenster-Versprechen darf danach nichts mehr bewirken (es wird schlicht nie gelesen)
  // → kein neues Leak. (Der frühere „brichAb während des erfasseFenster-Awaits verhindert den Start"-
  // Fall ist mit Fix B gegenstandslos: es gibt keinen solchen Await mehr.)
  it('W2-A/4: erfasseFenster gated NICHT mehr den Start (Fix B); ein danach hängendes Versprechen leakt nicht', async () => {
    const { sitzung, recorder, calls, oeffneTore, oeffneFensterTor, wartendeFensterTore } =
      makeSitzungMitTorSteuerung({ gateErfasseFenster: true })

    const p = sitzung.starteWorkflow('transcribe', 'hotkey')
    // load + apiKeys.has durchlaufen lassen. erfasseFenster hängt weiter — runner.start() läuft TROTZDEM.
    await oeffneTore()
    await p
    expect(recorder.started).toBe(1) // Fix B: Start nicht mehr auf erfasseFenster blockiert
    expect(wartendeFensterTore()).toBe(1) // das Versprechen steht noch aus

    // Der Nutzer bricht ab, WÄHREND erfasseFenster() noch aussteht. brichAb räumt normal.
    sitzung.brichAb()
    // Danach löst das Versprechen auf; es wird nie gelesen → keine Wirkung, kein Leak.
    await oeffneFensterTor()
    expect(sitzung.beschaeftigt()).toBe(false)
    expect(calls.einfügen).toEqual([])
    expect(calls.anzeigen).toEqual([])

    // Kein Zustands-Leck: eine frische Auslösung nach dem Abbruch läuft sauber an (auch über das
    // erfasseFenster-Tor hinweg).
    const p2 = sitzung.starteWorkflow('transcribe', 'hotkey')
    await oeffneTore()
    await oeffneFensterTor()
    await p2
    expect(recorder.started).toBe(2)
    expect(sitzung.beschaeftigt()).toBe(true)
  })

  // --- W3-A: Fokus-Rückkehr (ADR-0011 Weg B) — HWND beim Start erfassen, an einfügen durchreichen ---

  it('Weg B: erfasst beim Start das Fenster und reicht fokusRueckkehr + erfasstesHwnd an einfügen', async () => {
    const { sitzung, calls } = makeSitzung({
      transcript: 'hallo',
      erfasstesHwnd: 4711,
      settings: { fokusRueckkehr: true }
    })

    await sitzung.starteWorkflow('transcribe', 'hotkey')
    await sitzung.stoppe()

    expect(calls.erfasseFenster).toBe(1)
    expect(calls.einfügen).toEqual(['hallo'])
    expect(calls.einfügenKontext[0]).toEqual({ fokusRueckkehr: true, erfasstesHwnd: 4711 })
  })

  it('Weg B: reicht fokusRueckkehr=false durch, wenn das Feature aus ist', async () => {
    const { sitzung, calls } = makeSitzung({
      transcript: 'hallo',
      erfasstesHwnd: 4711,
      settings: { fokusRueckkehr: false }
    })

    await sitzung.starteWorkflow('transcribe', 'hotkey')
    await sitzung.stoppe()

    expect(calls.einfügenKontext[0]).toEqual({ fokusRueckkehr: false, erfasstesHwnd: 4711 })
  })

  it('Weg B: erfasst KEIN Fenster bei manueller Quelle (kein Auto-Einfügen, nur Anzeige)', async () => {
    const { sitzung, calls } = makeSitzung({ transcript: 'hallo', erfasstesHwnd: 4711 })

    await sitzung.starteWorkflow('transcribe', 'manuell')
    await sitzung.stoppe()

    // Manuelle Quelle zeigt an statt einzufügen → keine Fenster-Erfassung nötig.
    expect(calls.erfasseFenster).toBe(0)
    expect(calls.anzeigen).toEqual(['hallo'])
  })

  // --- W3-B: Audio-Retry (Meldung mit aktion 'erneut' + erneutVersuchen ohne neues Diktat) ---

  it('W3-B: anbieter-Fehler bietet aktion "erneut"; erneutVersuchen fügt nach Erfolg ein (kein neues Diktat)', async () => {
    const { sitzung, calls, recorder, transcribeAufrufe } = makeSitzung({
      transcript: 'endlich da',
      transcribeFehlerErsterVersuch: new Error('OpenAI-Fehler: 500')
    })

    await sitzung.starteWorkflow('transcribe', 'hotkey')
    await sitzung.stoppe()

    // Erster Lauf scheitert → Meldung mit Retry-Aktion, nichts eingefügt.
    expect(calls.einfügen).toEqual([])
    expect(calls.melde).toHaveLength(1)
    expect(calls.melde[0]!.aktion).toBe('erneut')
    expect(recorder.stopped).toBe(1)
    expect(transcribeAufrufe()).toBe(1)

    // Retry ab Transkription — ohne neues Diktat (kein Recorder-Neustart).
    await sitzung.erneutVersuchen()
    await tick()

    expect(recorder.started).toBe(1) // NICHT erneut gestartet
    expect(transcribeAufrufe()).toBe(2)
    expect(calls.einfügen).toEqual(['endlich da'])
  })

  it('W3-B: erneutVersuchen ohne gehaltenes Audio ist ein No-Op', async () => {
    const { sitzung, calls } = makeSitzung({ transcript: 'hallo' })
    await sitzung.starteWorkflow('transcribe', 'hotkey')
    await sitzung.stoppe()
    // Erfolgreicher Lauf → Audio verworfen. Ein Retry darf nichts tun.
    calls.einfügen.length = 0
    await sitzung.erneutVersuchen()
    await tick()
    expect(calls.einfügen).toEqual([])
  })

  // --- F1: kannErneutVersuchen spiegelt den Runner-Zustand (für den Tray-Eintrag-Aktivzustand) ---

  it('F1: kannErneutVersuchen ist false vor jedem Lauf', () => {
    const { sitzung } = makeSitzung({ transcript: 'hallo' })
    expect(sitzung.kannErneutVersuchen()).toBe(false)
  })

  it('F1: kannErneutVersuchen ist true nach einem transienten Fehler (Audio gehalten)', async () => {
    const { sitzung } = makeSitzung({
      transcript: 'endlich da',
      transcribeFehlerErsterVersuch: new Error('OpenAI-Fehler: 500')
    })
    await sitzung.starteWorkflow('transcribe', 'hotkey')
    await sitzung.stoppe()
    expect(sitzung.kannErneutVersuchen()).toBe(true)
  })

  it('F1: kannErneutVersuchen ist false nach einem erfolgreichen Lauf (Audio verworfen)', async () => {
    const { sitzung } = makeSitzung({ transcript: 'hallo' })
    await sitzung.starteWorkflow('transcribe', 'hotkey')
    await sitzung.stoppe()
    expect(sitzung.kannErneutVersuchen()).toBe(false)
  })

  // --- F1: der Fehler-melde reicht bei aktion 'erneut' einen Retry-Callback mit (Notification-Button) ---

  it('F1: retrybarer Fehler reicht einen erneut-Callback an melde; Aufruf löst erneutVersuchen aus', async () => {
    const { sitzung, calls, recorder, transcribeAufrufe } = makeSitzung({
      transcript: 'endlich da',
      transcribeFehlerErsterVersuch: new Error('OpenAI-Fehler: 500')
    })

    await sitzung.starteWorkflow('transcribe', 'hotkey')
    await sitzung.stoppe()

    // Meldung trägt die Retry-Aktion UND einen aufrufbaren Callback.
    expect(calls.melde[0]!.aktion).toBe('erneut')
    const erneut = calls.meldeErneut[0]
    expect(typeof erneut).toBe('function')
    expect(transcribeAufrufe()).toBe(1)

    // Der Callback (Notification-Button-Klick) verarbeitet das gehaltene Audio erneut.
    erneut!()
    await tick()
    await tick()

    expect(recorder.started).toBe(1) // kein neues Diktat
    expect(transcribeAufrufe()).toBe(2)
    expect(calls.einfügen).toEqual(['endlich da'])
  })

  it('F1: ein nicht-retrybarer Fehler reicht KEINEN erneut-Callback mit', async () => {
    const { sitzung, calls } = makeSitzung({
      transcribeFehler: Object.assign(new Error('Ungültiger Key'), { status: 401 })
    })
    await sitzung.starteWorkflow('transcribe', 'hotkey')
    await sitzung.stoppe()
    expect(calls.melde[0]!.aktion).toBe('einstellungen')
    expect(calls.meldeErneut[0]).toBeUndefined()
  })

  // --- F1: Reservierungs-Lücke in erneutVersuchen (P1-latent Doppel-Run-Korruption) ---

  it('F1: während laufendem erneutVersuchen wird ein konkurrierender starteWorkflow abgewiesen', async () => {
    // Erster Versuch scheitert transient (Audio gehalten), zweiter (Retry) hängt in der
    // Transkription bis zum Abbruch-Signal. Ein starteWorkflow während des Retrys darf den Runner
    // NICHT ein zweites Mal starten (Doppel-Run-Korruption auf demselben Runner).
    const { sitzung, recorder } = makeSitzung({
      transcript: 'egal',
      transcribeFehlerErsterVersuch: new Error('OpenAI-Fehler: 500'),
      hangUntilAbort: true
    })

    await sitzung.starteWorkflow('transcribe', 'hotkey')
    await sitzung.stoppe()
    expect(recorder.started).toBe(1)
    expect(sitzung.kannErneutVersuchen()).toBe(true)

    // Retry starten (hängt in der Transkription) — NICHT awaiten.
    const retryP = sitzung.erneutVersuchen()
    await tick()
    // Während der Retry läuft, ist die Sitzung beschäftigt.
    expect(sitzung.beschaeftigt()).toBe(true)

    // Konkurrierender Hotkey-Start MUSS abgewiesen werden (kein zweiter runner.start).
    await sitzung.starteWorkflow('improve', 'hotkey')
    expect(recorder.started).toBe(1) // unverändert — kein zweiter Start

    // Aufräumen: Abbruch löst den hängenden Retry auf.
    sitzung.brichAb()
    await retryP
    expect(sitzung.beschaeftigt()).toBe(false)
  })

  it('F1: nach Abschluss von erneutVersuchen ist die Reservierung wieder frei', async () => {
    const { sitzung, recorder } = makeSitzung({
      transcript: 'endlich da',
      transcribeFehlerErsterVersuch: new Error('OpenAI-Fehler: 500')
    })
    await sitzung.starteWorkflow('transcribe', 'hotkey')
    await sitzung.stoppe()

    await sitzung.erneutVersuchen()
    await tick()
    expect(sitzung.beschaeftigt()).toBe(false)

    // Eine frische Auslösung nach dem erfolgreichen Retry läuft sauber an.
    await sitzung.starteWorkflow('transcribe', 'hotkey')
    expect(recorder.started).toBe(2)
  })

  it('F1: erneutVersuchen wird ignoriert, solange ein Lauf aktiv ist', async () => {
    const { sitzung, transcribeAufrufe } = makeSitzung({ transcript: 'hallo', hangUntilAbort: true })
    await sitzung.starteWorkflow('transcribe', 'hotkey')
    const stopP = sitzung.stoppe() // hängt in der Transkription
    await tick()
    expect(sitzung.beschaeftigt()).toBe(true)

    // Ein Retry während eines aktiven Laufs ist ein No-Op (kein zusätzlicher transcribe).
    await sitzung.erneutVersuchen()
    expect(transcribeAufrufe()).toBe(1)

    sitzung.brichAb()
    await stopP
  })

  it('verarbeiteTerminal-Guard: eine nicht-terminale Phase (z. B. umschreiben) löst NICHTS aus', async () => {
    // Regressionsschutz für den Guard in verarbeiteTerminal (nur fertig/teilErfolg/fehler laufen durch).
    // Simuliert über den normalen stoppe()-Pfad: Desync-Schutz + Guard zusammen bedeuten, dass ein
    // stoppe() ohne aktiven Lauf (aktiveQuelle bereits null) gar nicht erst bis verarbeiteTerminal kommt.
    const { sitzung, calls } = makeSitzung({ transcript: 'hallo' })
    await sitzung.stoppe() // kein aktiver Lauf → Desync-Guard greift zuerst
    expect(calls.einfügen).toEqual([])
    expect(calls.anzeigen).toEqual([])
  })
})
