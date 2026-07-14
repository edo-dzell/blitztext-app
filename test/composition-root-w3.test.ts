import { describe, it, expect, vi } from 'vitest'
import { createMainComposition, type CompositionDeps } from '@main/composition-root'
import type { Autostart, AutostartStatus } from '@main/autostart'
import type { Holer, UpdateCacheSpeicher } from '@main/update/update-hinweis'
import type { ErreichbarkeitsPort } from '@main/health'
import { defaultSettings, type BlitztextSettings } from '@main/settings/store'

// Verdrahtungstests der Staffel 3.2 (W3-κ): Autostart-Kopplung an Settings-Save, Hotkey-Hook-Status,
// Selbstdiagnose-Zubringer, Opt-in-Update. Reine Logik/gemockt; die realen OS-/Netz-Adapter sind HITL.

function basisDeps(overrides: Partial<CompositionDeps> = {}): CompositionDeps {
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
      has: async () => true,
      get: async () => 'sk',
      set: async () => {},
      clear: async () => {},
      maske: async () => null
    },
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
    neueId: () => 'id',
    ...overrides
  }
}

function fakeAutostart(): { autostart: Autostart; eintrag: { pfad: string | null } } {
  const zustand = { pfad: null as string | null }
  return {
    eintrag: zustand,
    autostart: {
      async autostartAn(exePfad) {
        zustand.pfad = exePfad
      },
      async autostartAus() {
        zustand.pfad = null
      },
      async istAutostartAktiv(exePfad): Promise<AutostartStatus> {
        if (zustand.pfad === null) return { zustand: 'inaktiv' }
        return zustand.pfad === exePfad
          ? { zustand: 'aktiv', pfad: exePfad }
          : { zustand: 'verwaist', hinterlegterPfad: zustand.pfad }
      }
    }
  }
}

const EXE = 'C:\\Apps\\Blitztext\\Blitztext.exe'

async function settingsMit(patch: Partial<BlitztextSettings>): Promise<BlitztextSettings> {
  return { ...defaultSettings(), ...patch }
}

describe('W3-γ: Autostart-Kopplung an Settings-Save', () => {
  it('autostart=true beim Speichern ⇒ setzt den Registry-Eintrag auf den exePfad', async () => {
    const { autostart, eintrag } = fakeAutostart()
    const comp = await createMainComposition(basisDeps({ autostart, exePfad: EXE }))

    comp.aktualisiere(await settingsMit({ autostart: true }))
    await Promise.resolve() // koppleAutostart ist feuer-und-vergiss (nicht awaited)

    expect(eintrag.pfad).toBe(EXE)
    expect(await comp.autostartStatus()).toEqual({ zustand: 'aktiv', pfad: EXE })
  })

  it('autostart=false ⇒ entfernt den Eintrag wieder', async () => {
    const { autostart, eintrag } = fakeAutostart()
    const comp = await createMainComposition(basisDeps({ autostart, exePfad: EXE }))

    comp.aktualisiere(await settingsMit({ autostart: true }))
    await Promise.resolve()
    comp.aktualisiere(await settingsMit({ autostart: false }))
    await Promise.resolve()

    expect(eintrag.pfad).toBeNull()
    expect(await comp.autostartStatus()).toEqual({ zustand: 'inaktiv' })
  })

  it('unveränderter autostart-Wert ⇒ kein erneuter Registry-Schreibvorgang', async () => {
    const { autostart } = fakeAutostart()
    const anSpy = vi.spyOn(autostart, 'autostartAn')
    const comp = await createMainComposition(basisDeps({ autostart, exePfad: EXE }))

    // language ändern, autostart bleibt Default (false) → keine Autostart-Kopplung
    comp.aktualisiere(await settingsMit({ language: 'en' }))
    await Promise.resolve()
    expect(anSpy).not.toHaveBeenCalled()
  })

  it('syncAutostartBeimStart gleicht den Eintrag an das gespeicherte Feld an (heilt verwaisten Pfad)', async () => {
    const { autostart, eintrag } = fakeAutostart()
    eintrag.pfad = 'C:\\Alt\\Blitztext.exe' // verwaister Eintrag einer verschobenen .exe
    const comp = await createMainComposition(
      basisDeps({
        autostart,
        exePfad: EXE,
        settingsFile: { read: async () => JSON.stringify({ autostart: true }), write: async () => {} }
      })
    )

    await comp.syncAutostartBeimStart()
    expect(eintrag.pfad).toBe(EXE) // auf den aktuellen Pfad geheilt
  })

  it('ohne Autostart-Port ⇒ Status inaktiv, kein Absturz', async () => {
    const comp = await createMainComposition(basisDeps())
    expect(await comp.autostartStatus()).toEqual({ zustand: 'inaktiv' })
  })
})

describe('W3-ε: Hotkey-Hook-Status + Selbstdiagnose', () => {
  it('setzeHotkeyHookAktiv fließt in den Hotkey-Check der Diagnose', async () => {
    const erreichbarkeit: ErreichbarkeitsPort = { pingeAnbieter: async () => ({ erreichbar: true }) }
    const comp = await createMainComposition(basisDeps({ erreichbarkeit }))

    comp.setzeHotkeyHookAktiv(false)
    let diag = await comp.diagnose(1)
    let hotkey = diag.checks.find((c) => c.titel === 'Hotkey-Erkennung')
    expect(hotkey?.status).toBe('fehler')

    comp.setzeHotkeyHookAktiv(true)
    diag = await comp.diagnose(1)
    hotkey = diag.checks.find((c) => c.titel === 'Hotkey-Erkennung')
    expect(hotkey?.status).toBe('ok')
  })

  it('mikrofonAnzahl aus dem Renderer fließt in den Mikrofon-Check (0 ⇒ fehler)', async () => {
    const erreichbarkeit: ErreichbarkeitsPort = { pingeAnbieter: async () => ({ erreichbar: true }) }
    const comp = await createMainComposition(basisDeps({ erreichbarkeit }))
    comp.setzeHotkeyHookAktiv(true)

    const diag0 = await comp.diagnose(0)
    expect(diag0.checks.find((c) => c.titel === 'Mikrofon')?.status).toBe('fehler')

    const diag2 = await comp.diagnose(2)
    expect(diag2.checks.find((c) => c.titel === 'Mikrofon')?.status).toBe('ok')
  })

  it('alle grün ⇒ Gesamtstatus ok (Key vorhanden, erreichbar, Mikrofon, Hotkey)', async () => {
    const erreichbarkeit: ErreichbarkeitsPort = { pingeAnbieter: async () => ({ erreichbar: true }) }
    const comp = await createMainComposition(basisDeps({ erreichbarkeit }))
    comp.setzeHotkeyHookAktiv(true)
    const diag = await comp.diagnose(1)
    expect(diag.gesamtstatus).toBe('ok')
    expect(diag.checks).toHaveLength(4)
  })

  it('ohne Erreichbarkeits-Port ⇒ Erreichbarkeits-Check meldet warnung (Port wirft)', async () => {
    const comp = await createMainComposition(basisDeps()) // kein erreichbarkeit-Port
    comp.setzeHotkeyHookAktiv(true)
    const diag = await comp.diagnose(1)
    expect(diag.checks.find((c) => c.titel === 'Anbieter-Erreichbarkeit')?.status).toBe('warnung')
  })
})

describe('W3-δ: Opt-in-Update-Prüfung', () => {
  function fakeHoler(status: number, body: unknown): Holer {
    return {
      fetch: vi.fn(async () => ({
        status,
        headers: { get: () => null },
        json: async () => body
      }))
    }
  }
  function fakeCache(): UpdateCacheSpeicher {
    let e: import('@main/update/update-hinweis').UpdateCacheEintrag | null = null
    return {
      async lesen() {
        return e
      },
      async schreiben(next) {
        e = next
      }
    }
  }

  it('updateHinweisAktiv=false ⇒ Holer wird NIE aufgerufen (Opt-in)', async () => {
    const holer = fakeHoler(200, { tag_name: 'v9.9.9', html_url: 'https://x' })
    const comp = await createMainComposition(
      basisDeps({
        updateHoler: holer,
        updateCache: fakeCache(),
        appVersion: '0.5.0',
        settingsFile: { read: async () => JSON.stringify({ updateHinweisAktiv: false }), write: async () => {} }
      })
    )
    const r = await comp.pruefeUpdate()
    expect(holer.fetch).not.toHaveBeenCalled()
    expect(r).toEqual({ aktuelleVersion: '0.5.0', neuVerfuegbar: false, url: '' })
  })

  it('updateHinweisAktiv=true + neueres Release ⇒ neuVerfuegbar true + url', async () => {
    const holer = fakeHoler(200, { tag_name: 'v0.6.0', html_url: 'https://x/rel' })
    const comp = await createMainComposition(
      basisDeps({
        updateHoler: holer,
        updateCache: fakeCache(),
        appVersion: '0.5.0',
        settingsFile: { read: async () => JSON.stringify({ updateHinweisAktiv: true }), write: async () => {} }
      })
    )
    const r = await comp.pruefeUpdate()
    expect(holer.fetch).toHaveBeenCalledTimes(1)
    expect(r.neuVerfuegbar).toBe(true)
    expect(r.url).toBe('https://x/rel')
  })

  it('ohne verdrahtete Update-Ports ⇒ still „kein Update"', async () => {
    const comp = await createMainComposition(basisDeps({ appVersion: '0.5.0' }))
    expect(await comp.pruefeUpdate()).toEqual({ aktuelleVersion: '0.5.0', neuVerfuegbar: false, url: '' })
  })
})
