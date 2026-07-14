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
import type { RecordingMode } from '@main/hotkey/matcher'

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
  /** Sortierrichtung im Verlauf (C2). Default 'neuesteZuerst'. Migration wie `theme` (includes-Check). */
  verlaufSortierung: 'neuesteZuerst' | 'aeltesteZuerst'
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
}

export interface SettingsStore {
  load(): Promise<BlitztextSettings>
  save(settings: BlitztextSettings): Promise<void>
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
    verlaufSortierung: 'neuesteZuerst'
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
  return {
    id: o.id,
    vorlage: descriptor ? descriptor.id : 'custom',
    label: strOder(o.label, descriptor?.label ?? o.id),
    baseUrl: strOder(o.baseUrl, descriptor?.baseUrl ?? DEFAULT_ANBIETER.baseUrl),
    asrModell: strOder(o.asrModell, DEFAULT_ANBIETER.asrModell),
    chatModell: strOder(o.chatModell, DEFAULT_ANBIETER.chatModell),
    ...(o.keinKeyNoetig === true ? { keinKeyNoetig: true as const } : {})
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
    customTerms: Array.isArray(o.customTerms)
      ? o.customTerms.filter((t): t is string => typeof t === 'string')
      : d.customTerms,
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
    verlaufSortierung: (['neuesteZuerst', 'aeltesteZuerst'] as const).includes(
      o.verlaufSortierung as never
    )
      ? (o.verlaufSortierung as BlitztextSettings['verlaufSortierung'])
      : d.verlaufSortierung
  }
}

export function createSettingsStore({ file }: { file: SettingsFile }): SettingsStore {
  return {
    async load() {
      const raw = await file.read()
      if (raw === null) return defaultSettings()
      let parsed: unknown
      try {
        parsed = JSON.parse(raw)
      } catch {
        return defaultSettings()
      }
      return parseSettings(parsed)
    },
    async save(settings) {
      await file.write(JSON.stringify(settings))
    }
  }
}
