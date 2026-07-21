import { contextBridge, ipcRenderer } from 'electron'
import type { ApiKeyValidation } from '@shared/api-key'
import type { BlitztextSettings } from '@main/settings/store'
import type { VerlaufEintrag } from '@main/history/history-store'
import type { StatsSummary } from '@main/stats/stats-store'
import type { AutostartStatus } from '@main/autostart'
import type { UpdateErgebnis } from '@main/update/update-hinweis'
import type { DiagnoseErgebnis, HealthErgebnis } from '@main/health'
import type { WorkflowPhase } from '@main/workflow/runner'
import type { WorkflowDefinition } from '@shared/workflows'
import type { LogFelder } from '@main/diagnostics/ereignis-log'

/** Stufen, die der Renderer loggen darf (kein `debug` — der Main filtert zusätzlich, siehe log-ipc). */
export type RendererLogStufe = 'info' | 'warnung' | 'fehler'

/** Ergebnis von workflow:export (Datei-Preset, siehe main/index.ts). */
export type WorkflowExportErgebnis =
  | { ok: true; pfad: string }
  | { ok: false; grund: 'abgebrochen' | 'unbekannt' | 'schreibfehler' }

/** Ergebnis von workflow:import (Datei-Preset, siehe main/index.ts). */
export type WorkflowImportErgebnis =
  | { ok: true; workflow: WorkflowDefinition }
  | { ok: false; grund: 'abgebrochen' | 'ungueltig' | 'lesefehler' }

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
    // C4/A4b: Rückgabewert zeigt an, ob die Einstellungen SOFORT übernommen wurden (true/undefined,
    // Altverhalten) oder — weil gerade eine Aufnahme läuft — erst NACH deren Ende (false). Der
    // Main-Handler liefert `false` in dieser Welle über einen parallelen Agenten; bis dahin ist der
    // Rückgabewert zur Laufzeit `undefined` → Aufrufer MÜSSEN strikt auf `=== false` prüfen, nicht auf
    // Falsy, sonst würde `undefined` fälschlich als „verschoben" gewertet.
    save: (next: BlitztextSettings): Promise<boolean> => ipcRenderer.invoke('settings:save', next)
  },
  /** Prompt-Assistent: erzeugt einen System-Prompt-Entwurf (V2). */
  workflow: {
    assistEntwurf: (beschreibung: string, bestehend?: string): Promise<string> =>
      ipcRenderer.invoke('workflow:assistEntwurf', beschreibung, bestehend),
    /** Workflow als Preset-Datei exportieren (nativer Speichern-Dialog im Main). */
    export: (workflowId: string): Promise<WorkflowExportErgebnis> =>
      ipcRenderer.invoke('workflow:export', workflowId),
    /** Preset-Datei importieren (nativer Öffnen-Dialog im Main). KEIN Store-Write hier — der
     *  Aufrufer übernimmt das Ergebnis über settings.save. */
    import: (): Promise<WorkflowImportErgebnis> => ipcRenderer.invoke('workflow:import')
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
  },
  /** S4: Erreichbarkeits-Check für EINEN bestimmten Anbieter (Einstellungen-Karte „Server prüfen",
   *  v. a. fürs lokale ASR gedacht — Port/Server variiert dort je nach Setup). */
  anbieter: {
    pruefeErreichbarkeit: (anbieterId: string): Promise<HealthErgebnis> =>
      ipcRenderer.invoke('anbieter:pruefeErreichbarkeit', anbieterId)
  },
  /** C4: Live-Workflow-Phase fürs Settings-Fenster (Status-Indikator im Header). Gleiches
   *  Abmelde-Muster wie history.onChanged (Listener-Referenz HIER erfasst). */
  workflowStatus: {
    onChanged: (cb: (phase: WorkflowPhase) => void): (() => void) => {
      const listener = (_e: unknown, phase: WorkflowPhase): void => cb(phase)
      ipcRenderer.on('workflow:status', listener)
      return () => ipcRenderer.removeListener('workflow:status', listener)
    }
  },
  /** W2-S8 (Onboarding-Wizard): manuelles Auslösen/Stoppen eines Workflows ohne Hotkey (Probe-Schritt).
   *  Der Fortschritt kommt wie beim Hotkey über workflowStatus.onChanged — beide Aufrufe resolven sofort. */
  sitzung: {
    starteManuell: (workflowId: string): Promise<void> =>
      ipcRenderer.invoke('sitzung:starteManuell', workflowId),
    stoppeManuell: (): Promise<void> => ipcRenderer.invoke('sitzung:stoppeManuell')
  },
  /** v0.7.2 „Ereignislog": text-freies Diagnose-Log auf diesem Gerät. Der Renderer darf nur schreiben
   *  (fire-and-forget `send`, der Main validiert/redigiert via parseRendererLog und präfixt `renderer.`)
   *  sowie Pfad/Ordner/Löschen anfragen. `schreibe` wirft NIE — der Renderer soll nie am Logging
   *  scheitern; die Felder enthalten ausschließlich Primitive (nie Diktat-/Audio-Inhalt). */
  log: {
    schreibe: (stufe: RendererLogStufe, ereignis: string, felder?: LogFelder): void => {
      ipcRenderer.send('log:schreibe', { stufe, ereignis, felder })
    },
    pfad: (): Promise<string> => ipcRenderer.invoke('log:pfad'),
    oeffneOrdner: (): Promise<void> => ipcRenderer.invoke('log:oeffneOrdner'),
    loeschen: (): Promise<void> => ipcRenderer.invoke('log:loeschen')
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
