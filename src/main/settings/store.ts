// Persistenz der Einstellungen für Transkription + Umschreiben (#07). Reiner Kern hinter einem
// injizierten Datei-Port → ohne echtes Dateisystem testbar (Muster wie der Secret-Store, #01).
// Migration: feldweise Defaults (wie macOS decodeIfPresent), keine Schema-Version.

import {
  BUILTIN_WORKFLOWS,
  NEUER_WORKFLOW_TEMPERATUR,
  DEFAULT_HOTKEYS,
  type WorkflowId,
  type WorkflowDefinition,
  type PromptModus,
  type PromptVersion
} from '@shared/workflows'
import type { AnbieterKonfig } from '@shared/anbieter'
import { getProvider } from '@shared/providers'
import { EUR_PRO_USD, type PreisOverrides, type ModellPreis } from '@shared/pricing'
import { normalisiereBegriffe } from '@shared/begriffe'
import type { RecordingMode } from '@main/hotkey/matcher'
import {
  MINDEST_AUFNAHME_SEKUNDEN_STUFEN,
  MINDEST_AUFNAHME_SEKUNDEN_DEFAULT,
  STILLE_PROFIL_STUFEN,
  STILLE_PROFIL_DEFAULT,
  type StilleProfil,
  NETZWERK_PROFIL_STUFEN,
  NETZWERK_PROFIL_DEFAULT,
  type NetzwerkProfil,
  RETRY_VERSUCHE_STUFEN,
  RETRY_VERSUCHE_DEFAULT,
  VERLAUF_MAXIMUM_STUFEN,
  VERLAUF_MAXIMUM_DEFAULT,
  STATISTIK_KOMPAKTIERUNG_TAGE_STUFEN,
  STATISTIK_KOMPAKTIERUNG_TAGE_DEFAULT,
  UPDATE_INTERVALL_STUNDEN_STUFEN,
  UPDATE_INTERVALL_STUNDEN_DEFAULT,
  PILLEN_ANZEIGEDAUER_PROFIL_STUFEN,
  PILLEN_ANZEIGEDAUER_PROFIL_DEFAULT,
  type PillenAnzeigedauerProfil,
  PERF_AKTIV_DEFAULT,
  istStufe
} from '@shared/laufzeit-profile'

/** Recency-Status eines API-Keys (P1): „zuletzt erfolgreich getestet". NUR im Main verwaltet. */
export interface ApiKeyStatus {
  status: 'verifiziert'
  zuletztGetestetMs: number
}

export interface BlitztextSettings {
  language: string
  customTerms: string[]
  tone: 'formal' | 'neutral' | 'casual'
  emojiDensity: 'wenig' | 'mittel' | 'viel'
  /** Aufnahmemodus (CONTEXT.md): Halten = 'hold', Drücken = 'toggle'. */
  aufnahmemodus: RecordingMode
  /** Chord je Workflow als abstrakte Tastennamen; der uiohook-Adapter mappt Keycodes (HITL). */
  hotkeys: Record<WorkflowId, string[]>
  /** Hinterlegte Anbieter (ADR-0010); einer ist Standard. Migration aus dem alten Single-`provider`. */
  anbieter: AnbieterKonfig[]
  /** Id des Standard-Anbieters (für Workflows ohne eigene Zuordnung + Assistent/Validierung). */
  standardAnbieterId: string
  /** Workflows (eingebaut + nutzer-definiert). Migration seedet die vier eingebauten. */
  workflows: WorkflowDefinition[]
  /** Verlauf aufzeichnen? Opt-in, Standard AUS (ADR-0009, sensibler Text). */
  verlaufAktiv: boolean
  /** Verlauf-Sperre (D5): erzwingt Verlauf AUS, egal was verlaufAktiv sagt. Macht NICHTS lokal —
   *  Audio/Text gehen weiter an den Anbieter (ADR-0016). Vormals „sichererLokalerModus" (migriert). */
  verlaufGesperrt: boolean
  /** Fokus-Rückkehr vor dem Einfügen (ADR-0011, F-1). Default an; nur bei echtem Drift aktiv. */
  fokusRueckkehr: boolean
  /** Farbschema: dem System folgen oder manuell. Default 'system'. */
  theme: 'system' | 'hell' | 'dunkel'
  /** Nutzer-Overrides der Preistabelle je Modell-Id (P7). Default {} = nur Default-Preise. */
  preisOverrides: PreisOverrides
  /** Editierbarer USD→EUR-Kurs (P7). Default = EUR_PRO_USD. */
  usdEurKurs: number
  /** „Zuletzt erfolgreich getestet" je Anbieter (P1). NUR im Main geschrieben (Lost-Update-Schutz). */
  apiKeyStatus: Record<string, ApiKeyStatus>
  /** Mit Windows starten (W3-γ/3.2). Default AUS. Ehrlich: bricht, wenn die portable .exe verschoben wird. */
  autostart: boolean
  /** Gewähltes Mikrofon (deviceId aus enumerateDevices, W3-ζ). Leer = OS-Standardgerät. */
  mikrofonDeviceId: string
  /** Opt-in Update-Hinweis (W3-δ). Default AUS — KEIN Netzabruf ohne ausdrückliche Zustimmung. */
  updateHinweisAktiv: boolean
  /** Debug-Stufe des Ereignislogs (v0.7.2). Default AUS. BLITZTEXT_DEBUG=1 erzwingt sie unabhängig davon. */
  ausfuehrlichesProtokoll: boolean
  /** Sortierrichtung im Verlauf (C2). Default 'neuesteZuerst'. Migration wie `theme` (includes-Check). */
  verlaufSortierung: 'neuesteZuerst' | 'aeltesteZuerst'
  /**
   * W2-S8: hat der Nutzer den Onboarding-Wizard abgeschlossen (oder übersprungen)? Default AUS (neue
   * Installation zeigt den Wizard). Migration bei fehlendem Feld (alte Settings-Datei ohne dieses
   * Feld = Bestandsnutzer, KEIN Neuling): Heuristik in parseSettings setzt es auf true, wenn bereits
   * ein API-Key getestet wurde ODER mehr als die vier eingebauten Workflows existieren — beides sind
   * Spuren echter Vornutzung, die ein frisch installierter Wizard-Kandidat nicht haben kann.
   */
  onboardingAbgeschlossen: boolean

  /**
   * v0.8.0 (Auftrag 1, Nutzer-Befund): einmalige Kennzeichnung für eine SPÄTERE Oberfläche (hier nicht
   * gebaut — reines Datenmodell). BUILTIN_WORKFLOWS (shared/workflows.ts) pinnte bis hierhin auf allen
   * vier eingebauten Workflows hart `anbieterId: 'openai'`; das ist entfernt (sie erben jetzt den
   * Standard-Anbieter). Eine BESTEHENDE settings.json mit bereits gespeichertem `anbieterId:'openai'`
   * auf einem Built-in behält diese Zuordnung unverändert (Bestandsschutz, s. parseWorkflow) — aus der
   * Datei allein lässt sich nicht unterscheiden, ob das ein nie angefasster Altwert oder eine bewusste
   * Nutzerwahl war. Damit ein solcher Altbestand trotzdem einmal auffällt (statt für immer unsichtbar
   * zu bleiben), markiert dieses Feld GENAU DAS: false = ein Hinweis steht noch aus (eine künftige
   * Oberfläche könnte daraus einen einmaligen Tipp „Built-ins erben jetzt automatisch den
   * Standard-Anbieter — im Workflow-Editor auf 'Erbt Standard' umstellen?" bauen und das Feld danach
   * auf true setzen); true = kein Hinweis nötig.
   * Default true (frische Installationen: der neue, nicht gepinnte Startwert gilt von Anfang an, nichts
   * hinzuweisen). Migration bei fehlendem Feld (alte Datei, Heuristik wie `onboardingAbgeschlossen`,
   * nur mit umgekehrter Polung): false, wenn mindestens ein BUILTIN-Workflow noch einen gepinnten
   * (nicht-leeren) `anbieterId` trägt — sonst true.
   */
  builtinAnbieterHinweisAbgeschlossen: boolean

  // --- v0.8.0: Laufzeit-Profile (src/shared/laufzeit-profile.ts) — ausschließlich per geschlossener
  // Stufenliste konfigurierbar (Dropdown-Vorgabe der Nutzer-Anforderung). Jeder Default reproduziert
  // exakt das bis hierhin hart kodierte Verhalten (siehe laufzeit-profile.ts für die Herleitung je Stufe).
  /** Mindest-Aufnahmedauer (Sekunden), löst MINIMUM_RECORDING_SECONDS (quality.ts) ab. Default 0.3. */
  mindestAufnahmeSekunden: number
  /** Stille-Erkennungs-Profil, löst STILLE_HART/STILLE_WEICH/STILLE_DYNAMIK (quality.ts) ab. Default 'normal'. */
  stilleProfil: StilleProfil
  /** Netzwerk-Timeout-Profil (Fetch + daraus abgeleiteter Watchdog). Default 'normal'. */
  netzwerkProfil: NetzwerkProfil
  /** Anzahl Anbieter-Retry-Versuche. Default 2. */
  retryVersuche: number
  /** Deckelung der Anzahl gespeicherter Verlauf-Einträge. Default 200. */
  verlaufMaximum: number
  /** Ab welchem Alter (Tage) die Statistik monatlich kompaktiert wird. Default 90. */
  statistikKompaktierungTage: number
  /** Prüfintervall (Stunden) des opt-in Update-Hinweises. Default 24. */
  updateIntervallStunden: number
  /** Pillen-Anzeigedauer-Profil (Auto-Hide-Basis/Obergrenze/ms-pro-Zeichen, pill-status.ts). Default 'normal'. */
  pillenAnzeigedauerProfil: PillenAnzeigedauerProfil
  /** Perf-Messung (sonst nur über BLITZTEXT_PERF=1 env). Default false. */
  perfAktiv: boolean
}

// Default-Anbieter = OpenAI. ASR auf die moderne Generation `gpt-4o-mini-transcribe` (v0.2.4, per
// HITL-Test belegt: korrekter + schneller als whisper-1, das ~Juni 2026 ausläuft). Chat unverändert
// gpt-4o-mini. whisper-1 / gpt-4o-transcribe bleiben in der Registry wählbar.
const DEFAULT_ANBIETER: AnbieterKonfig = {
  id: 'openai',
  vorlage: 'openai',
  label: 'OpenAI',
  baseUrl: 'https://api.openai.com/v1',
  asrModell: 'gpt-4o-mini-transcribe',
  chatModell: 'gpt-4o-mini'
}

/** Persistenz-Port: liest/schreibt den serialisierten Einstellungs-String. Echter Adapter: fs. */
export interface SettingsFile {
  read(): Promise<string | null>
  write(content: string): Promise<void>
  /**
   * Korruptions-Rettung (v0.7.3, A3): benennt eine unlesbare Datei nach settings.json.korrupt um,
   * damit der nächste Start nicht dieselbe kaputte Datei wieder ablehnt. Optional — Fake-Ports ohne
   * diese Methode sind weiter gültig; der Store ruft sie nur mit `?.()`. Wirft NIE (best effort).
   */
  beiseiteLegen?(): Promise<void>
}

export interface SettingsStore {
  load(): Promise<BlitztextSettings>
  save(settings: BlitztextSettings): Promise<void>
  /**
   * A2 (Lost-Update-Schutz): load(), fn() und save() als EINE serialisierte Transaktion — behebt, dass
   * z. B. `settings:save` und `apikey:save` (index.ts) je ein eigenes load()→merge()→save() fuhren, ohne
   * gegenseitigen Ausschluss. Zwei überlappende Aufrufe (bei ihrer Registrierung serialisiert, siehe
   * `kette` in createSettingsStore) verlieren dadurch keine Änderung mehr — jeder Aufruf sieht den
   * bereits von vorherigen mutate()-Aufrufen geschriebenen Stand. Liefert den TATSÄCHLICH geschriebenen
   * (durch parseSettings voll geparsten/migrierten) Stand zurück.
   */
  mutate(
    fn: (aktuell: BlitztextSettings) => BlitztextSettings | Promise<BlitztextSettings>
  ): Promise<BlitztextSettings>
}

export function defaultSettings(): BlitztextSettings {
  return {
    language: 'de',
    customTerms: [],
    tone: 'neutral',
    emojiDensity: 'mittel',
    aufnahmemodus: 'hold',
    hotkeys: { ...DEFAULT_HOTKEYS },
    anbieter: [{ ...DEFAULT_ANBIETER }],
    standardAnbieterId: DEFAULT_ANBIETER.id,
    workflows: BUILTIN_WORKFLOWS.map((w) => ({ ...w })),
    verlaufAktiv: false,
    verlaufGesperrt: false,
    fokusRueckkehr: true,
    theme: 'system',
    preisOverrides: {},
    usdEurKurs: EUR_PRO_USD,
    apiKeyStatus: {},
    autostart: false,
    mikrofonDeviceId: '',
    updateHinweisAktiv: false,
    ausfuehrlichesProtokoll: false,
    verlaufSortierung: 'neuesteZuerst',
    onboardingAbgeschlossen: false,
    builtinAnbieterHinweisAbgeschlossen: true,
    mindestAufnahmeSekunden: MINDEST_AUFNAHME_SEKUNDEN_DEFAULT,
    stilleProfil: STILLE_PROFIL_DEFAULT,
    netzwerkProfil: NETZWERK_PROFIL_DEFAULT,
    retryVersuche: RETRY_VERSUCHE_DEFAULT,
    verlaufMaximum: VERLAUF_MAXIMUM_DEFAULT,
    statistikKompaktierungTage: STATISTIK_KOMPAKTIERUNG_TAGE_DEFAULT,
    updateIntervallStunden: UPDATE_INTERVALL_STUNDEN_DEFAULT,
    pillenAnzeigedauerProfil: PILLEN_ANZEIGEDAUER_PROFIL_DEFAULT,
    perfAktiv: PERF_AKTIV_DEFAULT
  }
}

// Preis-Overrides feldweise validieren: nur endliche Zahlen je Feld; leere Einträge werden verworfen.
function parsePreisOverrides(raw: unknown): PreisOverrides {
  if (typeof raw !== 'object' || raw === null) return {}
  const out: PreisOverrides = {}
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v !== 'object' || v === null) continue
    const o = v as Record<string, unknown>
    const eintrag: ModellPreis = {}
    if (typeof o.asrProMinuteUsd === 'number' && Number.isFinite(o.asrProMinuteUsd))
      eintrag.asrProMinuteUsd = o.asrProMinuteUsd
    if (typeof o.inputPro1MUsd === 'number' && Number.isFinite(o.inputPro1MUsd))
      eintrag.inputPro1MUsd = o.inputPro1MUsd
    if (typeof o.outputPro1MUsd === 'number' && Number.isFinite(o.outputPro1MUsd))
      eintrag.outputPro1MUsd = o.outputPro1MUsd
    if (Object.keys(eintrag).length > 0) out[id] = eintrag
  }
  return out
}

// apiKeyStatus feldweise validieren: nur { status:'verifiziert', zuletztGetestetMs:number }.
function parseApiKeyStatus(raw: unknown): Record<string, ApiKeyStatus> {
  if (typeof raw !== 'object' || raw === null) return {}
  const out: Record<string, ApiKeyStatus> = {}
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v !== 'object' || v === null) continue
    const o = v as Record<string, unknown>
    if (o.status !== 'verifiziert' || typeof o.zuletztGetestetMs !== 'number') continue
    out[id] = { status: 'verifiziert', zuletztGetestetMs: o.zuletztGetestetMs }
  }
  return out
}

const PROMPT_MODI: PromptModus[] = ['berechnet', 'statisch']

// Eine einzelne Workflow-Definition feldweise validieren; ungültige/fehlende Felder fallen auf
// sinnvolle Defaults zurück. Liefert null, wenn kein brauchbarer Datensatz (id fehlt).
// Prompt-Historie feldweise validieren (v0.2.5). Ungültige Einträge werden verworfen.
function parsePromptHistorie(raw: unknown[]): PromptVersion[] {
  const out: PromptVersion[] = []
  for (const r of raw) {
    if (typeof r !== 'object' || r === null) continue
    const o = r as Record<string, unknown>
    if (typeof o.id !== 'string' || typeof o.text !== 'string') continue
    out.push({
      id: o.id,
      zeitstempelMs: typeof o.zeitstempelMs === 'number' ? o.zeitstempelMs : 0,
      text: o.text,
      quelle: o.quelle === 'assistent' ? 'assistent' : 'manuell'
    })
  }
  return out
}

function parseWorkflow(raw: unknown): WorkflowDefinition | null {
  if (typeof raw !== 'object' || raw === null) return null
  const o = raw as Record<string, unknown>
  if (typeof o.id !== 'string' || o.id.trim() === '') return null
  const builtin = o.builtin === true
  const promptModus: PromptModus = PROMPT_MODI.includes(o.promptModus as PromptModus)
    ? (o.promptModus as PromptModus)
    : 'statisch'
  return {
    id: o.id,
    label: typeof o.label === 'string' && o.label.trim() !== '' ? o.label : o.id,
    summary: typeof o.summary === 'string' ? o.summary : '',
    builtin,
    rewrites: o.rewrites !== false, // Default: umschreiben (nur explizit false = reine Transkription)
    promptModus,
    systemPrompt: typeof o.systemPrompt === 'string' ? o.systemPrompt : '',
    model: typeof o.model === 'string' ? o.model : '',
    temperature: typeof o.temperature === 'number' ? o.temperature : NEUER_WORKFLOW_TEMPERATUR,
    anbieterId: typeof o.anbieterId === 'string' ? o.anbieterId : '',
    language: typeof o.language === 'string' ? o.language : '',
    ausgabeSprache: typeof o.ausgabeSprache === 'string' ? o.ausgabeSprache : '',
    ...(['formal', 'neutral', 'casual'].includes(o.tone as string)
      ? { tone: o.tone as WorkflowDefinition['tone'] }
      : {}),
    ...(['aus', 'wenig', 'mittel', 'viel'].includes(o.emojiDensity as string)
      ? { emojiDensity: o.emojiDensity as WorkflowDefinition['emojiDensity'] }
      : {}),
    ...(Array.isArray(o.promptHistorie)
      ? { promptHistorie: parsePromptHistorie(o.promptHistorie) }
      : {})
  }
}

// Workflows migrieren: gespeicherte (feldweise bereinigt, in ihrer Reihenfolge) übernehmen, dann
// fehlende eingebaute hinten anhängen — so gehen transcribe/improve/calm/emoji nie verloren.
// Doppelte Ids werden verworfen (erste gewinnt).
function parseWorkflows(raw: unknown): WorkflowDefinition[] {
  if (!Array.isArray(raw)) return BUILTIN_WORKFLOWS.map((w) => ({ ...w }))
  const ergebnis: WorkflowDefinition[] = []
  const gesehen = new Set<string>()
  for (const eintrag of raw) {
    const w = parseWorkflow(eintrag)
    if (!w || gesehen.has(w.id)) continue
    gesehen.add(w.id)
    ergebnis.push(w)
  }
  for (const b of BUILTIN_WORKFLOWS) {
    if (!gesehen.has(b.id)) ergebnis.push({ ...b })
  }
  return ergebnis
}

const strOder = (v: unknown, fb: string): string =>
  typeof v === 'string' && v.trim() !== '' ? v : fb

// Einen Anbieter feldweise validieren; null bei fehlender id (wird verworfen). vorlage/label fallen
// auf die Registry zurück (custom → 'custom'); fehlende Modelle/Base-URL auf den OpenAI-Default.
function parseEinAnbieter(raw: unknown): AnbieterKonfig | null {
  if (typeof raw !== 'object' || raw === null) return null
  const o = raw as Record<string, unknown>
  if (typeof o.id !== 'string' || o.id.trim() === '') return null
  const descriptor = getProvider(strOder(o.vorlage, o.id))
  const vorlage = descriptor ? descriptor.id : 'custom'
  // 'lokal'-Vorlage: fehlendes keinKeyNoetig-Feld → Default true (robust auch bei manuell editierter
  // Datei — die Vorlage IST der keylose lokale Server). Ein explizites `false` wird respektiert (der
  // Nutzer kann einen lokalen Server mit eigenem Auth-Schema bewusst wieder auf „Key nötig" stellen).
  const keinKeyNoetigDefault = vorlage === 'lokal' && o.keinKeyNoetig === undefined
  return {
    id: o.id,
    vorlage,
    label: strOder(o.label, descriptor?.label ?? o.id),
    baseUrl: strOder(o.baseUrl, descriptor?.baseUrl ?? DEFAULT_ANBIETER.baseUrl),
    asrModell: strOder(o.asrModell, DEFAULT_ANBIETER.asrModell),
    chatModell: strOder(o.chatModell, DEFAULT_ANBIETER.chatModell),
    ...(o.keinKeyNoetig === true || keinKeyNoetigDefault ? { keinKeyNoetig: true as const } : {})
  }
}

// Anbieter-Liste + Standard auflösen. Migration (idempotent, feldweise): liegt `anbieter[]` vor →
// übernehmen; sonst alter Single-`provider` → ein Listeneintrag (stabile id aus provider.id); sonst
// Default-OpenAI-Anbieter. Standard ohne Treffer → erster Listeneintrag.
function parseAnbieter(o: Record<string, unknown>): {
  anbieter: AnbieterKonfig[]
  standardAnbieterId: string
} {
  if (Array.isArray(o.anbieter)) {
    const liste = o.anbieter
      .map(parseEinAnbieter)
      .filter((a): a is AnbieterKonfig => a !== null)
    if (liste.length > 0) {
      const standard =
        typeof o.standardAnbieterId === 'string' && liste.some((a) => a.id === o.standardAnbieterId)
          ? o.standardAnbieterId
          : liste[0]!.id
      return { anbieter: liste, standardAnbieterId: standard }
    }
  }
  const eintrag = parseEinAnbieter(o.provider) ?? { ...DEFAULT_ANBIETER }
  return { anbieter: [eintrag], standardAnbieterId: eintrag.id }
}

const TONES: BlitztextSettings['tone'][] = ['formal', 'neutral', 'casual']
const DENSITIES: BlitztextSettings['emojiDensity'][] = ['wenig', 'mittel', 'viel']
const MODI: RecordingMode[] = ['hold', 'toggle']

function istChord(v: unknown): v is string[] {
  return Array.isArray(v) && v.length > 0 && v.every((k) => typeof k === 'string')
}

// Hotkeys über die (bereits geparsten) Workflows iterieren — so erhalten auch nutzer-definierte
// Workflows einen Eintrag, und verwaiste Keys (zu gelöschten Workflows) werden geprunt. Eingebaute
// Workflows ohne gespeicherten Chord fallen auf ihren Default zurück; custom ohne Chord bleibt leer.
function parseHotkeys(raw: unknown, workflows: WorkflowDefinition[]): Record<WorkflowId, string[]> {
  const o = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
  const ergebnis: Record<WorkflowId, string[]> = {}
  for (const { id } of workflows) {
    const standard = DEFAULT_HOTKEYS[id]
    if (istChord(o[id])) ergebnis[id] = o[id] as string[]
    else if (standard) ergebnis[id] = [...standard]
    else ergebnis[id] = []
  }
  return ergebnis
}

// Feldweise gegen die Defaults validieren: fehlende/typfremde/unbekannte Werte fallen zurück,
// unbekannte Extra-Felder werden verworfen.
function parseSettings(raw: unknown): BlitztextSettings {
  const d = defaultSettings()
  if (typeof raw !== 'object' || raw === null) return d
  const o = raw as Record<string, unknown>

  // Workflows ZUERST parsen — die Hotkey-Migration iteriert über sie (auch custom Workflows).
  const workflows = parseWorkflows(o.workflows)

  return {
    language: typeof o.language === 'string' && o.language.trim() !== '' ? o.language : d.language,
    // Terms-Kern: nach dem Typ-Filter zusätzlich normalisieren (trim/leer raus/Dedupe
    // case-insensitive) — verhindert Leerstring-Artefakte wie „Acme, , GmbH" aus alten/kaputten
    // Einstellungsdateien, die vor der Normalisierung gespeichert wurden.
    customTerms: normalisiereBegriffe(
      Array.isArray(o.customTerms)
        ? o.customTerms.filter((t): t is string => typeof t === 'string')
        : d.customTerms
    ),
    tone: TONES.includes(o.tone as BlitztextSettings['tone']) ? (o.tone as BlitztextSettings['tone']) : d.tone,
    emojiDensity: DENSITIES.includes(o.emojiDensity as BlitztextSettings['emojiDensity'])
      ? (o.emojiDensity as BlitztextSettings['emojiDensity'])
      : d.emojiDensity,
    aufnahmemodus: MODI.includes(o.aufnahmemodus as RecordingMode)
      ? (o.aufnahmemodus as RecordingMode)
      : d.aufnahmemodus,
    hotkeys: parseHotkeys(o.hotkeys, workflows),
    ...parseAnbieter(o),
    workflows,
    verlaufAktiv: o.verlaufAktiv === true,
    // A7-Migration: alten Schlüssel dauerhaft mit übernehmen (kein versioniertes Schema), nicht zurückschreiben.
    verlaufGesperrt: o.verlaufGesperrt === true || o.sichererLokalerModus === true,
    fokusRueckkehr: o.fokusRueckkehr !== false, // Default an
    theme: (['system', 'hell', 'dunkel'] as const).includes(o.theme as never)
      ? (o.theme as BlitztextSettings['theme'])
      : d.theme,
    preisOverrides: parsePreisOverrides(o.preisOverrides),
    usdEurKurs:
      typeof o.usdEurKurs === 'number' && Number.isFinite(o.usdEurKurs) && o.usdEurKurs > 0
        ? o.usdEurKurs
        : d.usdEurKurs,
    apiKeyStatus: parseApiKeyStatus(o.apiKeyStatus),
    // Neue W3-Felder (3.2). Migration-sicher: alte Datei ohne diese Felder ⇒ konservativer Default.
    autostart: o.autostart === true, // Default AUS
    mikrofonDeviceId: typeof o.mikrofonDeviceId === 'string' ? o.mikrofonDeviceId : d.mikrofonDeviceId,
    updateHinweisAktiv: o.updateHinweisAktiv === true, // Opt-in, Default AUS
    ausfuehrlichesProtokoll: o.ausfuehrlichesProtokoll === true, // Debug-Log, Default AUS
    verlaufSortierung: (['neuesteZuerst', 'aeltesteZuerst'] as const).includes(
      o.verlaufSortierung as never
    )
      ? (o.verlaufSortierung as BlitztextSettings['verlaufSortierung'])
      : d.verlaufSortierung,
    // W2-S8 (Onboarding-Wizard): explizit gesetzter boolean wird respektiert (auch `false` — ein
    // Nutzer, der den Wizard bewusst übersprungen/neu gestartet hat, soll ihn nicht wiedersehen).
    // Fehlt das Feld GANZ (alte Settings-Datei von vor diesem Feature), greift die Bestandsnutzer-
    // Heuristik: true, wenn bereits ein API-Key getestet wurde (apiKeyStatus nicht leer) ODER mehr als
    // die vier eingebauten Workflows existieren (>4 = der Nutzer hat mindestens einen eigenen
    // angelegt) — beides sind Spuren echter Vornutzung, die eine frische Installation nicht hat.
    // Ein FEHLENDES Feld ohne diese Spuren (frische Installation) bleibt false → der Wizard erscheint.
    onboardingAbgeschlossen:
      typeof o.onboardingAbgeschlossen === 'boolean'
        ? o.onboardingAbgeschlossen
        : Object.keys(parseApiKeyStatus(o.apiKeyStatus)).length > 0 || workflows.length > 4,
    // v0.8.0 (Auftrag 1): explizit gesetzter boolean wird respektiert (auch `false`, z. B. weil eine
    // künftige Oberfläche den Hinweis bereits gezeigt und diesen Wert selbst geschrieben hat). Fehlt
    // das Feld GANZ (alte Datei von vor diesem Feature): true (kein Hinweis nötig), AUSSER mindestens
    // ein BUILTIN-Workflow trägt noch einen gepinnten (nicht-leeren) anbieterId — dann false (Hinweis
    // steht aus). `workflows` ist hier bereits geparst (s.o.); ein NICHT-eingebauter Workflow mit
    // eigenem anbieterId zählt bewusst NICHT (das ist die längst bestehende „Anbieter pro Workflow"-
    // Funktion, kein Altbestand aus der Built-in-Pinnung).
    // Geprüft wird gezielt auf `'openai'` und NICHT auf „irgendein anbieterId" (Review-Befund v0.8.0):
    // nur `'openai'` war je der Werks-Startwert der Built-ins. Wer einem eingebauten Workflow bewusst
    // einen ANDEREN Anbieter zugewiesen hat, hat die Zuordnung gerade erst selbst getroffen — dem
    // müsste man nicht erklären, dass Built-ins ihn jetzt erben können.
    builtinAnbieterHinweisAbgeschlossen:
      typeof o.builtinAnbieterHinweisAbgeschlossen === 'boolean'
        ? o.builtinAnbieterHinweisAbgeschlossen
        : !workflows.some((w) => w.builtin && w.anbieterId === 'openai'),
    // v0.8.0 (Laufzeit-Profile): jedes Feld gegen seine geschlossene Stufenliste validiert (istStufe,
    // shared/laufzeit-profile.ts) — ein fehlender/typfremder/nicht in der Liste enthaltener Wert fällt
    // feldweise auf den Default zurück (kein Absturz, kein Teil-Update anderer Felder).
    mindestAufnahmeSekunden: istStufe(MINDEST_AUFNAHME_SEKUNDEN_STUFEN, o.mindestAufnahmeSekunden)
      ? o.mindestAufnahmeSekunden
      : d.mindestAufnahmeSekunden,
    stilleProfil: istStufe(STILLE_PROFIL_STUFEN, o.stilleProfil) ? o.stilleProfil : d.stilleProfil,
    netzwerkProfil: istStufe(NETZWERK_PROFIL_STUFEN, o.netzwerkProfil)
      ? o.netzwerkProfil
      : d.netzwerkProfil,
    retryVersuche: istStufe(RETRY_VERSUCHE_STUFEN, o.retryVersuche)
      ? o.retryVersuche
      : d.retryVersuche,
    verlaufMaximum: istStufe(VERLAUF_MAXIMUM_STUFEN, o.verlaufMaximum)
      ? o.verlaufMaximum
      : d.verlaufMaximum,
    statistikKompaktierungTage: istStufe(
      STATISTIK_KOMPAKTIERUNG_TAGE_STUFEN,
      o.statistikKompaktierungTage
    )
      ? o.statistikKompaktierungTage
      : d.statistikKompaktierungTage,
    updateIntervallStunden: istStufe(UPDATE_INTERVALL_STUNDEN_STUFEN, o.updateIntervallStunden)
      ? o.updateIntervallStunden
      : d.updateIntervallStunden,
    pillenAnzeigedauerProfil: istStufe(
      PILLEN_ANZEIGEDAUER_PROFIL_STUFEN,
      o.pillenAnzeigedauerProfil
    )
      ? o.pillenAnzeigedauerProfil
      : d.pillenAnzeigedauerProfil,
    perfAktiv: o.perfAktiv === true // nur === true zählt (Muster wie autostart etc.)
  }
}

export function createSettingsStore({
  file,
  aufKorruption
}: {
  file: SettingsFile
  /**
   * Korruptions-Callback (v0.7.3, A3): wird gerufen, wenn die Datei existiert, aber nicht lesbar/
   * parsebar ist (JSON.parse ODER parseSettings wirft). Optional; No-Op-Default → alle bestehenden
   * Aufrufer kompilieren unverändert. Der Empfänger (Phase B) loggt/benachrichtigt; der Store loggt
   * bewusst NICHT selbst (keine log-Dep im Kern). Eine fehlende Datei ist KEINE Korruption.
   */
  aufKorruption?: () => void
}): SettingsStore {
  // A7 (Cache): der zuletzt geparste Stand — vermeidet einen Disk-Read bei JEDEM load()-Aufruf, u. a.
  // im Hot-Path „Aufnahme starten" (sitzung.ts liest die Einstellungen bei jedem Lauf-Start neu). NUR
  // ein Schreiber im Prozess (Single-Instance-Lock, app.requestSingleInstanceLock() in index.ts) → eine
  // prozessinterne Momentaufnahme genügt, kein FS-Watcher nötig.
  //
  // BEWUSST NICHT erkannt: ändert der Nutzer settings.json von Hand, während die App läuft (kein
  // eigener Schreibvorgang der App), bleibt der Cache auf dem alten Stand — es gibt keinen FS-Watcher,
  // der externe Änderungen bemerkt. Das ist eine akzeptierte Design-Entscheidung (die App ist der
  // einzige Schreiber, ein FS-Watcher wäre zusätzliche Komplexität für einen Rand-Fall) und KEIN Bug.
  let cache: BlitztextSettings | null = null

  // Liefert den gecachten Stand, sonst EINMALIG von der Platte lesen+parsen (identischer Pfad wie
  // bisher `load()`). Korruptions-Pfad (A3): der geparste Defaults-Fallback WIRD gecacht — die Rettung
  // selbst ist mit `beiseiteLegen()` bereits abgeschlossen (Datei umbenannt), ein zweiter Versuch würde
  // ohnehin nur wieder auf dieselbe (nun fehlende) Datei treffen. Eine spätere Rettung/Neuanlage bleibt
  // trotzdem sichtbar: der nächste ECHTE Schreibvorgang (save()/mutate(), z. B. weil der Nutzer nach der
  // Störfall-Meldung die Einstellungen erneut speichert) aktualisiert den Cache ohnehin auf den frisch
  // geschriebenen Stand (siehe `schreibeUndCache` unten) — nichts bleibt dauerhaft „eingefroren".
  async function ladeIntern(): Promise<BlitztextSettings> {
    if (cache) return cache
    const raw = await file.read()
    if (raw === null) {
      cache = defaultSettings() // fehlende Datei = frische Installation, keine Korruption
      return cache
    }
    try {
      // JSON.parse UND parseSettings defensiv kapseln: auch ein struktureller Absturz in der
      // feldweisen Migration (unerwarteter Wert) darf den Start nicht verhindern.
      cache = parseSettings(JSON.parse(raw))
    } catch {
      // Kaputte Datei beiseitelegen (→ settings.json.korrupt), damit der nächste Start sie nicht
      // erneut ablehnt; dann Callback und Defaults. beiseiteLegen/Callback wirft nie.
      await file.beiseiteLegen?.()
      aufKorruption?.()
      cache = defaultSettings()
    }
    return cache
  }

  // Schreiben + Cache in EINEM Schritt aktualisieren — über `parseSettings` (nicht den rohen
  // `settings`-Parameter direkt), damit load() DANACH garantiert denselben Stand liefert, den ein
  // frischer Disk-Read ergäbe (eine einzige Quelle der Wahrheit für Migration/Validierung, kein
  // zweiter, potenziell abweichender Cache-Pfad).
  async function schreibeUndCache(settings: BlitztextSettings): Promise<BlitztextSettings> {
    // Zweite Verteidigungslinie (defense-in-depth): normalisiert auch dann, wenn ein künftiger
    // Aufrufer (z. B. IPC-Handler) ungeprüfte customTerms direkt an save() durchreicht, ohne den
    // load()-Pfad zu durchlaufen.
    const normalisiert = { ...settings, customTerms: normalisiereBegriffe(settings.customTerms) }
    await file.write(JSON.stringify(normalisiert))
    cache = parseSettings(normalisiert)
    return cache
  }

  // A2 (Lost-Update-Schutz): Muster wortgleich zu history-store.ts (A1). NUR schreibende Operationen
  // (save()/mutate()) laufen über die Kette — reines Lesen (load(), analog `liste()` im Verlauf-Store)
  // bleibt unserialisiert, weil ein Read allein keinen Lost-Update erzeugen kann. Jede Aufgabe hängt sich
  // an die vorherige an (Erfolg ODER Fehler); die Ketten-Referenz selbst wird mit einem entschärften
  // .then weitergeführt, damit ein einzelner Fehlschlag (z. B. ein werfendes `fn` in mutate()) die Kette
  // nicht dauerhaft in den rejected-Zustand versetzt — sonst würde JEDE künftige Operation sofort mitwerfen.
  let kette: Promise<unknown> = Promise.resolve()
  function serialisiert<T>(aufgabe: () => Promise<T>): Promise<T> {
    const ergebnis = kette.then(aufgabe, aufgabe)
    kette = ergebnis.then(
      () => undefined,
      () => undefined
    )
    return ergebnis
  }

  return {
    load() {
      return ladeIntern()
    },
    save(settings) {
      return serialisiert(() => schreibeUndCache(settings)).then(() => undefined)
    },
    mutate(fn) {
      return serialisiert(async () => {
        const aktuell = await ladeIntern()
        const next = await fn(aktuell)
        // Echter No-Op-Schutz: liefert `fn` den unveränderten Stand zurück (Referenzgleichheit), wird
        // NICHT geschrieben — sonst würde z. B. `mergeApiKeyStatus` (index.ts) bei einem bereits
        // fehlenden apiKeyStatus-Eintrag einen folgenlosen Disk-Write auslösen (die alte load()→save()-
        // Variante hatte für genau diesen Fall einen frühen `return`, siehe dort).
        //
        // 🔴 VORAUSSETZUNG an jeden Aufrufer (Review-Befund v0.8.0): `fn` MUSS ein NEUES Objekt
        // liefern, wenn es etwas ändert — typischerweise `{ ...aktuell, feld: wert }`. Wer `aktuell`
        // an Ort und Stelle verändert und dieselbe Referenz zurückgibt, bekommt hier stillschweigend
        // KEINEN Schreibvorgang: der Cache zeigte dann einen Stand, der nie auf der Platte landet, und
        // die Änderung wäre nach dem nächsten Start verloren. Beide heutigen Aufrufer (index.ts)
        // spreaden korrekt.
        if (next === aktuell) return aktuell
        return schreibeUndCache(next)
      })
    }
  }
}
