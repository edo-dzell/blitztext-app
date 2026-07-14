// Workflows als framework-unabhängige Domänendaten. Bewusst ohne Electron-/React-Abhängigkeiten,
// damit Main, Preload, Renderer und Tests dieselbe Quelle der Wahrheit teilen.
//
// V2 (ADR-0008, Strang C): „Workflow" ist nutzer-definiert → `WorkflowId` ist ein OFFENER String
// (nicht mehr der feste Union `'transcribe'|'improve'|'calm'|'emoji'`). Die vier eingebauten
// Workflows bleiben als Seeds erhalten und verhalten sich byte-identisch zu v1.

export type WorkflowId = string

/**
 * Wie der System-Prompt eines Umschreibe-Workflows entsteht:
 * - 'berechnet': über den v1-Builder aus den Einstellungen (Ton/Emoji-Dichte/Begriffe) — nur die
 *   vier eingebauten Workflows; bewahrt das v1-Verhalten exakt.
 * - 'statisch': fester, vom Nutzer bearbeiteter Prompt-Text.
 */
export type PromptModus = 'berechnet' | 'statisch'

export interface WorkflowDefinition {
  id: string
  /** Anzeigename in der UI. */
  label: string
  /** Kurzbeschreibung der Wirkung. */
  summary: string
  /** true = eingebauter Standard-Workflow (nicht löschbar). */
  builtin: boolean
  /** Folgt nach der Transkription ein LLM-Umschreibeschritt? */
  rewrites: boolean
  promptModus: PromptModus
  /** Nur bei promptModus='statisch' genutzt. */
  systemPrompt: string
  /** Umschreib-Modell; '' = Provider-Standardmodell (chatModell). */
  model: string
  temperature: number
  /** Anbieter-Zuordnung (v0.2.3, ADR-0010). Fehlt/'' = erbt Standard-Anbieter; Built-ins auf 'openai' gepinnt. */
  anbieterId?: string
  /** Eingabe-/ASR-Sprachcode pro Workflow (v0.2.4, S-3). Fehlt/'' = erbt die globale Sprache. */
  language?: string
  /** Ausgabesprache fürs Umschreiben (R1). Fehlt/'' = keine Vorgabe (Sprache der Eingabe). */
  ausgabeSprache?: string
  /** Ton pro Workflow (v0.2.7); fehlt/'' = erbt global. Wirkt auf berechnete Umschreibe-Workflows. */
  tone?: 'formal' | 'neutral' | 'casual'
  /** Emoji-Dichte pro Workflow (v0.2.7); fehlt/'' = erbt global. 'aus' = gar keine Emojis. */
  emojiDensity?: 'aus' | 'wenig' | 'mittel' | 'viel'
  /** Frühere System-Prompt-Versionen (v0.2.5, P-1/W-8). In den Settings, NICHT im verschlüsselten Verlauf. */
  promptHistorie?: PromptVersion[]
}

/** Eine gespeicherte System-Prompt-Fassung (Prompt-Historie, v0.2.5). */
export interface PromptVersion {
  id: string
  zeitstempelMs: number
  text: string
  quelle: 'manuell' | 'assistent'
}

/** Deckelung der Prompt-Historie je Workflow (älteste fallen raus). */
export const PROMPT_HISTORIE_MAX = 20

/** Non-destruktiv eine neue Version vorne anhängen und deckeln (neueste zuerst). */
export function mitNeuemPrompt(
  historie: PromptVersion[] | undefined,
  version: PromptVersion,
  max = PROMPT_HISTORIE_MAX
): PromptVersion[] {
  return [version, ...(historie ?? [])].slice(0, max)
}

/** Eine frühere Version per id finden (zum Wiederherstellen); undefined, wenn nicht vorhanden. */
export function findePromptVersion(
  historie: PromptVersion[] | undefined,
  id: string
): PromptVersion | undefined {
  return (historie ?? []).find((v) => v.id === id)
}

/**
 * Prompt-Historie nach dem Speichern (R3/#26): hängt NUR dann eine neue Version an, wenn der Prompt
 * statisch ist, nicht leer und sich gegenüber dem ZULETZT GESPEICHERTEN Stand (altDef) geändert hat.
 * Sonst bleibt die Historie unverändert. Reine Funktion (id/Zeitstempel kommen als `version` herein).
 */
export function historieNachSpeichern(
  altDef: Pick<WorkflowDefinition, 'systemPrompt'>,
  neuDef: Pick<WorkflowDefinition, 'promptModus' | 'systemPrompt' | 'promptHistorie'>,
  version: PromptVersion,
  max = PROMPT_HISTORIE_MAX
): PromptVersion[] | undefined {
  if (neuDef.promptModus !== 'statisch') return neuDef.promptHistorie
  if (neuDef.systemPrompt.trim() === '') return neuDef.promptHistorie
  if (neuDef.systemPrompt === altDef.systemPrompt) return neuDef.promptHistorie
  return mitNeuemPrompt(neuDef.promptHistorie, version, max)
}

/** Feste Temperatur-Stufen für das Editor-Dropdown (W-6). Enthält die Built-in-Werte 0/0.3/0.4. */
export const TEMPERATUR_STUFEN = [0, 0.2, 0.3, 0.4, 0.7, 1.0] as const

/** Kanonische Default-Temperatur neuer Workflows (∈ TEMPERATUR_STUFEN). */
export const NEUER_WORKFLOW_TEMPERATUR = 0.3

/** Gültiger Sprachcode (ISO-639-1, zwei Kleinbuchstaben) — leer = „erbt global" (S-3). */
export function istGueltigerSprachcode(code: string): boolean {
  return /^[a-z]{2}$/.test(code)
}

// Windows-Default-Chords der eingebauten Workflows (ADR-0007). transcribe = LinksStrg+LinksWin
// (einhändig); improve/calm/emoji = RechtsStrg+RechtsShift+Ziffer (AltGr gemieden, kollisionsarm).
export const DEFAULT_HOTKEYS: Record<WorkflowId, string[]> = {
  transcribe: ['ControlLeft', 'MetaLeft'],
  improve: ['ControlRight', 'ShiftRight', 'Digit2'],
  calm: ['ControlRight', 'ShiftRight', 'Digit3'],
  emoji: ['ControlRight', 'ShiftRight', 'Digit4']
}

// Die vier eingebauten Workflows. Modell/Temperatur reproduzieren exakt das v1-Routing
// (LLMService.swift: improve/emoji gpt-4o-mini@0.3, calm gpt-4o@0.4). promptModus='berechnet' →
// der Prompt entsteht weiter dynamisch über buildSystemPrompt (Verhalten unverändert).
export const BUILTIN_WORKFLOWS: readonly WorkflowDefinition[] = [
  {
    id: 'transcribe',
    label: 'Blitztext',
    summary: 'Sprache in Text umwandeln.',
    builtin: true,
    rewrites: false,
    promptModus: 'berechnet',
    systemPrompt: '',
    model: '',
    temperature: 0,
    anbieterId: 'openai'
  },
  {
    id: 'improve',
    label: 'Blitztext+',
    summary: 'Rohtext in saubere Schreibweise überführen.',
    builtin: true,
    rewrites: true,
    promptModus: 'berechnet',
    systemPrompt: '',
    model: 'gpt-4o-mini',
    temperature: 0.3,
    anbieterId: 'openai'
  },
  {
    id: 'calm',
    label: 'Blitztext $%&!',
    summary: 'Frustrierte Sprache in eine ruhige Nachricht umwandeln.',
    builtin: true,
    rewrites: true,
    promptModus: 'berechnet',
    systemPrompt: '',
    model: 'gpt-4o',
    temperature: 0.4,
    anbieterId: 'openai'
  },
  {
    id: 'emoji',
    label: 'Blitztext :)',
    summary: 'Passende Emojis zum diktierten Text ergänzen.',
    builtin: true,
    rewrites: true,
    promptModus: 'berechnet',
    systemPrompt: '',
    model: 'gpt-4o-mini',
    temperature: 0.3,
    anbieterId: 'openai'
  }
]

/** Sicheres Nachschlagen: undefined statt Wurf (für defensive Aufrufer wie die Sitzung). */
export function findWorkflow(
  id: string,
  workflows: readonly WorkflowDefinition[]
): WorkflowDefinition | undefined {
  return workflows.find((w) => w.id === id)
}

/** Nachschlagen mit Wurf bei unbekannter Id (für Aufrufer, die die Existenz garantieren). */
export function getWorkflow(
  id: string,
  workflows: readonly WorkflowDefinition[]
): WorkflowDefinition {
  const found = findWorkflow(id, workflows)
  if (!found) throw new Error(`Unbekannter Workflow: ${id}`)
  return found
}

// --- P3: „Auf Auslieferung zurücksetzen" (nur VERHALTEN; Name/Hotkey/Anbieter/Sprache bleiben). ---
// Genau die im Sparring (Punkt 3) festgelegten Verhaltensfelder. NICHT id/label/summary/builtin/
// promptHistorie und bewusst NICHT anbieterId/language (= Nutzer-Konfiguration, bleibt).
export const WORKFLOW_VERHALTENS_FELDER = [
  'rewrites',
  'promptModus',
  'systemPrompt',
  'model',
  'temperature',
  'tone',
  'emojiDensity',
  'ausgabeSprache'
] as const

export type WorkflowVerhaltensFeld = (typeof WORKFLOW_VERHALTENS_FELDER)[number]

/**
 * Werks-Verhalten eines eingebauten Workflows (nur die Verhaltensfelder; nicht gesetzte Optionale
 * werden explizit als undefined geführt, damit ein Reset sie zurücksetzt). undefined, wenn die Id
 * kein eingebauter Workflow ist.
 */
export function werksVerhalten(id: string): Partial<WorkflowDefinition> | undefined {
  const b = BUILTIN_WORKFLOWS.find((w) => w.id === id)
  if (!b) return undefined
  const out: Record<string, unknown> = {}
  const quelle = b as unknown as Record<string, unknown>
  for (const f of WORKFLOW_VERHALTENS_FELDER) out[f] = quelle[f]
  return out as Partial<WorkflowDefinition>
}

// --- Prompt-Kennung im Verlauf (V5): identifiziert den Prompt-STAND, der einen Endtext erzeugte. ---
// Reine, deterministische Funktion — bewusst ohne Node-`crypto` (Datei bleibt framework-/laufzeit-
// unabhängig; läuft in Main, Renderer UND Tests gleich). FNV-1a 32-bit ist für diesen Zweck
// (Kollisionsanzeige bei Prompt-Änderungen, KEINE Sicherheitsfunktion) ausreichend.
function kurzHash(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  // >>> 0 macht das Ergebnis unsigned, damit toString(16) keine führende Minus-/Vorzeichenform liefert.
  return (h >>> 0).toString(16).padStart(8, '0')
}

/**
 * Bildet eine deterministische Kennung des Prompt-Stands, der einen bestimmten Endtext erzeugt hat
 * (V5, Verlauf-Anzeige). `aufgeloesterPrompt` ist der fertige System-Prompt-Text, wie ihn
 * `resolveSystemPrompt` zur Laufzeit gebaut hat.
 *
 * - Eingebaute Workflows (`builtin===true`, i. d. R. `promptModus==='berechnet'`): Der Prompt-TEXT
 *   selbst ändert sich mit jedem Prompt-Fix (v0.4.2…v0.4.5 etc.) — es gibt keine separate
 *   Versionsnummer. Kennung = `builtin:<workflowId>@<kurzHash(aufgeloesterPrompt)>`; ändert sich der
 *   Built-in-Prompt-Text (Bugfix/Härtung), ändert sich automatisch auch die Kennung.
 * - Statische/eigene Prompts MIT passendem Eintrag in `promptHistorie` (Text-Gleichheit mit dem
 *   aktuell gespeicherten `systemPrompt`): die `PromptVersion.id` dieses Eintrags — stabil über
 *   Läufe hinweg, solange sich der gespeicherte Prompt nicht ändert.
 * - Statische/eigene Prompts OHNE passenden Historie-Eintrag (z. B. Historie leer/deaktiviert):
 *   `custom:<kurzHash(aufgeloesterPrompt)>` als Fallback.
 */
export function promptKennungFuer(
  workflowDef: Pick<WorkflowDefinition, 'id' | 'builtin' | 'promptModus' | 'systemPrompt' | 'promptHistorie'>,
  aufgeloesterPrompt: string
): string {
  if (workflowDef.builtin) {
    return `builtin:${workflowDef.id}@${kurzHash(aufgeloesterPrompt)}`
  }
  if (workflowDef.promptModus === 'statisch') {
    const treffer = (workflowDef.promptHistorie ?? []).find(
      (v) => v.text === workflowDef.systemPrompt
    )
    if (treffer) return treffer.id
  }
  return `custom:${kurzHash(aufgeloesterPrompt)}`
}

// --- Workflow-Export/Import als Preset-Datei (später auch Grundlage der Fork-Presets). Bewusst KEINE
// In-App-Galerie (Nutzer-Entscheid) — nur Datei-Export/Import über einen nativen Speichern/Öffnen-Dialog.
//
// W3-F1: Die Hüllen-Typen (`PresetWorkflow`, `PresetDatei`) + `BLITZTEXT_PRESET_VERSION` bleiben HIER
// in shared (reine Daten, keine @main-Abhängigkeit). Die Export-FUNKTION `workflowZuPreset` lebt aber
// NICHT hier, sondern in `src/main/rewrite/prompt-builder.ts`. Grund: Ein unveränderter Built-in hat
// `promptModus==='berechnet'` UND `systemPrompt===''` (der Prompt entsteht erst zur Laufzeit über
// `berechneterPrompt`/`buildSystemPrompt`). Ein Export MUSS den aufgelösten Klartext mitgeben (Presets
// sind self-contained; 'berechnet' ist eine Built-in-Eigenschaft, keine portable Prompt-Quelle) — dafür
// braucht die Export-Funktion `berechneterPrompt`, das in @main/rewrite/prompt-builder sitzt. `shared/`
// ist laut eslint.config.mjs (D4-Block) richtungsunabhängig und darf @main nicht als WERT importieren
// (nur Typ-Importe) — ein Import von dort nach hier wäre also ein Lint-Fehler/eine Schichtverletzung.
// `parseImportierterWorkflow` (Import/Validierung) bleibt HIER in shared, da es ohne prompt-builder
// auskommt und so auch ohne @main testbar/nutzbar bleibt.

/** Version des Preset-Dateiformats. Erhöhen, falls sich die Hülle/das Feld-Set inkompatibel ändert. */
export const BLITZTEXT_PRESET_VERSION = 1

/**
 * Portable Projektion eines Workflows für den Datei-Export. Enthält NUR Felder, die auf einer anderen
 * Maschine/Installation sinnvoll sind. Absichtlich AUSGESCHLOSSEN:
 * - id (wird beim Import frisch vergeben, sonst Kollisionsgefahr)
 * - builtin (ein Import ist nie „eingebaut")
 * - anbieterId (Anbieter-Konfiguration ist maschinenspezifisch, z. B. eigene Base-URL/API-Keys)
 * - promptHistorie (rein lokale Bearbeitungshistorie, kein Teil des Presets)
 * Hotkeys leben in `settings.hotkeys` (Record<WorkflowId, string[]>) und werden bewusst NIE
 * exportiert — sie sind maschinenspezifisch (Kollisionen mit anderen Chords je Installation).
 *
 * W3-F1: `promptModus` ist HIER bewusst nicht mehr Teil des Feld-Sets, das direkt vom Workflow
 * übernommen wird — `workflowZuPreset` (in @main/rewrite/prompt-builder) erzwingt beim Export IMMER
 * 'statisch' + den aufgelösten Klartext. Der Typ lässt `PromptModus` trotzdem zu (statt hart auf
 * 'statisch' zu verengen), weil ältere/fremde Preset-Dateien beim Import (`parseImportierterWorkflow`)
 * auch 'berechnet' enthalten könnten — das ist eine Lese-/Validierungsfrage, keine Schreib-Garantie.
 */
export interface PresetWorkflow {
  label: string
  summary: string
  rewrites: boolean
  promptModus: PromptModus
  systemPrompt: string
  model: string
  temperature: number
  language?: string
  ausgabeSprache?: string
  tone?: 'formal' | 'neutral' | 'casual'
  emojiDensity?: 'aus' | 'wenig' | 'mittel' | 'viel'
}

/** Hülle der Preset-Datei (`*.blitztext.json`). */
export interface PresetDatei {
  blitztextPreset: typeof BLITZTEXT_PRESET_VERSION
  workflow: PresetWorkflow
}

/**
 * Erzeugt aus einem Label + der Liste bereits vorhandener Labels ein eindeutiges Label. Frei →
 * unverändert. Kollision → Suffix „ (importiert)", bei weiterer Kollision „ (importiert 2)", „ (importiert 3)" …
 */
export function eindeutigesLabel(label: string, vorhandene: string[]): string {
  if (!vorhandene.includes(label)) return label
  const basis = `${label} (importiert)`
  if (!vorhandene.includes(basis)) return basis
  let n = 2
  while (vorhandene.includes(`${label} (importiert ${n})`)) n++
  return `${label} (importiert ${n})`
}

// Temperatur-Grenzen für importierte Presets (großzügiger als TEMPERATUR_STUFEN, das nur die
// Editor-Dropdown-Stufen sind — ein Preset könnte einen abweichenden, aber dennoch gültigen Wert
// mitbringen). Gängiger Chat-Completion-Bereich ist 0–2.
const PRESET_TEMPERATUR_MIN = 0
const PRESET_TEMPERATUR_MAX = 2

function clampTemperatur(t: number): number {
  if (!Number.isFinite(t)) return NEUER_WORKFLOW_TEMPERATUR
  return Math.min(PRESET_TEMPERATUR_MAX, Math.max(PRESET_TEMPERATUR_MIN, t))
}

/**
 * Validiert eine rohe (untrusted, aus einer Datei gelesene) Preset-Struktur und baut daraus einen
 * frischen, importierbaren `WorkflowDefinition`. Feldweise defensiv, nach dem Muster von
 * `parseWorkflow` in `src/main/settings/store.ts` (dort MAIN-lokal, hier eigenständig nachgebaut, da
 * `shared/` framework-/schichtunabhängig bleibt). Liefert `null`, wenn die Hülle nicht passt
 * (`blitztextPreset` nicht exakt `BLITZTEXT_PRESET_VERSION`, `workflow` fehlt/kein Objekt) oder gar
 * kein Objekt hereinkommt.
 *
 * - `id`: immer frisch (`custom-<uuid>`) — ein Import ist nie identisch mit einem bestehenden Workflow.
 * - `builtin`: immer `false` — ein importierter Workflow ist nie „eingebaut".
 * - `promptModus`: W3-F1 (Gürtel+Hosenträger) — IMMER `'statisch'`, unabhängig davon, was die Datei
 *   trägt. Ein importierter Workflow ist nie „eingebaut" (s.o.) und `'berechnet'` ist NUR für die vier
 *   eingebauten Built-ins definiert (`buildSystemPrompt` wirft im default-Zweig bei jeder anderen id) —
 *   ein `promptModus==='berechnet'` an einem frisch importierten `custom-…`-Workflow würde beim
 *   nächsten Auflösen abstürzen. Der korrekte Export (`workflowZuPreset`, @main/rewrite/prompt-builder)
 *   liefert ohnehin immer `'statisch'` + aufgelösten Text; diese Zwangs-Normalisierung fängt zusätzlich
 *   ältere/kaputte/fremde Preset-Dateien ab (Defense-in-depth, nicht nur Vertrauen in den Schreiber).
 * - Validierung: `rewrites===true` UND `systemPrompt` fehlt/leer/nur Whitespace → `null` (die Datei
 *   verspricht einen Umschreibeschritt, kann ihn aber mangels Prompt-Text nicht liefern — genau das
 *   Muster der alten, kaputten Built-in-Exporte aus dem Fenster vor diesem Fix). Eine Datei mit
 *   `rewrites===false` (reine Transkription) braucht dagegen keinen Prompt-Text.
 * - `label`: über `eindeutigesLabel` gegen `vorhandeneLabels` entschärft (Kollisionsschutz).
 * - `rewrites`: Default `true` (wie `parseWorkflow`: nur ein explizites `false` schaltet reine
 *   Transkription ein).
 * - `temperature`: auf `[0, 2]` geclampt; nicht-endliche/fehlende Werte → `NEUER_WORKFLOW_TEMPERATUR`.
 */
export function parseImportierterWorkflow(
  raw: unknown,
  vorhandeneLabels: string[]
): WorkflowDefinition | null {
  if (typeof raw !== 'object' || raw === null) return null
  const huelle = raw as Record<string, unknown>
  if (huelle.blitztextPreset !== BLITZTEXT_PRESET_VERSION) return null
  if (typeof huelle.workflow !== 'object' || huelle.workflow === null) return null
  const o = huelle.workflow as Record<string, unknown>

  const rewrites = o.rewrites !== false
  const systemPrompt = typeof o.systemPrompt === 'string' ? o.systemPrompt : ''
  // Gürtel+Hosenträger: ein Umschreibe-Workflow ohne (nutzbaren) Prompt-Text ist eine kaputte/alte
  // Preset-Datei — sauber ablehnen statt einen Workflow zu erzeugen, der beim ersten Lauf abstürzt.
  if (rewrites && systemPrompt.trim() === '') return null

  const rohLabel = typeof o.label === 'string' && o.label.trim() !== '' ? o.label : 'Importierter Workflow'

  return {
    id: `custom-${globalThis.crypto.randomUUID()}`,
    label: eindeutigesLabel(rohLabel, vorhandeneLabels),
    summary: typeof o.summary === 'string' ? o.summary : '',
    builtin: false,
    rewrites,
    // Immer 'statisch' — siehe Doku-Kommentar oben (W3-F1).
    promptModus: 'statisch',
    systemPrompt,
    model: typeof o.model === 'string' ? o.model : '',
    temperature:
      typeof o.temperature === 'number' ? clampTemperatur(o.temperature) : NEUER_WORKFLOW_TEMPERATUR,
    language: typeof o.language === 'string' ? o.language : '',
    ausgabeSprache: typeof o.ausgabeSprache === 'string' ? o.ausgabeSprache : '',
    ...(['formal', 'neutral', 'casual'].includes(o.tone as string)
      ? { tone: o.tone as WorkflowDefinition['tone'] }
      : {}),
    ...(['aus', 'wenig', 'mittel', 'viel'].includes(o.emojiDensity as string)
      ? { emojiDensity: o.emojiDensity as WorkflowDefinition['emojiDensity'] }
      : {})
  }
}

/** Weicht ein EINGEBAUTER Workflow in einem Verhaltensfeld vom Werkszustand ab? (steuert Reset-Sichtbarkeit) */
export function weichtVomWerkAb(w: WorkflowDefinition): boolean {
  if (!w.builtin) return false
  const werk = werksVerhalten(w.id)
  if (!werk) return false
  const akt = w as unknown as Record<string, unknown>
  const ref = werk as unknown as Record<string, unknown>
  // '' und undefined gelten als gleich („leer") — der Store normalisiert optionale Strings auf '',
  // die Werks-Definition lässt sie undefined.
  const norm = (v: unknown): unknown => (v === undefined || v === '' ? '' : v)
  for (const f of WORKFLOW_VERHALTENS_FELDER) {
    if (JSON.stringify(norm(akt[f])) !== JSON.stringify(norm(ref[f]))) return true
  }
  return false
}
