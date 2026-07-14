import { contextBridge, ipcRenderer } from 'electron'
import type { ApiKeyValidation } from '@shared/api-key'
import type { BlitztextSettings } from '@main/settings/store'
import type { VerlaufEintrag } from '@main/history/history-store'
import type { StatsSummary } from '@main/stats/stats-store'
import type { AutostartStatus } from '@main/autostart'
import type { UpdateErgebnis } from '@main/update/update-hinweis'
import type { DiagnoseErgebnis } from '@main/health'

const api = {
  /** Health-Check der IPC-Bridge zwischen Renderer und Main-Prozess. */
  ping: (): Promise<string> => ipcRenderer.invoke('app:ping'),
  /** Liefert die App-Version aus dem Main-Prozess. */
  getAppVersion: (): Promise<string> => ipcRenderer.invoke('app:version'),
  /** API-Key des aktiven Anbieters (der rohe Key bleibt im Main-Prozess; hier nur has/save/clear). */
  apiKey: {
    has: (anbieterId: string): Promise<boolean> => ipcRenderer.invoke('apikey:has', anbieterId),
    maske: (anbieterId: string): Promise<string | null> =>
      ipcRenderer.invoke('apikey:maske', anbieterId),
    save: (anbieterId: string, key: string, baseUrl: string): Promise<ApiKeyValidation> =>
      ipcRenderer.invoke('apikey:save', anbieterId, key, baseUrl),
    clear: (anbieterId: string): Promise<void> => ipcRenderer.invoke('apikey:clear', anbieterId)
  },
  /** Einstellungen (ohne Secrets) lesen/speichern (V2). */
  settings: {
    get: (): Promise<BlitztextSettings> => ipcRenderer.invoke('settings:get'),
    save: (next: BlitztextSettings): Promise<void> => ipcRenderer.invoke('settings:save', next)
  },
  /** Prompt-Assistent: erzeugt einen System-Prompt-Entwurf (V2). */
  workflow: {
    assistEntwurf: (beschreibung: string, bestehend?: string): Promise<string> =>
      ipcRenderer.invoke('workflow:assistEntwurf', beschreibung, bestehend)
  },
  /** Verlauf (opt-in, verschlüsselt) lesen/löschen (V2). */
  history: {
    liste: (): Promise<VerlaufEintrag[]> => ipcRenderer.invoke('history:liste'),
    loeschen: (): Promise<void> => ipcRenderer.invoke('history:loeschen'),
    loeschenEintrag: (id: string): Promise<void> =>
      ipcRenderer.invoke('history:loeschenEintrag', id),
    // P5b: Lauscht auf history:changed (neuer Eintrag geschrieben) und gibt eine Abmelde-Funktion
    // zurück. Die Referenz wird HIER erfasst (removeListener matcht per Referenz) → StrictMode-sicher.
    onChanged: (cb: () => void): (() => void) => {
      const listener = (): void => cb()
      ipcRenderer.on('history:changed', listener)
      return () => ipcRenderer.removeListener('history:changed', listener)
    }
  },
  /** Statistik/Kosten-Zusammenfassung (V2). */
  stats: {
    zusammenfassung: (): Promise<StatsSummary> => ipcRenderer.invoke('stats:zusammenfassung'),
    loeschen: (): Promise<void> => ipcRenderer.invoke('stats:loeschen')
  },
  /** Farbschema: Systemwert lesen + auf Änderungen lauschen (v0.2.x). */
  theme: {
    systemDark: (): Promise<boolean> => ipcRenderer.invoke('theme:systemDark'),
    // S21-Rest (Listener-Leak): gleiches Muster wie history.onChanged — Listener-Referenz HIER
    // erfassen, damit removeListener sie per Referenz wieder entfernen kann (StrictMode-sicher).
    onSystemChanged: (cb: (dark: boolean) => void): (() => void) => {
      const listener = (_e: unknown, dark: boolean): void => cb(dark)
      ipcRenderer.on('theme:systemChanged', listener)
      return () => ipcRenderer.removeListener('theme:systemChanged', listener)
    }
  },
  /** Autostart-Status (W3-γ): aktiv/inaktiv/verwaist gegen den aktuellen .exe-Pfad. */
  autostart: {
    status: (): Promise<AutostartStatus> => ipcRenderer.invoke('autostart:status')
  },
  /** Opt-in Update-Hinweis (W3-δ): prüft (nur bei aktivierter Einstellung) auf ein neueres Release. */
  update: {
    pruefe: (): Promise<UpdateErgebnis> => ipcRenderer.invoke('update:pruefe')
  },
  /** Selbstdiagnose (W3-ε): Ampel-Checks. `mikrofonAnzahl` kommt aus enumerateDevices im Renderer. */
  health: {
    diagnose: (mikrofonAnzahl: number): Promise<DiagnoseErgebnis> =>
      ipcRenderer.invoke('health:diagnose', mikrofonAnzahl)
  }
}

export type BlitztextApi = typeof api

// Bridge für den versteckten Aufnahme-Renderer (recorder.html, #03/#11): Befehle aus dem Main-Prozess
// empfangen, Ergebnis/Fehler zurücksenden. Auf dem Einstellungs-Fenster ungenutzt (harmlos).
const recorder = {
  onStart: (cb: () => void): void => {
    ipcRenderer.on('recorder:start', () => cb())
  },
  onStop: (cb: () => void): void => {
    ipcRenderer.on('recorder:stop', () => cb())
  },
  onDiscard: (cb: () => void): void => {
    ipcRenderer.on('recorder:discard', () => cb())
  },
  sendResult: (buffer: ArrayBuffer, durationSeconds: number, mimeType: string): void => {
    ipcRenderer.send('recorder:result', { buffer, durationSeconds, mimeType })
  },
  sendError: (message: string): void => {
    ipcRenderer.send('recorder:error', message)
  }
}

export type BlitztextRecorderApi = typeof recorder

// Bridge für die Status-Pille (pill.html, #08): empfängt das Phasen-Label aus dem Main-Prozess.
const pill = {
  onStatus: (cb: (label: string) => void): void => {
    ipcRenderer.on('pill:status', (_event, label: string) => cb(label))
  }
}

export type BlitztextPillApi = typeof pill

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('blitztext', api)
    contextBridge.exposeInMainWorld('blitztextRecorder', recorder)
    contextBridge.exposeInMainWorld('blitztextPill', pill)
  } catch (error) {
    console.error(error)
  }
} else {
  // Fallback ohne Context-Isolation (sollte im Normalbetrieb nicht vorkommen).
  ;(globalThis as unknown as { blitztext: BlitztextApi }).blitztext = api
  ;(globalThis as unknown as { blitztextRecorder: BlitztextRecorderApi }).blitztextRecorder = recorder
  ;(globalThis as unknown as { blitztextPill: BlitztextPillApi }).blitztextPill = pill
}
