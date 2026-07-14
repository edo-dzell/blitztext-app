import { describe, it, expect } from 'vitest'
import { fuehreDiagnose, type DiagnoseDeps } from '@main/health/diagnose'

function alleGruen(): DiagnoseDeps {
  return {
    apiKey: {
      apiKeys: { async has() { return true } },
      anbieter: { id: 'openai', label: 'OpenAI' }
    },
    erreichbarkeit: {
      holer: { async pingeAnbieter() { return { erreichbar: true } } },
      anbieter: { label: 'OpenAI', baseUrl: 'https://api.openai.com/v1' }
    },
    mikrofon: { geraete: { async anzahl() { return 1 } } },
    hotkeyHook: { hook: { async istAktiv() { return true } } }
  }
}

describe('fuehreDiagnose', () => {
  it('gesamtstatus ok, wenn alle Checks ok sind', async () => {
    const { gesamtstatus, checks } = await fuehreDiagnose(alleGruen())
    expect(gesamtstatus).toBe('ok')
    expect(checks).toHaveLength(4)
    expect(checks.every((c) => c.status === 'ok')).toBe(true)
  })

  it('gesamtstatus nimmt den schlechtesten Einzelstatus (warnung schlägt ok)', async () => {
    const deps = alleGruen()
    deps.erreichbarkeit.holer = {
      async pingeAnbieter() {
        return { erreichbar: false }
      }
    }
    const { gesamtstatus } = await fuehreDiagnose(deps)
    expect(gesamtstatus).toBe('warnung')
  })

  it('gesamtstatus nimmt fehler, auch wenn andere Checks nur warnung/ok sind', async () => {
    const deps = alleGruen()
    deps.erreichbarkeit.holer = {
      async pingeAnbieter() {
        return { erreichbar: false }
      }
    }
    deps.mikrofon.geraete = { async anzahl() { return 0 } }
    const { gesamtstatus } = await fuehreDiagnose(deps)
    expect(gesamtstatus).toBe('fehler')
  })

  it('ein werfender Port lässt nur den eigenen Check fehlschlagen, andere laufen weiter', async () => {
    const deps = alleGruen()
    deps.hotkeyHook.hook = {
      async istAktiv() {
        throw new Error('uiohook-Absturz')
      }
    }
    const { gesamtstatus, checks } = await fuehreDiagnose(deps)
    expect(gesamtstatus).toBe('fehler')

    const hotkeyCheck = checks.find((c) => c.titel === 'Hotkey-Erkennung')
    expect(hotkeyCheck?.status).toBe('fehler')

    // Die drei anderen (ok konfigurierten) Checks blieben unbeeinflusst.
    const uebrige = checks.filter((c) => c.titel !== 'Hotkey-Erkennung')
    expect(uebrige.every((c) => c.status === 'ok')).toBe(true)
  })

  it('liefert genau vier Checks in stabiler Reihenfolge (API-Key, Erreichbarkeit, Mikrofon, Hotkey)', async () => {
    const { checks } = await fuehreDiagnose(alleGruen())
    expect(checks.map((c) => c.titel)).toEqual([
      'API-Key',
      'Anbieter-Erreichbarkeit',
      'Mikrofon',
      'Hotkey-Erkennung'
    ])
  })
})
