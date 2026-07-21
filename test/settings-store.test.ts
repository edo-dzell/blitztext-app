import { describe, it, expect } from 'vitest'
import { createSettingsStore, defaultSettings, type SettingsFile } from '@main/settings/store'

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
})
