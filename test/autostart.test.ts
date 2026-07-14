import { describe, it, expect } from 'vitest'
import { createAutostart, AUTOSTART_WERTNAME } from '@main/autostart/autostart'
import type { RegistrySchreiber } from '@main/autostart/autostart-port'

// In-Memory-"Registry" (eine Map als Fake-Run-Key) — kein echter Windows-Registry-Zugriff nötig.
function fakeRegistry(initial: Map<string, string> = new Map()): {
  registry: RegistrySchreiber
  werte: Map<string, string>
} {
  const werte = initial
  return {
    werte,
    registry: {
      async setze(name, pfad) {
        werte.set(name, pfad)
      },
      async entferne(name) {
        werte.delete(name)
      },
      async liest(name) {
        return werte.get(name) ?? null
      }
    }
  }
}

const EXE = 'C:\\Users\\nutzer\\AppData\\Local\\Blitztext\\Blitztext.exe'
const ANDERER_EXE = 'C:\\Users\\nutzer\\Downloads\\Blitztext-alt\\Blitztext.exe'

describe('createAutostart', () => {
  it('istAutostartAktiv: ohne Eintrag → inaktiv', async () => {
    const { registry } = fakeRegistry()
    const autostart = createAutostart({ registry })
    expect(await autostart.istAutostartAktiv(EXE)).toEqual({ zustand: 'inaktiv' })
  })

  it('autostartAn setzt den Eintrag unter dem stabilen Wertnamen', async () => {
    const { registry, werte } = fakeRegistry()
    const autostart = createAutostart({ registry })
    await autostart.autostartAn(EXE)
    expect(werte.has(AUTOSTART_WERTNAME)).toBe(true)
  })

  it('istAutostartAktiv: Eintrag zeigt auf aktuellen Pfad → aktiv', async () => {
    const { registry } = fakeRegistry()
    const autostart = createAutostart({ registry })
    await autostart.autostartAn(EXE)
    expect(await autostart.istAutostartAktiv(EXE)).toEqual({ zustand: 'aktiv', pfad: EXE })
  })

  it('istAutostartAktiv: Eintrag zeigt auf ANDEREN Pfad → verwaist (nicht aktiv)', async () => {
    const { registry } = fakeRegistry()
    const autostart = createAutostart({ registry })
    await autostart.autostartAn(ANDERER_EXE)
    const status = await autostart.istAutostartAktiv(EXE)
    expect(status).toEqual({ zustand: 'verwaist', hinterlegterPfad: ANDERER_EXE })
  })

  it('autostartAus entfernt den Eintrag; danach wieder inaktiv', async () => {
    const { registry } = fakeRegistry()
    const autostart = createAutostart({ registry })
    await autostart.autostartAn(EXE)
    await autostart.autostartAus()
    expect(await autostart.istAutostartAktiv(EXE)).toEqual({ zustand: 'inaktiv' })
  })

  it('autostartAus ist idempotent (kein Fehler ohne vorhandenen Eintrag)', async () => {
    const { registry } = fakeRegistry()
    const autostart = createAutostart({ registry })
    await expect(autostart.autostartAus()).resolves.toBeUndefined()
    await expect(autostart.autostartAus()).resolves.toBeUndefined()
  })

  it('autostartAn ist idempotent: zweifaches Einschalten mit gleichem Pfad bleibt aktiv', async () => {
    const { registry, werte } = fakeRegistry()
    const autostart = createAutostart({ registry })
    await autostart.autostartAn(EXE)
    await autostart.autostartAn(EXE)
    expect(werte.size).toBe(1)
    expect(await autostart.istAutostartAktiv(EXE)).toEqual({ zustand: 'aktiv', pfad: EXE })
  })

  it('autostartAn mit neuem Pfad überschreibt den alten Eintrag (Korrektur eines verwaisten Eintrags)', async () => {
    const { registry } = fakeRegistry()
    const autostart = createAutostart({ registry })
    await autostart.autostartAn(ANDERER_EXE)
    expect(await autostart.istAutostartAktiv(EXE)).toEqual({
      zustand: 'verwaist',
      hinterlegterPfad: ANDERER_EXE
    })
    await autostart.autostartAn(EXE)
    expect(await autostart.istAutostartAktiv(EXE)).toEqual({ zustand: 'aktiv', pfad: EXE })
  })

  it('Pfade mit Leerzeichen werden korrekt in Anführungszeichen gesetzt und wieder erkannt', async () => {
    const mitLeerzeichen = 'C:\\Program Files\\Blitztext\\Blitztext.exe'
    const { registry } = fakeRegistry()
    const autostart = createAutostart({ registry })
    await autostart.autostartAn(mitLeerzeichen)
    expect(await autostart.istAutostartAktiv(mitLeerzeichen)).toEqual({
      zustand: 'aktiv',
      pfad: mitLeerzeichen
    })
  })

  it('erkennt Aktivität auch, wenn der hinterlegte Wert (von reg.exe) bereits ohne Anführungszeichen kommt', async () => {
    const { registry, werte } = fakeRegistry()
    werte.set(AUTOSTART_WERTNAME, EXE) // kein umschließendes Quote, wie es reg.exe teils liefert
    const autostart = createAutostart({ registry })
    expect(await autostart.istAutostartAktiv(EXE)).toEqual({ zustand: 'aktiv', pfad: EXE })
  })
})
