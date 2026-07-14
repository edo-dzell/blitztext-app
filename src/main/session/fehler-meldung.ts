// Bildet eine Fehler-Art (CONTEXT.md) auf eine nutzergerichtete Meldung ab — rein/testbar. Der
// Anzeige-Konsument (index.ts) zeigt sie als Windows-Notification; bei `aktion:'einstellungen'` bietet
// er einen Sprung in die Einstellungen an. Nur technische Fakten, keine Rechts-/Compliance-Aussagen (ADR-0016).

import type { FehlerArt } from '@main/workflow/fehler-klassifikation'
import type { TeilErfolgGrund } from '@main/workflow/runner'

export interface FehlerMeldung {
  titel: string
  koerper: string
  /**
   * Wenn gesetzt, bietet der Adapter eine Folge-Aktion an (z. B. Notification-Klick):
   * - 'einstellungen': Sprung in die Einstellungen (Konfigurationsfehler).
   * - 'erneut': erneuter Versuch ab Transkription mit dem gehaltenen Audio (W3-B), OHNE neues Diktat.
   *   Der Konsument (Staffel 3.2 UI) verbindet diese Aktion mit `sitzung.erneutVersuchen()`.
   */
  aktion?: 'einstellungen' | 'erneut'
}

/**
 * Nutzergerichtete Meldung für einen Teil-Erfolg (Rohtext liegt in der Zwischenablage). Der Grund
 * unterscheidet, WARUM nicht eingefügt wurde: Umschreib-Fehler vs. Treue-Befund (das Modell hat das
 * Diktat beantwortet, v0.4.5). Ehrlich + spezifisch, damit auch ein Fehlalarm verständlich bleibt.
 */
export function teilErfolgMeldung(grund: TeilErfolgGrund): FehlerMeldung {
  switch (grund) {
    case 'umschreibfehler':
      return {
        titel: 'Umschreiben fehlgeschlagen',
        koerper: 'Der Rohtext liegt in der Zwischenablage — mit Strg+V einfügen.'
      }
    case 'beantwortet':
      return {
        titel: 'Diktat nicht eingefügt',
        koerper:
          'Das Diktat sah aus wie eine Anweisung an die KI — der Rohtext liegt in der Zwischenablage, kein automatisches Einfügen.'
      }
    case 'abgeschnitten':
      return {
        titel: 'Umschreiben abgeschnitten',
        koerper:
          'Die Antwort wurde vom Modell abgeschnitten (Token-Limit) — der Rohtext liegt in der Zwischenablage — mit Strg+V einfügen.'
      }
  }
}

/**
 * Fokus-Drift (W3-A, ADR-0011 Weg B): der Nutzer hat während Transkription/Umschreiben das
 * Vordergrundfenster gewechselt. Statt in ein fremdes Fenster zu tippen, liegt der fertige Text in
 * der Zwischenablage — der Nutzer fügt selbst ein. Keine Sprung-Aktion (nur ein Hinweis).
 */
export function fokusDriftMeldung(): FehlerMeldung {
  return {
    titel: 'Fokus gewechselt',
    koerper: 'Der Text liegt in der Zwischenablage — mit Strg+V einfügen.'
  }
}

/**
 * @param retrybar Bei transienten Fehlern (netzwerk/anbieter) hält die Sitzung das Audio flüchtig im
 * Speicher (W3-B) → die Meldung trägt `aktion:'erneut'`, damit die UI (Staffel 3.2) einen erneuten
 * Versuch ab Transkription anbieten kann (kein neues Diktat nötig).
 */
export function fehlerMeldung(art: FehlerArt, message: string, retrybar = false): FehlerMeldung {
  switch (art) {
    case 'aufnahme':
      return { titel: 'Nichts aufgenommen', koerper: message }
    case 'konfiguration':
      return { titel: 'Einrichtung prüfen', koerper: message, aktion: 'einstellungen' }
    case 'netzwerk':
      return {
        titel: 'Keine Verbindung',
        koerper: 'Verbindung zum Anbieter fehlgeschlagen — bitte später erneut versuchen.',
        ...(retrybar ? { aktion: 'erneut' as const } : {})
      }
    case 'anbieter':
      return {
        titel: 'Fehler beim Anbieter',
        koerper: message,
        ...(retrybar ? { aktion: 'erneut' as const } : {})
      }
  }
}
