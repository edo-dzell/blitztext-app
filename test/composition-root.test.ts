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
})
