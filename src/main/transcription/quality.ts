// Qualitätsfilter gegen Whisper-Artefakte bei sehr kurzen/leeren Aufnahmen.
// Treue Portierung von TranscriptionQualityService aus dem macOS-Original (reine Logik).

export const MINIMUM_RECORDING_SECONDS = 0.3

/**
 * v0.8.0 (mindestAufnahmeSekunden): `mindestSekunden` ist optional mit Default = MINIMUM_RECORDING_
 * SECONDS (heutiges Verhalten byte-identisch). Diese Datei kennt die Einstellung selbst nicht — die
 * composition-root liest den konfigurierten Wert live aus den Settings und reicht ihn hier herein
 * (Muster: shared/laufzeit-profile.ts ist die EINE Quelle der Stufenliste, quality.ts bleibt frei von
 * jedem @main/settings/store-Import).
 */
export function shouldRejectRecording(
  durationSeconds: number,
  mindestSekunden: number = MINIMUM_RECORDING_SECONDS
): boolean {
  return durationSeconds < mindestSekunden
}

/**
 * v0.7.4 — Stille-Erkennung (das „VAD"-Signal, das der Kommentar unten seit jeher als das robustere
 * einfordert). Whisper-Modelle geben auf stillem Audio nicht nichts zurück, sondern die Floskeln, die
 * in ihren Trainingsdaten in stillen Passagen standen: „Danke.", „Thank you.", „Vielen Dank.",
 * „Untertitel von …". Diese Ausgaben sind KURZ und stammen aus NORMAL LANGEN Aufnahmen — der
 * Dauer×Länge-Proxy in `isLikelyArtifact` fängt das Gegenteil (viel Text aus kurzer Aufnahme) und kann
 * sie strukturell nicht erwischen, egal wie man seine Schwellen dreht.
 *
 * Deshalb wird jetzt gemessen, statt geraten: der Recorder-Renderer bestimmt während der Aufnahme den
 * lautesten Abschnitt (RMS über kurze Fenster) und reicht das Maximum durch. Liegt es unter der
 * Schwelle, war schlicht nichts zu hören — dann gar nicht erst transkribieren (spart zusätzlich einen
 * ASR- UND einen Umschreib-Aufruf pro Fehlauslösung).
 *
 * Konservativ ausgelegt: Es ist das MAXIMUM über die gesamte Aufnahme, und schon leise oder entfernte
 * Sprache liegt um mindestens eine Größenordnung darüber. Ohne Messwert (`null`/`undefined`, ältere
 * Renderer, fehlgeschlagene Audio-Analyse) wird NIE abgelehnt — eine echte Aufnahme darf nie an einer
 * fehlenden Diagnose scheitern.
 */
export interface PegelMessung {
  /** Lautester Abschnitt (RMS über kurze Fenster, 0…1). */
  max: number
  /** Typischer Abschnitt (Median über dieselben Fenster) = das Grundrauschen der Aufnahme. */
  median: number
}

/**
 * Unterhalb davon ist es für JEDES Mikrofon Stille — die absolute Untergrenze.
 * Oberhalb von WEICH ist es in jedem Fall hörbares Sprechen; dazwischen entscheidet die Dynamik.
 */
export const STILLE_HART = 0.002
export const STILLE_WEICH = 0.02
/**
 * Verhältnis Spitze zu Grundrauschen. Der eigentliche Kern: Sprache ist STOSSHAFT — zwischen Silben
 * und Wörtern fällt der Pegel ab, die Spitze liegt um ein Vielfaches über dem Grundrauschen. Stille ist
 * FLACH, ihre Spitze liegt dicht am Grundrauschen. Dieses Verhältnis ist unabhängig von Mikrofon,
 * Eingangspegel und Störgeräuschkulisse — anders als eine absolute Schwelle, die für ein leises Mikrofon
 * zu hoch und für ein rauschendes zu niedrig steht.
 */
export const STILLE_DYNAMIK = 3

/**
 * v0.8.0 (Befund A, Feld-Log): die Dynamik allein hat keine untere Haltelinie — in einem SEHR leisen
 * Raum sinkt das Grundrauschen (`median`) auf 0,0001–0,0003, und schon ein winziger, nicht-sprachlicher
 * Ausschlag (Mikrofon-Eigenrauschen, Atem, ein Klick) erzeugt dagegen ein Verhältnis von 11 bis 111 —
 * „stoßhaft wie Sprache", obwohl niemand gesprochen hat. Sechs reale Fehlauslösungen belegen das:
 * `max` lag zwischen 0,0025 und 0,0223, bei einem `median` von nur 0,0001–0,0003. Echte Diktate
 * DESSELBEN Nutzers lagen bei `max` = 0,3341 und 0,3603 — 15- bis 130-fach lauter.
 *
 * STILLE_ABSOLUT zieht deshalb eine zweite, von der Dynamik UNABHÄNGIGE Linie: unterhalb davon ist es
 * Stille, ganz gleich wie „stoßhaft" das Verhältnis aussieht. Sie wird bewusst ÜBER STILLE_WEICH gelegt
 * (0,05 statt 0,02) — die reale Fehlauslösung mit dem höchsten Pegel (0,0223) lag bereits ÜBER dem
 * bisherigen WEICH und wurde dadurch NIE geprüft (die „oberhalb WEICH immer hörbar"-Abkürzung griff
 * zuerst). Ohne diese Anhebung bliebe genau der schlimmste beobachtete Fall weiterhin unentdeckt.
 *
 * Sicherheitsabstand — die deutlich wichtigere Richtung: 0,03 liegt knapp über dem lautesten bekannten
 * Fehlalarm (0,0223), fängt also ALLE sechs beobachteten Fälle, und zugleich rund 11-fach UNTER dem
 * leisesten bekannten echten Diktat (0,3341).
 *
 * Der Wert wurde bewusst NICHT höher gewählt, obwohl mehr Marge nach oben etwas lautere Störgeräusche
 * derselben Art zusätzlich fangen würde. Zwei Gründe:
 *  1. **Kostenasymmetrie.** Ein fälschlich verworfenes Diktat kostet den Nutzer einen verlorenen Satz
 *     und die Wiederholung. Ein durchgerutschtes Nicht-Diktat kostet einen Transkriptions-Aufruf
 *     (Bruchteile eines Cents) und eine ehrliche Meldung. Die teurere Fehlerrichtung bestimmt die Linie.
 *  2. **Dünne Datenbasis nach oben.** Die Referenz „echtes Diktat" stützt sich auf nur ZWEI Messwerte,
 *     beide in normaler Lautstärke. Ein leises oder mikrofonfernes Diktat liegt realistisch deutlich
 *     darunter — und genau diesen Fehler hat dieses Projekt schon einmal gemacht (die erste Fassung
 *     verwarf mit einer absoluten Schwelle echte leise Diktate).
 * Wer lieber aggressiver filtert, wählt im Stille-Profil „Streng" (dort 0,06) — der Standard hält die
 * sichere Seite.
 */
export const STILLE_ABSOLUT = 0.03

/**
 * v0.7.4 — Stille-Erkennung (das „VAD"-Signal, das der Kommentar unten seit jeher als das robustere
 * einfordert). Whisper-Modelle geben auf stillem Audio nicht nichts zurück, sondern die Floskeln, die
 * in ihren Trainingsdaten in stillen Passagen standen: „Danke.", „Thank you.", „Vielen Dank.",
 * „Untertitel von …". Diese Ausgaben sind KURZ und stammen aus NORMAL LANGEN Aufnahmen — der
 * Dauer×Länge-Proxy in `isLikelyArtifact` fängt das Gegenteil (viel Text aus kurzer Aufnahme) und kann
 * sie strukturell nicht erwischen, egal wie man seine Schwellen dreht.
 *
 * Vier Stufen statt einer Schwelle (die erste Fassung nutzte nur `max < 0.005` und lag im Feld in BEIDE
 * Richtungen daneben: stille Aufnahmen rutschten durch, leise Diktate wurden verworfen — eine absolute
 * Lautstärke sagt eben nichts darüber, OB gesprochen wurde):
 *   0. absolute Untergrenze (max < ABSOLUT) → Stille, UNABHÄNGIG von Dynamik UND von WEICH (Befund A,
 *      v0.8.0, s. u. bei STILLE_ABSOLUT) — geprüft VOR allem anderen, weil sie genau den Fall abdeckt,
 *      in dem WEICH selbst schon zu niedrig ist (ein Grundrauschen-Ausschlag kann WEICH überschreiten).
 *   1. klar hörbar  (max ≥ WEICH)  → nie Stille, egal wie flach — sofern nicht schon Stufe 0 griff.
 *   2. klar still   (max < HART)   → Stille, egal wie dynamisch
 *   3. Graubereich                 → die Dynamik entscheidet (siehe STILLE_DYNAMIK)
 *
 * Ohne Messwert (`null`/`undefined`, fehlgeschlagene Analyse) wird NIE abgelehnt — eine echte Aufnahme
 * darf nie an einer fehlenden Diagnose scheitern.
 */
/** Strukturelles Gegenstück zu `StilleSchwellen` (shared/laufzeit-profile.ts) — bewusst lokal
 *  dupliziert statt importiert (siehe Datei-Kopfkommentar dort): diese Datei bleibt frei von jedem
 *  Wissen über Settings/Profile, TypeScript matcht die Form strukturell. `absolut` ist OPTIONAL: fehlt
 *  sie (ältere/manuell gebaute Schwellen-Objekte, z. B. in Tests), greift Stufe 0 einfach nicht — reine
 *  Dynamik/Hart/Weich-Logik wie vor v0.8.0, kein Verhaltensbruch für solche Aufrufer. */
export interface StilleSchwellenParam {
  hart: number
  weich: number
  dynamik: number
  /** Befund A (v0.8.0): absolute Untergrenze, s. STILLE_ABSOLUT. Optional (s. o.). */
  absolut?: number
}

const STANDARD_STILLE_SCHWELLEN: StilleSchwellenParam = {
  hart: STILLE_HART,
  weich: STILLE_WEICH,
  dynamik: STILLE_DYNAMIK,
  absolut: STILLE_ABSOLUT
}

/**
 * v0.8.0 (stilleProfil): `schwellen` optional mit Default = die heutigen STILLE_HART/WEICH/DYNAMIK/
 * ABSOLUT (byte-identisches Verhalten ohne den Parameter). `schwellen === null` ist der explizite
 * 'aus'-Fall (composition-root reicht `stilleSchwellenFuer(profil)` durch, das für 'aus' null liefert)
 * — dann wird SICHERHEITSHALBER NIE als Stille abgelehnt, unabhängig vom Messwert.
 */
export function istStilleAufnahme(
  messung: PegelMessung | null | undefined,
  schwellen: StilleSchwellenParam | null = STANDARD_STILLE_SCHWELLEN
): boolean {
  if (!messung) return false
  if (schwellen === null) return false // stilleProfil='aus': Prüfung deaktiviert, nie ablehnen
  const { max, median } = messung
  if (!Number.isFinite(max) || !Number.isFinite(median) || max < 0 || median < 0) return false
  // Befund A (v0.8.0): absolute Untergrenze ZUERST — unabhängig von Dynamik UND von der WEICH-
  // Abkürzung direkt danach (die reale Fehlauslösung mit dem höchsten Pegel lag bereits ÜBER WEICH,
  // s. STILLE_ABSOLUT-Kommentar). `?? -Infinity`: fehlt `absolut` (Aufrufer ohne das Feld), greift
  // diese Stufe nie — Verhalten bleibt die reine Dynamik/Hart/Weich-Logik von vor v0.8.0.
  if (max < (schwellen.absolut ?? -Infinity)) return true
  if (max >= schwellen.weich) return false
  if (max < schwellen.hart) return true
  // Division gegen 0 absichern: ein exakt stummer Median macht jede Spitze „unendlich dynamisch",
  // also hörbar — das ist die sichere Richtung (nicht ablehnen).
  return max / Math.max(median, 1e-9) < schwellen.dynamik
}

export function cleanedTranscript(text: string): string {
  return text.trim()
}

// Gewinnt den Rohtext aus der rohen Transkription: säubert ihn und prüft ihn in einem Schritt
// auf ein Artefakt. Liefert den gesäuberten Rohtext, oder null, wenn die Aufnahme als Artefakt
// verworfen wird. Kapselt die feste Reihenfolge säubern→prüfen, die sonst der Aufrufer dirigiert.
// Hinweis: Die Artefakt-Heuristik ist ein Dauer/Länge-Proxy für Whisper-Halluzinationen auf sehr
// kurzen/stillen Clips. Falls die Pipeline sie später bereitstellt, sind compression_ratio,
// avg_logprob, no_speech_prob oder eine VAD die robusteren Signale (siehe arXiv:2501.11378).
export function rohtextAus(raw: string, recordingSeconds: number): string | null {
  const rohtext = cleanedTranscript(raw)
  if (isLikelyArtifact(rohtext, recordingSeconds)) return null
  return rohtext
}

// Intern: Implementierungsdetail von rohtextAus. Die feste Reihenfolge säubern→prüfen lebt dort,
// nicht mehr beim Aufrufer.
function isLikelyArtifact(text: string, recordingSeconds: number): boolean {
  const cleaned = cleanedTranscript(text)
  if (cleaned === '') return true

  const letters = (cleaned.match(/\p{L}/gu) ?? []).length
  if (letters === 0) return true

  const words = cleaned.split(/\s+/).filter(Boolean)
  if (recordingSeconds < 0.55 && (words.length >= 5 || cleaned.length >= 32)) return true

  if (recordingSeconds < 0.8 && cleaned.length >= 56) return true

  return false
}
