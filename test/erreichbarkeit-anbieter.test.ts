import { describe, it, expect, vi } from 'vitest'
import {
  createMainComposition,
  loeseAnbieterFuerErreichbarkeit,
  type CompositionDeps
} from '@main/composition-root'
import type { ErreichbarkeitsPort } from '@main/health'
import type { AnbieterKonfig } from '@shared/anbieter'
import { defaultSettings, type BlitztextSettings } from '@main/settings/store'

// S4 (lokales ASR „Server prüfen"): Erreichbarkeits-Check für EINEN bestimmten Anbieter (per id),
// unabhängig vom Standard-Anbieter. Zwei Ebenen:
//  - die reine Auflösung (anbieterId → {label,baseUrl} | null) ohne jeden Seiteneffekt
//  - die Verdrahtung in createMainComposition (pruefeErreichbarkeitFuer), mit einem Fake-Holer

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

const LOKALER_ANBIETER: AnbieterKonfig = {
  id: 'mein-lokaler',
  vorlage: 'lokal',
  label: 'Mein lokaler Server',
  baseUrl: 'http://localhost:8000/v1',
  asrModell: 'Systran/faster-whisper-small',
  chatModell: '',
  keinKeyNoetig: true
}

function settingsMitAnbieter(anbieter: AnbieterKonfig[], standardAnbieterId: string): BlitztextSettings {
  return { ...defaultSettings(), anbieter, standardAnbieterId }
}

describe('loeseAnbieterFuerErreichbarkeit (reine Auflösung)', () => {
  it('findet einen vorhandenen Anbieter per id → {label, baseUrl}', () => {
    const ergebnis = loeseAnbieterFuerErreichbarkeit([LOKALER_ANBIETER], 'mein-lokaler')
    expect(ergebnis).toEqual({ label: 'Mein lokaler Server', baseUrl: 'http://localhost:8000/v1' })
  })

  it('unbekannte id → null (kein Throw)', () => {
    expect(loeseAnbieterFuerErreichbarkeit([LOKALER_ANBIETER], 'unbekannt')).toBeNull()
  })

  it('leere Liste → null', () => {
    expect(loeseAnbieterFuerErreichbarkeit([], 'irgendwas')).toBeNull()
  })
})

describe('comp.pruefeErreichbarkeitFuer (Verdrahtung, Fake-Holer)', () => {
  it('erreichbarer Server → status ok', async () => {
    const erreichbarkeit: ErreichbarkeitsPort = { pingeAnbieter: async () => ({ erreichbar: true }) }
    const comp = await createMainComposition(
      basisDeps({
        erreichbarkeit,
        settingsFile: {
          read: async () =>
            JSON.stringify(settingsMitAnbieter([LOKALER_ANBIETER], 'mein-lokaler')),
          write: async () => {}
        }
      })
    )

    const ergebnis = await comp.pruefeErreichbarkeitFuer('mein-lokaler')
    expect(ergebnis.status).toBe('ok')
  })

  it('Server lehnt Autorisierung ab (401/403) → status fehler', async () => {
    const erreichbarkeit: ErreichbarkeitsPort = {
      pingeAnbieter: async () => ({ erreichbar: false, autorisierungAbgelehnt: true })
    }
    const comp = await createMainComposition(
      basisDeps({
        erreichbarkeit,
        settingsFile: {
          read: async () =>
            JSON.stringify(settingsMitAnbieter([LOKALER_ANBIETER], 'mein-lokaler')),
          write: async () => {}
        }
      })
    )

    const ergebnis = await comp.pruefeErreichbarkeitFuer('mein-lokaler')
    expect(ergebnis.status).toBe('fehler')
  })

  it('unbekannte anbieterId → definiertes Fehler-Ergebnis, kein Throw', async () => {
    const comp = await createMainComposition(
      basisDeps({
        settingsFile: {
          read: async () =>
            JSON.stringify(settingsMitAnbieter([LOKALER_ANBIETER], 'mein-lokaler')),
          write: async () => {}
        }
      })
    )

    await expect(comp.pruefeErreichbarkeitFuer('nicht-vorhanden')).resolves.toEqual({
      status: 'fehler',
      titel: 'Anbieter-Erreichbarkeit',
      detail: expect.any(String)
    })
  })

  it('Netzfehler (Port wirft) → status warnung, kein Absturz', async () => {
    const erreichbarkeit: ErreichbarkeitsPort = {
      pingeAnbieter: async () => {
        throw new Error('ECONNREFUSED')
      }
    }
    const comp = await createMainComposition(
      basisDeps({
        erreichbarkeit,
        settingsFile: {
          read: async () =>
            JSON.stringify(settingsMitAnbieter([LOKALER_ANBIETER], 'mein-lokaler')),
          write: async () => {}
        }
      })
    )

    const ergebnis = await comp.pruefeErreichbarkeitFuer('mein-lokaler')
    expect(ergebnis.status).toBe('warnung')
  })
})
