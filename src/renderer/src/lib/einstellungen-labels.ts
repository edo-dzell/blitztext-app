// Reine Beschriftungs-/Formatierungslogik für die neuen Laufzeit-Einstellungen (v0.8.0,
// @shared/laufzeit-profile). Bewusst getrennt von den Karten/Views — das Projekt hat KEINE React-
// Komponententests (siehe Testkonvention), also muss die Text-/Formatlogik dahinter hier landen, wo sie
// ohne JSDOM testbar ist.
//
// Nutzer-Vorgabe: die aktuell gültige Standard-Stufe muss in jedem Dropdown als „(Standard)" erkennbar
// sein. Der Bestand (TEMPERATUR_STUFEN in WorkflowEditor.tsx) macht das nicht — `mitStandardMarkierung`
// ist die EINE Stelle, die das für alle Stufen-Labels unten nachrüstet.

import type { StilleProfil, NetzwerkProfil, PillenAnzeigedauerProfil } from '@shared/laufzeit-profile'

/** Hängt „ (Standard)" an, wenn `istStandard` gilt. */
export function mitStandardMarkierung(text: string, istStandard: boolean): string {
  return istStandard ? `${text} (Standard)` : text
}

/** „0,3 s" — deutsches Komma, ganze Werte ohne unnötige Nachkommastelle (1 → „1 s", nicht „1,0 s"). */
export function formatSekunden(wert: number): string {
  const text = wert.toLocaleString('de-DE', {
    minimumFractionDigits: Number.isInteger(wert) ? 0 : 1,
    maximumFractionDigits: 1
  })
  return `${text} s`
}

const STILLE_PROFIL_LABELS: Record<StilleProfil, string> = {
  aus: 'Aus (keine Prüfung)',
  vorsichtig: 'Vorsichtig (verwirft seltener)',
  normal: 'Normal',
  streng: 'Streng (verwirft mehr)'
}

/** Menschlich lesbares Label je Stille-Erkennungs-Stufe (ohne „(Standard)"-Zusatz). */
export function stilleProfilLabel(profil: StilleProfil): string {
  return STILLE_PROFIL_LABELS[profil]
}

const NETZWERK_PROFIL_LABELS: Record<NetzwerkProfil, string> = {
  kurz: 'Kurz (bricht schneller ab)',
  normal: 'Normal',
  lang: 'Lang (mehr Geduld bei langsamem Netz)'
}

/** Menschlich lesbares Label je Netzwerk-Zeitlimit-Stufe (ohne „(Standard)"-Zusatz). */
export function netzwerkProfilLabel(profil: NetzwerkProfil): string {
  return NETZWERK_PROFIL_LABELS[profil]
}

const PILLEN_ANZEIGEDAUER_PROFIL_LABELS: Record<PillenAnzeigedauerProfil, string> = {
  kurz: 'Kurz (blendet schneller aus)',
  normal: 'Normal',
  lang: 'Lang (bleibt länger sichtbar)'
}

/** Menschlich lesbares Label je Pillen-Anzeigedauer-Stufe (ohne „(Standard)"-Zusatz). */
export function pillenAnzeigedauerProfilLabel(profil: PillenAnzeigedauerProfil): string {
  return PILLEN_ANZEIGEDAUER_PROFIL_LABELS[profil]
}

/** „2×" für die Retry-Versuche-Stufe. */
export function retryVersucheLabel(n: number): string {
  return `${n}×`
}

/** „200 Einträge" für die Verlauf-Obergrenze-Stufe (deutsches Tausender-Trennzeichen ab 1000). */
export function verlaufMaximumLabel(n: number): string {
  return `${n.toLocaleString('de-DE')} Einträge`
}

/** „90 Tage" für die Statistik-Kompaktierungs-Stufe. */
export function statistikKompaktierungTageLabel(n: number): string {
  return `${n} Tage`
}

/** „6 Std." bzw. glatte 24er-Vielfache menschlich als Tage („1 Tag", „3 Tage", …). */
export function updateIntervallLabel(stunden: number): string {
  if (stunden % 24 === 0) {
    const tage = stunden / 24
    return `${tage} ${tage === 1 ? 'Tag' : 'Tage'}`
  }
  return `${stunden} Std.`
}

/** „N Preis-Overrides aktiv · Kurs X,XXXX" — Zusammenfassung für die Preis-Lesekarte in Einstellungen. */
export function preisUebersichtZusammenfassung(anzahlOverrides: number, kurs: number): string {
  const kursText = kurs.toFixed(4).replace('.', ',')
  return `${anzahlOverrides} Preis-Overrides aktiv · Kurs ${kursText}`
}
