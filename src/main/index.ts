import {
  app,
  BrowserWindow,
  Tray,
  Menu,
  ipcMain,
  nativeImage,
  Notification,
  screen,
  nativeTheme,
  powerMonitor
} from 'electron'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { validateApiKey } from './secrets'
import {
  createApiKeyVault,
  migriereLegacyApiKey,
  type ApiKeyVault
} from '@main/secrets/api-key-vault'
import { createMainComposition, type MainComposition } from '@main/composition-root'
import { createRecorder } from '@main/recording/recorder-adapter'
import { createPasteAusgabe } from '@main/output/paste-adapter'
import { createSettingsFile } from '@main/settings/settings-file'
import { safeStorageCipher } from '@main/secrets/safe-storage-cipher'
import {
  createHistoryFile,
  createApiKeyFile,
  createApiKeyVaultFile
} from '@main/secrets/ciphertext-file'
import { createStatsFile } from '@main/stats/stats-file'
import { starteUiohookQuelle } from '@main/hotkey/uiohook-source'
import { createDefaultAutostart } from '@main/autostart'
import { createUpdateHoler } from '@main/update/update-holer'
import { createUpdateCacheFile } from '@main/update/update-cache-file'
import { createErreichbarkeitsAdapter } from '@main/health/erreichbarkeit-adapter'
import { spiegleStatus, baueTrayMenuTemplate } from '@main/window/tray-status'
import { pillenPosition } from '@main/window/pillen-position'
import { pillenStatus } from '@main/window/pill-status'
import { istAbbruchOderTimeout } from '@main/session/abbruch-guard'
import { createSettingsStore, type BlitztextSettings, type ApiKeyStatus } from '@main/settings/store'
import { sendeAn } from '@main/window/send-to-window'

// Prozessweiter Wächter (#03): ein abgebrochener/getimeouteter Anbieter-fetch (undici) kann eine
// unhandledRejection erzeugen (RESEARCH R1). NUR Abbruch/Timeout schlucken — echte Bugs eskalieren
// (re-throw → uncaughtException = Default-Verhalten, nichts maskieren).
process.on('unhandledRejection', (grund) => {
  if (istAbbruchOderTimeout(grund)) return
  throw grund
})

// Tray-Dauertool (D4/A5): ein unerwarteter Bug soll NICHT lautlos verschwinden, aber auch keine
// Datenverlust-Schleife auslösen → surface (Log + Hinweis), dann kontrolliert beenden. KEIN Auto-Neustart
// (geparkt). Es werden NUR Name/Message geloggt — nie API-Keys/Objekt-Innereien (Secret-Redaction).
function meldeFatalUndBeende(grund: unknown): void {
  const text = grund instanceof Error ? `${grund.name}: ${grund.message}` : String(grund)
  console.error('Schwerer Fehler — Blitztext wird beendet:', text)
  try {
    if (Notification.isSupported()) {
      new Notification({
        title: 'Blitztext',
        body: 'Blitztext ist auf einen Fehler gestoßen und muss neu gestartet werden.'
      }).show()
    }
  } catch {
    // Notification im Fehlerfall best effort
  }
  app.exit(1)
}
process.on('uncaughtException', meldeFatalUndBeende)

let tray: Tray | null = null
let settingsWindow: BrowserWindow | null = null
let recorderWindow: BrowserWindow | null = null
let pillWindow: BrowserWindow | null = null
let pillFehlerTimer: ReturnType<typeof setTimeout> | null = null
let stopUiohook: () => void = () => {}
let isQuitting = false

// Dunkle Taskleiste → helles Icon, helle Taskleiste → dunkles Icon (Windows kennt keine Template-
// Images; shouldUseDarkColors ist die beste verfügbare Näherung, ADR-Recherche §5).
function resolveTrayIcon(dark = nativeTheme.shouldUseDarkColors): Electron.NativeImage {
  const name = dark ? 'tray-light.png' : 'tray-dark.png'
  const file = app.isPackaged
    ? join(process.resourcesPath, name)
    : join(app.getAppPath(), 'resources', name)
  return existsSync(file) ? nativeImage.createFromPath(file) : nativeImage.createEmpty()
}

function aktualisiereTrayIcon(dark = nativeTheme.shouldUseDarkColors): void {
  if (tray) tray.setImage(resolveTrayIcon(dark))
}

function createSettingsWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1080,
    height: 720,
    minWidth: 880,
    minHeight: 600,
    show: false,
    title: 'Blitztext',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  // Tray-App-Verhalten: Schließen versteckt das Fenster, beendet die App nicht.
  window.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault()
      window.hide()
    }
  })

  // Wird das Fenster doch zerstört (z. B. beim Beenden): Referenz nullen, sonst würde sendeAn
  // (history:changed, P5b) auf ein zerstörtes Objekt zugreifen.
  window.on('closed', () => {
    settingsWindow = null
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    void window.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return window
}

function showSettings(): void {
  if (!settingsWindow) settingsWindow = createSettingsWindow()
  settingsWindow.show()
  settingsWindow.focus()
}

// Verstecktes, app-langlebiges Aufnahme-Fenster (#03/#11). EINMAL hier beim Start geladen — nie
// pro Aufnahme neu erzeugen: loadFile/URL zieht sonst den Fokus (electron#8649, RESEARCH §5), was
// das Paste-Ziel zerstören würde. Während der Aufnahme fließen nur IPC-Befehle, kein Fokuswechsel.
function createRecorderWindow(): BrowserWindow {
  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  // Mikrofon im Recorder-Fenster erlauben — BEIDE Handler (sonst lehnt der Check getUserMedia ab,
  // RESEARCH §5). Die OS-Mikrofon-Datenschutz-Einstellung bleibt eine separate Fehlerquelle.
  const ses = window.webContents.session
  ses.setPermissionRequestHandler((_wc, permission, callback) => callback(permission === 'media'))
  ses.setPermissionCheckHandler((_wc, permission) => permission === 'media')

  if (process.env['ELECTRON_RENDERER_URL']) {
    void window.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/recorder.html`)
  } else {
    void window.loadFile(join(__dirname, '../renderer/recorder.html'))
  }

  return window
}

// Fokusfreie Status-Pille (ADR-0007/0009, Q2-Config): always-on-top, click-through, nimmt NIE Fokus
// (focusable:false + nur showInactive). Einmal beim Start geladen (electron#8649). transparent für
// die abgerundete Karte; opaker Inhalt umgeht die meisten Windows-Transparenz-GPU-Bugs (Fallback bei
// schwarzem Kasten: app.disableHardwareAcceleration() — HITL-Entscheidung).
function createPillWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 260,
    height: 56,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    focusable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    thickFrame: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      backgroundThrottling: false
    }
  })
  window.setAlwaysOnTop(true, 'screen-saver')
  window.setIgnoreMouseEvents(true, { forward: true })

  if (process.env['ELECTRON_RENDERER_URL']) {
    void window.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/pill.html`)
  } else {
    void window.loadFile(join(__dirname, '../renderer/pill.html'))
  }
  return window
}

// Unten mittig über der Taskleiste, auf dem Display unter dem Cursor (dort wurde der Hotkey ausgelöst).
function positioniertePille(window: BrowserWindow): void {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const [pw = 0, ph = 0] = window.getSize()
  // A8: Wunschposition (unten zentriert) + harter Clamp in die sichtbaren Bounds gegen off-screen.
  const { x, y } = pillenPosition(display.workArea, { width: pw, height: ph })
  window.setBounds({ x, y, width: pw, height: ph })
}

function createTray(): void {
  tray = new Tray(resolveTrayIcon())
  tray.setToolTip('Blitztext')
  tray.on('click', showSettings)
}

// Tray-Menü mit „Abbrechen" (aktiv nur bei laufendem Workflow) + „Letzte Aufnahme erneut verarbeiten"
// (F1, aktiv nur wenn ein Retry möglich ist). Bei jedem onStatus neu bauen (#04). Das Template ist rein
// (baueTrayMenuTemplate, testbar); hier nur die Electron-Anbindung.
function baueTrayMenu(comp: MainComposition): void {
  if (!tray) return
  tray.setContextMenu(
    Menu.buildFromTemplate(
      baueTrayMenuTemplate(
        { beschaeftigt: comp.beschaeftigt(), kannErneutVersuchen: comp.kannErneutVersuchen() },
        {
          einstellungenOeffnen: showSettings,
          abbrechen: () => comp.brichAb(),
          erneutVersuchen: () => comp.erneutVersuchen(),
          beenden: () => {
            isQuitting = true
            app.quit()
          }
        }
      )
    )
  )
}

// Optionale Windows-Toast-Aktion (F1): ein beschrifteter Button in der Notification (nicht nur der
// Klick auf die Benachrichtigung selbst). `on('action')` liefert den Button-Index. HITL: die native
// Toast-Action-Darstellung ist Windows-abhängig — headless nicht verifizierbar.
interface ToastAktion {
  text: string
  aufAktion: () => void
}

function benachrichtige(
  titel: string,
  koerper: string,
  onClick?: () => void,
  aktion?: ToastAktion
): void {
  if (!Notification.isSupported()) return
  const n = new Notification({
    title: titel,
    body: koerper,
    ...(aktion ? { actions: [{ type: 'button', text: aktion.text }] } : {})
  })
  if (onClick) n.on('click', onClick)
  // Der Notification-Aktions-Button feuert 'action' mit dem Button-Index (hier nur Button 0).
  if (aktion) n.on('action', (_event, index) => index === 0 && aktion.aufAktion())
  n.show()
}

// P1: apiKeyStatus[anbieterId] setzen (status) oder entfernen (null) — frisch laden, NUR diesen Eintrag
// mergen, schreiben, Live-Reconfigure. So überschreibt kein Renderer-Entwurf den Status (Lost-Update).
async function mergeApiKeyStatus(
  comp: MainComposition,
  anbieterId: string,
  status: ApiKeyStatus | null
): Promise<void> {
  const aktuell = await comp.einstellungen.load()
  const apiKeyStatus = { ...aktuell.apiKeyStatus }
  if (status === null) {
    if (!(anbieterId in apiKeyStatus)) return
    delete apiKeyStatus[anbieterId]
  } else {
    apiKeyStatus[anbieterId] = status
  }
  const next = { ...aktuell, apiKeyStatus }
  await comp.einstellungen.save(next)
  comp.aktualisiere(next)
}

function registerIpc(apiKeys: ApiKeyVault, comp: MainComposition): void {
  ipcMain.handle('app:ping', () => 'pong')
  ipcMain.handle('app:version', () => app.getVersion())
  ipcMain.handle('theme:systemDark', () => nativeTheme.shouldUseDarkColors)

  // Key pro Anbieter (Vault, eine Datei je Anbieter). Validierung gegen die Base-URL DIESES Anbieters.
  ipcMain.handle('apikey:has', (_event, anbieterId: string) => apiKeys.has(anbieterId))
  ipcMain.handle('apikey:maske', (_event, anbieterId: string) => apiKeys.maske(anbieterId))
  ipcMain.handle('apikey:save', async (_event, anbieterId: string, key: string, baseUrl: string) => {
    // Gegen die Base-URL DIESES Anbieters validieren — vom Renderer mitgegeben, damit auch ein neu
    // angelegter (noch nicht gespeicherter) Anbieter korrekt geprüft wird (sonst fiele es auf den
    // Standard-Anbieter zurück → fremder Key gegen OpenAI → fälschlich „ungültig").
    const validation = await validateApiKey(key, { baseUrl })
    if (validation.status === 'valid') {
      await apiKeys.set(anbieterId, key)
      // P1: apiKeyStatus ist MAIN-ONLY (Lost-Update-Schutz) — frisch laden, NUR diesen Eintrag mergen,
      // schreiben, Live-Reconfigure. Nie aus dem Renderer-Entwurf geführt.
      await mergeApiKeyStatus(comp, anbieterId, {
        status: 'verifiziert',
        zuletztGetestetMs: Date.now()
      })
    }
    return validation
  })
  ipcMain.handle('apikey:clear', async (_event, anbieterId: string) => {
    await apiKeys.clear(anbieterId)
    await mergeApiKeyStatus(comp, anbieterId, null) // Status-Eintrag analog räumen
  })

  // V2: Einstellungen (ohne Secrets) lesen/speichern → Live-Reconfigure. (Key-Lebenszyklus hängt jetzt
  // an clear(anbieterId) beim Anbieter-Entfernen, nicht mehr an einer Provider-Wechsel-Heuristik.)
  ipcMain.handle('settings:get', () => comp.einstellungen.load())
  ipcMain.handle('settings:save', async (_event, next: BlitztextSettings) => {
    // P1: apiKeyStatus NICHT aus dem Renderer übernehmen — Main bewahrt den persistierten Stand.
    const aktuell = await comp.einstellungen.load()
    const zusammengefuehrt = { ...next, apiKeyStatus: aktuell.apiKeyStatus }
    await comp.einstellungen.save(zusammengefuehrt)
    comp.aktualisiere(zusammengefuehrt)
  })

  // V2: Prompt-Assistent (Chat-Anbieter) — ohne Key des Standard-Anbieters klare Fehlermeldung.
  ipcMain.handle('workflow:assistEntwurf', async (_event, beschreibung: string, bestehend?: string) => {
    if (!(await apiKeys.has(comp.standardAnbieterId()))) {
      throw new Error('Kein API-Key gesetzt. Bitte zuerst in den Einstellungen hinterlegen.')
    }
    return comp.assistiere(beschreibung, bestehend)
  })

  // V2: Verlauf + Statistik.
  ipcMain.handle('history:liste', () => comp.verlauf.liste())
  ipcMain.handle('history:loeschen', () => comp.verlauf.loeschen())
  ipcMain.handle('history:loeschenEintrag', (_event, id: string) =>
    comp.verlauf.loeschenEintrag(id)
  )
  ipcMain.handle('stats:zusammenfassung', () => comp.stats.zusammenfassung())
  ipcMain.handle('stats:loeschen', () => comp.stats.loeschen())

  // W3-γ/δ/ε: Autostart-Status, Opt-in-Update-Prüfung, Selbstdiagnose.
  ipcMain.handle('autostart:status', () => comp.autostartStatus())
  ipcMain.handle('update:pruefe', () => comp.pruefeUpdate())
  ipcMain.handle('health:diagnose', (_event, mikrofonAnzahl: unknown) => {
    // Eingabe validieren (untrusted Renderer): nur eine endliche, nicht-negative Zahl; sonst 0.
    const anzahl =
      typeof mikrofonAnzahl === 'number' && Number.isFinite(mikrofonAnzahl) && mikrofonAnzahl >= 0
        ? mikrofonAnzahl
        : 0
    return comp.diagnose(anzahl)
  })
}

const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', showSettings)

  app.whenReady().then(async () => {
    app.setAppUserModelId('de.blitztext.app') // Windows: Voraussetzung für zuverlässige Notifications

    // Reihenfolge (ADR-0010): Settings laden (liefert standardAnbieterId) → Legacy-Key (api-key.bin)
    // auf die anbieter-spezifische Datei migrieren → Vault bauen → dann Komposition.
    const settingsFile = createSettingsFile()
    const startSettings = await createSettingsStore({ file: settingsFile }).load()
    await migriereLegacyApiKey({
      legacy: createApiKeyFile(),
      ziel: createApiKeyVaultFile(startSettings.standardAnbieterId)
    })
    const apiKeys = createApiKeyVault({ cipher: safeStorageCipher, dateiFuer: createApiKeyVaultFile })
    createTray()

    // Farbschema: Systemänderungen an die Fenster broadcasten + Tray-Icon nachziehen (#Design).
    nativeTheme.on('updated', () => {
      const dark = nativeTheme.shouldUseDarkColors
      for (const w of BrowserWindow.getAllWindows()) w.webContents.send('theme:systemChanged', dark)
      aktualisiereTrayIcon(dark)
    })

    // M3/#11 — die Sitzung montieren und die nativen Adapter anschließen.
    recorderWindow = createRecorderWindow()
    pillWindow = createPillWindow()
    const ausgabe = createPasteAusgabe({
      fenster: {
        // Manuelle Auslösequelle: v1-minimal als Notification (vollständige Workflow-Anzeige + manueller
        // Tray-Start brauchen Aufnahme-UI → zurückgestellt; Kernpfad ist der Hotkey).
        anzeigen: (text) => benachrichtige('Blitztext', text),
        zeigeEinstellungen: showSettings,
        zeigeManuellenHinweis: () =>
          benachrichtige('Blitztext', 'In Zwischenablage kopiert — bitte mit Strg+V einfügen.'),
        // Lauf-Fehler/Teil-Erfolg: Notification (OS-announced = auch barrierefrei); bei 'einstellungen'
        // führt der Klick in die Einstellungen. F1 (W3-B): bei einem retrybaren Fehler reicht die
        // Sitzung `aktionen.erneut` durch → als Notification-Aktions-Button „Erneut versuchen".
        melde: (fehler, aktionen) =>
          benachrichtige(
            fehler.titel,
            fehler.koerper,
            fehler.aktion === 'einstellungen' ? showSettings : undefined,
            aktionen?.erneut ? { text: 'Erneut versuchen', aufAktion: aktionen.erneut } : undefined
          )
      }
    })

    // Lazy-Verweis auf den Standard-Anbieter (für den Erreichbarkeits-Ping); nach comp-Bau gesetzt.
    let holeStandardAnbieterId: () => string = () => ''

    const comp = await createMainComposition({
      recorder: createRecorder(recorderWindow),
      ausgabe,
      apiKeys,
      settingsFile,
      // V2 Strang D: verschlüsselter Verlauf (safeStorage/DPAPI) + text-freie Statistik.
      verlaufCipher: safeStorageCipher,
      verlaufFile: createHistoryFile(),
      statsFile: createStatsFile(),
      // P5b: nach erfolgtem Verlauf-Schreiben das Dashboard zum Neuladen anstoßen (race-frei, da das
      // Event erst nach dem aufgelösten Schreibvorgang feuert). sendeAn prüft null/isDestroyed.
      onHistoryChanged: () => sendeAn(settingsWindow, 'history:changed'),
      // W3-γ: Autostart über den HKCU-Run-Key (portable .exe). `process.execPath` = die laufende .exe.
      autostart: createDefaultAutostart(),
      exePfad: process.execPath,
      // W3-δ: echte Ports für den Opt-in-Update-Hinweis (Netz nur bei aktivierter Einstellung).
      updateHoler: createUpdateHoler(),
      updateCache: createUpdateCacheFile(join(app.getPath('userData'), 'update-cache.json')),
      appVersion: app.getVersion(),
      // W3-ε: leichter Anbieter-Ping für die Selbstdiagnose (Key des Standard-Anbieters mitschicken →
      // 401/403 wird verlässlich als „Key falsch" erkannt). Der Getter liest den Standard-Anbieter erst
      // zur Diagnose-Zeit über den Verweis in `holeStandardAnbieterId` (nach comp-Zuweisung gesetzt).
      erreichbarkeit: createErreichbarkeitsAdapter({
        getApiKey: () => apiKeys.get(holeStandardAnbieterId())
      })
    })
    holeStandardAnbieterId = () => comp.standardAnbieterId()

    // IPC erst nach dem Bau der Komposition registrieren (Handler brauchen comp), dann Fenster zeigen.
    registerIpc(apiKeys, comp)
    baueTrayMenu(comp)
    showSettings()

    // Runner-Phase → Tray-Tooltip + fokusfreie Status-Pille (stiehlt keinen Fokus, ADR-0007).
    comp.sitzung.onStatus = (phase) => {
      // Nach Lauf-Ende ausstehende Settings-Änderungen übernehmen (während eines Laufs gespeichert).
      if (
        phase.status === 'fertig' ||
        phase.status === 'teilErfolg' ||
        phase.status === 'fehler' ||
        phase.status === 'idle'
      ) {
        comp.wendeAusstehendeAn()
      }
      baueTrayMenu(comp) // „Abbrechen"-Aktivzustand nachziehen
      if (tray) spiegleStatus(tray, phase)
      if (!pillWindow) return
      if (pillFehlerTimer) {
        clearTimeout(pillFehlerTimer)
        pillFehlerTimer = null
      }
      const s = pillenStatus(phase)
      if (s.sichtbar) {
        pillWindow.webContents.send('pill:status', s.label)
        positioniertePille(pillWindow)
        pillWindow.showInactive()
        // Fehler/Teil-Erfolg bleiben sonst stehen (kein weiteres onStatus bis zum nächsten Lauf) → auto-ausblenden.
        if (phase.status === 'fehler' || phase.status === 'teilErfolg') {
          pillFehlerTimer = setTimeout(() => pillWindow?.hide(), 4000)
        }
      } else {
        pillWindow.hide()
      }
    }

    // Globaler Hotkey über uiohook → verarbeiteTaste → Sitzung (ersetzt den globalShortcut-Platzhalter).
    // onStatus speist den Start-Erfolg in den Health-Check „Hotkey-Erkennung" (W3-ε).
    stopUiohook = starteUiohookQuelle({
      verarbeiteTaste: comp.verarbeiteTaste,
      onStatus: (aktiv) => comp.setzeHotkeyHookAktiv(aktiv)
    })

    // W3-γ: Registry-Autostart-Eintrag an das gespeicherte `autostart`-Feld angleichen (heilt einen
    // verwaisten Eintrag nach dem Verschieben der .exe). Best effort — Fehler werden intern geschluckt.
    void comp.syncAutostartBeimStart()

    // Sperre/Standby verschlucken Keyups (Win+L → Secure Desktop, RESEARCH §3): Tasten-Tracking
    // zurücksetzen, sonst bleibt z. B. die Win-Taste „gedrückt" und LinksStrg allein startet die
    // Aufnahme. Ein gerade aktiver Hotkey-Lauf wird dabei abgebrochen.
    powerMonitor.on('lock-screen', () => comp.setzeTastenZurueck())
    powerMonitor.on('unlock-screen', () => comp.setzeTastenZurueck())
    powerMonitor.on('suspend', () => comp.setzeTastenZurueck())
    powerMonitor.on('resume', () => comp.setzeTastenZurueck())

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) showSettings()
    })
  }).catch((err) => {
    console.error('App-Start fehlgeschlagen:', err)
  })

  // Tray-App: weiterlaufen, auch wenn kein Fenster offen ist.
  app.on('window-all-closed', () => {})

  app.on('before-quit', () => {
    isQuitting = true
  })

  app.on('will-quit', () => {
    stopUiohook()
  })
}
