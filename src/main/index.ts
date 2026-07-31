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
  powerMonitor,
  shell,
  dialog
} from 'electron'
import { join } from 'node:path'
import { existsSync, rmSync } from 'node:fs'
import { writeFile, readFile } from 'node:fs/promises'
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
import {
  createPerfInstrumentierung,
  NOOP_PERF,
  type PerfInstrumentierung
} from '@main/diagnostics/perf-instrumentierung'
import { createEreignisLog, redigiereFehler } from '@main/diagnostics/ereignis-log'
import { createLogDateiSenke, logOrdnerPfad } from '@main/diagnostics/log-datei'
import { parseRendererLog } from '@main/diagnostics/log-ipc'
import { createDefaultAutostart } from '@main/autostart'
import { ermittleAutostartExePfad, istPortablerStart } from '@main/autostart/exe-pfad'
import { createUpdateHoler } from '@main/update/update-holer'
import { createUpdateCacheFile } from '@main/update/update-cache-file'
import { createErreichbarkeitsAdapter } from '@main/health/erreichbarkeit-adapter'
import { spiegleStatus, baueTrayMenuTemplate } from '@main/window/tray-status'
import { pillenStatus } from '@main/window/pill-status'
import {
  pillenAnzeigedauerWerteFuer,
  UPDATE_INTERVALL_STUNDEN_STUFEN
} from '@shared/laufzeit-profile'
import { erstellePillenSteuerung, type PillenSteuerung } from '@main/window/pillen-steuerung'
import { istAbbruchOderTimeout } from '@main/session/abbruch-guard'
import { createSettingsStore, type BlitztextSettings, type ApiKeyStatus } from '@main/settings/store'
import { sendeAn } from '@main/window/send-to-window'
import { warteAufFensterBereit, protokolliereLadefehler } from '@main/window/fenster-bereitschaft'
import { montiereFensterHeilung, type FensterHeilung } from '@main/window/fenster-heilung'
// W3-F1: `workflowZuPreset` zog von @shared/workflows nach @main/rewrite/prompt-builder um (braucht
// `berechneterPrompt`, um den Prompt-Text eines unveränderten Built-ins aufzulösen statt '' zu
// exportieren — shared darf @main nicht als Wert importieren, siehe Kommentar in workflows.ts).
import { workflowZuPreset } from '@main/rewrite/prompt-builder'
import { parseImportierterWorkflow } from '@shared/workflows'

// Prozessweiter Wächter (#03): ein abgebrochener/getimeouteter Anbieter-fetch (undici) kann eine
// unhandledRejection erzeugen (RESEARCH R1). NUR Abbruch/Timeout schlucken — echte Bugs eskalieren
// (re-throw → uncaughtException = Default-Verhalten, nichts maskieren).
process.on('unhandledRejection', (grund) => {
  if (istAbbruchOderTimeout(grund)) return
  throw grund
})

// v0.7.2 „Ereignislog": das eine, app-weite Log. Immer aktiv (Nutzer-Entscheid, kein Opt-in),
// synchrone Datei-Senke (Crash-Zeile sofort auf Disk), debug-Zeilen nur bei BLITZTEXT_DEBUG=1
// (analog BLITZTEXT_PERF). Wird als optionale Dep mit NOOP-Default in die Adapter/Composition
// durchgereicht. NIE Diktate/Texte/Keys — nur Ereignisnamen, redigierte Fehler, Längen, Ids, Flags.
const logSenke = createLogDateiSenke()
const log = createEreignisLog({
  senke: logSenke,
  debugAktiv: process.env['BLITZTEXT_DEBUG'] === '1'
})


// Tray-Dauertool (D4/A5): ein unerwarteter Bug soll NICHT lautlos verschwinden, aber auch keine
// Datenverlust-Schleife auslösen → surface (Log + Hinweis), dann kontrolliert beenden. KEIN Auto-Neustart
// (geparkt). Es werden NUR Name/Message geloggt — nie API-Keys/Objekt-Innereien (Secret-Redaction).
function meldeFatalUndBeende(grund: unknown): void {
  // Erste Anweisung: den Fatal-Fehler text-frei auf Disk bringen, BEVOR Notification/app.exit laufen.
  log.fehler('app.fatal', redigiereFehler(grund))
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

// v0.7.3 (B1): Selbstheilung der versteckten Renderer (Recorder/Pille) — bei will-quit entfernt (Liste,
// weil zwei Fenster geheilt werden). Leer, bis nach dem Fenster-Bau montiert.
const fensterHeilungen: FensterHeilung[] = []
// v0.7.4: dauerhafte 'did-fail-load'-Wächter beider versteckter Fenster — ebenfalls bei will-quit ab.
const ladefehlerWaechter: Array<{ entferne(): void }> = []
// v0.7.4: Anzeige-Steuerung der Pille (testbares Modul, ersetzt die früheren Closures pilleSichtbar/
// pilleHide/positioniertePille). Erst nach dem Fenster-Bau gesetzt; bis dahin No-Op.
let pillenSteuerung: PillenSteuerung | null = null

// C5: Zustand des Update-Hintergrund-Checks (Start-Check ~1min, danach ~6h-Intervall). Der bestehende
// 24h-Mindestabstand + ETag-Cache in pruefeAufUpdate() bleibt die Spam-Bremse — der Timer hier fragt
// nur regelmäßig „darf/soll jetzt geprüft werden", die Kernlogik entscheidet den Rest (inkl. Opt-in,
// live aus den Settings gelesen). null = kein neueres Release bekannt (oder Opt-in aus).
let updateVerfuegbar: { url: string; version: string } | null = null
let updateStartTimer: ReturnType<typeof setTimeout> | null = null
let updateIntervallTimer: ReturnType<typeof setInterval> | null = null

// R5 (Perf-Diagnose, opt-in, .scratch/PERF-MESSANLEITUNG-R5.md): NUR bei gesetztem env-Flag ODER
// aktivierter `perfAktiv`-Einstellung (v0.8.0) eine echte Ringpuffer-Instrumentierung anlegen — sonst
// NOOP_PERF (kein Ringpuffer, kein Timer, keine Allokation außer dem einen no-op-Objekt-Literal). Der
// Hot-Path in uiohook-source.ts bleibt im Aus-Zustand bei zwei no-op-Funktionsaufrufen pro Event
// (vernachlässigbar ggü. dem Hook selbst).
// v0.8.0: NICHT mehr beim Modul-Laden entschieden (VOR dem Settings-Laden) — der `perfAktiv`-Anteil
// braucht die geladenen Settings. Die endgültige Zuweisung passiert weiter unten in `app.whenReady()`,
// direkt nachdem `startSettings` geladen ist; bis dahin (bzw. falls der Start scheitert) bleibt `perf`
// NOOP_PERF, damit `will-quit` → `perf.stoppe()` immer ein gültiges Objekt vorfindet. WICHTIG: der uiohook-
// Hook wird EINMALIG mit diesem `perf`-Objekt verdrahtet (`starteUiohookQuelle({ perf, ... })`) und NICHT
// neu aufgebaut, wenn der Nutzer die Einstellung später ändert — der Schalter wirkt deshalb bewusst erst
// nach einem Neustart (akzeptiert, siehe Bericht/GUI-Hinweistext).
let perf: PerfInstrumentierung =
  process.env['BLITZTEXT_PERF'] === '1' ? createPerfInstrumentierung() : NOOP_PERF

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

// App-Icon für Fenster + Taskleiste. Ohne diese Option fällt Windows auf das Icon der .exe zurück —
// und das ist leer, weil `signAndEditExecutable: false` den rcedit-Schritt überspringt, der Icon und
// Versions-Metadaten einstempelt (siehe electron-builder.yml; genau diese Einstellung hält den
// Linux-Build wine-frei). Ergebnis war das Electron-Standardicon, obwohl das Tray-Icon korrekt war.
// Fehlt die Datei, wird bewusst KEINE Option gesetzt: ein leeres NativeImage würde das Icon erst
// recht löschen, während `undefined` Electron beim bisherigen Verhalten belässt.
function resolveAppIcon(): Electron.NativeImage | undefined {
  const file = app.isPackaged
    ? join(process.resourcesPath, 'icon.ico')
    : join(app.getAppPath(), 'resources', 'icon.ico')
  return existsSync(file) ? nativeImage.createFromPath(file) : undefined
}

function createSettingsWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1080,
    height: 720,
    minWidth: 880,
    minHeight: 600,
    show: false,
    title: 'Blitztext',
    icon: resolveAppIcon(),
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
      sandbox: false,
      // Verstecktes, aufnahme-kritisches Fenster: Throttling verhindern, damit der MediaRecorder auch
      // ohne sichtbaren Vordergrund zuverlässig läuft (wie die Pille, ~createPillWindow).
      backgroundThrottling: false
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
    // A3: moderat vergrößert (statt 260×56), damit CSS-Umbruch (pill.html) lange Fehlertexte/Labels
    // (z. B. Anbieter-Fehlermeldungen) nicht abschneidet. Fixe Größe bleibt bewusst (kein dynamisches
    // setBounds pro Nachricht — Resize-Flackern, siehe Design-Doc A3).
    width: 320,
    height: 88,
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

// v0.7.4: Anzeige/Verstecken/Positionieren der Pille liegen jetzt in `pillen-steuerung.ts` (testbar,
// duck-typed, protokolliert den TATSÄCHLICHEN Sichtbarkeitszustand). Hier bleibt nur die Electron-Naht:
// welche Arbeitsfläche gilt. Unten mittig über der Taskleiste, auf dem Display unter dem Cursor —
// dort steht in aller Regel auch das Fenster, in das eingefügt wird.
//
// Befund B (Feld-Log 2026-07-31): DIESE Funktion liefert weiterhin nur eine EINMALIGE, frische Messung
// unter dem aktuellen Zeiger — sie weiß nichts von „Läufen". Die Konstanz über einen ganzen Lauf hinweg
// (nicht bei jeder Phase neu unter dem inzwischen woanders stehenden Zeiger nachschauen) übernimmt
// pillen-steuerung.ts (laufBeginnt()/laufEndet()): sie ruft diese Funktion nur EINMAL pro Lauf auf
// (beim Phasenbeginn, s. comp.sitzung.onStatus unten) und hält das Ergebnis für alle weiteren Phasen
// desselben Laufs fest. Ohne laufenden Lauf (Aufwärmen vor dem allerersten Lauf) bleibt es bei der
// frischen Abfrage hier.
function arbeitsflaecheFuerPille(): { x: number; y: number; width: number; height: number } {
  return screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea
}

// Bequeme Hüllen — bis die Steuerung montiert ist (Fenster-Bau), sind sie folgenlose No-Ops.
function pilleSichtbar(label: string): void {
  pillenSteuerung?.zeige(label)
}

function pilleHide(): void {
  pillenSteuerung?.verstecke()
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
        {
          beschaeftigt: comp.beschaeftigt(),
          kannErneutVersuchen: comp.kannErneutVersuchen(),
          updateVerfuegbar
        },
        {
          einstellungenOeffnen: showSettings,
          abbrechen: () => comp.brichAb(),
          erneutVersuchen: () => comp.erneutVersuchen(),
          // C5: folgt dem einzigen bisherigen URL-Öffnen-Muster im Projekt — es gibt noch keins in
          // src/main (grep bestätigt), daher hier neu mit shell.openExternal (Standard-Electron-Weg für
          // externe Links, kein interner Navigations-/URL-Guard nötig, da die URL aus der GitHub-
          // Releases-API des eigenen Forks stammt, nicht aus Nutzereingabe).
          oeffneUpdateSeite: () => {
            if (updateVerfuegbar) void shell.openExternal(updateVerfuegbar.url)
          },
          beenden: () => {
            isQuitting = true
            app.quit()
          }
        }
      )
    )
  )
}

// C5: ein Check-Durchlauf — fragt comp.pruefeUpdate() (respektiert live Opt-in + 24h-Cache intern),
// hält das Ergebnis im Modul-State vor und zieht das Tray-Menü nach. Schaltet der Nutzer das Opt-in
// währenddessen aus, liefert pruefeUpdate() automatisch wieder neuVerfuegbar:false → updateVerfuegbar
// wird beim NÄCHSTEN Tick korrekt auf null zurückgesetzt (kein Sonderfall nötig).
async function fuehreUpdateCheckAus(comp: MainComposition): Promise<void> {
  const ergebnis = await comp.pruefeUpdate()
  // Bugfix (W2-F1): vorher stand hier `ergebnis.aktuelleVersion` — das ist die LOKALE (bereits
  // installierte) Version, nicht die neue. Zeigte irreführend „Update verfügbar – v<installierte
  // Version>" an. `neueVersion` trägt die tatsächliche Remote-Version (nur gesetzt bei
  // neuVerfuegbar); fehlt sie ausnahmsweise (z. B. alter Cache-Eintrag ohne das Feld), lieber KEINE
  // Versionsnummer zeigen als eine falsche → Fallback ohne Nummer, siehe baueTrayMenuTemplate.
  updateVerfuegbar = ergebnis.neuVerfuegbar
    ? { url: ergebnis.url, version: ergebnis.neueVersion ?? '' }
    : null
  baueTrayMenu(comp)
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

// v0.7.3 (A3/B1): einmaliger Korruptions-Melder für die Einstellungen. Der Store (A3) legt eine
// unlesbare settings.json als settings.json.korrupt beiseite und fällt auf Defaults zurück; er loggt/
// benachrichtigt bewusst NICHT selbst (keine log-/GUI-Dep im Kern), sondern ruft diesen Callback.
// Derselbe Callback wird an BEIDE Store-Instanzen gereicht (Startpfad + Komposition) — der `korrupt-
// Gemeldet`-Flag verhindert eine Doppel-Notification, falls beide load()-Pfade dieselbe kaputte Datei
// treffen. Text-frei: nur der Umstand + die feste, generische Meldung (kein Dateiinhalt).
let korruptGemeldet = false
function meldeSettingsKorrupt(): void {
  if (korruptGemeldet) return
  korruptGemeldet = true
  log.warnung('einstellungen.korrupt')
  benachrichtige(
    'Blitztext',
    'Einstellungen waren beschädigt und wurden zurückgesetzt. Alte Datei: settings.json.korrupt'
  )
}

// A1: derselbe Korruptions-Melder wie oben, für den Verlauf (history-store.ts). Der Store legt eine
// nicht entschlüsselbare/parsebare history.bin als history.bin.korrupt beiseite, STATT sie beim
// nächsten Diktat stillschweigend zu überschreiben, und ruft danach diesen Callback. Text-frei: nur
// der Umstand + eine generische, ehrliche Meldung (kein Dateiinhalt, kein voller Pfad).
function meldeVerlaufKorrupt(): void {
  log.warnung('verlauf.korrupt')
  benachrichtige(
    'Blitztext',
    'Der gespeicherte Verlauf war nicht mehr lesbar (z. B. nach einem Profil-/Systemwechsel) und ' +
      'wurde gesichert, statt überschrieben zu werden. Alte Datei: history.bin.korrupt. Die Daten ' +
      'sind nicht gelöscht, aber derzeit nicht mehr lesbar.'
  )
}

// A1: Korruptions-Melder für den API-Key-Tresor (api-key-vault.ts), EINER je Anbieter (mehrere Keys
// möglich) — daher ein Set statt eines einzelnen Flags, damit jeder betroffene Anbieter genau einmal
// gemeldet wird. NUR die anbieterId geht ins Log/die Meldung, NIE Key-Material (Leak-Regel).
const secretsKorruptGemeldet = new Set<string>()
function meldeSecretsKorrupt(anbieterId: string): void {
  if (secretsKorruptGemeldet.has(anbieterId)) return
  secretsKorruptGemeldet.add(anbieterId)
  log.warnung('secrets.korrupt', { anbieterId })
  benachrichtige(
    'Blitztext',
    `Der gespeicherte API-Key für „${anbieterId}" war nicht mehr lesbar und wurde gesichert (Suffix ` +
      '.korrupt). Bitte den Key in den Einstellungen erneut eingeben.'
  )
}

// P1: apiKeyStatus[anbieterId] setzen (status) oder entfernen (null) — NUR diesen Eintrag mergen,
// schreiben, Live-Reconfigure. So überschreibt kein Renderer-Entwurf den Status (Lost-Update).
// A2: load()→merge→save() lief hier bisher als ZWEI unabhängige Store-Zugriffe ohne gegenseitigen
// Ausschluss — zwei überlappende Aufrufe (z. B. zwei apikey:save für verschiedene Anbieter, oder dieser
// Handler parallel zu settings:save) konnten sich gegenseitig überschreiben (der zweite Aufruf hatte vor
// dem Schreiben einen veralteten Stand geladen). `mutate()` (store.ts) serialisiert load()→fn()→save()
// jetzt als EINE Transaktion.
async function mergeApiKeyStatus(
  comp: MainComposition,
  anbieterId: string,
  status: ApiKeyStatus | null
): Promise<void> {
  // `next` bleibt null, wenn `fn` den No-Op-Zweig nimmt (Key soll entfernt werden, ist aber gar nicht
  // gesetzt) — identisches Verhalten zum früheren frühen `return` VOR save()/aktualisiere() unten.
  let next: BlitztextSettings | null = null
  await comp.einstellungen.mutate((aktuell) => {
    if (status === null) {
      if (!(anbieterId in aktuell.apiKeyStatus)) return aktuell // No-Op: nichts zu entfernen
      const apiKeyStatus = { ...aktuell.apiKeyStatus }
      delete apiKeyStatus[anbieterId]
      next = { ...aktuell, apiKeyStatus }
      return next
    }
    next = { ...aktuell, apiKeyStatus: { ...aktuell.apiKeyStatus, [anbieterId]: status } }
    return next
  })
  if (next) comp.aktualisiere(next)
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
    // A2: load()→merge→save() jetzt als EINE serialisierte Transaktion über `mutate()` (store.ts) statt
    // zwei unabhängiger Store-Zugriffe — verhindert ein Lost-Update, falls dieser Aufruf mit einem
    // gleichzeitigen apikey:save (mergeApiKeyStatus) überlappt.
    let zusammengefuehrt!: BlitztextSettings
    await comp.einstellungen.mutate((aktuell) => {
      zusammengefuehrt = { ...next, apiKeyStatus: aktuell.apiKeyStatus }
      return zusammengefuehrt
    })
    // v0.7.2 debug: nur der Umstand „Einstellungen gespeichert" — keine Werte, keine Felder.
    log.debug('einstellungen.gespeichert')
    // A4b: Rückgabewert durchreichen (true=sofort übernommen, false=verschoben bis Lauf-Ende) — der
    // Renderer (App.tsx speichern()) zeigt bei false einen abweichenden Hinweis.
    return comp.aktualisiere(zusammengefuehrt)
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

  // S4 (lokales ASR „Server prüfen"): Erreichbarkeits-Check für einen bestimmten Anbieter (Einstellungen-
  // Karte). Eingabe defensiv validieren (untrusted Renderer), gleiches Muster wie health:diagnose oben.
  ipcMain.handle('anbieter:pruefeErreichbarkeit', (_event, anbieterId: unknown) => {
    if (typeof anbieterId !== 'string' || anbieterId.trim() === '') {
      return {
        status: 'fehler' as const,
        titel: 'Anbieter-Erreichbarkeit',
        detail: 'Unbekannter Anbieter — bitte Einstellungen neu laden.'
      }
    }
    return comp.pruefeErreichbarkeitFuer(anbieterId)
  })

  // v0.7.2 „Ereignislog": Diagnose-Log-Kanäle für die LogsKarte.
  // pfad/oeffneOrdner/loeschen sind invoke (Antwort/Fehler zurück), schreibe ist fire-and-forget (send).
  ipcMain.handle('log:pfad', () => join(logOrdnerPfad(), 'blitztext.log'))
  ipcMain.handle('log:oeffneOrdner', () => shell.openPath(logOrdnerPfad()))
  ipcMain.handle('log:loeschen', () => {
    // rm mit force (kein Fehler, wenn die Datei nicht existiert) auf beide Log-Dateien im logs-Ordner.
    const ordner = logOrdnerPfad()
    rmSync(join(ordner, 'blitztext.log'), { force: true })
    rmSync(join(ordner, 'blitztext.alt.log'), { force: true })
    // Der Größenzähler der Senke führte sonst die (nun gelöschte) alte Größe weiter → die nächste Zeile
    // löste eine überflüssige Rotation der frisch neu erzeugten Mini-Datei aus.
    logSenke.setzeZurueck?.()
  })
  // Renderer-Log: fire-and-forget (send/on). Eingabe UNTRUSTED → parseRendererLog validiert und
  // präfixt mit `renderer.` (Spoofing-Schutz); bei Ungültigem passiert nichts.
  ipcMain.on('log:schreibe', (_event, roh: unknown) => {
    const n = parseRendererLog(roh)
    if (n) log[n.stufe](n.ereignis, n.felder)
  })

  // W2-S8 (Onboarding-Wizard, Probe-Schritt): manuelles Auslösen/Stoppen eines Workflows über IPC statt
  // Hotkey — der Wizard hat keinen Zugriff auf den globalen uiohook-Kanal. Eingabe defensiv validieren
  // (untrusted Renderer); der eigentliche Fortschritt kommt wie beim Hotkey über workflow:status
  // (comp.sitzung.onStatus, oben verdrahtet) — beide Handler resolven daher sofort (void), ohne auf den
  // Lauf zu warten (analog zum bisherigen Tray-„Abbrechen"/manuellen Auslösen).
  ipcMain.handle('sitzung:starteManuell', (_event, workflowId: unknown) => {
    if (typeof workflowId !== 'string' || workflowId.trim() === '') return
    void comp.sitzung.starteWorkflow(workflowId, 'manuell')
  })
  ipcMain.handle('sitzung:stoppeManuell', () => {
    void comp.sitzung.stoppe()
  })

  // Workflow-Export/Import als Preset-Datei (*.blitztext.json). Bewusst KEINE In-App-Galerie
  // (Nutzer-Entscheid) — nur Datei-Export/Import über native Speichern/Öffnen-Dialoge. Der Renderer
  // schickt beim Export nur die id (nicht das ganze Objekt) — Main hat über comp.einstellungen.load()
  // die Wahrheit über den aktuellen Workflow-Stand. KEIN Store-Write in diesen Handlern: der Renderer
  // übernimmt einen importierten Workflow über den normalen settings:save-Weg (Live-Reconfigure-Schutz
  // bleibt an einer Stelle gebündelt, statt hier einen zweiten Schreibpfad aufzumachen).
  ipcMain.handle('workflow:export', async (_event, workflowId: unknown) => {
    if (typeof workflowId !== 'string' || workflowId.trim() === '') {
      return { ok: false as const, grund: 'unbekannt' as const }
    }
    const settings = await comp.einstellungen.load()
    const workflow = settings.workflows.find((w) => w.id === workflowId)
    if (!workflow) return { ok: false as const, grund: 'unbekannt' as const }

    const preset = workflowZuPreset(workflow)
    const dateiname = `${sanitisiereDateiname(workflow.label) || 'workflow'}.blitztext.json`
    const dialogOptionen = {
      defaultPath: dateiname,
      filters: [{ name: 'Blitztext-Preset', extensions: ['json'] }]
    }
    const result = settingsWindow
      ? await dialog.showSaveDialog(settingsWindow, dialogOptionen)
      : await dialog.showSaveDialog(dialogOptionen)
    if (result.canceled || !result.filePath) {
      return { ok: false as const, grund: 'abgebrochen' as const }
    }
    try {
      await writeFile(result.filePath, JSON.stringify(preset, null, 2), 'utf-8')
      return { ok: true as const, pfad: result.filePath }
    } catch {
      return { ok: false as const, grund: 'schreibfehler' as const }
    }
  })

  ipcMain.handle('workflow:import', async () => {
    const dialogOptionen: Electron.OpenDialogOptions = {
      properties: ['openFile'],
      filters: [{ name: 'Blitztext-Preset', extensions: ['json'] }]
    }
    const result = settingsWindow
      ? await dialog.showOpenDialog(settingsWindow, dialogOptionen)
      : await dialog.showOpenDialog(dialogOptionen)
    if (result.canceled || result.filePaths.length === 0) {
      return { ok: false as const, grund: 'abgebrochen' as const }
    }
    let inhalt: string
    try {
      inhalt = await readFile(result.filePaths[0]!, 'utf-8')
    } catch {
      return { ok: false as const, grund: 'lesefehler' as const }
    }
    let rohdaten: unknown
    try {
      rohdaten = JSON.parse(inhalt)
    } catch {
      return { ok: false as const, grund: 'ungueltig' as const }
    }
    const settings = await comp.einstellungen.load()
    const vorhandeneLabels = settings.workflows.map((w) => w.label)
    const workflow = parseImportierterWorkflow(rohdaten, vorhandeneLabels)
    if (!workflow) return { ok: false as const, grund: 'ungueltig' as const }
    return { ok: true as const, workflow }
  })
}

// Für den Preset-Dateinamen: Label auf ein dateisystemsicheres Zeichenrepertoire reduzieren
// (Windows verbietet u. a. \/:*?"<>|). Mehrfach-Whitespace/Trenner zu einem einzelnen Bindestrich,
// führende/folgende Bindestriche weg. Leeres Ergebnis wird vom Aufrufer auf 'workflow' zurückgefallen.
function sanitisiereDateiname(label: string): string {
  return label
    .replace(/[\\/:*?"<>|]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '')
}

const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', showSettings)

  app.whenReady().then(async () => {
    log.info('app.start', {
      version: app.getVersion(),
      electron: process.versions.electron ?? '',
      plattform: process.platform
    })
    app.setAppUserModelId('de.blitztext.app') // Windows: Voraussetzung für zuverlässige Notifications

    // Reihenfolge (ADR-0010): Settings laden (liefert standardAnbieterId) → Legacy-Key (api-key.bin)
    // auf die anbieter-spezifische Datei migrieren → Vault bauen → dann Komposition.
    const settingsFile = createSettingsFile()
    // v0.7.3 (A3/B1): auch der Startpfad-Store bekommt den Korruptions-Callback — er ist der ERSTE
    // load() beim Start (liefert standardAnbieterId für die Key-Migration), also die wahrscheinlichste
    // Stelle, an der eine kaputte Datei auffällt. Der `korruptGemeldet`-Flag im Callback verhindert eine
    // Doppel-Notification, falls der spätere Komposition-Store dieselbe (bereits beiseitegelegte) Datei
    // erneut trifft.
    const startSettings = await createSettingsStore({
      file: settingsFile,
      aufKorruption: meldeSettingsKorrupt
    }).load()
    // v0.7.2: gespeicherte Debug-Stufe des Ereignislogs übernehmen (env BLITZTEXT_DEBUG=1 bleibt erzwungen).
    log.setzeDebugAktiv?.(startSettings.ausfuehrlichesProtokoll)
    // v0.8.0 (perfAktiv): die env-Variable bleibt ein Override (Muster wie BLITZTEXT_DEBUG oben) — die
    // Einstellung ODER das Flag genügt, um die echte Instrumentierung anzulegen. Bewusst NACH dem
    // Settings-Laden statt beim Modul-Top (siehe Kommentar an der `let perf`-Deklaration): wirkt erst
    // nach einem Neustart, weil der uiohook-Hook weiter unten mit GENAU diesem `perf`-Objekt verdrahtet
    // wird und bei einer späteren Einstellungsänderung nicht neu aufgebaut wird.
    if (startSettings.perfAktiv || process.env['BLITZTEXT_PERF'] === '1') {
      perf = createPerfInstrumentierung()
    }
    await migriereLegacyApiKey({
      legacy: createApiKeyFile(),
      ziel: createApiKeyVaultFile(startSettings.standardAnbieterId)
    })
    const apiKeys = createApiKeyVault({
      cipher: safeStorageCipher,
      dateiFuer: createApiKeyVaultFile,
      aufKorruption: meldeSecretsKorrupt
    })
    createTray()

    // Farbschema: Systemänderungen an die Fenster broadcasten + Tray-Icon nachziehen (#Design).
    // v0.7.3 (B1): der Broadcast läuft über sendeAn (canSend-Gate) — ein gerade zerstörtes/neu ladendes
    // Fenster in der Liste würde bei nacktem webContents.send sonst werfen (uncaughtException → App-Tod).
    nativeTheme.on('updated', () => {
      const dark = nativeTheme.shouldUseDarkColors
      for (const w of BrowserWindow.getAllWindows()) sendeAn(w, 'theme:systemChanged', dark)
      aktualisiereTrayIcon(dark)
    })

    // M3/#11 — die Sitzung montieren und die nativen Adapter anschließen.
    recorderWindow = createRecorderWindow()
    pillWindow = createPillWindow()
    // v0.7.4: Anzeige-Steuerung an das frisch erzeugte Fenster hängen (siehe pillen-steuerung.ts).
    pillenSteuerung = erstellePillenSteuerung({
      fenster: pillWindow,
      ermittleArbeitsflaeche: arbeitsflaecheFuerPille,
      log
    })
    const ausgabe = createPasteAusgabe({
      log,
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
      log,
      recorder: createRecorder(recorderWindow, { log }),
      ausgabe,
      apiKeys,
      settingsFile,
      // v0.7.3 (A3/B1): derselbe Korruptions-Callback wie beim Startpfad-Store (korruptGemeldet-Flag
      // schützt vor Doppel-Notification, falls beide Stores die kaputte Datei treffen).
      aufSettingsKorruption: meldeSettingsKorrupt,
      // V2 Strang D: verschlüsselter Verlauf (safeStorage/DPAPI) + text-freie Statistik.
      verlaufCipher: safeStorageCipher,
      verlaufFile: createHistoryFile(),
      // A1: Störfall-Melder für den Verlauf (siehe meldeVerlaufKorrupt oben).
      aufVerlaufKorruption: meldeVerlaufKorrupt,
      statsFile: createStatsFile(),
      // P5b: nach erfolgtem Verlauf-Schreiben das Dashboard zum Neuladen anstoßen (race-frei, da das
      // Event erst nach dem aufgelösten Schreibvorgang feuert). sendeAn prüft null/isDestroyed.
      onHistoryChanged: () => sendeAn(settingsWindow, 'history:changed'),
      // W3-γ: Autostart über den HKCU-Run-Key (portable .exe).
      // v0.7.4: NICHT `process.execPath` — bei einem portable-Build zeigt der auf die ins %TEMP%
      // entpackte Kopie (bei jedem Start eine andere), nicht auf die vom Nutzer gestartete .exe. Der
      // Run-Key bekam dadurch einen toten Pfad: Autostart hat nie funktioniert. `PORTABLE_EXECUTABLE_FILE`
      // (von electron-builder gesetzt) trägt den echten Pfad; siehe autostart/exe-pfad.ts.
      autostart: createDefaultAutostart(),
      exePfad: ermittleAutostartExePfad(process.env, process.execPath),
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

    // v0.7.3 (B1): Selbstheilung der versteckten Renderer montieren — NACH createRecorder (das läuft in
    // createMainComposition oben und registriert im recorder-adapter seinen eigenen 'render-process-gone'-
    // Listener, der einen wartenden stop() ablehnt). Registrierungsreihenfolge = Feuerreihenfolge: der
    // Adapter-Listener feuert VOR unserem Reload, also läuft das stop()-Reject zuerst und der Reload trifft
    // ein sauber abgeräumtes webContents. Recorder: Notification bei Aufgabe (Aufnahme dauerhaft tot ist
    // sichtbar relevant); Pille: nur Log (rein visueller Statushinweis, kein Datenverlust).
    if (recorderWindow) {
      fensterHeilungen.push(
        montiereFensterHeilung({
          fenster: recorderWindow,
          name: 'recorder',
          log,
          beiAufgabe: () =>
            benachrichtige(
              'Blitztext',
              'Das Aufnahme-Fenster ist wiederholt abgestürzt. Bitte Blitztext neu starten.'
            )
        })
      )
    }
    if (pillWindow) {
      fensterHeilungen.push(
        montiereFensterHeilung({ fenster: pillWindow, name: 'pille', log })
      )
    }

    // IPC erst nach dem Bau der Komposition registrieren (Handler brauchen comp), dann Fenster zeigen.
    registerIpc(apiKeys, comp)
    baueTrayMenu(comp)
    showSettings()

    // C5: Update-Hintergrund-Check — Start-Check nach ~1min (App-Start nicht verzögern), danach
    // regelmäßig. comp.pruefeUpdate() liest das Opt-in LIVE aus den Settings und bremst über den
    // Mindestabstand (v0.8.0 einstellbar) + ETag-Cache selbst (kein Netz-Spam). .unref(), damit die
    // Timer einen App-Exit nicht künstlich offenhalten; Cleanup zusätzlich explizit bei will-quit.
    //
    // Das Poll-Intervall ist NUR das Raster, in dem gefragt wird „darf jetzt geprüft werden?" — die
    // eigentliche Kadenz bestimmt der Mindestabstand. Damit ein Nutzer die kürzeste wählbare Stufe
    // auch tatsächlich bekommt, wird das Raster aus der Stufenliste ABGELEITET statt festverdrahtet:
    // sonst würde eine später ergänzte Stufe unterhalb des Rasters still auf das Raster aufgerundet
    // (Review-Befund v0.8.0 — heute unauffällig, weil die kleinste Stufe zufällig dem alten
    // 6h-Festwert entspricht).
    const pollIntervallMs = Math.min(...UPDATE_INTERVALL_STUNDEN_STUFEN) * 60 * 60_000
    updateStartTimer = setTimeout(() => void fuehreUpdateCheckAus(comp), 60_000)
    updateStartTimer.unref()
    updateIntervallTimer = setInterval(() => void fuehreUpdateCheckAus(comp), pollIntervallMs)
    updateIntervallTimer.unref()

    // Runner-Phase → Tray-Tooltip + fokusfreie Status-Pille (stiehlt keinen Fokus, ADR-0007).
    comp.sitzung.onStatus = (phase) => {
      // Befund B (Feld-Log 2026-07-31): Anker für die Pillen-Arbeitsfläche setzen/lösen. 'aufnehmen'
      // OHNE `bestaetigt` ist die EINZIGE Phase, die runner.start() bei JEDEM neuen Lauf sendet (Hotkey
      // UND manueller Start, s. runner.ts `start()`) — exakt der vom Auftrag verlangte Phasenbeginn.
      // Ab hier bleibt die Arbeitsfläche für den gesamten Lauf konstant (pillen-steuerung.ts
      // laufBeginnt()), selbst wenn der Mauszeiger während der Verarbeitung auf einen anderen Monitor
      // wandert (genau der Feld-Befund: die Pille sprang der „Zeiger"-Quelle hinterher und wurde dadurch
      // vom Nutzer nicht mehr gesehen). 'idle' (Abbruch oder App-Start-Ruhezustand) löst den Anker
      // wieder — die nächste Anzeige OHNE laufenden Lauf ermittelt wieder frisch.
      if (phase.status === 'aufnehmen' && !phase.bestaetigt) {
        pillenSteuerung?.laufBeginnt()
      } else if (phase.status === 'idle') {
        pillenSteuerung?.laufEndet()
      }

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

      // C4-main: Aufnahme-Indikator fürs Settings-Fenster. Gezielt NUR an settingsWindow (analog
      // history:changed), nicht an alle Fenster (anders als theme:systemChanged). sendeAn prüft bereits
      // null/isDestroyed — kein zusätzliches isVisible()-Gate (siehe Design-Doc C4-main: ein Event an
      // ein verstecktes, aber existierendes Fenster ist harmlos/Standard-Electron).
      // Payload = die ROHE WorkflowPhase (nicht die bereits gemappte PillenStatus) — der Renderer-Hook
      // (use-workflow-status.ts) mappt selbst über pillenStatus(), damit `dauerMs` & Co. bei Bedarf ohne
      // Main-Änderung mitgenommen werden können.
      sendeAn(settingsWindow, 'workflow:status', phase)

      // Status-Pille (fokusfrei, Recorder-Fenster) nutzt weiterhin die gemappte PillenStatus lokal hier.
      // v0.7.3 (B1): ALLE Pillen-Zugriffe laufen über die canSend/isDestroyed-gesicherten Hüllen
      // (pilleSichtbar/pilleHide) — ein während des Betriebs zerstörtes (oder gerade neu geladenes)
      // Pillen-Fenster darf keinen send-auf-Zerstörtes-Crash mehr auslösen.
      // v0.8.0 (pillenAnzeigedauerProfil, Sonderfall): `pillenStatus()` läuft hier AUSSERHALB der
      // composition-root-Closures (kein getConfig/getBaseUrl-Muster verfügbar) — `comp.aktuelleEinstellungen()`
      // liefert die lebende Settings-Kopie synchron (kein Disk-I/O), `pillenAnzeigedauerWerteFuer` löst
      // das Profil in die drei Zahlen auf (EINZIGE Berechnungsstelle, shared/laufzeit-profile.ts).
      const s = pillenStatus(
        phase,
        pillenAnzeigedauerWerteFuer(comp.aktuelleEinstellungen().pillenAnzeigedauerProfil)
      )
      if (pillFehlerTimer) {
        clearTimeout(pillFehlerTimer)
        pillFehlerTimer = null
      }
      if (s.sichtbar) {
        pilleSichtbar(s.label)
        // Fehler/Teil-Erfolg bleiben sonst stehen (kein weiteres onStatus bis zum nächsten Lauf) → auto-ausblenden.
        // A3: Anzeigedauer kommt aus pillenStatus() (nach Textlänge gestaffelt, gedeckelt) statt fixer 4000ms.
        if (phase.status === 'fehler' || phase.status === 'teilErfolg') {
          pillFehlerTimer = setTimeout(() => pilleHide(), s.dauerMs ?? 4000)
        }
      } else {
        pilleHide()
      }
    }

    // Erstlauf-Härtung (H1): die versteckten Renderer (Recorder/Pille) werden fire-and-forget geladen
    // (loadFile/URL) — der Hook darf erst starten, wenn sie ihre IPC-Listener registriert haben, sonst
    // verpufft der allererste recorder:start / pill:status nach Kaltstart. Timeout = Fallback (der Hook
    // startet IMMER, blockiert nie).
    const fensterNamen = ['recorder', 'pille'] as const
    const bereitschaft = await warteAufFensterBereit([recorderWindow, pillWindow], 3000)
    if (!bereitschaft.bereit) {
      log.warnung('app.fenster_bereit_timeout', { dauerMs: bereitschaft.dauerMs })
    } else {
      log.debug('app.fenster_bereit', { dauerMs: bereitschaft.dauerMs })
    }
    // v0.7.4: Ein 'did-fail-load' galt bisher als „fertig geladen" und wurde NIRGENDS protokolliert —
    // ein gescheitertes pill.html/recorder.html war damit spurlos (Fenster lebt, send() verpufft,
    // showInactive() zeigt eine leere Fläche). Jetzt einmal beim Start und dauerhaft danach.
    for (const i of bereitschaft.ladefehler) {
      log.warnung('fenster.ladefehler', { fenster: fensterNamen[i] ?? 'pille', beimStart: true })
    }
    ladefehlerWaechter.push(
      protokolliereLadefehler(recorderWindow, 'recorder', log),
      protokolliereLadefehler(pillWindow, 'pille', log)
    )

    // v0.7.4 (electron#32001) — DIE Ursache für „Status-Pille bleibt unsichtbar", im Feld bestätigt.
    // Ein mit `show:false` erzeugtes, transparentes Fenster bekommt unter Windows unzuverlässig NIE
    // einen ersten Compositor-Frame. Ein späteres showInactive() findet dann nichts vor, was es
    // darstellen könnte: Das Fenster gilt als sichtbar (isVisible() === true) und bleibt trotzdem
    // vollständig unsichtbar — dauerhaft, auch über jeden Inhaltswechsel hinweg, weshalb auch die
    // späteren Phasen („Transkribiere …") nichts zeigten. Bestätigter Upstream-Fehler, bis heute OFFEN:
    // der Fix-PR electron/electron#49938 steht auf Draft, die Backports sind bis einschließlich 44
    // „pending". Die frühere Notiz „Fix-Backports erst ab 39" war eine Fehlannahme — es gibt derzeit
    // KEINE Electron-Version, in der der Fehler behoben ist (geprüft mit dem Sprung auf 43.2.0).
    //
    // Einmaliges Zeigen+Verstecken direkt nach dem Laden etabliert die Zeichenfläche, solange sie noch
    // niemand braucht. Kosten: allenfalls ein kurzes Aufblitzen beim App-Start. NICHT entfernen, solange
    // https://github.com/electron/electron/issues/32001 offen ist — an keine Versionsnummer binden,
    // sondern vor dem Entfernen den Issue-Stand prüfen. `pille.warmup sichtbar=…` im Log
    // (info-Stufe, ohne Debug-Schalter sichtbar) belegt bei jedem Start, dass es gegriffen hat.
    pillenSteuerung?.waermeAuf()

    // Befund A (v0.8.0, Feld-Log 2026-07-31): Mikrofon-Vorwärmung bereits beim App-Start auslösen, statt
    // erst ab der ERSTEN echten Aufnahme davon zu profitieren. Befund 11 hält den Stream zwischen zwei
    // Aufnahmen offen — das half aber nur ab der ZWEITEN, weil der Stream vorher schlicht noch nie
    // geöffnet worden war. Im Feld belegt: der Nutzer ließ die Taste nach ~1,2s los, bevor getUserMedia
    // beim Kaltstart fertig war ("Keine aktive Aufnahme.", Diktat verloren).
    //
    // Fire-and-forget (KEIN await): der App-Start darf NICHT auf ein bereites Mikrofon warten. Wie beim
    // Pillen-Aufwärmen erst NACH `warteAufFensterBereit`, damit der Recorder-Renderer seinen IPC-Listener
    // (onWarmup, s. recorder.ts) schon registriert hat — sonst verpufft der Kanal spurlos (H1-Muster).
    // Bewusst VOR `starteUiohookQuelle` (unten): der Hotkey-Hook ist hier noch nicht aktiv, ein echtes
    // Diktat kann also unmöglich schon laufen — die Reihenfolge dieser beiden Aufrufe ist damit selbst
    // schon die erste Absicherung gegen eine Störung eines laufenden Diktats (recorder.ts sichert
    // zusätzlich über den Generationszähler/die Warm-Stream-Prüfung ab, siehe dortigen Kommentar).
    //
    // Schlägt die Vorwärmung fehl (kein Mikrofon, keine Berechtigung), bleibt das FOLGENLOS: kein
    // Fehler-Popup, keine Fehler-Pille — der Nutzer hat an dieser Stelle nichts angefordert. recorder.ts
    // protokolliert höchstens eine info-Log-Zeile; hier ist kein Fehlerpfad zu behandeln (sendeAn
    // schlägt bei nicht sendbarem Fenster ebenfalls folgenlos fehl, kein Log nötig — anders als bei
    // recorder:start/-stop ist ein verpuffter Warm-up-Versuch nie ein Nutzer-sichtbares Problem).
    //
    // AUSGEWEITETER PREIS (ausdrücklich festgehalten): das Windows-Mikrofonsymbol leuchtet damit schon
    // beim App-Start auf, nicht erst beim ersten Diktat. Das ist dieselbe, vom Nutzer bereits akzeptierte
    // Dauer-Aktivierung aus Befund 11 — sie beginnt jetzt nur früher. KEIN neuer Fehlerfall.
    sendeAn(recorderWindow, 'recorder:warmup', comp.aktuelleEinstellungen().mikrofonDeviceId)

    // Globaler Hotkey über uiohook → verarbeiteTaste → Sitzung (ersetzt den globalShortcut-Platzhalter).
    // onStatus speist den Start-Erfolg in den Health-Check „Hotkey-Erkennung" (W3-ε).
    // perf: NOOP_PERF im Normalbetrieb (siehe oben) — nur bei BLITZTEXT_PERF=1 eine echte Messung.
    stopUiohook = starteUiohookQuelle({
      verarbeiteTaste: comp.verarbeiteTaste,
      onStatus: (aktiv) => comp.setzeHotkeyHookAktiv(aktiv),
      perf,
      log
    })

    // W3-γ: Registry-Autostart-Eintrag an das gespeicherte `autostart`-Feld angleichen (heilt einen
    // verwaisten Eintrag nach dem Verschieben der .exe). Best effort — Fehler werden intern geschluckt.
    // v0.7.4: text-freier Beleg, aus welcher Quelle der Autostart-Pfad stammt. NUR das Boolean — der
    // Pfad selbst enthält den Windows-Benutzernamen und darf nie ins Log (Leak-Regel).
    log.info('autostart.pfadquelle', { portable: istPortablerStart(process.env) })
    void comp.syncAutostartBeimStart()

    // Sperre/Standby verschlucken Keyups (Win+L → Secure Desktop, RESEARCH §3): Tasten-Tracking
    // zurücksetzen, sonst bleibt z. B. die Win-Taste „gedrückt" und LinksStrg allein startet die
    // Aufnahme. Ein gerade aktiver Hotkey-Lauf wird dabei abgebrochen.
    powerMonitor.on('lock-screen', () => {
      log.info('system.sperre')
      comp.setzeTastenZurueck()
    })
    powerMonitor.on('unlock-screen', () => {
      log.info('system.entsperrt')
      comp.setzeTastenZurueck()
    })
    powerMonitor.on('suspend', () => {
      log.info('system.standby')
      comp.setzeTastenZurueck()
    })
    powerMonitor.on('resume', () => {
      log.info('system.aufwachen')
      comp.setzeTastenZurueck()
    })

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) showSettings()
    })
  }).catch((err) => {
    log.fehler('app.start_fehl', redigiereFehler(err))
    console.error('App-Start fehlgeschlagen:', err)
  })

  // Tray-App: weiterlaufen, auch wenn kein Fenster offen ist.
  app.on('window-all-closed', () => {})

  app.on('before-quit', () => {
    isQuitting = true
  })

  app.on('will-quit', () => {
    log.info('app.ende')
    stopUiohook()
    // v0.7.3 (B1): Fenster-Heilungs-Listener abmelden (kein Reload mehr während des App-Abbaus).
    for (const h of fensterHeilungen) h.entferne()
    // v0.7.4: dito für die 'did-fail-load'-Wächter — beim Abbau ist ein Ladefehler erwartbar, kein Befund.
    for (const w of ladefehlerWaechter) w.entferne()
    perf.stoppe() // No-Op bei NOOP_PERF; verhindert einen hängenden Log-Timer bei BLITZTEXT_PERF=1
    // C5: Update-Timer aufräumen (Start-Timeout kann beim Beenden noch ausstehen, Intervall läuft sonst weiter).
    if (updateStartTimer) clearTimeout(updateStartTimer)
    if (updateIntervallTimer) clearInterval(updateIntervallTimer)
  })
}
