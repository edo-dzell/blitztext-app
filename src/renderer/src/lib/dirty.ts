// Reine, node-testbare Dirty-Erkennung (P4/P8). KEIN React/lucide, KEIN @/-Alias (vitest läuft node-
// only und kennt nur @main/@shared/@renderer). Ersetzt die Inline-JSON.stringify-Vergleiche in
// WorkflowsView (P4) und EinstellungenView (P8).

import type { WorkflowDefinition } from '@shared/workflows'
import type { BlitztextSettings } from '@main/settings/store'

/** Struktureller Tiefenvergleich (gekapselter JSON.stringify-Vergleich). */
export function tiefGleich(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/**
 * P4: Der Workflow-Editor ist schmutzig, wenn die Definition ODER der Hotkey-Chord vom gespeicherten
 * Stand abweicht — beide Entwürfe prüfen, sonst bliebe eine reine Hotkey-Änderung unerkannt.
 */
export function workflowEntwurfGeaendert(
  e: WorkflowDefinition,
  def: WorkflowDefinition,
  chord: string[],
  hotkey: string[]
): boolean {
  return !tiefGleich(e, def) || !tiefGleich(chord, hotkey)
}

// apiKeyStatus wird ausschließlich im Main verwaltet (Lost-Update-Schutz, Slice 16) und gehört NICHT
// zum Einstellungs-Entwurf-Vergleich. Defensiv entfernt — no-op, solange das Feld noch fehlt.
function ohneApiKeyStatus(s: BlitztextSettings): unknown {
  const klon: Record<string, unknown> = { ...s }
  delete klon.apiKeyStatus
  return klon
}

/** P8: Der Einstellungs-Entwurf weicht vom gespeicherten Stand ab (apiKeyStatus ausgenommen). */
export function einstellungenGeaendert(
  entwurf: BlitztextSettings,
  settings: BlitztextSettings
): boolean {
  return !tiefGleich(ohneApiKeyStatus(entwurf), ohneApiKeyStatus(settings))
}

/**
 * W1-E (P1-Datenverlust): Ein API-Key-Eingabefeld ist dirty, sobald nicht-leerer, ungespeicherter Text
 * drinsteht — unabhängig vom eigentlichen Einstellungs-Entwurf, denn der Key wird separat/sofort
 * gespeichert (nicht über den Settings-Entwurf). Nur Whitespace zählt als leer (Trim), damit
 * versehentliches Leerzeichen-Tippen keinen Guard auslöst.
 */
export function apiKeyEntwurfGeaendert(keyInput: string): boolean {
  return keyInput.trim() !== ''
}

/**
 * W1-E (P1-Datenverlust): Läuft eine Prompt-Assistent-Anfrage, ist der Workflow-Editor „dirty" —
 * die Antwort würde beim Remount (key={aktiv.id} in WorkflowsView) kommentarlos verloren gehen, weil
 * WorkflowEditor bei Auswahl-Wechsel neu erzeugt wird. Variante (a): Auswahl sperren statt (b) Antwort
 * über den Wechsel retten — reuse desselben Guard-Mechanismus wie ein ungespeicherter Entwurf.
 */
export function assistentSperrtAuswahl(assistentBusy: boolean): boolean {
  return assistentBusy
}
