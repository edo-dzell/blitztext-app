// Phase → Status-Pille (ADR-0007/0009). Rein/testbar; die Anzeige (fokusfreies Overlay) ist HITL.
import type { WorkflowPhase } from '@main/workflow/runner'

// A3: Basis-Anzeigedauer (unverändertes Verhalten für kurze Labels) + Obergrenze gegen ewiges
// Stehenbleiben bei langen Fehlertexten. Nur für 'fehler'/'teilErfolg' relevant (Auto-Hide-Fälle);
// andere Phasen brauchen keine Anzeigedauer (kein Auto-Hide, siehe index.ts).
const AUTO_HIDE_BASIS_MS = 4000
const AUTO_HIDE_OBERGRENZE_MS = 8000
const AUTO_HIDE_MS_PRO_ZEICHEN = 60

/** Strukturelles Gegenstück zu `PillenAnzeigedauerWerte` (shared/laufzeit-profile.ts) — bewusst lokal
 *  dupliziert statt importiert (Datei bleibt frei von jedem Settings-/Profil-Wissen, siehe quality.ts
 *  für dasselbe Muster). TypeScript matcht die Form strukturell, kein Direktimport nötig. */
export interface PillenAnzeigedauerParameter {
  basisMs: number
  obergrenzeMs: number
  msProZeichen: number
}

const STANDARD_ANZEIGEDAUER: PillenAnzeigedauerParameter = {
  basisMs: AUTO_HIDE_BASIS_MS,
  obergrenzeMs: AUTO_HIDE_OBERGRENZE_MS,
  msProZeichen: AUTO_HIDE_MS_PRO_ZEICHEN
}

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
function autoHideDauerMs(label: string, werte: PillenAnzeigedauerParameter): number {
  return Math.min(werte.obergrenzeMs, Math.max(werte.basisMs, label.length * werte.msProZeichen))
}

// A2/A4a: additive Suffixe (kombinierbar) — Wiederholung UND Zwischenmeldung können gleichzeitig aktiv
// sein (z. B. ein erneuter Versuch, der selbst wieder ungewöhnlich lange dauert).
function suffixe(phase: { istWiederholung?: boolean; dauertLaenger?: boolean }): string {
  const teile: string[] = []
  if (phase.istWiederholung) teile.push('erneuter Versuch')
  if (phase.dauertLaenger) teile.push('dauert länger als üblich')
  return teile.length > 0 ? ` (${teile.join(', ')})` : ''
}

/**
 * v0.8.0 (pillenAnzeigedauerProfil): `anzeigedauer` optional mit Default = die heutigen AUTO_HIDE_*-
 * Konstanten (byte-identisches Verhalten ohne den Parameter — bestehende Tests bleiben unverändert
 * grün). index.ts (außerhalb der composition-root-Closures) löst das Profil über den synchronen
 * `comp.aktuelleEinstellungen()`-Getter + `pillenAnzeigedauerWerteFuer` (shared/laufzeit-profile.ts)
 * auf und reicht das Ergebnis hier herein.
 */
export function pillenStatus(
  phase: WorkflowPhase,
  anzeigedauer: PillenAnzeigedauerParameter = STANDARD_ANZEIGEDAUER
): PillenStatus {
  switch (phase.status) {
    // Befund 9 (v0.8.0): OHNE Bestätigung des Renderers (mediaRecorder.start() noch nicht durchgelaufen)
    // zeigt die Pille „Starte …" statt fälschlich „Aufnahme …" — sonst spricht der Nutzer bei langsamem
    // Gerätestart (Defender-Erstscan, Bluetooth-Mikro) unbemerkt ins Leere, bevor überhaupt aufgenommen
    // wird. `bestaetigt` ist additiv (siehe runner.ts WorkflowPhase) — sobald true, unverändertes
    // Bestandslabel.
    case 'aufnehmen':
      return {
        sichtbar: true,
        label: phase.bestaetigt ? '🎙 Aufnahme …' : '⏳ Starte …'
      }
    case 'transkribieren':
      return { sichtbar: true, label: `⏳ Transkribiere …${suffixe(phase)}` }
    case 'umschreiben':
      return { sichtbar: true, label: `✍️ Schreibe um …${suffixe(phase)}` }
    case 'teilErfolg': {
      const label = '📋 Rohtext in Zwischenablage'
      return { sichtbar: true, label, dauerMs: autoHideDauerMs(label, anzeigedauer) }
    }
    case 'fehler': {
      const label = `⚠️ ${phase.message}`
      return { sichtbar: true, label, dauerMs: autoHideDauerMs(label, anzeigedauer) }
    }
    case 'idle':
    case 'fertig':
      return { sichtbar: false, label: '' }
  }
}
