// A6 (v0.8.0): Anzeige-Label für das TATSÄCHLICH gelaufene Modell im Verlauf.

/** Minimal-Shape — die relevanten Felder aus VerlaufEintrag (history-store.ts), strukturell statt per
 *  Import, damit diese Datei store-unabhängig bleibt (gleiches Muster wie shared/pricing.ts). */
export interface ModellFelder {
  asrModell?: string
  chatModell?: string
}

/**
 * Baut das Anzeige-Label für das TATSÄCHLICH gelaufene Modell (VerlaufView-Badge). VerlaufEintrag
 * speichert asrModell/chatModell bereits (die real gelaufenen Modelle, nicht die Konfiguration) — sie
 * waren aber bislang nirgends sichtbar. Wichtig, weil eingebaute Workflows hart auf OpenAI gepinnt sind
 * und eine stille Modell-Herabstufung sonst unbemerkt bliebe.
 *
 * - Beide gesetzt → "<asr> + <chat>".
 * - Nur ASR gesetzt (reine Transkription ohne Umschreibeschritt) → nur ASR.
 * - Keines gesetzt (Alt-Einträge vor Einführung der Felder) → leerer String (Aufrufer zeigt dann
 *   bewusst KEINEN Badge, statt einer leeren Hülle).
 */
export function modellLabelFuerEintrag(e: ModellFelder): string {
  const asr = e.asrModell?.trim() ?? ''
  const chat = e.chatModell?.trim() ?? ''
  if (asr === '' && chat === '') return ''
  if (asr === '') return chat
  if (chat === '') return asr
  return `${asr} + ${chat}`
}
