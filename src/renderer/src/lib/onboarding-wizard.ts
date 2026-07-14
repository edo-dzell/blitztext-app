// Onboarding-Wizard (W2-S8): reiner, framework-freier Zustandsautomat für den Fullscreen-Ersteinrichtungs-
// Assistenten. Die Komponente (OnboardingWizard.tsx) hält NUR diesen Zustand + rendert je Schritt; alle
// Übergangsregeln leben hier, damit sie ohne React/Electron node-testbar sind (Muster wie
// hotkey-capture.ts/kaltstart.ts: reine Logik separat vom Rendering).

/** Die fünf Schritte des Wizards, in fester Reihenfolge. */
export type WizardSchritt = 'willkommen' | 'key' | 'mikrofon' | 'probe' | 'fertig'

const REIHENFOLGE: readonly WizardSchritt[] = ['willkommen', 'key', 'mikrofon', 'probe', 'fertig']

/** Ergebnis der Probe-Aufnahme (Schritt 'probe'): der Endtext bei Erfolg, sonst null (noch keins/Fehler). */
export interface WizardZustand {
  schritt: WizardSchritt
  /** Cloud- oder Lokal-Anbieter gewählt (Schritt 'willkommen'); null = noch keine Wahl getroffen. */
  anbieterWahl: 'cloud' | 'lokal' | null
  /** War der zuletzt gespeicherte Key erfolgreich getestet (Schritt 'key')? */
  keyGetestet: boolean
  /** Wurde das Mikrofon geprüft (Schritt 'mikrofon', mind. ein Gerät gefunden)? */
  mikroGeprueft: boolean
  /** Endtext der Probe-Aufnahme (Schritt 'probe'); null = noch kein Ergebnis. */
  probeErgebnis: string | null
}

export function initialerZustand(): WizardZustand {
  return {
    schritt: 'willkommen',
    anbieterWahl: null,
    keyGetestet: false,
    mikroGeprueft: false,
    probeErgebnis: null
  }
}

/** Nächster Schritt in der festen Reihenfolge; bleibt auf 'fertig' stehen (kein Schritt danach). */
export function naechsterSchritt(zustand: WizardZustand): WizardZustand {
  const idx = REIHENFOLGE.indexOf(zustand.schritt)
  const naechster = REIHENFOLGE[Math.min(idx + 1, REIHENFOLGE.length - 1)]!
  return { ...zustand, schritt: naechster }
}

/** Vorheriger Schritt; bleibt auf 'willkommen' stehen (kein Schritt davor, nicht negativ werden). */
export function vorherigerSchritt(zustand: WizardZustand): WizardZustand {
  const idx = REIHENFOLGE.indexOf(zustand.schritt)
  const vorheriger = REIHENFOLGE[Math.max(idx - 1, 0)]!
  return { ...zustand, schritt: vorheriger }
}

/**
 * Darf der Nutzer von hier aus weiter? NUR 'willkommen' erzwingt etwas (eine Anbieter-Wahl muss
 * getroffen sein, sonst ist unklar, welchen Pfad Schritt 'key' zeigen soll). Alle anderen Schritte sind
 * bewusst IMMER weiter-bar — nichts wird erzwungen (ein Nutzer ohne Mikrofon/ohne getesteten Key/ohne
 * Probe-Erfolg soll den Wizard trotzdem zu Ende bringen können, „Überspringen" ist ohnehin immer da).
 */
export function kannWeiter(zustand: WizardZustand): boolean {
  if (zustand.schritt === 'willkommen') return zustand.anbieterWahl !== null
  return true
}
