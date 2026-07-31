import { describe, it, expect, vi } from 'vitest'
import { routeDispatch, createMainComposition } from '@main/composition-root'

function fakeSitzung() {
  return {
    starteWorkflow: vi.fn(async () => {}),
    stoppe: vi.fn(async () => {}),
    brichAb: vi.fn(() => {})
  }
}

describe('routeDispatch', () => {
  it('start → starteWorkflow(workflow, "hotkey")', () => {
    const s = fakeSitzung()
    routeDispatch({ aktion: 'start', workflow: 'improve' }, s)
    expect(s.starteWorkflow).toHaveBeenCalledWith('improve', 'hotkey')
  })

  it('stop → stoppe()', () => {
    const s = fakeSitzung()
    routeDispatch({ aktion: 'stop', workflow: 'improve' }, s)
    expect(s.stoppe).toHaveBeenCalledOnce()
  })

  it('cancel → brichAb()', () => {
    const s = fakeSitzung()
    routeDispatch({ aktion: 'cancel', workflow: 'improve' }, s)
    expect(s.brichAb).toHaveBeenCalledOnce()
  })

  it('null (kein Treffer) → keine Aktion', () => {
    const s = fakeSitzung()
    routeDispatch(null, s)
    expect(s.starteWorkflow).not.toHaveBeenCalled()
    expect(s.stoppe).not.toHaveBeenCalled()
    expect(s.brichAb).not.toHaveBeenCalled()
  })
})

describe('createMainComposition', () => {
  it('verdrahtet Sitzung + verarbeiteTaste aus den injizierten nativen Ports', async () => {
    const comp = await createMainComposition({
      recorder: {
        start: vi.fn(),
        stop: vi.fn(async () => ({ audio: new Blob(), durationSeconds: 0 })),
        discard: vi.fn()
      },
      ausgabe: {
        einfügen: vi.fn(),
        anzeigen: vi.fn(),
        zeigeEinstellungen: vi.fn(),
        melde: vi.fn(),
        inZwischenablage: vi.fn(),
        erfasseFenster: vi.fn(async () => null)
      },
      apiKeys: { has: async () => false, get: async () => null, set: async () => {}, clear: async () => {}, maske: async () => null },
      settingsFile: { read: async () => null, write: async () => {} },
      verlaufCipher: {
        isEncryptionAvailable: () => true,
        async encrypt(s) {
          return new TextEncoder().encode(s)
        },
        async decrypt(d) {
          return new TextDecoder().decode(d)
        }
      },
      verlaufFile: { read: async () => null, write: async () => {}, remove: async () => {} },
      statsFile: { read: async () => null, write: async () => {} },
      jetzt: () => 1,
      neueId: () => 'id'
    })

    expect(typeof comp.verarbeiteTaste).toBe('function')
    expect(typeof comp.sitzung.starteWorkflow).toBe('function')
    expect(typeof comp.aktualisiere).toBe('function')
    expect(typeof comp.assistiere).toBe('function')
    expect(comp.aktuelleBaseUrl()).toBe('https://api.openai.com/v1')
    // #03: Abbruch-Naht nach außen (für den Tray-Eintrag).
    expect(typeof comp.brichAb).toBe('function')
    expect(comp.beschaeftigt()).toBe(false)
    // F1 (W3-B): Retry-Naht nach außen (Tray-Eintrag/Notification-Button); ohne Lauf kein Retry möglich.
    expect(typeof comp.erneutVersuchen).toBe('function')
    expect(comp.kannErneutVersuchen()).toBe(false)
  })

  // v0.8.0: Beide Recorder-Rückkanäle MÜSSEN hier verdrahtet werden — sie sind reine Verdrahtung ohne
  // eigene Logik und fielen deshalb bisher durch jedes Testraster. Genau das ist einmal passiert: der
  // Bestätigungs-Kanal (Befund 9) wurde gebaut, aber nicht verbunden; die Pille wäre dann für die
  // GESAMTE Aufnahme auf „Starte …" stehen geblieben — schlechter als der Zustand davor. Dieser Test
  // ist der Wächter dagegen: verschwindet eine der beiden Zeilen aus der composition-root, fällt er.
  it('verdrahtet beide Recorder-Rückkanäle (Fehler UND Aufnahme-Bestätigung)', async () => {
    const onFehler = vi.fn()
    const onGestartet = vi.fn()
    await createMainComposition({
      recorder: {
        start: vi.fn(),
        stop: vi.fn(async () => ({ audio: new Blob(), durationSeconds: 0 })),
        discard: vi.fn(),
        onFehler,
        onGestartet
      },
      ausgabe: {
        einfügen: vi.fn(),
        anzeigen: vi.fn(),
        zeigeEinstellungen: vi.fn(),
        melde: vi.fn(),
        inZwischenablage: vi.fn(),
        erfasseFenster: vi.fn(async () => null)
      },
      apiKeys: { has: async () => false, get: async () => null, set: async () => {}, clear: async () => {}, maske: async () => null },
      settingsFile: { read: async () => null, write: async () => {} },
      verlaufCipher: {
        isEncryptionAvailable: () => true,
        async encrypt(s) {
          return new TextEncoder().encode(s)
        },
        async decrypt(d) {
          return new TextDecoder().decode(d)
        }
      },
      verlaufFile: { read: async () => null, write: async () => {}, remove: async () => {} },
      statsFile: { read: async () => null, write: async () => {} },
      jetzt: () => 1,
      neueId: () => 'id'
    })

    expect(onFehler).toHaveBeenCalledOnce()
    expect(onGestartet).toHaveBeenCalledOnce()
    // Die registrierten Rückrufe müssen aufrufbar sein, ohne zu werfen — sie laufen im Renderer-Ereignis
    // und dürfen den Main-Prozess unter keinen Umständen mitreißen (prozessweiter Wächter → app.exit).
    expect(() => onGestartet.mock.calls[0]?.[0](7)).not.toThrow()
    expect(() => onFehler.mock.calls[0]?.[0]('Mikrofon getrennt')).not.toThrow()
    // Der Lauf-Bezug MUSS weitergereicht werden. Ein `() => runner.meldeAufnahmeBestaetigt()` ohne
    // Parameter würde ebenso registrieren, typechecken und die Prüfungen oben bestehen — und dabei
    // still den Schutz gegen verspätete Bestätigungen aus abgebrochenen Läufen aushebeln. Da der
    // Runner hier nicht injizierbar ist, prüfen wir die Stelligkeit des Rückrufs: sie ist das einzige
    // von außen beobachtbare Merkmal dafür, dass das Argument überhaupt angenommen wird.
    expect(onGestartet.mock.calls[0]?.[0]).toHaveLength(1)
  })

  it('verschiebt aktualisiere während eines aktiven Laufs und übernimmt es nach Lauf-Ende', async () => {
    const comp = await createMainComposition({
      recorder: {
        start: vi.fn(),
        // Dauer 0 → Kurzaufnahme-Guard greift, kein Netzaufruf, Lauf endet sofort.
        stop: vi.fn(async () => ({ audio: new Blob(), durationSeconds: 0 })),
        discard: vi.fn()
      },
      ausgabe: {
        einfügen: vi.fn(),
        anzeigen: vi.fn(),
        zeigeEinstellungen: vi.fn(),
        melde: vi.fn(),
        inZwischenablage: vi.fn(),
        erfasseFenster: vi.fn(async () => null)
      },
      apiKeys: { has: async () => true, get: async () => 'sk', set: async () => {}, clear: async () => {}, maske: async () => null },
      settingsFile: { read: async () => null, write: async () => {} },
      verlaufCipher: {
        isEncryptionAvailable: () => true,
        async encrypt(s) {
          return new TextEncoder().encode(s)
        },
        async decrypt(d) {
          return new TextDecoder().decode(d)
        }
      },
      verlaufFile: { read: async () => null, write: async () => {}, remove: async () => {} },
      statsFile: { read: async () => null, write: async () => {} },
      jetzt: () => 1,
      neueId: () => 'id'
    })

    await comp.sitzung.starteWorkflow('transcribe', 'hotkey')
    expect(comp.sitzung.beschaeftigt()).toBe(true)

    const next = await comp.einstellungen.load()
    next.anbieter = [{ ...next.anbieter[0]!, baseUrl: 'https://api.groq.com/openai/v1' }]
    // Während des Laufs: verschoben, Base-URL NICHT gewechselt.
    expect(comp.aktualisiere(next)).toBe(false)
    expect(comp.aktuelleBaseUrl()).toBe('https://api.openai.com/v1')

    await comp.sitzung.stoppe()
    expect(comp.sitzung.beschaeftigt()).toBe(false)
    // Nach Lauf-Ende übernehmen.
    comp.wendeAusstehendeAn()
    expect(comp.aktuelleBaseUrl()).toBe('https://api.groq.com/openai/v1')
  })

  it('setzeTastenZurueck() heilt hängende Hotkey-Tasten (verlorenes Win-Keyup)', async () => {
    const recorder = {
      start: vi.fn(),
      stop: vi.fn(async () => ({ audio: new Blob(), durationSeconds: 0 })),
      discard: vi.fn()
    }
    const comp = await createMainComposition({
      recorder,
      ausgabe: {
        einfügen: vi.fn(),
        anzeigen: vi.fn(),
        zeigeEinstellungen: vi.fn(),
        melde: vi.fn(),
        inZwischenablage: vi.fn(),
        erfasseFenster: vi.fn(async () => null)
      },
      apiKeys: { has: async () => true, get: async () => 'sk', set: async () => {}, clear: async () => {}, maske: async () => null },
      settingsFile: { read: async () => null, write: async () => {} },
      verlaufCipher: {
        isEncryptionAvailable: () => true,
        async encrypt(s) {
          return new TextEncoder().encode(s)
        },
        async decrypt(d) {
          return new TextDecoder().decode(d)
        }
      },
      verlaufFile: { read: async () => null, write: async () => {}, remove: async () => {} },
      statsFile: { read: async () => null, write: async () => {} },
      jetzt: () => 1,
      neueId: () => 'id'
    })

    // Win-Down ohne Up (z. B. Win+L) → ohne Reset startete LinksStrg allein die Aufnahme.
    comp.verarbeiteTaste({ type: 'down', key: 'MetaLeft' })
    comp.setzeTastenZurueck()
    comp.verarbeiteTaste({ type: 'down', key: 'ControlLeft' })
    await new Promise((r) => setImmediate(r)) // starteWorkflow wäre fire-and-forget
    expect(recorder.start).not.toHaveBeenCalled()

    // Gegenprobe: der volle Chord startet nach dem Reset weiterhin.
    comp.verarbeiteTaste({ type: 'up', key: 'ControlLeft' })
    comp.verarbeiteTaste({ type: 'down', key: 'MetaLeft' })
    comp.verarbeiteTaste({ type: 'down', key: 'ControlLeft' })
    await vi.waitFor(() => expect(recorder.start).toHaveBeenCalled())
  })

  // --- v0.8.0: Laufzeit-Profile — die restlichen Verdrahtungen, die OHNE Mocking der Netz-/Runner-
  // Fabriken über die echte Komposition beweisbar sind (verlaufMaximum/statistikKompaktierungTage/
  // updateIntervallStunden/pillenAnzeigedauerProfil via `aktuelleEinstellungen()`). netzwerkProfil/
  // mindestAufnahmeSekunden/stilleProfil/retryVersuche stehen in
  // composition-root-laufzeit-profile.test.ts (dort mit Spionen auf den drei Netz-/Runner-Fabriken).

  function baseDeps() {
    return {
      recorder: {
        start: vi.fn(),
        stop: vi.fn(async () => ({ audio: new Blob(), durationSeconds: 0 })),
        discard: vi.fn()
      },
      ausgabe: {
        einfügen: vi.fn(),
        anzeigen: vi.fn(),
        zeigeEinstellungen: vi.fn(),
        melde: vi.fn(),
        inZwischenablage: vi.fn(),
        erfasseFenster: vi.fn(async () => null)
      },
      apiKeys: {
        has: async () => false,
        get: async () => null,
        set: async () => {},
        clear: async () => {},
        maske: async () => null
      },
      settingsFile: { read: async () => null, write: async () => {} },
      verlaufCipher: {
        isEncryptionAvailable: () => true,
        async encrypt(s: string) {
          return new TextEncoder().encode(s)
        },
        async decrypt(d: Uint8Array) {
          return new TextDecoder().decode(d)
        }
      },
      verlaufFile: { read: async () => null, write: async () => {}, remove: async () => {} },
      statsFile: { read: async () => null, write: async () => {} },
      jetzt: () => 1,
      neueId: () => 'id'
    }
  }

  it('aktuelleEinstellungen(): synchroner Getter liefert die lebende Settings-Kopie (kein Disk-I/O)', async () => {
    const comp = await createMainComposition(baseDeps())
    expect(comp.aktuelleEinstellungen().pillenAnzeigedauerProfil).toBe('normal') // Default

    const next = await comp.einstellungen.load()
    next.pillenAnzeigedauerProfil = 'kurz'
    expect(comp.aktualisiere(next)).toBe(true)

    // Sofort sichtbar, OHNE erneut await einstellungen.load() aufzurufen — das ist der Sinn des
    // synchronen Getters (index.ts' onStatus-Handler ruft ihn außerhalb der Closures auf).
    expect(comp.aktuelleEinstellungen().pillenAnzeigedauerProfil).toBe('kurz')
  })

  // Zustandsloser `verlaufFile`/`statsFile`-Fake aus baseDeps() (write() verwirft, read() liefert immer
  // null) reicht für die Live-Reconfigure-/Hotkey-Tests oben, aber NICHT für verlaufMaximum/
  // statistikKompaktierungTage — die brauchen einen ECHTEN Roundtrip über mehrere Aufrufe hinweg
  // (Muster wie `fakeFile()` in history-store.test.ts/stats-store.test.ts).
  function stateVerlaufFile(): { read(): Promise<Uint8Array | null>; write(d: Uint8Array): Promise<void>; remove(): Promise<void> } {
    let data: Uint8Array | null = null
    return {
      async read() {
        return data
      },
      async write(d) {
        data = d
      },
      async remove() {
        data = null
      }
    }
  }

  function stateStatsFile(): { read(): Promise<string | null>; write(c: string): Promise<void> } {
    let content: string | null = null
    return {
      async read() {
        return content
      },
      async write(c) {
        content = c
      }
    }
  }

  it('verlaufMaximum: ein abweichender Wert (1 statt Default 200) kappt den Verlauf beim Store, den composition-root verdrahtet hat', async () => {
    const comp = await createMainComposition({ ...baseDeps(), verlaufFile: stateVerlaufFile() })

    const next = await comp.einstellungen.load()
    next.verlaufMaximum = 1
    next.verlaufAktiv = true
    expect(comp.aktualisiere(next)).toBe(true)

    await comp.verlauf.aufzeichnen({
      id: 'a',
      zeitstempelMs: 1,
      workflowId: 'transcribe',
      workflowLabel: 'Blitztext',
      rohtext: 'r1',
      endtext: 'e1',
      dauerSekunden: 1
    })
    await comp.verlauf.aufzeichnen({
      id: 'b',
      zeitstempelMs: 2,
      workflowId: 'transcribe',
      workflowLabel: 'Blitztext',
      rohtext: 'r2',
      endtext: 'e2',
      dauerSekunden: 1
    })

    const liste = await comp.verlauf.liste()
    // Mit dem Default (200) blieben beide Einträge erhalten — der abweichende Wert (1) kommt an.
    expect(liste.map((e) => e.id)).toEqual(['b'])
  })

  it('statistikKompaktierungTage: ein abweichender Wert (30 statt Default 90) kompaktiert eine 45 Tage alte Zeile, die der Default noch tagesgenau ließe', async () => {
    const comp = await createMainComposition({ ...baseDeps(), statsFile: stateStatsFile() })

    const next = await comp.einstellungen.load()
    next.statistikKompaktierungTage = 30
    expect(comp.aktualisiere(next)).toBe(true)

    const T0 = Date.UTC(2026, 0, 1, 12, 0, 0)
    const T_SPAETER = T0 + 45 * 24 * 60 * 60 * 1000 // 45 Tage später
    await comp.stats.aufzeichnen({ workflowId: 'transcribe', audioSekunden: 1, asrModell: 'whisper-1' }, T0)

    const zusammenfassung = await comp.stats.zusammenfassung(T_SPAETER)
    // 45 Tage > 30 (konfiguriert) → auf 'YYYY-MM' kompaktiert. Mit dem Default (90) bliebe die Zeile
    // tagesgenau ('YYYY-MM-DD'), weil 45 < 90 — der abweichende Wert kommt beim Store an.
    expect(zusammenfassung.zeilen).toHaveLength(1)
    expect(zusammenfassung.zeilen[0]!.datum).toBe('2026-01')
  })

  it('updateIntervallStunden: ein kürzeres Intervall (6h) fragt erneut, wo der 24h-Default den Cache noch als frisch behandeln würde', async () => {
    const jetzt = Date.now()
    let fetchAufrufe = 0
    const updateHoler = {
      fetch: vi.fn(async () => {
        fetchAufrufe++
        return {
          status: 200,
          headers: { get: () => null },
          json: async () => ({ tag_name: 'v0.0.1', html_url: '' })
        }
      })
    }
    let cacheEintrag: {
      geprueftAmMs: number
      letztesErgebnis: { aktuelleVersion: string; neuVerfuegbar: boolean; url: string }
    } | null = {
      geprueftAmMs: jetzt - 7 * 60 * 60 * 1000, // vor 7 Stunden geprüft
      letztesErgebnis: { aktuelleVersion: '0.0.0', neuVerfuegbar: false, url: '' }
    }
    const updateCache = {
      lesen: async () => cacheEintrag,
      schreiben: async (e: typeof cacheEintrag) => {
        cacheEintrag = e
      }
    }

    const comp = await createMainComposition({
      ...baseDeps(),
      updateHoler,
      updateCache,
      appVersion: '0.0.0'
    })

    const next = await comp.einstellungen.load()
    next.updateIntervallStunden = 6
    next.updateHinweisAktiv = true
    expect(comp.aktualisiere(next)).toBe(true)

    await comp.pruefeUpdate()

    // 7h seit der letzten Prüfung > 6h (konfiguriert) → erneut gefragt. Mit dem 24h-Default wäre der
    // Cache noch frisch gewesen (kein Aufruf) — der abweichende Wert kommt bei pruefeAufUpdate an.
    expect(fetchAufrufe).toBe(1)
  })
})
