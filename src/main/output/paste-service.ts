// Fallback-Orchestrierung fürs Einfügen ins Paste-Ziel (ADR-0003), reine Logik hinter injizierten
// Ports → ohne echtes OS testbar. Reihenfolge: nativer Helfer (win-paste.exe) → PowerShell-SendKeys
// → nur Zwischenablage + Hinweis. Die echten Strategien (spawn) und das verzögerte, marker-geschützte
// Wiederherstellen der Zwischenablage liegen im Adapter (HITL/Windows), nicht hier.
//
// W3-A (ADR-0011 Weg B, verify-or-degrade): Vor dem Einfügen prüft der Service optional, ob der
// Vordergrund-Fokus vom erfassten Paste-Ziel weggewandert ist (Nutzer klickte während Transkription/
// Umschreiben woanders hin). Ist das Feature `fokusRueckkehr` an UND ein Drift feststellbar, wird
// NICHT ins fremde Fenster getippt — der Text bleibt nur in der Zwischenablage + Drift-Hinweis. Kann
// der Provider das aktuelle/erfasste HWND nicht liefern (null), bleibt es beim bisherigen Verhalten
// (nicht schlechter als heute).

import { entscheideFokusRueckkehr } from '@main/output/fokus-rueckkehr'

export interface Zwischenablage {
  lies(): string
  schreib(text: string): void
}

export interface EinfügeStrategie {
  name: 'helfer' | 'powershell'
  versuch: () => Promise<boolean>
}

export interface PasteServiceDeps {
  zwischenablage: Zwischenablage
  strategien: EinfügeStrategie[]
  /** "In Zwischenablage kopiert — bitte mit Strg+V einfügen", wenn alle Strategien scheitern. */
  zeigeManuellenHinweis: () => void
  /**
   * Aktuelles Vordergrundfenster-Handle unmittelbar vor dem Einfügen (Weg B). null = unbekannt
   * (Helfer fehlt/scheitert) → Drift-Prüfung entfällt, Fallback aufs bisherige Verhalten. Optional:
   * fehlt der Port, gibt es keine Drift-Prüfung (Alt-Verhalten).
   */
  aktuellesFenster?: () => number | null
  /** Weg-B-Drift erkannt: Text liegt in der Zwischenablage, „Fokus gewechselt — mit Strg+V einfügen". */
  zeigeDriftHinweis?: () => void
}

/** Fokus-Kontext eines Einfüge-Auftrags (Weg B). Fehlt er, läuft das bisherige Verhalten. */
export interface EinfügeKontext {
  /** Feature-Schalter `fokusRueckkehr` (Settings). */
  fokusRueckkehr: boolean
  /** Vordergrund-Handle beim Aufnahme-Start (nativ erfasst); null = nichts erfasst. */
  erfasstesHwnd: number | null
}

export type EinfügeErgebnis =
  | { erfolg: true; strategie: 'helfer' | 'powershell'; wiederherstellen: () => void }
  // erfolg:false ohne drift → alle Strategien scheiterten (Hinweis kam). Mit drift:true → Weg B hat
  // bewusst NICHT eingefügt (Text in der Zwischenablage, Drift-Hinweis kam).
  | { erfolg: false; drift?: true }

export interface PasteService {
  einfügen(text: string, kontext?: EinfügeKontext): Promise<EinfügeErgebnis>
}

export function createPasteService(deps: PasteServiceDeps): PasteService {
  return {
    async einfügen(text, kontext) {
      const vorher = deps.zwischenablage.lies()
      deps.zwischenablage.schreib(text)

      // Weg B (ADR-0011): nur prüfen, wenn Kontext + Provider vorhanden sind. entscheideFokusRueckkehr
      // liefert restauriere=true NUR bei echtem Drift (Feature an, erfasstesHwnd gesetzt, aktuelles
      // != erfasstes). Ist das aktuelle HWND unbekannt (null), gibt es keinen Drift → einfügen.
      if (kontext && deps.aktuellesFenster) {
        const aktuellesHwnd = deps.aktuellesFenster()
        // Unbekannter Vordergrund (Helfer lieferte kein HWND) → kein verlässlicher Drift-Vergleich →
        // Fallback aufs bisherige Einfügen (nicht schlechter als heute). Nur bei bekanntem HWND urteilen.
        const entscheidung =
          aktuellesHwnd === null
            ? { restauriere: false as const }
            : entscheideFokusRueckkehr({
                aktiviert: kontext.fokusRueckkehr,
                erfasstesHwnd: kontext.erfasstesHwnd,
                aktuellesHwnd
              })
        if (entscheidung.restauriere) {
          // Drift: NICHT ins fremde Fenster tippen. Text bleibt in der Zwischenablage, Hinweis raus.
          deps.zeigeDriftHinweis?.()
          return { erfolg: false, drift: true }
        }
      }

      for (const strategie of deps.strategien) {
        if (await strategie.versuch()) {
          // Wiederherstellen ist eine Absicht: der Adapter ruft sie verzögert auf (nach dem Paste).
          // Inhalts-Guard: nur zurücksetzen, wenn die Zwischenablage noch unseren Text trägt —
          // sonst hätte der Nutzer zwischenzeitlich etwas kopiert (vgl. macOS Marker-Check).
          const wiederherstellen = (): void => {
            if (deps.zwischenablage.lies() === text) deps.zwischenablage.schreib(vorher)
          }
          return { erfolg: true, strategie: strategie.name, wiederherstellen }
        }
      }
      deps.zeigeManuellenHinweis()
      return { erfolg: false }
    }
  }
}
