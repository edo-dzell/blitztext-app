import { describe, it, expect } from 'vitest'
import { createSettingsStore, defaultSettings, type SettingsFile } from '@main/settings/store'
import {
  MINDEST_AUFNAHME_SEKUNDEN_DEFAULT,
  STILLE_PROFIL_DEFAULT,
  NETZWERK_PROFIL_DEFAULT,
  RETRY_VERSUCHE_DEFAULT,
  VERLAUF_MAXIMUM_DEFAULT,
  STATISTIK_KOMPAKTIERUNG_TAGE_DEFAULT,
  UPDATE_INTERVALL_STUNDEN_DEFAULT,
  PILLEN_ANZEIGEDAUER_PROFIL_DEFAULT,
  PERF_AKTIV_DEFAULT
} from '@shared/laufzeit-profile'

function fakeFile(initial: string | null = null): SettingsFile {
  let content = initial
  return {
    async read() {
      return content
    },
    async write(next) {
      content = next
    }
  }
}

describe('createSettingsStore', () => {
  it('round-trippt alle Felder: save dann load liefert dieselben Einstellungen', async () => {
    const store = createSettingsStore({ file: fakeFile() })
    const settings = {
      language: 'en',
      customTerms: ['Acme', 'GmbH'],
      tone: 'formal' as const,
      emojiDensity: 'viel' as const,
      aufnahmemodus: 'toggle' as const,
      hotkeys: {
        transcribe: ['ControlLeft', 'KeyT'],
        improve: ['ControlLeft', 'KeyI'],
        calm: ['ControlLeft', 'KeyC'],
        emoji: ['ControlLeft', 'KeyE'],
        'mein-flow': ['ControlRight', 'KeyM']
      },
      anbieter: [
        {
          id: 'groq',
          vorlage: 'groq',
          label: 'Groq',
          baseUrl: 'https://api.groq.com/openai/v1',
          asrModell: 'whisper-large-v3',
          chatModell: 'llama-3.1-8b-instant'
        }
      ],
      standardAnbieterId: 'groq',
      verlaufAktiv: true,
      verlaufGesperrt: false,
      fokusRueckkehr: true,
      theme: 'dunkel' as const,
      preisOverrides: { 'gpt-4o-mini': { inputPro1MUsd: 1 } },
      usdEurKurs: 0.9,
      apiKeyStatus: { groq: { status: 'verifiziert' as const, zuletztGetestetMs: 123 } },
      autostart: true,
      mikrofonDeviceId: 'geraet-abc',
      updateHinweisAktiv: true,
      ausfuehrlichesProtokoll: true,
      verlaufSortierung: 'aeltesteZuerst' as const,
      onboardingAbgeschlossen: true,
      builtinAnbieterHinweisAbgeschlossen: true,
      mindestAufnahmeSekunden: 0.5,
      stilleProfil: 'streng' as const,
      netzwerkProfil: 'lang' as const,
      retryVersuche: 4,
      verlaufMaximum: 500,
      statistikKompaktierungTage: 180,
      updateIntervallStunden: 72,
      pillenAnzeigedauerProfil: 'kurz' as const,
      perfAktiv: true,
      workflows: [
        {
          id: 'transcribe',
          label: 'Blitztext',
          summary: 'Sprache in Text umwandeln.',
          builtin: true,
          rewrites: false,
          promptModus: 'berechnet' as const,
          systemPrompt: '',
          model: '',
          temperature: 0,
          anbieterId: '',
          language: '',
          ausgabeSprache: ''
        },
        {
          id: 'mein-flow',
          label: 'Mein Flow',
          summary: 'eigener',
          builtin: false,
          rewrites: true,
          promptModus: 'statisch' as const,
          systemPrompt: 'Mach das so.',
          model: 'gpt-4o-mini',
          temperature: 0.5,
          anbieterId: '',
          language: '',
          ausgabeSprache: ''
        }
      ]
    }

    await store.save(settings)
    const loaded = await store.load()

    // workflows: gespeicherte zuerst, fehlende eingebaute (improve/calm/emoji) hinten angehängt.
    expect(loaded.workflows.slice(0, 2)).toEqual(settings.workflows)
    expect(loaded.workflows.map((w) => w.id)).toEqual([
      'transcribe',
      'mein-flow',
      'improve',
      'calm',
      'emoji'
    ])
    const { workflows: _lw, ...loadedRest } = loaded
    const { workflows: _sw, ...settingsRest } = settings
    expect(loadedRest).toEqual(settingsRest)
  })

  // W3-γ/δ/ζ (Staffel 3.2): neue Felder migrationssicher — eine alte Datei OHNE diese Felder lädt mit
  // konservativen Defaults (Autostart aus, Mikrofon = OS-Standard/leer, Update-Hinweis aus).
  it('alte Datei ohne W3-Felder ⇒ konservative Defaults (autostart/updateHinweis aus, Mikrofon leer)', async () => {
    const store = createSettingsStore({
      file: fakeFile(JSON.stringify({ language: 'de', tone: 'formal' }))
    })
    const loaded = await store.load()
    expect(loaded.autostart).toBe(false)
    expect(loaded.mikrofonDeviceId).toBe('')
    expect(loaded.updateHinweisAktiv).toBe(false)
  })

  it('W3-Felder werden übernommen und round-trippen (autostart/mikrofonDeviceId/updateHinweisAktiv)', async () => {
    const store = createSettingsStore({
      file: fakeFile(
        JSON.stringify({ autostart: true, mikrofonDeviceId: 'mic-42', updateHinweisAktiv: true })
      )
    })
    const loaded = await store.load()
    expect(loaded.autostart).toBe(true)
    expect(loaded.mikrofonDeviceId).toBe('mic-42')
    expect(loaded.updateHinweisAktiv).toBe(true)
  })

  it('typfremde W3-Werte fallen auf die Defaults zurück (kein Absturz)', async () => {
    const store = createSettingsStore({
      file: fakeFile(
        JSON.stringify({ autostart: 'ja', mikrofonDeviceId: 123, updateHinweisAktiv: 1 })
      )
    })
    const loaded = await store.load()
    expect(loaded.autostart).toBe(false) // nur === true zählt
    expect(loaded.mikrofonDeviceId).toBe('') // Nicht-String → Default
    expect(loaded.updateHinweisAktiv).toBe(false)
  })

  it('defaultSettings enthält die neuen W3-Felder mit konservativen Defaults', () => {
    const d = defaultSettings()
    expect(d.autostart).toBe(false)
    expect(d.mikrofonDeviceId).toBe('')
    expect(d.updateHinweisAktiv).toBe(false)
  })

  // v0.7.2: ausfuehrlichesProtokoll (Debug-Stufe des Ereignislogs) — Migration wie die W3-Booleans:
  // alte Datei ohne Feld ⇒ false, expliziter boolean round-trippt, typfremder Wert ⇒ false.
  it('alte Datei ohne ausfuehrlichesProtokoll ⇒ Default false', async () => {
    const store = createSettingsStore({ file: fakeFile(JSON.stringify({ language: 'de' })) })
    const loaded = await store.load()
    expect(loaded.ausfuehrlichesProtokoll).toBe(false)
  })

  it('ausfuehrlichesProtokoll round-trippt (true)', async () => {
    const store = createSettingsStore({
      file: fakeFile(JSON.stringify({ ausfuehrlichesProtokoll: true }))
    })
    const loaded = await store.load()
    expect(loaded.ausfuehrlichesProtokoll).toBe(true)
  })

  it('typfremder ausfuehrlichesProtokoll-Wert fällt auf false zurück', async () => {
    const store = createSettingsStore({
      file: fakeFile(JSON.stringify({ ausfuehrlichesProtokoll: 'ja' }))
    })
    const loaded = await store.load()
    expect(loaded.ausfuehrlichesProtokoll).toBe(false) // nur === true zählt
  })

  it('defaultSettings enthält ausfuehrlichesProtokoll mit Default false', () => {
    expect(defaultSettings().ausfuehrlichesProtokoll).toBe(false)
  })

  // C2: verlaufSortierung — Migration feldweise wie theme (includes-Check + Fallback auf Default).
  it('defaultSettings: verlaufSortierung ist neuesteZuerst', () => {
    expect(defaultSettings().verlaufSortierung).toBe('neuesteZuerst')
  })

  it('alte Datei ohne verlaufSortierung ⇒ Default neuesteZuerst', async () => {
    const store = createSettingsStore({
      file: fakeFile(JSON.stringify({ language: 'de' }))
    })
    const loaded = await store.load()
    expect(loaded.verlaufSortierung).toBe('neuesteZuerst')
  })

  it('verlaufSortierung round-trippt (aeltesteZuerst)', async () => {
    const store = createSettingsStore({
      file: fakeFile(JSON.stringify({ verlaufSortierung: 'aeltesteZuerst' }))
    })
    const loaded = await store.load()
    expect(loaded.verlaufSortierung).toBe('aeltesteZuerst')
  })

  it('ungültiger verlaufSortierung-Wert fällt auf den Default zurück', async () => {
    const store = createSettingsStore({
      file: fakeFile(JSON.stringify({ verlaufSortierung: 'zufaellig' }))
    })
    const loaded = await store.load()
    expect(loaded.verlaufSortierung).toBe('neuesteZuerst')
  })

  it('seedet die vier eingebauten Workflows ohne vorhandenes File', async () => {
    const store = createSettingsStore({ file: fakeFile(null) })
    const w = (await store.load()).workflows
    expect(w.map((x) => x.id)).toEqual(['transcribe', 'improve', 'calm', 'emoji'])
    expect(w.find((x) => x.id === 'calm')).toMatchObject({ model: 'gpt-4o', temperature: 0.4 })
  })

  it('ergänzt fehlende eingebaute Workflows, behält custom und pruned verwaiste Hotkeys', async () => {
    const store = createSettingsStore({
      file: fakeFile(
        JSON.stringify({
          workflows: [
            { id: 'custom1', label: 'C1', builtin: false, rewrites: true, promptModus: 'statisch' }
          ],
          hotkeys: {
            custom1: ['ControlRight', 'KeyJ'],
            geloescht: ['ControlRight', 'KeyZ'] // verwaist → wird geprunt
          }
        })
      )
    })
    const loaded = await store.load()
    expect(loaded.workflows.map((w) => w.id)).toEqual([
      'custom1',
      'transcribe',
      'improve',
      'calm',
      'emoji'
    ])
    expect(loaded.hotkeys.custom1).toEqual(['ControlRight', 'KeyJ'])
    expect('geloescht' in loaded.hotkeys).toBe(false) // verwaister Key geprunt
    expect(loaded.hotkeys.transcribe).toEqual(['ControlLeft', 'MetaLeft']) // builtin-Default
  })

  it('ohne Anbieter/Provider (v1-File) → ein OpenAI-Standard-Anbieter', async () => {
    const store = createSettingsStore({ file: fakeFile(JSON.stringify({ language: 'de' })) })
    const loaded = await store.load()
    expect(loaded.anbieter).toEqual([
      {
        id: 'openai',
        vorlage: 'openai',
        label: 'OpenAI',
        baseUrl: 'https://api.openai.com/v1',
        asrModell: 'gpt-4o-mini-transcribe',
        chatModell: 'gpt-4o-mini'
      }
    ])
    expect(loaded.standardAnbieterId).toBe('openai')
  })

  it('migriert Single-`provider` (v1) zu einem Anbieter-Listeneintrag', async () => {
    const store = createSettingsStore({
      file: fakeFile(JSON.stringify({ provider: { id: 'groq' } }))
    })
    const loaded = await store.load()
    expect(loaded.standardAnbieterId).toBe('groq')
    const a = loaded.anbieter[0]
    expect(a).toMatchObject({
      id: 'groq',
      vorlage: 'groq',
      baseUrl: 'https://api.groq.com/openai/v1', // aus der Registry-Vorlage
      asrModell: 'gpt-4o-mini-transcribe',
      chatModell: 'gpt-4o-mini'
    })
  })

  // --- S4: parseEinAnbieter-Default für 'lokal' (keinKeyNoetig), Muster wie die vorlage-abhängigen
  // Defaults oben (Base-URL/Modelle aus der Registry) ---

  it("'lokal'-Anbieter OHNE keinKeyNoetig-Feld → Default true (robust bei manuell editierter Datei)", async () => {
    const store = createSettingsStore({
      file: fakeFile(
        JSON.stringify({
          anbieter: [{ id: 'mein-lokaler', vorlage: 'lokal', baseUrl: 'http://localhost:8000/v1' }],
          standardAnbieterId: 'mein-lokaler'
        })
      )
    })
    const loaded = await store.load()
    expect(loaded.anbieter[0]).toMatchObject({ vorlage: 'lokal', keinKeyNoetig: true })
  })

  it("'lokal'-Anbieter mit explizitem keinKeyNoetig=false → respektiert (kein erzwungenes true)", async () => {
    const store = createSettingsStore({
      file: fakeFile(
        JSON.stringify({
          anbieter: [
            {
              id: 'mein-lokaler',
              vorlage: 'lokal',
              baseUrl: 'http://localhost:8000/v1',
              keinKeyNoetig: false
            }
          ],
          standardAnbieterId: 'mein-lokaler'
        })
      )
    })
    const loaded = await store.load()
    expect(loaded.anbieter[0]!.keinKeyNoetig).toBeUndefined()
  })

  it("'custom'-Anbieter ohne keinKeyNoetig-Feld → KEIN Default-true (nur 'lokal' bekommt den Default)", async () => {
    const store = createSettingsStore({
      file: fakeFile(
        JSON.stringify({
          anbieter: [{ id: 'mein-custom', vorlage: 'custom', baseUrl: 'https://example.test/v1' }],
          standardAnbieterId: 'mein-custom'
        })
      )
    })
    const loaded = await store.load()
    expect(loaded.anbieter[0]!.keinKeyNoetig).toBeUndefined()
  })

  it('A7: migriert sichererLokalerModus → verlaufGesperrt und schreibt den alten Key nicht zurück', async () => {
    const file = fakeFile(JSON.stringify({ sichererLokalerModus: true }))
    const store = createSettingsStore({ file })

    const loaded = await store.load()
    expect(loaded.verlaufGesperrt).toBe(true)

    await store.save(loaded)
    const roh = await file.read()
    expect(roh).toContain('verlaufGesperrt')
    expect(roh).not.toContain('sichererLokalerModus')
  })

  it('ohne vorhandenes File liefert load die Defaults', async () => {
    const store = createSettingsStore({ file: fakeFile(null) })

    const loaded = await store.load()
    expect(loaded).toEqual(defaultSettings())
    expect(loaded.language).toBe('de')
    expect(loaded.tone).toBe('neutral')
    expect(loaded.emojiDensity).toBe('mittel')
    expect(loaded.aufnahmemodus).toBe('hold')
    expect(loaded.hotkeys.transcribe).toEqual(['ControlLeft', 'MetaLeft'])
  })

  it('füllt fehlende Felder aus einem Teil-JSON mit Defaults auf', async () => {
    const store = createSettingsStore({ file: fakeFile(JSON.stringify({ language: 'en' })) })

    expect(await store.load()).toEqual({ ...defaultSettings(), language: 'en' })
  })

  it('ersetzt unbekannte Enum-Werte durch die Defaults', async () => {
    const store = createSettingsStore({
      file: fakeFile(JSON.stringify({ tone: 'shouting', emojiDensity: 'extrem' }))
    })

    const loaded = await store.load()
    expect(loaded.tone).toBe('neutral')
    expect(loaded.emojiDensity).toBe('mittel')
  })

  it('bereinigt customTerms auf Strings und ersetzt einen Nicht-Array durch []', async () => {
    const mixed = createSettingsStore({
      file: fakeFile(JSON.stringify({ customTerms: ['Acme', 5, null, 'GmbH'] }))
    })
    expect((await mixed.load()).customTerms).toEqual(['Acme', 'GmbH'])

    const notArray = createSettingsStore({
      file: fakeFile(JSON.stringify({ customTerms: 'Acme' }))
    })
    expect((await notArray.load()).customTerms).toEqual([])
  })

  it('normalisiert customTerms beim Laden: Leerstrings/Whitespace raus, Case-Duplikate dedupliziert (Terms-Kern)', async () => {
    const store = createSettingsStore({
      file: fakeFile(JSON.stringify({ customTerms: ['Acme', '', '  ', 'GmbH', 'acme', ' GmbH '] }))
    })
    expect((await store.load()).customTerms).toEqual(['Acme', 'GmbH'])
  })

  it('normalisiert customTerms auch beim Speichern (zweite Verteidigungslinie)', async () => {
    const file = fakeFile()
    const store = createSettingsStore({ file })
    const settings = {
      ...defaultSettings(),
      customTerms: ['Acme', '', 'acme', '  GmbH  ']
    }
    await store.save(settings)
    const reloaded = await store.load()
    expect(reloaded.customTerms).toEqual(['Acme', 'GmbH'])
  })

  it('liefert bei kaputtem JSON die Defaults statt zu werfen', async () => {
    const store = createSettingsStore({ file: fakeFile('das ist kein json') })

    await expect(store.load()).resolves.toEqual(defaultSettings())
  })

  // A3 (v0.7.3): Korruptions-Rettung — beiseiteLegen + aufKorruption-Callback bei unlesbarer Datei.
  describe('Korruptions-Rettung (A3)', () => {
    // Fake-Port mit beiseiteLegen-Zähler.
    function korruptFile(initial: string | null) {
      let content = initial
      let beiseiteGelegt = 0
      return {
        file: {
          async read() {
            return content
          },
          async write(next: string) {
            content = next
          },
          async beiseiteLegen() {
            beiseiteGelegt++
            content = null // Datei „umbenannt" → beim nächsten read weg
          }
        } satisfies SettingsFile,
        get beiseiteGelegt() {
          return beiseiteGelegt
        }
      }
    }

    it('kaputtes JSON: legt die Datei beiseite, ruft aufKorruption und liefert Defaults', async () => {
      const f = korruptFile('{ das ist kaputt')
      let callbacks = 0
      const store = createSettingsStore({ file: f.file, aufKorruption: () => callbacks++ })

      await expect(store.load()).resolves.toEqual(defaultSettings())
      expect(f.beiseiteGelegt).toBe(1)
      expect(callbacks).toBe(1)
    })

    it('fehlende Datei (null): KEIN Callback, KEIN Beiseitelegen, Defaults', async () => {
      const f = korruptFile(null)
      let callbacks = 0
      const store = createSettingsStore({ file: f.file, aufKorruption: () => callbacks++ })

      await expect(store.load()).resolves.toEqual(defaultSettings())
      expect(f.beiseiteGelegt).toBe(0)
      expect(callbacks).toBe(0)
    })

    it('gültige Datei: KEIN Callback, KEIN Beiseitelegen', async () => {
      const f = korruptFile(JSON.stringify({ language: 'en' }))
      let callbacks = 0
      const store = createSettingsStore({ file: f.file, aufKorruption: () => callbacks++ })

      const loaded = await store.load()
      expect(loaded.language).toBe('en')
      expect(f.beiseiteGelegt).toBe(0)
      expect(callbacks).toBe(0)
    })

    it('Fake-Port OHNE beiseiteLegen: wirft bei Korruption nicht, liefert Defaults + Callback', async () => {
      // fakeFile hat kein beiseiteLegen (optionale Methode) → der Store ruft `?.()` und läuft weiter.
      let callbacks = 0
      const store = createSettingsStore({
        file: fakeFile('kein json'),
        aufKorruption: () => callbacks++
      })
      await expect(store.load()).resolves.toEqual(defaultSettings())
      expect(callbacks).toBe(1)
    })

    it('ohne aufKorruption-Callback: kaputtes JSON liefert weiterhin Defaults (No-Op-Default)', async () => {
      const store = createSettingsStore({ file: fakeFile('kaputt') })
      await expect(store.load()).resolves.toEqual(defaultSettings())
    })
  })

  it('ersetzt einen unbekannten Aufnahmemodus durch den Default (hold)', async () => {
    const store = createSettingsStore({
      file: fakeFile(JSON.stringify({ aufnahmemodus: 'dauerfeuer' }))
    })

    expect((await store.load()).aufnahmemodus).toBe('hold')
  })

  it('migriert hotkeys feldweise: ungültiger/fehlender Workflow-Chord fällt einzeln auf Default zurück', async () => {
    const store = createSettingsStore({
      file: fakeFile(
        JSON.stringify({
          hotkeys: {
            transcribe: ['ControlLeft', 'KeyT'], // gültig → übernommen
            improve: 'kein-array', // ungültig → Default
            calm: [] // leer → Default
            // emoji fehlt → Default
          }
        })
      )
    })

    const hotkeys = (await store.load()).hotkeys
    expect(hotkeys.transcribe).toEqual(['ControlLeft', 'KeyT'])
    expect(hotkeys.improve).toEqual(['ControlRight', 'ShiftRight', 'Digit2'])
    expect(hotkeys.calm).toEqual(['ControlRight', 'ShiftRight', 'Digit3'])
    expect(hotkeys.emoji).toEqual(['ControlRight', 'ShiftRight', 'Digit4'])
  })

  it('ersetzt nicht-objekt hotkeys komplett durch die Defaults', async () => {
    const store = createSettingsStore({ file: fakeFile(JSON.stringify({ hotkeys: 'nope' })) })

    expect((await store.load()).hotkeys).toEqual(defaultSettings().hotkeys)
  })

  it('v0.3-Felder: Defaults bei leerem File', async () => {
    const leer = await createSettingsStore({ file: fakeFile(null) }).load()
    expect(leer.preisOverrides).toEqual({})
    expect(leer.usdEurKurs).toBe(0.86)
    expect(leer.apiKeyStatus).toEqual({})
  })

  it('v0.3-Felder: ungültige Werte fallen auf Default zurück', async () => {
    const loaded = await createSettingsStore({
      file: fakeFile(
        JSON.stringify({
          usdEurKurs: -1, // <=0 → Default
          preisOverrides: { x: { inputPro1MUsd: 'nope' } }, // nicht-numerisch → Eintrag verworfen
          apiKeyStatus: { a: { status: 'falsch' } } // status != verifiziert → verworfen
        })
      )
    }).load()
    expect(loaded.usdEurKurs).toBe(0.86)
    expect(loaded.preisOverrides).toEqual({})
    expect(loaded.apiKeyStatus).toEqual({})
  })

  it('v0.3-Felder: gültige Werte werden übernommen', async () => {
    const loaded = await createSettingsStore({
      file: fakeFile(
        JSON.stringify({
          usdEurKurs: 0.92,
          preisOverrides: { 'gpt-4o': { inputPro1MUsd: 3 } },
          apiKeyStatus: { openai: { status: 'verifiziert', zuletztGetestetMs: 5 } }
        })
      )
    }).load()
    expect(loaded.usdEurKurs).toBe(0.92)
    expect(loaded.preisOverrides).toEqual({ 'gpt-4o': { inputPro1MUsd: 3 } })
    expect(loaded.apiKeyStatus).toEqual({ openai: { status: 'verifiziert', zuletztGetestetMs: 5 } })
  })

  // R3/#26: Prompt-Historie je Workflow (parsePromptHistorie) — feldweise Validierung inkl. `quelle`.
  describe('Prompt-Historie (R3/#26): parsePromptHistorie', () => {
    it('lädt gültige Einträge beider quelle-Werte unverändert', async () => {
      const loaded = await createSettingsStore({
        file: fakeFile(
          JSON.stringify({
            workflows: [
              {
                id: 'mein-flow',
                label: 'Mein Flow',
                builtin: false,
                rewrites: true,
                promptModus: 'statisch',
                systemPrompt: 'aktuell',
                promptHistorie: [
                  { id: 'v2', zeitstempelMs: 200, text: 'zweite', quelle: 'assistent' },
                  { id: 'v1', zeitstempelMs: 100, text: 'erste', quelle: 'manuell' }
                ]
              }
            ]
          })
        )
      }).load()
      const flow = loaded.workflows.find((w) => w.id === 'mein-flow')
      expect(flow?.promptHistorie).toEqual([
        { id: 'v2', zeitstempelMs: 200, text: 'zweite', quelle: 'assistent' },
        { id: 'v1', zeitstempelMs: 100, text: 'erste', quelle: 'manuell' }
      ])
    })

    it('unbekannter/fehlender quelle-Wert fällt auf manuell zurück (kein Wurf)', async () => {
      const loaded = await createSettingsStore({
        file: fakeFile(
          JSON.stringify({
            workflows: [
              {
                id: 'mein-flow',
                label: 'Mein Flow',
                builtin: false,
                rewrites: true,
                promptModus: 'statisch',
                systemPrompt: 'x',
                promptHistorie: [
                  { id: 'v1', zeitstempelMs: 1, text: 'a', quelle: 'unbekannt' },
                  { id: 'v2', zeitstempelMs: 2, text: 'b' } // quelle fehlt ganz
                ]
              }
            ]
          })
        )
      }).load()
      const flow = loaded.workflows.find((w) => w.id === 'mein-flow')
      expect(flow?.promptHistorie).toEqual([
        { id: 'v1', zeitstempelMs: 1, text: 'a', quelle: 'manuell' },
        { id: 'v2', zeitstempelMs: 2, text: 'b', quelle: 'manuell' }
      ])
    })

    it('verwirft Einträge ohne id/text, fehlender zeitstempelMs fällt auf 0 zurück', async () => {
      const loaded = await createSettingsStore({
        file: fakeFile(
          JSON.stringify({
            workflows: [
              {
                id: 'mein-flow',
                label: 'Mein Flow',
                builtin: false,
                rewrites: true,
                promptModus: 'statisch',
                systemPrompt: 'x',
                promptHistorie: [
                  { id: 'gueltig', text: 'ok', quelle: 'manuell' }, // zeitstempelMs fehlt → 0
                  { text: 'ohne id', quelle: 'manuell' }, // keine id → verworfen
                  { id: 'ohne-text', quelle: 'manuell' }, // kein text → verworfen
                  'nicht-mal-ein-objekt' // kein Objekt → verworfen
                ]
              }
            ]
          })
        )
      }).load()
      const flow = loaded.workflows.find((w) => w.id === 'mein-flow')
      expect(flow?.promptHistorie).toEqual([
        { id: 'gueltig', zeitstempelMs: 0, text: 'ok', quelle: 'manuell' }
      ])
    })

    it('round-trippt promptHistorie über save→load (beide quelle-Werte, Reihenfolge erhalten)', async () => {
      const store = createSettingsStore({ file: fakeFile() })
      const settings = {
        ...defaultSettings(),
        workflows: [
          {
            id: 'mein-flow',
            label: 'Mein Flow',
            summary: '',
            builtin: false,
            rewrites: true,
            promptModus: 'statisch' as const,
            systemPrompt: 'aktuell',
            model: '',
            temperature: 0.3,
            anbieterId: '',
            language: '',
            ausgabeSprache: '',
            promptHistorie: [
              { id: 'v3', zeitstempelMs: 300, text: 'neueste', quelle: 'assistent' as const },
              { id: 'v2', zeitstempelMs: 200, text: 'mitte', quelle: 'manuell' as const },
              { id: 'v1', zeitstempelMs: 100, text: 'aelteste', quelle: 'manuell' as const }
            ]
          }
        ]
      }
      await store.save(settings)
      const loaded = await store.load()
      const flow = loaded.workflows.find((w) => w.id === 'mein-flow')
      expect(flow?.promptHistorie).toEqual(settings.workflows[0]!.promptHistorie)
    })

    it('fehlendes/ungültiges promptHistorie-Feld ergibt kein Feld (undefined), kein Wurf', async () => {
      const ohneFeld = await createSettingsStore({
        file: fakeFile(
          JSON.stringify({
            workflows: [
              { id: 'mein-flow', label: 'M', builtin: false, rewrites: true, promptModus: 'statisch' }
            ]
          })
        )
      }).load()
      expect(ohneFeld.workflows.find((w) => w.id === 'mein-flow')?.promptHistorie).toBeUndefined()

      const keinArray = await createSettingsStore({
        file: fakeFile(
          JSON.stringify({
            workflows: [
              {
                id: 'mein-flow',
                label: 'M',
                builtin: false,
                rewrites: true,
                promptModus: 'statisch',
                promptHistorie: 'nicht-array'
              }
            ]
          })
        )
      }).load()
      expect(keinArray.workflows.find((w) => w.id === 'mein-flow')?.promptHistorie).toBeUndefined()
    })
  })

  describe('onboardingAbgeschlossen (W2-S8): Migration bei fehlendem Feld', () => {
    it('fehlt das Feld UND ist apiKeyStatus leer UND ≤4 Workflows → false (frische Installation)', async () => {
      const loaded = await createSettingsStore({ file: fakeFile(JSON.stringify({})) }).load()
      expect(loaded.onboardingAbgeschlossen).toBe(false)
    })

    it('fehlt das Feld, aber apiKeyStatus ist nicht leer → true (Bestandsnutzer)', async () => {
      const loaded = await createSettingsStore({
        file: fakeFile(
          JSON.stringify({
            apiKeyStatus: { openai: { status: 'verifiziert', zuletztGetestetMs: 123 } }
          })
        )
      }).load()
      expect(loaded.onboardingAbgeschlossen).toBe(true)
    })

    it('fehlt das Feld, aber es existieren mehr als 4 Workflows → true (Bestandsnutzer)', async () => {
      const fuenfterWorkflow = {
        id: 'mein-flow',
        label: 'Mein Flow',
        builtin: false,
        rewrites: true,
        promptModus: 'statisch'
      }
      const loaded = await createSettingsStore({
        file: fakeFile(JSON.stringify({ workflows: [fuenfterWorkflow] }))
      }).load()
      // Migration hängt die 4 eingebauten Workflows an fehlende an → 5 Workflows insgesamt (>4).
      expect(loaded.workflows.length).toBeGreaterThan(4)
      expect(loaded.onboardingAbgeschlossen).toBe(true)
    })

    it('explizit gesetztes false bleibt false, auch mit apiKeyStatus (respektiert den expliziten Wert)', async () => {
      const loaded = await createSettingsStore({
        file: fakeFile(
          JSON.stringify({
            onboardingAbgeschlossen: false,
            apiKeyStatus: { openai: { status: 'verifiziert', zuletztGetestetMs: 123 } }
          })
        )
      }).load()
      expect(loaded.onboardingAbgeschlossen).toBe(false)
    })

    it('explizit gesetztes true bleibt true, auch ohne jede Vornutzungs-Spur', async () => {
      const loaded = await createSettingsStore({
        file: fakeFile(JSON.stringify({ onboardingAbgeschlossen: true }))
      }).load()
      expect(loaded.onboardingAbgeschlossen).toBe(true)
    })
  })

  // v0.8.0 (Auftrag 1): BUILTIN_WORKFLOWS pinnt seit hier keinen anbieterId mehr (siehe workflows.ts).
  // Eine BESTEHENDE settings.json mit bereits gespeichertem `anbieterId:'openai'` auf einem Built-in
  // MUSS diese Zuordnung unverändert behalten (Bestandsschutz — aus der Datei allein lässt sich nicht
  // unterscheiden, ob 'openai' ein nie angefasster Altwert oder eine bewusste Nutzerwahl war). Die
  // einmalige Kennzeichnung `builtinAnbieterHinweisAbgeschlossen` markiert für eine SPÄTERE Oberfläche
  // (nicht Teil dieser Änderung), ob ein solcher Altbestand vorliegt — Heuristik nach dem Muster von
  // `onboardingAbgeschlossen`, nur mit umgekehrter Stoßrichtung: dort true = „kein Wizard nötig", hier
  // true = „kein Hinweis nötig" (frische Installationen + bereits entpinnte Bestände).
  describe('Bestandsschutz: gepinnte Built-ins + builtinAnbieterHinweisAbgeschlossen', () => {
    it('bestehende settings.json mit gepinntem Built-in behält die Zuordnung (kein stiller Wechsel)', async () => {
      const store = createSettingsStore({
        file: fakeFile(
          JSON.stringify({
            standardAnbieterId: 'mistral',
            anbieter: [
              {
                id: 'mistral',
                vorlage: 'mistral',
                label: 'Mistral',
                baseUrl: 'https://api.mistral.ai/v1',
                asrModell: 'voxtral-mini-latest',
                chatModell: 'mistral-small-latest'
              },
              {
                id: 'openai',
                vorlage: 'openai',
                label: 'OpenAI',
                baseUrl: 'https://api.openai.com/v1',
                asrModell: 'gpt-4o-mini-transcribe',
                chatModell: 'gpt-4o-mini'
              }
            ],
            workflows: [
              {
                id: 'calm',
                label: 'Blitztext $%&!',
                builtin: true,
                rewrites: true,
                promptModus: 'berechnet',
                model: 'gpt-4o',
                temperature: 0.4,
                anbieterId: 'openai'
              }
            ]
          })
        )
      })
      const loaded = await store.load()
      const calm = loaded.workflows.find((w) => w.id === 'calm')
      // Trotz Standard-Anbieter 'mistral' bleibt der EXPLIZIT gespeicherte 'openai' auf diesem
      // Built-in erhalten — genau die Konfiguration, die vor dieser Änderung geschrieben wurde.
      expect(calm?.anbieterId).toBe('openai')
    })

    it('fehlt das Feld UND kein Built-in ist gepinnt (frische Installation) → true', async () => {
      const loaded = await createSettingsStore({ file: fakeFile(JSON.stringify({})) }).load()
      expect(loaded.builtinAnbieterHinweisAbgeschlossen).toBe(true)
    })

    it('fehlt das Feld, aber mindestens ein Built-in trägt noch einen gepinnten anbieterId → false (Hinweis steht aus)', async () => {
      const loaded = await createSettingsStore({
        file: fakeFile(
          JSON.stringify({
            workflows: [
              {
                id: 'improve',
                label: 'Blitztext+',
                builtin: true,
                rewrites: true,
                promptModus: 'berechnet',
                model: 'gpt-4o-mini',
                temperature: 0.3,
                anbieterId: 'openai'
              }
            ]
          })
        )
      }).load()
      expect(loaded.builtinAnbieterHinweisAbgeschlossen).toBe(false)
    })

    // Review-Befund v0.8.0: Die Heuristik prüfte zunächst auf „irgendein anbieterId" und hätte damit
    // auch eine BEWUSSTE Nutzer-Zuweisung als Altbestand gewertet. Nur 'openai' war je der
    // Werks-Startwert — wer einem Built-in selbst Mistral zugewiesen hat, braucht keinen Hinweis, dass
    // Built-ins den Standard-Anbieter erben können.
    it('bewusst zugewiesener Fremd-Anbieter auf einem Built-in gilt NICHT als Altbestand', async () => {
      const loaded = await createSettingsStore({
        file: fakeFile(
          JSON.stringify({
            workflows: [
              {
                id: 'improve',
                label: 'Blitztext+',
                builtin: true,
                rewrites: true,
                promptModus: 'berechnet',
                model: 'gpt-4o-mini',
                temperature: 0.3,
                anbieterId: 'mistral'
              }
            ]
          })
        )
      }).load()
      expect(loaded.builtinAnbieterHinweisAbgeschlossen).toBe(true)
    })

    it('explizit gesetztes false bleibt false, auch ohne gepinnte Built-ins (respektiert den expliziten Wert)', async () => {
      const loaded = await createSettingsStore({
        file: fakeFile(JSON.stringify({ builtinAnbieterHinweisAbgeschlossen: false }))
      }).load()
      expect(loaded.builtinAnbieterHinweisAbgeschlossen).toBe(false)
    })

    it('explizit gesetztes true bleibt true, auch mit gepinntem Built-in', async () => {
      const loaded = await createSettingsStore({
        file: fakeFile(
          JSON.stringify({
            builtinAnbieterHinweisAbgeschlossen: true,
            workflows: [
              {
                id: 'improve',
                label: 'Blitztext+',
                builtin: true,
                rewrites: true,
                promptModus: 'berechnet',
                model: 'gpt-4o-mini',
                temperature: 0.3,
                anbieterId: 'openai'
              }
            ]
          })
        )
      }).load()
      expect(loaded.builtinAnbieterHinweisAbgeschlossen).toBe(true)
    })

    it('defaultSettings(): frische Installation braucht keinen Hinweis (true)', () => {
      expect(defaultSettings().builtinAnbieterHinweisAbgeschlossen).toBe(true)
    })

    it('ein gepinnter EIGENER (nicht-builtin) Workflow löst KEINEN Hinweis aus (nur Built-ins zählen)', async () => {
      const loaded = await createSettingsStore({
        file: fakeFile(
          JSON.stringify({
            workflows: [
              {
                id: 'mein-flow',
                label: 'Mein Flow',
                builtin: false,
                rewrites: true,
                promptModus: 'statisch',
                systemPrompt: 'X',
                anbieterId: 'openai'
              }
            ]
          })
        )
      }).load()
      expect(loaded.builtinAnbieterHinweisAbgeschlossen).toBe(true)
    })
  })

  // v0.8.0: Laufzeit-Profile (src/shared/laufzeit-profile.ts) — neun Felder, ausschließlich über
  // geschlossene Stufenlisten konfigurierbar (Fünfer-Muster je Feld: Round-Trip bereits oben über den
  // großen Round-Trip-Test erledigt; hier zusätzlich Alt-Datei→Default, Übernahme+Round-Trip,
  // typfremder Wert→Default, defaultSettings()-Inhalt; Zahlenfelder zusätzlich: Wert außerhalb der
  // Stufenliste→Default). Bestandsschutz ist hier die Kern-Eigenschaft: jeder Default ist exakt der
  // heute hart kodierte Wert (siehe laufzeit-profile.ts-Kommentare für die Herleitung).
  describe('Laufzeit-Profile (v0.8.0)', () => {
    it('defaultSettings() enthält alle neun Felder mit den dokumentierten Defaults', () => {
      const d = defaultSettings()
      expect(d.mindestAufnahmeSekunden).toBe(MINDEST_AUFNAHME_SEKUNDEN_DEFAULT)
      expect(d.stilleProfil).toBe(STILLE_PROFIL_DEFAULT)
      expect(d.netzwerkProfil).toBe(NETZWERK_PROFIL_DEFAULT)
      expect(d.retryVersuche).toBe(RETRY_VERSUCHE_DEFAULT)
      expect(d.verlaufMaximum).toBe(VERLAUF_MAXIMUM_DEFAULT)
      expect(d.statistikKompaktierungTage).toBe(STATISTIK_KOMPAKTIERUNG_TAGE_DEFAULT)
      expect(d.updateIntervallStunden).toBe(UPDATE_INTERVALL_STUNDEN_DEFAULT)
      expect(d.pillenAnzeigedauerProfil).toBe(PILLEN_ANZEIGEDAUER_PROFIL_DEFAULT)
      expect(d.perfAktiv).toBe(PERF_AKTIV_DEFAULT)
    })

    it('alte Datei ohne diese Felder ⇒ alle neun fallen auf ihre Defaults zurück (Bestandsschutz)', async () => {
      const store = createSettingsStore({
        file: fakeFile(JSON.stringify({ language: 'de' }))
      })
      const loaded = await store.load()
      expect(loaded.mindestAufnahmeSekunden).toBe(MINDEST_AUFNAHME_SEKUNDEN_DEFAULT)
      expect(loaded.stilleProfil).toBe(STILLE_PROFIL_DEFAULT)
      expect(loaded.netzwerkProfil).toBe(NETZWERK_PROFIL_DEFAULT)
      expect(loaded.retryVersuche).toBe(RETRY_VERSUCHE_DEFAULT)
      expect(loaded.verlaufMaximum).toBe(VERLAUF_MAXIMUM_DEFAULT)
      expect(loaded.statistikKompaktierungTage).toBe(STATISTIK_KOMPAKTIERUNG_TAGE_DEFAULT)
      expect(loaded.updateIntervallStunden).toBe(UPDATE_INTERVALL_STUNDEN_DEFAULT)
      expect(loaded.pillenAnzeigedauerProfil).toBe(PILLEN_ANZEIGEDAUER_PROFIL_DEFAULT)
      expect(loaded.perfAktiv).toBe(PERF_AKTIV_DEFAULT)
    })

    it('gültige, von den Defaults abweichende Werte werden übernommen und round-trippen', async () => {
      const store = createSettingsStore({
        file: fakeFile(
          JSON.stringify({
            mindestAufnahmeSekunden: 1.0,
            stilleProfil: 'vorsichtig',
            netzwerkProfil: 'kurz',
            retryVersuche: 1,
            verlaufMaximum: 1000,
            statistikKompaktierungTage: 365,
            updateIntervallStunden: 168,
            pillenAnzeigedauerProfil: 'lang',
            perfAktiv: true
          })
        )
      })
      const loaded = await store.load()
      expect(loaded.mindestAufnahmeSekunden).toBe(1.0)
      expect(loaded.stilleProfil).toBe('vorsichtig')
      expect(loaded.netzwerkProfil).toBe('kurz')
      expect(loaded.retryVersuche).toBe(1)
      expect(loaded.verlaufMaximum).toBe(1000)
      expect(loaded.statistikKompaktierungTage).toBe(365)
      expect(loaded.updateIntervallStunden).toBe(168)
      expect(loaded.pillenAnzeigedauerProfil).toBe('lang')
      expect(loaded.perfAktiv).toBe(true)

      await store.save(loaded)
      const nochmal = await store.load()
      expect(nochmal.mindestAufnahmeSekunden).toBe(1.0)
      expect(nochmal.stilleProfil).toBe('vorsichtig')
      expect(nochmal.netzwerkProfil).toBe('kurz')
      expect(nochmal.retryVersuche).toBe(1)
      expect(nochmal.verlaufMaximum).toBe(1000)
      expect(nochmal.statistikKompaktierungTage).toBe(365)
      expect(nochmal.updateIntervallStunden).toBe(168)
      expect(nochmal.pillenAnzeigedauerProfil).toBe('lang')
      expect(nochmal.perfAktiv).toBe(true)
    })

    it('typfremde Werte fallen auf die Defaults zurück (kein Absturz)', async () => {
      const store = createSettingsStore({
        file: fakeFile(
          JSON.stringify({
            mindestAufnahmeSekunden: '0.3',
            stilleProfil: 5,
            netzwerkProfil: true,
            retryVersuche: '2',
            verlaufMaximum: null,
            statistikKompaktierungTage: {},
            updateIntervallStunden: [24],
            pillenAnzeigedauerProfil: 3,
            perfAktiv: 'ja'
          })
        )
      })
      const loaded = await store.load()
      expect(loaded.mindestAufnahmeSekunden).toBe(MINDEST_AUFNAHME_SEKUNDEN_DEFAULT)
      expect(loaded.stilleProfil).toBe(STILLE_PROFIL_DEFAULT)
      expect(loaded.netzwerkProfil).toBe(NETZWERK_PROFIL_DEFAULT)
      expect(loaded.retryVersuche).toBe(RETRY_VERSUCHE_DEFAULT)
      expect(loaded.verlaufMaximum).toBe(VERLAUF_MAXIMUM_DEFAULT)
      expect(loaded.statistikKompaktierungTage).toBe(STATISTIK_KOMPAKTIERUNG_TAGE_DEFAULT)
      expect(loaded.updateIntervallStunden).toBe(UPDATE_INTERVALL_STUNDEN_DEFAULT)
      expect(loaded.pillenAnzeigedauerProfil).toBe(PILLEN_ANZEIGEDAUER_PROFIL_DEFAULT)
      expect(loaded.perfAktiv).toBe(false) // nur === true zählt (Muster wie autostart etc.)
    })

    it('unbekannte Enum-Werte (nicht Teil der Stufenliste) fallen auf die Defaults zurück', async () => {
      const store = createSettingsStore({
        file: fakeFile(
          JSON.stringify({
            stilleProfil: 'extrem',
            netzwerkProfil: 'sehr-lang',
            pillenAnzeigedauerProfil: 'ewig'
          })
        )
      })
      const loaded = await store.load()
      expect(loaded.stilleProfil).toBe(STILLE_PROFIL_DEFAULT)
      expect(loaded.netzwerkProfil).toBe(NETZWERK_PROFIL_DEFAULT)
      expect(loaded.pillenAnzeigedauerProfil).toBe(PILLEN_ANZEIGEDAUER_PROFIL_DEFAULT)
    })

    // Zahlenfelder: ein Wert außerhalb der geschlossenen Stufenliste fällt auf den Default zurück —
    // auch wenn der Wert selbst eine gültige Zahl ist (z. B. 0.4 ist keine mindestAufnahmeSekunden-Stufe).
    it('Zahlenfelder: ein Wert außerhalb der Stufenliste fällt auf den Default zurück', async () => {
      const store = createSettingsStore({
        file: fakeFile(
          JSON.stringify({
            mindestAufnahmeSekunden: 0.4, // gültige Zahl, aber keine Stufe
            retryVersuche: 5,
            verlaufMaximum: 150,
            statistikKompaktierungTage: 45,
            updateIntervallStunden: 48
          })
        )
      })
      const loaded = await store.load()
      expect(loaded.mindestAufnahmeSekunden).toBe(MINDEST_AUFNAHME_SEKUNDEN_DEFAULT)
      expect(loaded.retryVersuche).toBe(RETRY_VERSUCHE_DEFAULT)
      expect(loaded.verlaufMaximum).toBe(VERLAUF_MAXIMUM_DEFAULT)
      expect(loaded.statistikKompaktierungTage).toBe(STATISTIK_KOMPAKTIERUNG_TAGE_DEFAULT)
      expect(loaded.updateIntervallStunden).toBe(UPDATE_INTERVALL_STUNDEN_DEFAULT)
    })
  })

  // A2 (Lost-Update-Schutz) + A7 (Cache): store.ts:mutate() serialisiert load()→fn()→save() als EINE
  // Transaktion (Muster history-store.ts/A1); load() cacht den zuletzt geparsten Stand statt bei jedem
  // Aufruf die Datei neu zu lesen.
  describe('mutate() (A2): serialisierte load()→fn()→save()-Transaktion', () => {
    // Fake-Port mit steuerbarer Verzögerung: der ERSTE write() hängt an einem extern auflösbaren Gate
    // fest (kein setTimeout-Raten) — so lässt sich beweisen, dass ein zweiter, „überlappend" gestarteter
    // mutate()-Aufruf tatsächlich wartet, statt mit einem veralteten Stand loszulaufen.
    function fakeFileMitGate(initial: string | null) {
      let content = initial
      let schreibvorgaenge = 0
      let freigeben: (() => void) | null = null
      const wartet = new Promise<void>((resolve) => {
        freigeben = resolve
      })
      return {
        file: {
          async read() {
            return content
          },
          async write(next: string) {
            schreibvorgaenge++
            if (schreibvorgaenge === 1) await wartet // nur der ERSTE Schreibvorgang hängt fest
            content = next
          }
        } satisfies SettingsFile,
        freigeben: () => freigeben?.(),
        get schreibvorgaenge() {
          return schreibvorgaenge
        }
      }
    }

    it('zwei überlappende mutate()-Aufrufe setzen zwei verschiedene Felder → der Endstand trägt BEIDE (kein Lost-Update)', async () => {
      const f = fakeFileMitGate(JSON.stringify(defaultSettings()))
      const store = createSettingsStore({ file: f.file })

      // „Überlappend" gestartet: beide Aufrufe laufen an, BEVOR der erste Schreibvorgang aufgelöst wird.
      const p1 = store.mutate((aktuell) => ({ ...aktuell, language: 'en' }))
      const p2 = store.mutate((aktuell) => ({ ...aktuell, tone: 'formal' as const }))
      f.freigeben() // löst den festhängenden ERSTEN write() — erst danach kann die Kette weiterlaufen

      const [, r2] = await Promise.all([p1, p2])

      // r2 ist der Endstand nach BEIDEN Transaktionen (der zweite mutate()-Aufruf hat auf den ERSTEN
      // aufgesetzt, weil load()→fn()→save() serialisiert ist) — trägt also beide Felder.
      expect(r2.language).toBe('en')
      expect(r2.tone).toBe('formal')
      expect((await store.load()).language).toBe('en')
      expect((await store.load()).tone).toBe('formal')
      expect(f.schreibvorgaenge).toBe(2) // zwei echte, nacheinander abgeschlossene Schreibvorgänge
    })

    it('ein Fehler in fn() vergiftet die Kette nicht — der nächste mutate()-Aufruf läuft normal weiter', async () => {
      const store = createSettingsStore({ file: fakeFile() })

      await expect(
        store.mutate(() => {
          throw new Error('absichtlich kaputt')
        })
      ).rejects.toThrow('absichtlich kaputt')

      const ergebnis = await store.mutate((aktuell) => ({ ...aktuell, language: 'fr' }))
      expect(ergebnis.language).toBe('fr')
      expect((await store.load()).language).toBe('fr')
    })

    it('mutate() liefert den TATSÄCHLICH geschriebenen (voll geparsten) Stand zurück', async () => {
      const store = createSettingsStore({ file: fakeFile() })
      const ergebnis = await store.mutate((aktuell) => ({
        ...aktuell,
        customTerms: ['Acme', '', 'acme'] // unnormalisiert — save() normalisiert zweitverteidigt
      }))
      expect(ergebnis.customTerms).toEqual(['Acme'])
    })
  })

  describe('load()-Cache (A7): kein Disk-Read bei jedem Aufruf', () => {
    function fakeFileMitZaehler(initial: string | null) {
      let content = initial
      let liest = 0
      return {
        file: {
          async read() {
            liest++
            return content
          },
          async write(next: string) {
            content = next
          }
        } satisfies SettingsFile,
        get liest() {
          return liest
        }
      }
    }

    it('zweiter load()-Aufruf löst KEIN zweites file.read() aus', async () => {
      const f = fakeFileMitZaehler(JSON.stringify({ language: 'en' }))
      const store = createSettingsStore({ file: f.file })

      await store.load()
      await store.load()

      expect(f.liest).toBe(1)
    })

    it('nach save() liefert der nächste load() den NEUEN Stand — kein veralteter Cache', async () => {
      const f = fakeFileMitZaehler(JSON.stringify({ language: 'de' }))
      const store = createSettingsStore({ file: f.file })

      expect((await store.load()).language).toBe('de') // Cache füllen
      await store.save({ ...defaultSettings(), language: 'en' })

      expect((await store.load()).language).toBe('en')
    })

    it('nach mutate() liefert der nächste load() den NEUEN Stand — kein veralteter Cache', async () => {
      const f = fakeFileMitZaehler(JSON.stringify({ language: 'de' }))
      const store = createSettingsStore({ file: f.file })

      expect((await store.load()).language).toBe('de') // Cache füllen
      await store.mutate((aktuell) => ({ ...aktuell, tone: 'formal' as const }))

      expect((await store.load()).tone).toBe('formal')
    })

    it('Korruptions-Pfad: der Cache hält die Defaults, bis ein echter Schreibvorgang sie ersetzt (kein Endlos-Beiseitelegen)', async () => {
      let beiseiteGelegt = 0
      let content: string | null = 'kaputtes json'
      const file: SettingsFile = {
        async read() {
          return content
        },
        async write(next) {
          content = next
        },
        async beiseiteLegen() {
          beiseiteGelegt++
          content = null
        }
      }
      let callbacks = 0
      const store = createSettingsStore({ file, aufKorruption: () => callbacks++ })

      await store.load()
      await store.load() // aus dem Cache — KEIN zweiter Rettungsversuch, KEIN zweiter Callback

      expect(beiseiteGelegt).toBe(1)
      expect(callbacks).toBe(1)

      // Ein späterer echter Schreibvorgang (z. B. der Nutzer speichert nach der Störfall-Meldung erneut)
      // ersetzt den Cache normal — die „Rettung" bleibt sichtbar, sobald geschrieben wird.
      const gerettet = await store.mutate((aktuell) => ({ ...aktuell, language: 'en' }))
      expect(gerettet.language).toBe('en')
      expect((await store.load()).language).toBe('en')
    })
  })
})
