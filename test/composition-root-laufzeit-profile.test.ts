// v0.8.0: beweist, dass composition-root die neun Laufzeit-Profile-Felder (BlitztextSettings) LIVE an
// ihre Konsumenten weiterreicht — als Closures über die lebende `settings`-Variable (Muster wie die
// bestehenden getConfig/getBaseUrl/getApiKey/istAktiv-Closures, siehe composition-root.ts).
//
// Drei der neun Konsumenten (transcription/cloud-provider.ts, rewrite/cloud-provider.ts,
// workflow/runner.ts) würden bei einem echten Aufruf einen echten Netzwerk-Request auslösen bzw. den
// vollen Aufnahme→Transkription→Umschreiben-Reducer durchlaufen — das ist hier nicht nötig, um die
// VERDRAHTUNG zu beweisen (dass composition-root die richtige, live gelesene Closure übergibt). Die
// drei Fabriken werden deshalb durch schlanke Spione ersetzt, die NUR die hereingereichten deps
// abfangen; das eigentliche Verhalten der echten Funktionen ist bereits in
// transcription-provider.test.ts / rewrite-provider.test.ts / workflow-runner.test.ts bewiesen.
import { describe, it, expect, vi } from 'vitest'

let transcriptionDeps: { getFetchTimeoutMs?: () => number } | undefined
let rewriteDeps: { getFetchTimeoutMs?: () => number } | undefined
let runnerDeps:
  | {
      getWatchdogMs?: () => number
      getRetryVersuche?: () => number
      quality: {
        shouldRejectRecording(durationSeconds: number): boolean
        istStilleAufnahme?(messung: { max: number; median: number } | null | undefined): boolean
      }
    }
  | undefined

vi.mock('@main/transcription/cloud-provider', () => ({
  createCloudTranscriptionProvider: (deps: typeof transcriptionDeps) => {
    transcriptionDeps = deps
    return { transcribe: async () => '' }
  }
}))
vi.mock('@main/rewrite/cloud-provider', () => ({
  createCloudRewriteProvider: (deps: typeof rewriteDeps) => {
    rewriteDeps = deps
    return { rewrite: async () => ({ text: '' }) }
  }
}))
vi.mock('@main/workflow/runner', () => ({
  createWorkflowRunner: (deps: typeof runnerDeps) => {
    runnerDeps = deps
    // Minimal-Stub, der nur von createSitzung() angefasst wird (dort wird `onPhase` gesetzt) — in
    // diesem Test wird kein Lauf gestartet, das Objekt muss nur diese Zuweisung klaglos entgegennehmen.
    return { onPhase: undefined }
  }
}))

import { createMainComposition } from '@main/composition-root'
import { netzwerkProfilWerte } from '@shared/laufzeit-profile'

function baseDeps() {
  return {
    recorder: { start: vi.fn(), stop: vi.fn(async () => ({ audio: new Blob(), durationSeconds: 0 })), discard: vi.fn() },
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

describe('composition-root: netzwerkProfil live verdrahtet (Fetch-Timeout + Watchdog)', () => {
  it('"kurz" liefert an Transkription/Umschreiben/Runner-Watchdog denselben kürzeren Wert wie netzwerkProfilWerte("kurz")', async () => {
    const comp = await createMainComposition(baseDeps())

    const next = await comp.einstellungen.load()
    next.netzwerkProfil = 'kurz'
    expect(comp.aktualisiere(next)).toBe(true) // kein Lauf aktiv → sofort übernommen

    const erwartet = netzwerkProfilWerte('kurz')
    expect(erwartet.fetchTimeoutMs).toBeLessThan(netzwerkProfilWerte('normal').fetchTimeoutMs)
    expect(transcriptionDeps?.getFetchTimeoutMs?.()).toBe(erwartet.fetchTimeoutMs)
    expect(rewriteDeps?.getFetchTimeoutMs?.()).toBe(erwartet.fetchTimeoutMs)
    expect(runnerDeps?.getWatchdogMs?.()).toBe(erwartet.watchdogMs)
  })

  it('Profiländerung wirkt SOFORT über dieselbe Closure (kein Neubau der Provider/des Runners nötig)', async () => {
    const comp = await createMainComposition(baseDeps())
    // Default ('normal') zuerst bestätigen …
    expect(transcriptionDeps?.getFetchTimeoutMs?.()).toBe(netzwerkProfilWerte('normal').fetchTimeoutMs)

    const next = await comp.einstellungen.load()
    next.netzwerkProfil = 'lang'
    comp.aktualisiere(next)

    // … dieselbe, bereits beim Bau übergebene Getter-Funktion liefert jetzt den NEUEN Wert.
    expect(transcriptionDeps?.getFetchTimeoutMs?.()).toBe(netzwerkProfilWerte('lang').fetchTimeoutMs)
  })
})

describe('composition-root: mindestAufnahmeSekunden/stilleProfil live verdrahtet (quality-Closures)', () => {
  it('mindestAufnahmeSekunden=1.0 lässt die runner.quality-Closure eine 0,5s-Aufnahme ablehnen (Default 0,3s würde sie durchlassen)', async () => {
    const comp = await createMainComposition(baseDeps())

    // Default: 0,5s liegt über der Default-Schwelle (0,3s) → NICHT abgelehnt.
    expect(runnerDeps?.quality.shouldRejectRecording(0.5)).toBe(false)

    const next = await comp.einstellungen.load()
    next.mindestAufnahmeSekunden = 1.0
    comp.aktualisiere(next)

    // Abweichender Wert kommt an: dieselbe Aufnahme wird jetzt abgelehnt.
    expect(runnerDeps?.quality.shouldRejectRecording(0.5)).toBe(true)
  })

  it("stilleProfil='aus' lehnt NIE als Stille ab — auch nicht bei einer Messung, die 'normal' als Stille werten würde", async () => {
    const comp = await createMainComposition(baseDeps())

    // Default ('normal'): eine klar stille Messung (weit unter STILLE_HART) wird abgelehnt.
    expect(runnerDeps?.quality.istStilleAufnahme?.({ max: 0, median: 0 })).toBe(true)

    const next = await comp.einstellungen.load()
    next.stilleProfil = 'aus'
    comp.aktualisiere(next)

    // Sicherheitsrelevant (Auftrag): 'aus' lehnt NIE ab, egal wie „still" die Messung aussieht.
    expect(runnerDeps?.quality.istStilleAufnahme?.({ max: 0, median: 0 })).toBe(false)
    expect(runnerDeps?.quality.istStilleAufnahme?.(null)).toBe(false)
  })
})

describe('composition-root: retryVersuche live verdrahtet', () => {
  it('ein abweichender Wert (4 statt Default 2) kommt bei der Runner-Closure an', async () => {
    const comp = await createMainComposition(baseDeps())
    expect(runnerDeps?.getRetryVersuche?.()).toBe(2) // Default

    const next = await comp.einstellungen.load()
    next.retryVersuche = 4
    comp.aktualisiere(next)

    expect(runnerDeps?.getRetryVersuche?.()).toBe(4)
  })
})
