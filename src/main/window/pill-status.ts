// Phase → Status-Pille (ADR-0007/0009). Rein/testbar; die Anzeige (fokusfreies Overlay) ist HITL.
import type { WorkflowPhase } from '@main/workflow/runner'

// A3: Basis-Anzeigedauer (unverändertes Verhalten für kurze Labels) + Obergrenze gegen ewiges
// Stehenbleiben bei langen Fehlertexten. Nur für 'fehler'/'teilErfolg' relevant (Auto-Hide-Fälle);
// andere Phasen brauchen keine Anzeigedauer (kein Auto-Hide, siehe index.ts).
const AUTO_HIDE_BASIS_MS = 4000
const AUTO_HIDE_OBERGRENZE_MS = 8000
const AUTO_HIDE_MS_PRO_ZEICHEN = 60

export interface PillenStatus {
  sichtbar: boolean
  label: string
  /**
   * Anzeigedauer bevor Auto-Hide greift (A3). NUR bei 'fehler'/'teilErfolg' gesetzt — andere Phasen
   * bleiben undefined (kein Auto-Hide, das steuert weiterhin index.ts über `s.sichtbar`/den Status).
   * Reine Funktion der Label-Länge: Basiswert 4000ms (Regressionsschutz für kurze Labels), gedeckelt
   * bei 8000ms.
   */
  dauerMs?: number
}

/** Anzeigedauer aus der Label-Länge (A3) — reine, testbare Funktion. */
function autoHideDauerMs(label: string): number {
  return Math.min(
    AUTO_HIDE_OBERGRENZE_MS,
    Math.max(AUTO_HIDE_BASIS_MS, label.length * AUTO_HIDE_MS_PRO_ZEICHEN)
  )
}

// A2/A4a: additive Suffixe (kombinierbar) — Wiederholung UND Zwischenmeldung können gleichzeitig aktiv
// sein (z. B. ein erneuter Versuch, der selbst wieder ungewöhnlich lange dauert).
function suffixe(phase: { istWiederholung?: boolean; dauertLaenger?: boolean }): string {
  const teile: string[] = []
  if (phase.istWiederholung) teile.push('erneuter Versuch')
  if (phase.dauertLaenger) teile.push('dauert länger als üblich')
  return teile.length > 0 ? ` (${teile.join(', ')})` : ''
}

export function pillenStatus(phase: WorkflowPhase): PillenStatus {
  switch (phase.status) {
    case 'aufnehmen':
      return { sichtbar: true, label: '🎙 Aufnahme …' }
    case 'transkribieren':
      return { sichtbar: true, label: `⏳ Transkribiere …${suffixe(phase)}` }
    case 'umschreiben':
      return { sichtbar: true, label: `✍️ Schreibe um …${suffixe(phase)}` }
    case 'teilErfolg': {
      const label = '📋 Rohtext in Zwischenablage'
      return { sichtbar: true, label, dauerMs: autoHideDauerMs(label) }
    }
    case 'fehler': {
      const label = `⚠️ ${phase.message}`
      return { sichtbar: true, label, dauerMs: autoHideDauerMs(label) }
    }
    case 'idle':
    case 'fertig':
      return { sichtbar: false, label: '' }
  }
}
