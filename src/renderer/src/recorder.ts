// Versteckter Aufnahme-Renderer (#03/#11, HITL/Windows). Empfängt start/stop/discard aus dem Main-
// Prozess (über die Preload-Bridge blitztextRecorder), nimmt das Mikrofon via MediaRecorder auf und
// schickt den fertigen Blob (als ArrayBuffer) + die gemessene Dauer zurück. Kein UI — das Fenster
// bleibt unsichtbar. Laufzeit-Abnahme (echtes Mikrofon, Berechtigungen) auf Windows.

import { waehleAudioConstraints } from './lib/mikrofon-auswahl'

declare global {
  interface Window {
    blitztextRecorder: {
      // Befund 7a (v0.8.0): `deviceId` kommt als Nutzlast direkt mit — `undefined`, wenn KEINE mitkam
      // (Altweg: dann fragt starteAufnahme() selbst per IPC nach, siehe ermittleGewuenschteDeviceId).
      // Befund 2 (v0.8.x, adversariale Review): `lauf` ist der vom Main-Prozess erzeugte Lauf-Bezug für
      // diesen Aufnahme-Versuch — recorder.ts interpretiert ihn nicht, reicht ihn nur an sendGestartet
      // durch (siehe runner.ts `meldeAufnahmeBestaetigt`).
      onStart(cb: (deviceId?: string, lauf?: number) => void): void
      onStop(cb: () => void): void
      onDiscard(cb: () => void): void
      /**
       * Befund A (v0.8.0, Feld-Log 2026-07-31): App-Start-Vorwärmung. Löst NUR das Öffnen/Wiederverwenden
       * des Mikrofon-Streams aus (siehe waermeMikrofonAuf) — KEINE Aufnahme, kein MediaRecorder, keine
       * sendGestartet-Bestätigung. `deviceId` = die vom Nutzer gewählte mikrofonDeviceId, direkt als
       * Nutzlast mitgegeben (analog zur onStart-Nutzlast, Befund 7a) — kein IPC-Pull nötig.
       */
      onWarmup(cb: (deviceId?: string) => void): void
      sendResult(
        buffer: ArrayBuffer,
        durationSeconds: number,
        mimeType: string,
        pegel: { max: number; median: number } | null
      ): void
      sendError(message: string): void
      /**
       * v0.8.0 (Befund 9): Bestätigung, dass mediaRecorder.start() erfolgreich lief — die Pille zeigt bis
       * dahin „Starte …" statt fälschlich „Aufnahme …" (siehe pill-status.ts). Dauerhafter Kanal, analog
       * zu sendError, kein Roundtrip-Warten im Renderer nötig.
       * Befund 2 (v0.8.x): `lauf` spiegelt den in onStart empfangenen Lauf-Bezug unverändert zurück.
       */
      sendGestartet(lauf?: number): void
    }
  }
}

/**
 * Schreibt eine Log-Zeile (v0.7.2), OHNE je zu werfen — Logging darf die Aufnahme nie stören. Nur
 * redigierte Primitive (name/message, ≤200 Zeichen), NIE Audio-/Diktat-Inhalt. Der Main redigiert/
 * validiert zusätzlich (parseRendererLog). Befund A: generalisiert von der vormaligen `logFehlerStill`
 * (bleibt als schmaler Wrapper erhalten) — die Vorwärmung braucht eine NICHT-'fehler'-Stufe: ein
 * fehlendes Mikrofon/eine fehlende Berechtigung beim bloßen App-Start ist kein Nutzer-sichtbarer Fehler.
 */
function logStill(
  stufe: 'info' | 'warnung' | 'fehler',
  ereignis: string,
  felder?: Record<string, string | number | boolean>
): void {
  try {
    window.blitztext?.log?.schreibe(stufe, ereignis, felder)
  } catch {
    // Log-Bridge fehlt (z. B. im Recorder-Fenster ohne Isolation) oder wirft → still verschlucken.
  }
}

/** Unveränderter Altweg-Name für den Aufnahme-Fehlerpfad (Bestandsverhalten, s. logStill). */
function logFehlerStill(ereignis: string, felder?: Record<string, string | number | boolean>): void {
  logStill('fehler', ereignis, felder)
}

/** Redigiert einen unbekannten Fehler auf name+message, jeweils auf ≤200 Zeichen gekürzt (kein Leak). */
function redigiereFehlerFelder(err: unknown): { name: string; message: string } {
  if (err instanceof Error) {
    return { name: err.name.slice(0, 200), message: err.message.slice(0, 200) }
  }
  return { name: 'Unknown', message: String(err).slice(0, 200) }
}

let mediaRecorder: MediaRecorder | null = null
let chunks: Blob[] = []
// Befund 11 (v0.8.0): der Mikrofon-Stream wird jetzt zwischen Aufnahmen VORGEWÄRMT (offen gehalten)
// statt bei jedem Stopp komplett freigegeben zu werden — die volle Geräte-Initialisierung durch
// getUserMedia ist der spürbarste Teil der Start-Latenz. `streamDeviceId` merkt, für welche deviceId der
// gehaltene Stream geöffnet wurde (normalisiert, siehe normalisiereDeviceId): ändert sich die gewünschte
// deviceId, muss neu geholt werden. SICHTBARER PREIS (vom Nutzer ausdrücklich akzeptiert): das Windows-
// Mikrofonsymbol bleibt an, solange der (versteckte) Recorder-Renderer lebt — das ist KEIN Fehler,
// sondern eine bewusste Entscheidung. Bitte NICHT als Befund für eine künftige Fehlerjagd aufgreifen.
let stream: MediaStream | null = null
let streamDeviceId = ''
let startMs = 0
// Befund 16 (v0.8.0): true, sobald diese Aufnahme-Sitzung terminal ist (Fehler bereits gemeldet ODER
// der reguläre onstop-Pfad ist schon durchgelaufen). Verhindert eine Doppelmeldung: der MediaRecorder-
// Spec zufolge feuert nach einem Fehler zusätzlich das reguläre 'stop'-Event — welcher Pfad auch zuerst
// läuft, er markiert die Sitzung sofort als abgeschlossen und legt den jeweils anderen still. Reset bei
// jedem neuen starteAufnahme()-Lauf.
let istAbgeschlossen = false

// Befund 1 (adversariale Review, v0.8.x): `starteAufnahme()` hängt VOR jeder Modul-Variablen-Zuweisung an
// zwei awaits (ermittleGewuenschteDeviceId, getUserMedia) — dauert einer davon lange (Bluetooth-Mikro,
// Defender-Erstscan, Gerätewechsel), kann der Nutzer währenddessen abbrechen UND einen neuen Lauf starten.
// Löst der alte Aufruf danach auf, lief er bisher BEDINGUNGSLOS weiter: neue MediaRecorder-Instanz, neuer
// Stream, Bestätigung — ohne zu prüfen, ob er noch aktuell ist. Der zwischenzeitlich gestartete, echte Lauf
// B wird dabei verwaist (sein mediaRecorder wird überschrieben) — Datenverlust ohne Fehlermeldung.
//
// `aufnahmeGeneration` behebt das: JEDER starteAufnahme()-Aufruf zieht sich beim Eintritt seine eigene,
// monoton steigende Generation; JEDER stoppeAufnahme()/verwerfeAufnahme()-Aufruf erhöht den Zähler
// ZUSÄTZLICH — auch wenn `mediaRecorder` dort noch `null` ist (genau der Fall, der heute wirkungslos
// bliebe). Ein starteAufnahme()-Aufruf prüft nach JEDEM await, ob seine gezogene Generation noch die
// aktuelle ist; ist sie es nicht, bricht er FOLGENLOS ab (keine Modul-Variable anfassen, keine Bestätigung/
// keinen Fehler senden) und gibt einen bereits geöffneten Stream sauber wieder frei.
let aufnahmeGeneration = 0

// v0.7.4 — Pegel-Analyse gegen Whisper-Halluzinationen auf Stille (siehe quality.istStilleAufnahme).
// Gemessen werden Spitze UND Grundrauschen (Median) über kurze Fenster; erst beides zusammen sagt
// etwas darüber aus, ob GESPROCHEN wurde: Sprache ist stoßhaft, Stille ist flach.
//
// Die Messung läuft bewusst NACH der Aufnahme auf dem fertigen Blob (decodeAudioData) statt live über
// einen AnalyserNode am Stream. Der Live-Weg hatte zwei Fehlerquellen, die im Feld beide zuschlugen:
// Ein AudioContext kann durch die Autoplay-Regeln suspendiert starten und liefert dann dauerhaft
// Nullen, und die Abtastung hing an einem Timer in einem dauerhaft unsichtbaren Fenster. decodeAudioData
// dekodiert dagegen unabhängig vom Kontext-Zustand und sieht JEDE Probe der Aufnahme statt nur
// Stichproben im 50-ms-Raster. Kosten: einige Millisekunden nach dem Stoppen.
const FENSTER_MS = 20

export interface PegelMessung {
  max: number
  median: number
}

/**
 * Analysiert die fertige Aufnahme. Liefert `null`, wenn irgendetwas schiefgeht (nicht dekodierbar,
 * Audio-API blockiert, kein einziges volles Fenster) — der Main lehnt dann NIE ab. Die Analyse ist eine
 * Diagnose-Zugabe und darf ein echtes Diktat niemals gefährden.
 */
async function analysierePegel(blob: Blob): Promise<PegelMessung | null> {
  let kontext: AudioContext | null = null
  try {
    // decodeAudioData ÜBERNIMMT den Puffer (detached) — deshalb eine eigene Kopie, sonst wäre der an den
    // Main gesendete ArrayBuffer hinterher leer.
    const kopie = await blob.arrayBuffer()
    kontext = new AudioContext()
    const audio = await kontext.decodeAudioData(kopie)
    const daten = audio.getChannelData(0)
    const fenster = Math.max(1, Math.round(audio.sampleRate * (FENSTER_MS / 1000)))
    const werte: number[] = []
    for (let i = 0; i + fenster <= daten.length; i += fenster) {
      let summe = 0
      for (let j = 0; j < fenster; j++) {
        const wert = daten[i + j] ?? 0
        summe += wert * wert
      }
      werte.push(Math.sqrt(summe / fenster))
    }
    if (werte.length === 0) return null
    let max = 0
    for (const wert of werte) if (wert > max) max = wert
    const sortiert = [...werte].sort((a, b) => a - b)
    const median = sortiert[Math.floor(sortiert.length / 2)] ?? 0
    if (!Number.isFinite(max) || !Number.isFinite(median)) return null
    return { max, median }
  } catch {
    return null
  } finally {
    // close() ist asynchron und darf nichts aufhalten; Fehler sind hier bedeutungslos.
    void kontext?.close().catch(() => {})
  }
}

/**
 * Befund 11: räumt NUR den MediaRecorder ab (löst onerror, verwirft die Chunks) — der Mikrofon-Stream
 * bleibt bewusst OFFEN (Vorwärmung für die nächste Aufnahme). Das ist der Normalfall nach einer
 * erfolgreich abgeschlossenen ODER verworfenen Aufnahme, bei der das Mikrofon selbst gesund blieb.
 */
function raeumeRecorderAuf(): void {
  if (mediaRecorder) mediaRecorder.onerror = null
  mediaRecorder = null
  chunks = []
}

/**
 * Befund 11: gibt den gehaltenen Stream VOLLSTÄNDIG frei (Track stoppen, Wächter lösen) — nur bei einem
 * Gerätewechsel, einem als tot erkannten Track (Befund 16: onerror/onended) oder beim Entladen des
 * (versteckten) Recorder-Fensters. Löst onended VOR dem stop(), damit ein durch stop() selbst
 * ausgelöstes 'ended' auf demselben Track nichts mehr anstößt.
 */
function gebeStreamFrei(): void {
  stream?.getTracks().forEach((t) => {
    t.onended = null
    t.stop()
  })
  stream = null
  streamDeviceId = ''
}

/**
 * Befund 16 (v0.8.0): einzige Meldestelle für einen Aufnahme-Fehler, der WÄHREND der laufenden Aufnahme
 * auftritt — MediaRecorder.onerror (Encoder-Fehler) oder ein beendeter Audio-Track (USB-Mikrofon
 * abgezogen, Datenschutz-Schalter des Systems, Gerät von einer anderen App exklusiv belegt). Nutzt
 * dieselbe bestehende Fehler-Brücke wie der getUserMedia-Fehlerpfad (sendError → recorder-adapter →
 * runner.meldeAufnahmeFehler) — KEIN neuer IPC-Kanal. `istAbgeschlossen` ist der Doppelmeldungs-Guard
 * (s. o.): er stellt `onstop` sofort still, damit das spec-bedingt zusätzlich feuernde 'stop'-Event nach
 * einem Fehler kein zweites (widersprüchliches) Ergebnis sendet.
 */
function meldeLaufendenAufnahmeFehler(ereignis: string, err: Error): void {
  if (istAbgeschlossen) return
  istAbgeschlossen = true
  if (mediaRecorder) mediaRecorder.onstop = null
  logFehlerStill(ereignis, redigiereFehlerFelder(err))
  window.blitztextRecorder.sendError(err.message)
  // Befund 11: hier ist der Stream selbst betroffen (Encoder-Fehler ODER ein Track, das sich beendet
  // hat) — VOLL freigeben, ein toter Stream darf NIE als „warm" für die nächste Aufnahme durchgehen.
  raeumeRecorderAuf()
  gebeStreamFrei()
}

/**
 * Liest die gewünschte Mikrofon-deviceId aus den Einstellungen (W3-ζ) per IPC. Befund 7a (v0.8.0): das
 * ist jetzt NUR NOCH der Altweg-Fallback — der Normalfall bekommt die deviceId direkt als Nutzlast von
 * `recorder:start` mit (kein Roundtrip mehr im Startpfad). Wird nur gerufen, wenn KEINE Nutzlast mitkam
 * (alte Aufrufer/Fakes/Tests). Jeder Fehler (z. B. Settings noch nicht erreichbar) fällt auf „kein
 * Wunschgerät" zurück, NIE die Aufnahme blockieren.
 */
async function ermittleGewuenschteDeviceId(): Promise<string | undefined> {
  try {
    const settings = (await window.blitztext.settings.get()) as { mikrofonDeviceId?: string }
    return settings.mikrofonDeviceId
  } catch {
    return undefined
  }
}

/** Befund 11: `undefined` und `''` bedeuten beide „OS-Standardgerät" — auf denselben Wert normalisieren,
 *  sonst würde ein Wechsel zwischen den beiden gleichbedeutenden Werten fälschlich als Gerätewechsel
 *  gelten und den warmen Stream unnötig verwerfen. */
function normalisiereDeviceId(deviceId: string | undefined): string {
  return deviceId ?? ''
}

/**
 * Befund 11: true, wenn der gehaltene Stream für GENAU diese deviceId offen ist UND jedes seiner Tracks
 * noch `readyState === 'live'` meldet. Das Sicherheitsnetz aus Befund 16 (onerror/onended) räumt einen
 * sterbenden Stream normalerweise schon VORHER über gebeStreamFrei() weg — diese Prüfung ist die zweite,
 * defensive Instanz direkt vor der Wiederverwendung: ein Track, das (aus welchem Grund auch immer) OHNE
 * onended-Feuern gestorben ist, darf trotzdem NIE wiederverwendet werden — das wäre ein stummer Hänger
 * (die Pille zeigt „Aufnahme", aber es kommt nie Audio an).
 */
function istWarmStreamNutzbar(gewuenschteDeviceId: string): boolean {
  if (!stream || streamDeviceId !== gewuenschteDeviceId) return false
  const tracks = stream.getTracks()
  return tracks.length > 0 && tracks.every((t) => t.readyState === 'live')
}

async function starteAufnahme(nutzlastDeviceId?: string, lauf?: number): Promise<void> {
  // Befund 1: DIESER Aufruf zieht sich seine eigene Generation — automatisch höher als alles, was vorher
  // lief (auch ein noch hängender älterer starteAufnahme()-Aufruf), UND der Referenzwert für die
  // istAktuell-Prüfungen weiter unten.
  const meineGeneration = ++aufnahmeGeneration
  try {
    // Befund 7a: Nutzlast bevorzugen (kein IPC nötig); nur OHNE Nutzlast (Altweg) selbst nachfragen.
    const gewuenschteDeviceId = normalisiereDeviceId(
      nutzlastDeviceId ?? (await ermittleGewuenschteDeviceId())
    )
    // Befund 1: erste Prüfstelle NACH einem await — an dieser Stelle wurde noch NICHTS alloziert (weder
    // Stream noch MediaRecorder), ein überholter Aufruf kann also folgenlos (ohne Aufräumen) abbrechen.
    if (meineGeneration !== aufnahmeGeneration) return
    // Befund 11: den gehaltenen Stream wiederverwenden, wenn er zur gewünschten deviceId passt und
    // gesund ist — sonst (Gerätewechsel oder totes Track) erst vollständig freigeben, dann neu holen.
    if (!istWarmStreamNutzbar(gewuenschteDeviceId)) {
      gebeStreamFrei()
      // Befund 1: ERST in eine lokale Variable holen, NICHT direkt ins Modul schreiben — das hier ist
      // genau die Stelle, an der ein hängender Aufruf lange verharren kann (Bluetooth-Mikro, Defender-
      // Erstscan, Gerätewechsel). Ein bedingungsloses `stream = await …` würde einen zwischenzeitlich
      // gestarteten, echten Lauf B überschreiben (dessen mediaRecorder verwaist — Datenverlust ohne
      // Fehlermeldung, siehe Modul-Kommentar zu aufnahmeGeneration).
      const frischerStream = await navigator.mediaDevices.getUserMedia(
        waehleAudioConstraints(gewuenschteDeviceId)
      )
      // Befund 1: zweite (und kritischste) Prüfstelle NACH einem await. Ist dieser Aufruf inzwischen
      // überholt, den GERADE geöffneten Stream NICHT dem Modul zuweisen — sonst verwaist ein zwischen-
      // zeitlich gestarteter, echter Lauf B —, sondern sofort wieder sauber freigeben (kein Leck, kein
      // dauerhaft aktives Windows-Mikrofonsymbol für ein Track, das niemand mehr nutzt).
      if (meineGeneration !== aufnahmeGeneration) {
        frischerStream.getTracks().forEach((t) => t.stop())
        return
      }
      stream = frischerStream
      streamDeviceId = gewuenschteDeviceId
      // Befund 16: ein beendetes Track (USB-Abzug, Datenschutz-Schalter, exklusive Belegung durch eine
      // andere App) merkt der MediaRecorder selbst NICHT — er bleibt im Zustand 'recording' und liefert
      // nur noch Stille, statt einen Fehler zu werfen. Nur für einen FRISCHEN Stream nötig — ein
      // wiederverwendeter Stream trägt die Wächter des vorigen Laufs schon (dieselben Track-Objekte).
      stream.getTracks().forEach((track) => {
        track.onended = () => {
          meldeLaufendenAufnahmeFehler('recorder.track_beendet', new Error('Mikrofon wurde getrennt.'))
        }
      })
    }
    chunks = []
    istAbgeschlossen = false // frische Sitzung — der Doppelmeldungs-Guard gilt pro Aufnahme
    mediaRecorder = new MediaRecorder(stream!) // Chromium-Default: audio/webm;codecs=opus — stream ist an dieser Stelle IMMER gesetzt (frisch geholt oder als warm geprüft)
    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data)
    }
    // Befund 16: ohne diesen Wächter bleibt ein Encoder-Fehler bis zum 10-Minuten-Aufnahme-Watchdog
    // unbemerkt — der Nutzer spricht derweil ins Leere.
    mediaRecorder.onerror = (event) => {
      const grund =
        event.error instanceof Error ? event.error : new Error(event.message || 'MediaRecorder-Fehler')
      meldeLaufendenAufnahmeFehler('recorder.mediarecorder_fehler', grund)
    }
    startMs = performance.now()
    mediaRecorder.start()
    // Befund 9: die Bestätigung geht ERST NACH erfolgreichem start() raus — bis dahin zeigt die Pille
    // „Starte …" statt fälschlich „Aufnahme …" (siehe pill-status.ts). Ein Fehler oberhalb dieser Zeile
    // (getUserMedia/Konstruktor) landet im catch unten und sendet KEINE Bestätigung.
    // Befund 2: `lauf` unverändert zurückspiegeln — der Main-Prozess erkennt daran eine verspätete
    // Bestätigung eines längst abgelösten Laufs (siehe runner.ts `meldeAufnahmeBestaetigt`). Kein
    // zusätzlicher istAktuell-Check hier nötig: die beiden Prüfstellen oben decken JEDEN await ab, ab
    // hier läuft der Code rein synchron bis zu dieser Zeile durch.
    window.blitztextRecorder.sendGestartet(lauf)
  } catch (err) {
    // Befund 1: ein überholter Aufruf darf auch im Fehlerfall NICHTS mehr anfassen — weder den
    // Doppelmeldungs-Guard noch einen (inzwischen fremden) MediaRecorder/Stream aufräumen, noch einen
    // Fehler senden. Täte er das doch, könnte er einen längst laufenden, gesunden Lauf B fälschlich in
    // die Fehler-Pille reißen (raeumeRecorderAuf/gebeStreamFrei würden B's LIVE Objekte treffen) oder
    // dessen Bestätigung durch eine überflüssige Fehlermeldung verwirren.
    if (meineGeneration !== aufnahmeGeneration) return
    // Befund 16: dieser Fehlschlag liegt VOR mediaRecorder.start() (getUserMedia/Konstruktor) — es gibt
    // also gar keinen onstop-Konkurrenten. `istAbgeschlossen` trotzdem setzen (defensiv-konsistent mit
    // meldeLaufendenAufnahmeFehler), damit ein aus einer vorherigen Sitzung nachzügelndes Event hier
    // keine zweite Meldung auslöst.
    istAbgeschlossen = true
    // Befund 11: der Fehlschlag liegt vor/bei der Geräte-Initialisierung — der (evtl. wiederverwendete)
    // Stream ist hier nicht vertrauenswürdig genug, um ihn warm zu halten. Voll freigeben.
    raeumeRecorderAuf()
    gebeStreamFrei()
    // v0.7.2: zusätzlich (Verhalten von sendError bleibt exakt) ins Ereignislog — Feld-Beleg für die
    // Fehlerjagd „Aufnahme startet nicht". Nur redigierte name/message, nie Audio-Inhalt.
    logFehlerStill('recorder.getusermedia_fehl', redigiereFehlerFelder(err))
    window.blitztextRecorder.sendError(err instanceof Error ? err.message : String(err))
  }
}

/**
 * Befund A (v0.8.0, Feld-Log 2026-07-31): wärmt den Mikrofon-Stream bereits beim App-Start vor, statt
 * erst ab der ERSTEN echten Aufnahme davon zu profitieren. Befund 11 hält den Stream zwischen zwei
 * Aufnahmen offen — das half aber nur ab der ZWEITEN Aufnahme, weil der Stream vorher schlicht noch nie
 * geöffnet worden war. Im Feld belegt: der Nutzer ließ die Taste nach ~1,2s los, bevor getUserMedia beim
 * Kaltstart fertig war — „Keine aktive Aufnahme.", Diktat verloren. index.ts löst diese Funktion (fire-
 * and-forget, über den neuen 'recorder:warmup'-Kanal) kurz nach dem App-Start aus, sobald dieses Fenster
 * bereit ist (siehe warteAufFensterBereit) — bewusst BEVOR der Nutzer irgendetwas angefordert hat.
 *
 * AUSGEWEITETER PREIS (wie vom Auftrag verlangt festgehalten): das Windows-Mikrofonsymbol leuchtet damit
 * schon beim App-Start auf, nicht erst beim ersten Diktat. Das ist dieselbe, vom Nutzer bereits
 * akzeptierte Dauer-Aktivierung aus Befund 11 (siehe `stream`-Kommentar oben) — sie beginnt jetzt nur
 * früher. KEIN neuer Fehlerfall.
 *
 * Scheitert FOLGENLOS: kein sendError() — der Nutzer hat an dieser Stelle nichts angefordert, eine
 * Fehler-Pille direkt beim App-Start wäre falsch. Fehlende Mikrofon-Berechtigung und fehlendes Gerät
 * bleiben beide still (nur eine info-Log-Zeile als Diagnose-Beleg, NIE Audio-/Klartextinhalt). Die
 * eigentliche erste Aufnahme läuft unverändert über starteAufnahme() — schlägt das Vorwärmen fehl,
 * verhält sie sich einfach wie ohne diese Funktion (voller getUserMedia-Preis beim ersten echten Start).
 *
 * Zusammenspiel mit Generationszähler/Warm-Stream-Prüfung (Befund 1/11), damit ein bereits laufendes
 * Diktat NIE gestört wird:
 *  - Existiert JETZT SCHON ein echter mediaRecorder (Aufnahme läuft), bricht diese Funktion SOFORT ab,
 *    BEVOR sie überhaupt eine Generation zieht oder `stream`/`gebeStreamFrei()` anfasst — unabhängig vom
 *    Zähler. Reine Vorsichtsmaßnahme: in der Praxis unerreichbar, weil index.ts das Vorwärmen VOR der
 *    Hotkey-Erkennung auslöst (kein echtes Diktat kann zu diesem Zeitpunkt schon laufen), aber die Reihen-
 *    folge zweier Aufrufer-Module soll keine Voraussetzung für Speichersicherheit sein.
 *  - Teilt sich DANACH `aufnahmeGeneration` mit starteAufnahme() (KEIN eigener Zähler): beginnt EIN
 *    echtes Diktat, WÄHREND das Vorwärmen noch in getUserMedia hängt, entwertet dessen ++aufnahmeGeneration
 *    diesen Aufruf an genau denselben beiden Prüfstellen wie in starteAufnahme() (nach dem ersten await,
 *    nach getUserMedia) — exakt das Befund-1-Muster. Der dann verwaiste, frisch geöffnete Stream wird
 *    sauber wieder freigegeben (Track gestoppt), OHNE `stream`/`streamDeviceId` anzufassen.
 */
async function waermeMikrofonAuf(nutzlastDeviceId?: string): Promise<void> {
  if (mediaRecorder) return // echtes Diktat läuft bereits — Vorwärmen hat hier nichts verloren
  const meineGeneration = ++aufnahmeGeneration
  try {
    const gewuenschteDeviceId = normalisiereDeviceId(
      nutzlastDeviceId ?? (await ermittleGewuenschteDeviceId())
    )
    if (meineGeneration !== aufnahmeGeneration) return // ein echtes Diktat hat inzwischen begonnen
    if (istWarmStreamNutzbar(gewuenschteDeviceId)) return // schon warm (oder passend wiederverwendbar)
    gebeStreamFrei()
    const frischerStream = await navigator.mediaDevices.getUserMedia(
      waehleAudioConstraints(gewuenschteDeviceId)
    )
    if (meineGeneration !== aufnahmeGeneration) {
      // Befund 1-Muster: inzwischen überholt (ein echtes Diktat hat begonnen) — den gerade geöffneten
      // Stream NICHT dem Modul zuweisen, sondern sofort sauber wieder freigeben.
      frischerStream.getTracks().forEach((t) => t.stop())
      return
    }
    stream = frischerStream
    streamDeviceId = gewuenschteDeviceId
    // Befund 16: derselbe Wächter wie in starteAufnahme() — ein beendetes Track muss auch für einen
    // vorgewärmten (noch nie aufgenommenen) Stream erkannt werden.
    stream.getTracks().forEach((track) => {
      track.onended = () => {
        meldeLaufendenAufnahmeFehler('recorder.track_beendet', new Error('Mikrofon wurde getrennt.'))
      }
    })
  } catch (err) {
    if (meineGeneration !== aufnahmeGeneration) return // überholt — nichts mehr anfassen (Befund 1)
    // Bewusst KEIN sendError(): folgenlos scheitern ist hier der Auftrag (s. Funktionskommentar). Nur
    // redigierte name/message, nie Audio-Inhalt; info statt fehler — für den Nutzer ist das kein Fehler.
    logStill('info', 'recorder.warmup_fehl', redigiereFehlerFelder(err))
  }
}

function stoppeAufnahme(): void {
  // Befund 1: JEDER Stopp-Befehl entwertet eine noch hängende starteAufnahme()-Fortsetzung — auch wenn
  // `mediaRecorder` unten noch `null` ist (der Fall, der heute wirkungslos bliebe, weil es dort gar
  // nichts zum Stoppen gibt). Ohne diese Zeile könnte ein spät auflösender alter Aufruf sich trotzdem
  // noch als „aktuell" erkennen und den inzwischen frisch gestarteten Lauf B verwaisen lassen.
  aufnahmeGeneration++
  const recorder = mediaRecorder
  if (!recorder) {
    // Befund 16: kam bereits ein Aufnahme-Fehler durch (onerror/beendeter Track), hat der schon
    // aufgeräumt (mediaRecorder === null) UND schon gemeldet — ein nachträgliches 'recorder:stop' (Race
    // zwischen der Fehlermeldung und dem Loslassen der Aufnahme-Taste) darf dann NICHT nochmal melden.
    if (!istAbgeschlossen) window.blitztextRecorder.sendError('Keine aktive Aufnahme.')
    return
  }
  const durationSeconds = (performance.now() - startMs) / 1000
  recorder.onstop = () => {
    // Befund 16: sofort als abgeschlossen markieren — feuert danach (spec-widrig selten, aber möglich)
    // doch noch ein onerror/onended auf demselben Recorder/Stream, bleibt dessen Meldung aus (Guard s.o.).
    istAbgeschlossen = true
    const type = recorder.mimeType || 'audio/webm'
    const blob = new Blob(chunks, { type })
    // electron#42714: getUserMedia kann ohne Mikrofon-Zugriff still ein leeres Track liefern statt zu
    // werfen → leere Aufnahme als Fehler melden (oft Windows-Mikrofon-Datenschutz).
    if (blob.size === 0) {
      // v0.7.2: zusätzlich (sendError-Pfad unverändert) ins Ereignislog. bytes=0 ist eine Länge, kein
      // Inhalt — datenschutzkonform.
      logFehlerStill('recorder.leere_aufnahme', { bytes: 0 })
      window.blitztextRecorder.sendError(
        'Mikrofon lieferte keine Audiodaten — bitte Windows-Mikrofon-Datenschutz prüfen.'
      )
      // Befund 11: NICHT freigeben — der Auftrag benennt genau drei Freigabe-Anlässe (Gerätewechsel,
      // totes Track, Fenster-Entladung). Das Track selbst meldet hier weiterhin `readyState === 'live'`
      // (electron#42714 ist ein OS-seitiges Stummschalten, kein Track-Tod) — das Sicherheitsnetz
      // (istWarmStreamNutzbar) hätte hier ohnehin nichts zu beanstanden. Nur den MediaRecorder abräumen.
      raeumeRecorderAuf()
      return
    }
    // Pegel-Analyse (v0.7.4) vor dem Senden: sie braucht eine eigene Kopie des Puffers, weil
    // decodeAudioData den übergebenen ArrayBuffer übernimmt. Schlägt sie fehl, geht `null` mit — der
    // Main lehnt dann nie ab, das Diktat läuft normal weiter.
    void analysierePegel(blob)
      .catch(() => null)
      .then(async (messung) => {
        const buffer = await blob.arrayBuffer()
        // MIME-Type MITGEBEN: sonst baut der Main-Prozess einen typlosen Blob → undici sendet
        // application/octet-stream → OpenAI 400 „Unrecognized file format" (RESEARCH §5).
        window.blitztextRecorder.sendResult(buffer, durationSeconds, type, messung)
        // Befund 11: NUR den MediaRecorder abräumen — der Stream bleibt für die nächste Aufnahme warm.
        raeumeRecorderAuf()
      })
  }
  recorder.stop()
}

function verwerfeAufnahme(): void {
  // Befund 1: siehe stoppeAufnahme — auch ein discard() muss eine noch hängende starteAufnahme()-
  // Fortsetzung entwerten, unabhängig davon, ob unten bereits ein mediaRecorder existiert (genau das ist
  // das im Auftrag benannte Szenario: A hängt noch VOR jeder Modul-Zuweisung, der Nutzer bricht ab).
  aufnahmeGeneration++
  // Befund 16: Verwerfen ist gewollt — ein danach noch feuerndes onerror/onended (z. B. weil stop() den
  // Track asynchron beendet) darf keine nachträgliche Fehlermeldung mehr auslösen.
  istAbgeschlossen = true
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.onstop = null
    mediaRecorder.stop()
  }
  // Befund 11: Verwerfen betrifft nur DIESE Aufnahme, nicht das Mikrofon selbst — der Stream bleibt warm.
  raeumeRecorderAuf()
}

window.blitztextRecorder.onStart((deviceId, lauf) => void starteAufnahme(deviceId, lauf))
window.blitztextRecorder.onStop(() => stoppeAufnahme())
window.blitztextRecorder.onDiscard(() => verwerfeAufnahme())
// Befund A: App-Start-Vorwärmung, fire-and-forget (das `void` verwirft die Promise absichtlich — der
// Aufrufer in index.ts awaitet dies ebenfalls nicht, siehe dortigen Kommentar).
window.blitztextRecorder.onWarmup((deviceId) => void waermeMikrofonAuf(deviceId))
// Befund 11: das (versteckte) Recorder-Fenster wird selten neu geladen (Fensterheilung nach Crash,
// manuelles Reload) — in dem Moment MUSS der gehaltene Stream sauber freigegeben werden, sonst hält das
// OS ein Mikrofon-Handle, das an keine lebende MediaRecorder-Instanz mehr gebunden ist.
window.addEventListener('beforeunload', () => gebeStreamFrei())

export {}
