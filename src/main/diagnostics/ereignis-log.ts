// v0.7.2 „Ereignislog": lokales, TEXT-FREIES Diagnose-Log. Dieses Modul ist der Port — reine,
// headless testbare Formatier-Logik ohne Datei-/Electron-Bezug (analog perf-instrumentierung.ts:
// Port + create + NOOP, alle Abhängigkeiten injizierbar). Die eigentliche Datei-Senke lebt in
// log-datei.ts; hier wird nur eine Zeile gebaut und an `senke.schreibeZeile` gereicht.
//
// HARTE DATENSCHUTZ-REGEL: Es dürfen NIE Diktate/Roh-/Endtexte, eingefügte Texte, Prompts,
// API-Keys, URLs mit Credentials oder Fehler-Objekt-Innereien ins Log. Erlaubt sind nur
// Ereignisnamen, FehlerArt, redigierte `err.name`+`err.message`, Dauern, Längen, Ids, Exit-Codes,
// boolesche Flags. Der Formatierer erzwingt das defensiv: nur Primitive, 200-Zeichen-Kürzung,
// Steuerzeichenfilter, verworfene ungültige Feld-Keys — selbst wenn ein Aufrufer sich verirrt.

export type LogStufe = 'debug' | 'info' | 'warnung' | 'fehler'

/** Feldwerte sind ausschließlich Primitive — niemals Objekte/Arrays (Redaction-Schutz). */
export type LogFelder = Record<string, string | number | boolean>

/** Port: die vier Stufen, jede nimmt ein Ereignis-Slug und optionale strukturierte Felder. */
export interface EreignisLog {
  debug(ereignis: string, felder?: LogFelder): void
  info(ereignis: string, felder?: LogFelder): void
  warnung(ereignis: string, felder?: LogFelder): void
  fehler(ereignis: string, felder?: LogFelder): void
  /**
   * Laufzeit-Umschaltung der debug-Stufe über den GUI-Schalter (v0.7.2). Optional, damit NOOP_EREIGNISLOG
   * und Fake-Logs die Methode nicht führen müssen. Die per env BLITZTEXT_DEBUG=1 ERZWUNGENE Stufe bleibt
   * davon unberührt (Support-Pfad, immer an); dieser Schalter steuert nur den Normalfall.
   */
  setzeDebugAktiv?(aktiv: boolean): void
}

/** Ausgabe-Senke (injizierbar): nimmt eine fertig formatierte Zeile (ohne Zeilenumbruch) entgegen. */
export interface LogSenke {
  schreibeZeile(zeile: string): void
  /**
   * Setzt den intern mitgeführten Größenzähler zurück auf 0 (v0.7.2). Optional, damit NOOP/Fakes die
   * Methode nicht führen müssen. Wird vom `log:loeschen`-IPC-Handler nach dem Löschen der Log-Dateien
   * gerufen: sonst führte die Speicher-Größe der Datei-Senke die alte (nun gelöschte) Größe weiter und
   * löste bei der nächsten Zeile eine überflüssige Rotation der frisch neu erzeugten Mini-Datei aus.
   */
  setzeZurueck?(): void
}

export interface EreignisLogDeps {
  senke: LogSenke
  /** Uhr, injizierbar für Tests. Default `() => new Date()`. */
  jetzt?: () => Date
  /** debug-Zeilen nur wenn true (analog BLITZTEXT_PERF/BLITZTEXT_DEBUG). Default false. */
  debugAktiv?: boolean
}

// Kürzungsgrenze für Feldwerte und redigierte Fehler-Nachrichten (Zeichen).
const MAX_WERT_LAENGE = 200
// Ereignis-Slug: bereich.aktion-Form, konservativ begrenzt.
const EREIGNIS_MUSTER = /^[a-z0-9._-]{1,64}$/i
// Erlaubte Feld-Keys — bewusst enger als der Slug (keine Punkte/Bindestriche im key=…).
const FELD_KEY_MUSTER = /^[a-zA-Z0-9_]{1,32}$/
// C0- (0x00–0x1F) und C1-Steuerzeichen (0x7F–0x9F) — werden aus jedem String entfernt.
const STEUERZEICHEN = /[\u0000-\u001f\u007f-\u009f]/g
// Werte, die roh (ohne Quotes) geschrieben werden dürfen: keine Leer-/Sonderzeichen.
const ROH_WERT = /^[a-zA-Z0-9._:+/@=-]+$/

/** Entfernt Steuerzeichen und kürzt auf MAX_WERT_LAENGE (+ „…"), defensiv gegen Leaks/Zeilenbruch. */
function saeubereString(roh: string): string {
  const ohneSteuerzeichen = roh.replace(STEUERZEICHEN, '')
  if (ohneSteuerzeichen.length <= MAX_WERT_LAENGE) return ohneSteuerzeichen
  return ohneSteuerzeichen.slice(0, MAX_WERT_LAENGE) + '…'
}

/** Formatiert einen einzelnen Feldwert: rohe Primitive, Strings ggf. gesäubert und gequotet. */
function formatiereWert(wert: string | number | boolean): string {
  if (typeof wert === 'number') {
    // Nicht-endliche Zahlen sind kein sinnvoller Log-Wert → als Wort ausgeben (nie „NaN"-Rohleck).
    return Number.isFinite(wert) ? String(wert) : `"${String(wert)}"`
  }
  if (typeof wert === 'boolean') return String(wert)
  const sauber = saeubereString(wert)
  if (sauber.length > 0 && ROH_WERT.test(sauber)) return sauber
  // Sonst gequotet: die Steuerzeichen sind schon weg, hier nur noch " und \ maskieren.
  const escaped = sauber.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  return `"${escaped}"`
}

/** Baut den `key=value key="…"`-Teil; ungültige Keys und Nicht-Primitive werden still verworfen. */
function formatiereFelder(felder: LogFelder | undefined): string {
  if (!felder) return ''
  const teile: string[] = []
  for (const key of Object.keys(felder)) {
    if (!FELD_KEY_MUSTER.test(key)) continue
    const wert = felder[key]
    const typ = typeof wert
    if (typ !== 'string' && typ !== 'number' && typ !== 'boolean') continue
    teile.push(`${key}=${formatiereWert(wert as string | number | boolean)}`)
  }
  return teile.length > 0 ? ' ' + teile.join(' ') : ''
}

// Zwei-Ziffern-/Drei-Ziffern-Auffüllung für die lokale Zeitformatierung.
function pad2(n: number): string {
  return String(n).padStart(2, '0')
}
function pad3(n: number): string {
  return String(n).padStart(3, '0')
}

/**
 * ISO-8601 in LOKALER Zeit mit Millisekunden und Offset, z. B. `2026-07-21T14:03:05.123+02:00`.
 * `toISOString()` liefert nur UTC („Z") — hier wird bewusst die lokale Zeit des Geräts abgebildet,
 * damit die Zeilen mit der Wanduhr des Nutzers zusammenpassen.
 */
function formatiereZeit(d: Date): string {
  // getTimezoneOffset(): Minuten, die man zur Lokalzeit ADDIERT, um UTC zu erhalten (Ost = negativ).
  const offsetMin = -d.getTimezoneOffset()
  const vorzeichen = offsetMin >= 0 ? '+' : '-'
  const absMin = Math.abs(offsetMin)
  const offset = `${vorzeichen}${pad2(Math.floor(absMin / 60))}:${pad2(absMin % 60)}`
  return (
    `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}` +
    `T${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}` +
    `.${pad3(d.getMilliseconds())}${offset}`
  )
}

// Stufen-Etikett: deutsch, großgeschrieben, auf 7 Zeichen aufgefüllt (WARNUNG ist am längsten).
const STUFEN_ETIKETT: Record<LogStufe, string> = {
  debug: 'DEBUG',
  info: 'INFO',
  warnung: 'WARNUNG',
  fehler: 'FEHLER'
}

/** Baut die vollständige Log-Zeile nach Format-Spezifikation (ohne abschließenden Zeilenumbruch). */
function formatiereZeile(
  jetzt: () => Date,
  stufe: LogStufe,
  ereignis: string,
  felder: LogFelder | undefined
): string {
  const slug = EREIGNIS_MUSTER.test(ereignis) ? ereignis : 'ungueltig'
  const kopf = `${formatiereZeit(jetzt())} ${STUFEN_ETIKETT[stufe].padEnd(7)} ${slug}`
  return kopf + formatiereFelder(felder)
}

export function createEreignisLog(deps: EreignisLogDeps): EreignisLog {
  const jetzt = deps.jetzt ?? (() => new Date())
  // env BLITZTEXT_DEBUG=1 (deps.debugAktiv) ERZWINGT Debug dauerhaft (Support-Pfad); der GUI-Schalter
  // (`setzeDebugAktiv`) steuert den Normalfall. debug() schreibt, wenn eines von beiden an ist.
  const erzwungen = deps.debugAktiv ?? false
  let schalter = false
  const senke = deps.senke

  const schreibe = (stufe: LogStufe, ereignis: string, felder?: LogFelder): void => {
    // Die Senke ist so gebaut, dass sie nie wirft (log-datei.ts). Der Port bleibt dennoch defensiv:
    // ein Log-Aufruf darf unter keinen Umständen den Aufrufer-Pfad (Workflow, Paste, App-Start) stören.
    try {
      senke.schreibeZeile(formatiereZeile(jetzt, stufe, ereignis, felder))
    } catch {
      // Bewusst still: kein console.error hier (die Senke meldet ihren ersten Fehler selbst), und
      // vor allem kein Log-über-das-Log → keine Rekursion.
    }
  }

  return {
    debug(ereignis, felder) {
      if (!erzwungen && !schalter) return // früher Return: keine Formatierung im Aus-Zustand
      schreibe('debug', ereignis, felder)
    },
    info(ereignis, felder) {
      schreibe('info', ereignis, felder)
    },
    warnung(ereignis, felder) {
      schreibe('warnung', ereignis, felder)
    },
    fehler(ereignis, felder) {
      schreibe('fehler', ereignis, felder)
    },
    setzeDebugAktiv(aktiv) {
      schalter = aktiv
    }
  }
}

/** Aus-Zustand/Default für optionale `log?`-Deps: vier no-op-Methoden, schreiben nie. */
export const NOOP_EREIGNISLOG: EreignisLog = {
  debug: () => {},
  info: () => {},
  warnung: () => {},
  fehler: () => {}
}

/**
 * Reduziert einen unbekannten Fehlergrund auf die einzig loggbaren, text-freien Felder: `name` und
 * eine redigierte, gekürzte `message`. NIE Stack, Cause, Response-Bodies o. Ä. (könnten Diktat-Text,
 * URLs mit Credentials oder Key-Fragmente enthalten). Nicht-Error → `name='Unbekannt'`, `message` aus
 * `String(grund)`. Steuerzeichenfilter/Kürzung erledigt der Formatierer beim Schreiben zusätzlich.
 */
export function redigiereFehler(grund: unknown): LogFelder {
  if (grund instanceof Error) {
    return {
      name: grund.name || 'Error',
      message: saeubereString(grund.message ?? '')
    }
  }
  return {
    name: 'Unbekannt',
    message: saeubereString(String(grund))
  }
}
