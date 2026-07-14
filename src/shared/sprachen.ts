// Zentrale Sprachliste (W2-F, v0.5.0): EINE geteilte Quelle statt dreier Kopien (prompt-builder
// SPRACHNAMEN, WorkflowsView-Selects, EinstellungenView-Select). Framework-unabhängig (wie
// workflows.ts/anbieter.ts), damit Main, Renderer und Tests dieselbe Wahrheit teilen.
//
// ISO-639-1-Code → deutscher Anzeigename (UI) + Klartext-Name für den Prompt (zielsprachenBlock in
// prompt-builder.ts sagt „Gib deine Antwort AUSSCHLIESSLICH auf ${sprache} aus" — dort gehört der
// Prompt-Name hin, nicht der Code).

export interface SpracheEintrag {
  code: string
  /** Anzeigename in der UI, z. B. „Deutsch (de)". */
  anzeigeName: string
  /** Klartext-Name für den Prompt, z. B. „Deutsch". */
  promptName: string
}

// Reihenfolge = Anzeige-Reihenfolge in den Selects. de/en zuerst (bisheriger Stand, Migrations-
// Kompatibilität sichtbar an erster Stelle), Rest alphabetisch nach deutschem Namen.
export const SPRACHEN: readonly SpracheEintrag[] = [
  { code: 'de', anzeigeName: 'Deutsch (de)', promptName: 'Deutsch' },
  { code: 'en', anzeigeName: 'Englisch (en)', promptName: 'Englisch' },
  { code: 'ar', anzeigeName: 'Arabisch (ar)', promptName: 'Arabisch' },
  { code: 'da', anzeigeName: 'Dänisch (da)', promptName: 'Dänisch' },
  { code: 'fi', anzeigeName: 'Finnisch (fi)', promptName: 'Finnisch' },
  { code: 'fr', anzeigeName: 'Französisch (fr)', promptName: 'Französisch' },
  { code: 'el', anzeigeName: 'Griechisch (el)', promptName: 'Griechisch' },
  { code: 'it', anzeigeName: 'Italienisch (it)', promptName: 'Italienisch' },
  { code: 'ja', anzeigeName: 'Japanisch (ja)', promptName: 'Japanisch' },
  { code: 'ko', anzeigeName: 'Koreanisch (ko)', promptName: 'Koreanisch' },
  { code: 'nl', anzeigeName: 'Niederländisch (nl)', promptName: 'Niederländisch' },
  { code: 'no', anzeigeName: 'Norwegisch (no)', promptName: 'Norwegisch' },
  { code: 'pl', anzeigeName: 'Polnisch (pl)', promptName: 'Polnisch' },
  { code: 'pt', anzeigeName: 'Portugiesisch (pt)', promptName: 'Portugiesisch' },
  { code: 'ro', anzeigeName: 'Rumänisch (ro)', promptName: 'Rumänisch' },
  { code: 'sv', anzeigeName: 'Schwedisch (sv)', promptName: 'Schwedisch' },
  { code: 'es', anzeigeName: 'Spanisch (es)', promptName: 'Spanisch' },
  { code: 'cs', anzeigeName: 'Tschechisch (cs)', promptName: 'Tschechisch' },
  { code: 'tr', anzeigeName: 'Türkisch (tr)', promptName: 'Türkisch' },
  { code: 'uk', anzeigeName: 'Ukrainisch (uk)', promptName: 'Ukrainisch' },
  { code: 'hu', anzeigeName: 'Ungarisch (hu)', promptName: 'Ungarisch' },
  { code: 'ru', anzeigeName: 'Russisch (ru)', promptName: 'Russisch' },
  { code: 'zh', anzeigeName: 'Chinesisch (zh)', promptName: 'Chinesisch' }
] as const

/** Schnelles Nachschlagen: Code → Eintrag; undefined bei unbekanntem Code. */
export function findeSprache(code: string): SpracheEintrag | undefined {
  return SPRACHEN.find((s) => s.code === code)
}

/**
 * Klartext-Name für den Prompt (zielsprachenBlock). Fallback bei unbekanntem Code: der Code selbst
 * (bisheriges Verhalten aus prompt-builder.ts SPRACHNAMEN, unverändert beibehalten).
 */
export function sprachPromptName(code: string): string {
  return findeSprache(code)?.promptName ?? code
}
