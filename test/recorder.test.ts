import { describe, it, expect, vi, afterEach } from 'vitest'

// Kein jsdom im Projekt (vitest.config.ts: environment: 'node') — Renderer-Globals wie `window`/
// `navigator`/`MediaRecorder` existieren hier nicht von selbst. Gleiches Grund-Muster wie in
// recorder-adapter.test.ts (Electron gemockt) und preload.test.ts (Bridge über globalThis, vi.resetModules
// + dynamischer Import je Test): alle benötigten Browser-APIs werden hier per vi.stubGlobal nachgebaut,
// BEVOR das Modul dynamisch importiert wird — recorder.ts verdrahtet seine onStart/onStop/onDiscard-
// Handler beim Import als Modul-Top-Level-Code.

/** Minimaler Fake für ein einzelnes Mikrofon-Track (nur was recorder.ts anfasst: stop()/onended/readyState). */
class FakeAudioTrack {
  stop = vi.fn()
  onended: (() => void) | null = null
  // Befund 11: der Warm-Stream-Check liest readyState VOR jeder Wiederverwendung — Default 'live' wie
  // ein echtes, gesundes Mikrofon-Track.
  readyState: 'live' | 'ended' = 'live'
}

/** Minimaler Fake-Stream: nur getTracks(), wie MediaStream ihn recorder.ts gegenüber bereitstellt. */
function fakeStream(tracks: FakeAudioTrack[] = [new FakeAudioTrack()]): {
  getTracks: () => FakeAudioTrack[]
} {
  return { getTracks: () => tracks }
}

/**
 * Fake für MediaRecorder. `stop()` feuert BEWUSST NICHT synchron `onstop` — echte Browser feuern das
 * 'stop'-Event asynchron, und die Doppelfeuer-Tests unten müssen die Reihenfolge von onerror/onstop
 * gezielt selbst kontrollieren können (s. u.).
 */
class FakeMediaRecorder {
  static instances: FakeMediaRecorder[] = []
  state: 'inactive' | 'recording' = 'inactive'
  mimeType = 'audio/webm'
  ondataavailable: ((e: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null
  onerror: ((e: { error?: unknown; message?: string }) => void) | null = null

  // recorder.ts liest die Tracks direkt vom Stream (nicht über den MediaRecorder) — der Konstruktor
  // muss den Stream nur entgegennehmen (echtes MediaRecorder-Signatur-Verhalten), nicht speichern.
  constructor(_stream: { getTracks: () => FakeAudioTrack[] }) {
    FakeMediaRecorder.instances.push(this)
  }

  start(): void {
    this.state = 'recording'
  }

  stop(): void {
    this.state = 'inactive'
  }
}

interface FakeBruecke {
  onStart: ReturnType<typeof vi.fn>
  onStop: ReturnType<typeof vi.fn>
  onDiscard: ReturnType<typeof vi.fn>
  onWarmup: ReturnType<typeof vi.fn>
  sendResult: ReturnType<typeof vi.fn>
  sendError: ReturnType<typeof vi.fn>
  sendGestartet: ReturnType<typeof vi.fn>
}

function fakeBruecke(): FakeBruecke {
  return {
    onStart: vi.fn(),
    onStop: vi.fn(),
    onDiscard: vi.fn(),
    onWarmup: vi.fn(),
    sendResult: vi.fn(),
    sendError: vi.fn(),
    sendGestartet: vi.fn()
  }
}

/** Stubbt alle vom Modul benötigten Globals und importiert recorder.ts frisch (Modul-Top-Level läuft neu). */
async function ladeModul(
  stream: { getTracks: () => FakeAudioTrack[] } = fakeStream(),
  getUserMediaImpl?: () => Promise<unknown>
): Promise<{
  bruecke: FakeBruecke
  getUserMedia: ReturnType<typeof vi.fn>
  settingsGet: ReturnType<typeof vi.fn>
  addEventListener: ReturnType<typeof vi.fn>
}> {
  FakeMediaRecorder.instances = []
  const bruecke = fakeBruecke()
  const getUserMedia = vi.fn(getUserMediaImpl ?? (() => Promise.resolve(stream)))
  const settingsGet = vi.fn().mockResolvedValue({})
  // Befund 11: recorder.ts verdrahtet am Modul-Top-Level jetzt auch einen 'beforeunload'-Listener
  // (gibt den vorgewärmten Stream beim Entladen des Fensters frei) — ohne diesen Stub wirft der Import.
  const addEventListener = vi.fn()

  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } })
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder)
  vi.stubGlobal('window', {
    blitztextRecorder: bruecke,
    blitztext: {
      settings: { get: settingsGet },
      log: { schreibe: vi.fn() }
    },
    addEventListener
  })

  vi.resetModules()
  await import('../src/renderer/src/recorder')

  return { bruecke, getUserMedia, settingsGet, addEventListener }
}

/**
 * Löst den registrierten onStart-Handler aus und wartet, bis die Aufnahme (Fake) tatsächlich läuft.
 * `deviceId` (Befund 7a) wird 1:1 an den Handler durchgereicht — ohne Angabe simuliert das den Altweg
 * (alte Aufrufer ohne Nutzlast). Liefert IMMER die ZULETZT erzeugte MediaRecorder-Instanz zurück (nötig
 * für Mehrfach-Zyklen, Befund 11) — bei genau einer Instanz identisch zu `instances[0]`.
 */
async function starte(bruecke: FakeBruecke, deviceId?: string): Promise<FakeMediaRecorder> {
  const onStartCb = bruecke.onStart.mock.calls[0]?.[0] as (deviceId?: string) => void
  const vorher = FakeMediaRecorder.instances.length
  onStartCb(deviceId)
  await vi.waitFor(() => {
    expect(FakeMediaRecorder.instances.length).toBeGreaterThan(vorher)
    expect(FakeMediaRecorder.instances[FakeMediaRecorder.instances.length - 1]?.state).toBe('recording')
  })
  return FakeMediaRecorder.instances[FakeMediaRecorder.instances.length - 1]!
}

/**
 * Vervollständigt einen Aufnahme-Zyklus für die Befund-11-Tests: schiebt Testdaten in den Recorder,
 * löst stop() aus und wartet, bis sendResult tatsächlich gefeuert hat (Pegel-Analyse läuft asynchron,
 * AudioContext ist hier nicht gestubbt — analysierePegel() fängt das intern ab und liefert `null`).
 */
async function stoppeUndWarte(bruecke: FakeBruecke, recorder: FakeMediaRecorder): Promise<void> {
  recorder.ondataavailable?.({ data: new Blob(['audio-bytes']) })
  const onStopCb = bruecke.onStop.mock.calls[bruecke.onStop.mock.calls.length - 1]?.[0] as () => void
  onStopCb()
  recorder.onstop?.()
  await vi.waitFor(() => {
    expect(bruecke.sendResult).toHaveBeenCalled()
  })
}

/** Löst den registrierten onWarmup-Handler aus (Befund A: App-Start-Vorwärmung, KEIN MediaRecorder). */
function warme(bruecke: FakeBruecke, deviceId?: string): void {
  const onWarmupCb = bruecke.onWarmup.mock.calls[0]?.[0] as (deviceId?: string) => void
  onWarmupCb(deviceId)
}

describe('recorder.ts — Aufnahme-Fehlerwächter (Befund 16)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('mediaRecorder.onerror meldet über die bestehende Fehler-Brücke (sendError) und räumt den Stream ab', async () => {
    const track = new FakeAudioTrack()
    const { bruecke } = await ladeModul(fakeStream([track]))
    const recorder = await starte(bruecke)

    recorder.onerror?.({ error: new Error('Encoder-Fehler') })

    expect(bruecke.sendError).toHaveBeenCalledTimes(1)
    expect(bruecke.sendError).toHaveBeenCalledWith('Encoder-Fehler')
    // Stream sauber abgeräumt: der (einzige) Track wurde gestoppt.
    expect(track.stop).toHaveBeenCalledTimes(1)
  })

  it('ein beendeter Audio-Track (USB-Abzug/Datenschutz-Schalter/exklusive Belegung) meldet ebenfalls über sendError', async () => {
    const track = new FakeAudioTrack()
    const { bruecke } = await ladeModul(fakeStream([track]))
    await starte(bruecke)

    expect(track.onended).toBeTypeOf('function')
    track.onended?.()

    expect(bruecke.sendError).toHaveBeenCalledTimes(1)
  })

  it('kein Doppelfeuer: feuert onerror ZUERST, legt es das bereits wartende onstop still (nur EINE Meldung)', async () => {
    const track = new FakeAudioTrack()
    const { bruecke } = await ladeModul(fakeStream([track]))
    const recorder = await starte(bruecke)

    // Der Nutzer lässt die Taste los (IPC 'recorder:stop') — stoppeAufnahme() ASSIGNiert recorder.onstop,
    // OHNE dass der native 'stop'-Event schon gefeuert hätte (das passiert im echten Browser asynchron).
    const onStopCb = bruecke.onStop.mock.calls[0]?.[0] as () => void
    onStopCb()
    expect(recorder.onstop).not.toBeNull() // Vorbedingung: der reguläre Pfad "wartet" noch

    // Jetzt feuert der Encoder-Fehler.
    recorder.onerror?.({ error: new Error('Encoder-Fehler') })
    expect(bruecke.sendError).toHaveBeenCalledTimes(1)

    // Der MediaRecorder-Spec zufolge feuert nach einem Fehler zusätzlich 'stop' — hier simuliert, indem
    // wir den (durch den Guard bereits stillgelegten) Handler manuell aufrufen. Er darf NICHTS mehr tun.
    recorder.onstop?.()

    expect(bruecke.sendResult).not.toHaveBeenCalled()
    expect(bruecke.sendError).toHaveBeenCalledTimes(1) // weiterhin nur EINE Meldung
  })

  it('kein Doppelfeuer: feuert der reguläre onstop-Pfad ZUERST, bleibt ein danach feuerndes onerror aus', async () => {
    const track = new FakeAudioTrack()
    const { bruecke } = await ladeModul(fakeStream([track]))
    const recorder = await starte(bruecke)
    // Referenz VOR dem onstop-Durchlauf sichern: aufräumen() setzt recorder.onerror danach ohnehin auf
    // null zurück — würde der Test den Handler erst NACHHER von `recorder.onerror` ablesen, bewiese er nur
    // die Nullung, nicht den `istAbgeschlossen`-Guard selbst. Mit der vorab gesicherten Referenz wird
    // exakt DIESER Guard geprüft (der Handler „existiert" für den Test noch, meldet aber trotzdem nicht).
    const onErrorHandler = recorder.onerror

    // KEINE Daten (chunks bleibt leer) → der onstop-Handler nimmt synchron den Leer-Aufnahme-Fehlerpfad
    // (electron#42714), ohne auf die asynchrone Pegel-Analyse warten zu müssen.
    const onStopCb = bruecke.onStop.mock.calls[0]?.[0] as () => void
    onStopCb()
    recorder.onstop?.()

    expect(bruecke.sendError).toHaveBeenCalledTimes(1)
    expect(bruecke.sendError).toHaveBeenCalledWith(expect.stringContaining('Mikrofon lieferte keine Audiodaten'))

    // Spät (spec-widrig) feuerndes onerror: die Sitzung ist schon abgeschlossen (istAbgeschlossen-Guard)
    // → keine zweite Meldung, auch wenn der Handler (hypothetisch) noch erreichbar wäre.
    onErrorHandler?.({ error: new Error('Encoder-Fehler') })
    expect(bruecke.sendError).toHaveBeenCalledTimes(1)
  })
})

describe('recorder.ts — Start-Bestätigung (Befund 9)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sendet nach erfolgreichem mediaRecorder.start() eine Bestätigung über den neuen Kanal (sendGestartet)', async () => {
    const { bruecke } = await ladeModul()
    const recorder = await starte(bruecke)

    expect(recorder.state).toBe('recording')
    expect(bruecke.sendGestartet).toHaveBeenCalledTimes(1)
    // Reihenfolge zählt (Befund 9): die Bestätigung darf erst NACH start() rausgehen.
    expect(bruecke.sendError).not.toHaveBeenCalled()
  })

  it('bei fehlschlagendem getUserMedia wird KEINE Bestätigung gesendet, nur der Fehler', async () => {
    const { bruecke } = await ladeModul(undefined, () => Promise.reject(new Error('Permission denied')))

    // Der registrierte onStart-Handler ist `() => void starteAufnahme()` — das `void` verwirft die
    // Promise (Fire-and-forget, wie im echten Einsatz). `await` darauf würde also NICHT auf den
    // asynchronen getUserMedia-Fehlschlag warten; deshalb wie in starte() per vi.waitFor auf das
    // beobachtbare Ergebnis (sendError) pollen statt auf einen (hier nicht existenten) Rückgabewert.
    const onStartCb = bruecke.onStart.mock.calls[0]?.[0] as () => void
    onStartCb()
    await vi.waitFor(() => {
      expect(bruecke.sendError).toHaveBeenCalledTimes(1)
    })

    expect(bruecke.sendGestartet).not.toHaveBeenCalled()
    expect(bruecke.sendError).toHaveBeenCalledWith('Permission denied')
  })
})

describe('recorder.ts — deviceId als Start-Nutzlast (Befund 7a)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('mit Nutzlast: getUserMedia bekommt die deviceId direkt, OHNE die Einstellungen per IPC abzufragen', async () => {
    const { bruecke, getUserMedia, settingsGet } = await ladeModul()

    await starte(bruecke, 'mic-xyz')

    expect(getUserMedia).toHaveBeenCalledWith({ audio: { deviceId: { exact: 'mic-xyz' } } })
    expect(settingsGet).not.toHaveBeenCalled()
  })

  it('ohne Nutzlast (Altweg): fragt weiterhin die Einstellungen per IPC ab', async () => {
    const { bruecke, getUserMedia, settingsGet } = await ladeModul()
    settingsGet.mockResolvedValue({ mikrofonDeviceId: 'mic-alt' })

    await starte(bruecke) // KEIN deviceId-Argument — simuliert einen alten Aufrufer/Fake

    expect(settingsGet).toHaveBeenCalledTimes(1)
    expect(getUserMedia).toHaveBeenCalledWith({ audio: { deviceId: { exact: 'mic-alt' } } })
  })
})

describe('recorder.ts — Mikrofon-Vorwärmung (Befund 11)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('zwei Start/Stopp-Zyklen mit GLEICHER deviceId rufen getUserMedia nur EINMAL auf', async () => {
    const { bruecke, getUserMedia } = await ladeModul()

    const erster = await starte(bruecke, 'mic-a')
    await stoppeUndWarte(bruecke, erster)

    const zweiter = await starte(bruecke, 'mic-a')
    await stoppeUndWarte(bruecke, zweiter)

    expect(getUserMedia).toHaveBeenCalledTimes(1)
    expect(FakeMediaRecorder.instances).toHaveLength(2) // zwei MediaRecorder-Instanzen, EIN Stream
  })

  it('ein Wechsel der deviceId erzwingt einen neuen getUserMedia-Aufruf', async () => {
    const { bruecke, getUserMedia } = await ladeModul()

    const erster = await starte(bruecke, 'mic-a')
    await stoppeUndWarte(bruecke, erster)

    await starte(bruecke, 'mic-b')

    expect(getUserMedia).toHaveBeenCalledTimes(2)
  })

  it('ein still gestorbenes Track (readyState=ended, KEIN onended-Feuern) wird NICHT wiederverwendet', async () => {
    const track = new FakeAudioTrack()
    const { bruecke, getUserMedia } = await ladeModul(fakeStream([track]))

    const erster = await starte(bruecke, 'mic-a')
    await stoppeUndWarte(bruecke, erster)

    // Das Track „stirbt" leise — kein onended-Event simuliert (Sicherheitsnetz Befund 16 greift also
    // NICHT); der Warm-Stream-Check vor der Wiederverwendung muss das trotzdem selbst erkennen.
    track.readyState = 'ended'

    await starte(bruecke, 'mic-a')

    expect(getUserMedia).toHaveBeenCalledTimes(2)
  })

  it('stoppeAufnahme() stoppt NUR den MediaRecorder, NICHT die Mikrofon-Tracks (Vorwärmung)', async () => {
    const track = new FakeAudioTrack()
    const { bruecke } = await ladeModul(fakeStream([track]))
    const recorder = await starte(bruecke, 'mic-a')

    await stoppeUndWarte(bruecke, recorder)

    expect(track.stop).not.toHaveBeenCalled()
  })

  it('verwerfeAufnahme() (discard) stoppt NICHT die Mikrofon-Tracks (Stream bleibt warm)', async () => {
    const track = new FakeAudioTrack()
    const { bruecke } = await ladeModul(fakeStream([track]))
    await starte(bruecke, 'mic-a')

    const onDiscardCb = bruecke.onDiscard.mock.calls[0]?.[0] as () => void
    onDiscardCb()

    expect(track.stop).not.toHaveBeenCalled()
  })

  it('ein Encoder-Fehler (onerror) gibt den Stream VOLL frei — die nächste Aufnahme holt einen neuen', async () => {
    const track = new FakeAudioTrack()
    const { bruecke, getUserMedia } = await ladeModul(fakeStream([track]))
    const recorder = await starte(bruecke, 'mic-a')

    recorder.onerror?.({ error: new Error('Encoder-Fehler') })
    expect(track.stop).toHaveBeenCalledTimes(1) // Sicherheitsnetz: der tote Stream wird sofort freigegeben

    await starte(bruecke, 'mic-a')

    expect(getUserMedia).toHaveBeenCalledTimes(2) // KEINE stillschweigende Wiederverwendung des toten Streams
  })

  it('beforeunload gibt den vorgewärmten Stream frei (Fenster-Entladung)', async () => {
    const track = new FakeAudioTrack()
    const { bruecke, addEventListener } = await ladeModul(fakeStream([track]))
    await starte(bruecke, 'mic-a')

    const beiEntladen = addEventListener.mock.calls.find((c) => c[0] === 'beforeunload')?.[1] as () => void
    expect(beiEntladen).toBeTypeOf('function')

    beiEntladen()

    expect(track.stop).toHaveBeenCalledTimes(1)
  })
})

describe('recorder.ts — verwaiste Aufnahme bei überholtem starteAufnahme() (adversariale Review, Befund 1)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it(
    'ein hängender Lauf A (verworfen) überschreibt NICHT den frisch gestarteten Lauf B — kein Zombie-Recorder, ' +
      'A gibt seinen Stream frei, sendet weder Bestätigung noch überschreibt er B\'s Zustand',
    async () => {
      const trackA = new FakeAudioTrack()
      const streamA = fakeStream([trackA])
      const trackB = new FakeAudioTrack()
      const streamB = fakeStream([trackB])

      // getUserMedia: der ERSTE Aufruf (Lauf A) hängt, bis der Test ihn per `loeseA` explizit auflöst —
      // simuliert ein langsames Gerät (Bluetooth-Mikro/Defender-Erstscan/Gerätewechsel). Der ZWEITE Aufruf
      // (Lauf B) löst SOFORT auf, wie ein normaler, gesunder Start.
      let loeseA: ((stream: unknown) => void) | undefined
      let aufrufNummer = 0
      const { bruecke, getUserMedia } = await ladeModul(undefined, () => {
        aufrufNummer += 1
        if (aufrufNummer === 1) return new Promise((resolve) => { loeseA = resolve })
        return Promise.resolve(streamB)
      })

      const onStartCb = bruecke.onStart.mock.calls[0]?.[0] as (deviceId?: string) => void
      const onDiscardCb = bruecke.onDiscard.mock.calls[0]?.[0] as () => void

      // Lauf A startet — hängt in getUserMedia, VOR jeder Modul-Variablen-Zuweisung.
      onStartCb('mic-a')
      await vi.waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(1))
      expect(FakeMediaRecorder.instances).toHaveLength(0) // A ist noch nicht so weit gekommen

      // Der Nutzer bricht A ab, WÄHREND getUserMedia noch hängt (mediaRecorder ist zu diesem Zeitpunkt
      // noch `null` — genau der heute wirkungslose Fall, den Regel 2 des Auftrags benennt).
      onDiscardCb()

      // Lauf B startet — löst SOFORT auf (zweiter getUserMedia-Aufruf).
      onStartCb('mic-a')
      await vi.waitFor(() => {
        expect(FakeMediaRecorder.instances).toHaveLength(1)
        expect(FakeMediaRecorder.instances[0]?.state).toBe('recording')
      })
      const bRecorder = FakeMediaRecorder.instances[0]!
      expect(bruecke.sendGestartet).toHaveBeenCalledTimes(1) // NUR B's Bestätigung bisher

      // JETZT löst A's uralter getUserMedia-Aufruf endlich auf — der Datenverlust-Moment.
      loeseA?.(streamA)
      await vi.waitFor(() => {
        // A's Stream muss sauber freigegeben worden sein (Track gestoppt) — er darf NICHT als „warm" für
        // B durchgehen und auch nicht einfach verwaist offen bleiben (Mikrofon-Handle-Leck).
        expect(trackA.stop).toHaveBeenCalledTimes(1)
      })

      // A darf WEDER eine zweite Bestätigung gesendet noch eine zweite MediaRecorder-Instanz erzeugt
      // haben (das wäre exakt der Zombie, der B's echte Instanz verwaisen ließe).
      expect(bruecke.sendGestartet).toHaveBeenCalledTimes(1)
      expect(bruecke.sendError).not.toHaveBeenCalled()
      expect(FakeMediaRecorder.instances).toHaveLength(1)

      // Stoppen muss B's ECHTE Instanz auswerten — nicht A's (nicht existenten) Spätzünder.
      bRecorder.ondataavailable?.({ data: new Blob(['b-audio']) })
      const onStopCb = bruecke.onStop.mock.calls[bruecke.onStop.mock.calls.length - 1]?.[0] as () => void
      onStopCb()
      bRecorder.onstop?.()
      await vi.waitFor(() => {
        expect(bruecke.sendResult).toHaveBeenCalled()
      })
    }
  )

  it('ein hängender Lauf A, der per Stopp (nicht Discard) abgelöst wird, verhält sich identisch', async () => {
    // Regel 2 des Auftrags EXPLIZIT: auch stoppeAufnahme() (nicht nur verwerfeAufnahme()) muss einen
    // hängenden starteAufnahme()-Aufruf entwerten, obwohl `mediaRecorder` zu dem Zeitpunkt noch `null` ist
    // (stoppeAufnahme() nähme heute den „keine aktive Aufnahme"-Zweig und täte sonst nichts Entwertendes).
    const trackA = new FakeAudioTrack()
    const streamA = fakeStream([trackA])
    const trackB = new FakeAudioTrack()
    const streamB = fakeStream([trackB])

    let loeseA: ((stream: unknown) => void) | undefined
    let aufrufNummer = 0
    const { bruecke } = await ladeModul(undefined, () => {
      aufrufNummer += 1
      if (aufrufNummer === 1) return new Promise((resolve) => { loeseA = resolve })
      return Promise.resolve(streamB)
    })

    const onStartCb = bruecke.onStart.mock.calls[0]?.[0] as (deviceId?: string) => void
    const onStopCb = bruecke.onStop.mock.calls[0]?.[0] as () => void

    onStartCb('mic-a') // Lauf A: hängt
    await vi.waitFor(() => expect(FakeMediaRecorder.instances).toHaveLength(0))

    onStopCb() // „keine aktive Aufnahme" heute — MUSS trotzdem A entwerten (Regel 2)

    onStartCb('mic-a') // Lauf B: löst sofort auf
    await vi.waitFor(() => {
      expect(FakeMediaRecorder.instances).toHaveLength(1)
      expect(FakeMediaRecorder.instances[0]?.state).toBe('recording')
    })

    loeseA?.(streamA) // A's Spätzünder
    await vi.waitFor(() => {
      expect(trackA.stop).toHaveBeenCalledTimes(1) // A's Stream freigegeben, NICHT übernommen
    })

    expect(FakeMediaRecorder.instances).toHaveLength(1) // kein Zombie
    expect(bruecke.sendGestartet).toHaveBeenCalledTimes(1) // nur B's Bestätigung
  })
})

// Befund A (Feld-Log 2026-07-31): die ALLERERSTE Aufnahme nach jedem Kaltstart schlug fehl, weil erst
// die ZWEITE von der Vorwärmung (Befund 11) profitierte — der Stream wurde vorher schlicht noch nie
// geöffnet. index.ts löst jetzt kurz nach dem App-Start ein `recorder:warmup` aus (fire-and-forget,
// bevor überhaupt ein Diktat angefordert wurde); dieser Block prüft NUR den Renderer-Teil: öffnet den
// Stream, OHNE eine Aufnahme zu beginnen, scheitert folgenlos und stört ein bereits laufendes Diktat nie.
describe('recorder.ts — App-Start-Vorwärmung (Befund A)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('registriert onWarmup beim Modul-Import', async () => {
    const { bruecke } = await ladeModul()
    expect(bruecke.onWarmup).toHaveBeenCalledTimes(1)
  })

  it('öffnet den Mikrofon-Stream vor, OHNE eine Aufnahme zu starten (kein MediaRecorder, keine Bestätigung)', async () => {
    const { bruecke, getUserMedia } = await ladeModul()

    warme(bruecke, 'mic-a')
    await vi.waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(1))

    expect(FakeMediaRecorder.instances).toHaveLength(0)
    expect(bruecke.sendGestartet).not.toHaveBeenCalled()
    expect(bruecke.sendResult).not.toHaveBeenCalled()
    expect(bruecke.sendError).not.toHaveBeenCalled()
  })

  it('berücksichtigt die vom Nutzer gewählte mikrofonDeviceId (keine IPC-Nachfrage nötig)', async () => {
    const { bruecke, getUserMedia, settingsGet } = await ladeModul()

    warme(bruecke, 'mic-xyz')
    await vi.waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(1))

    expect(getUserMedia).toHaveBeenCalledWith({ audio: { deviceId: { exact: 'mic-xyz' } } })
    expect(settingsGet).not.toHaveBeenCalled()
  })

  it('eine zweite Vorwärmung mit GLEICHER deviceId ruft getUserMedia NICHT erneut auf (bereits warm)', async () => {
    const { bruecke, getUserMedia } = await ladeModul()

    warme(bruecke, 'mic-a')
    await vi.waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(1))

    warme(bruecke, 'mic-a')
    await new Promise((r) => setTimeout(r, 0)) // Mikro-Tasks der zweiten Vorwärmung durchlaufen lassen

    expect(getUserMedia).toHaveBeenCalledTimes(1)
  })

  it('fehlende Berechtigung/fehlendes Gerät bleibt FOLGENLOS: kein sendError, kein Wurf', async () => {
    const { bruecke, getUserMedia } = await ladeModul(undefined, () =>
      Promise.reject(new Error('Permission denied'))
    )

    expect(() => warme(bruecke, 'mic-a')).not.toThrow()
    await vi.waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(1))
    await new Promise((r) => setTimeout(r, 0)) // die Ablehnung selbst asynchron durchlaufen lassen

    expect(bruecke.sendError).not.toHaveBeenCalled()
    expect(bruecke.sendGestartet).not.toHaveBeenCalled()
  })

  it('ein bereits aktives Diktat bleibt unberührt: die Vorwärmung fasst dessen Stream/Track nicht an', async () => {
    const track = new FakeAudioTrack()
    const { bruecke, getUserMedia } = await ladeModul(fakeStream([track]))
    const recorder = await starte(bruecke, 'mic-a')

    warme(bruecke, 'mic-a')
    await new Promise((r) => setTimeout(r, 0))

    expect(getUserMedia).toHaveBeenCalledTimes(1) // kein zweiter Aufruf durch die Vorwärmung
    expect(track.stop).not.toHaveBeenCalled() // der laufende Track wird NICHT angefasst
    expect(recorder.state).toBe('recording') // die echte Aufnahme läuft unverändert weiter
  })

  it(
    'beginnt WÄHREND einer hängenden Vorwärmung eine echte Aufnahme, gewinnt die Aufnahme — die ' +
      'Vorwärmung erkennt sich als überholt und gibt ihren später eintreffenden Stream sauber frei',
    async () => {
      const warmupTrack = new FakeAudioTrack()
      const warmupStream = fakeStream([warmupTrack])
      const echtTrack = new FakeAudioTrack()
      const echtStream = fakeStream([echtTrack])

      let loeseWarmup: ((stream: unknown) => void) | undefined
      let aufrufNummer = 0
      const { bruecke } = await ladeModul(undefined, () => {
        aufrufNummer += 1
        if (aufrufNummer === 1) {
          return new Promise((resolve) => {
            loeseWarmup = resolve
          })
        }
        return Promise.resolve(echtStream)
      })

      warme(bruecke, 'mic-a') // hängt in getUserMedia (Kaltstart-Latenz)
      const onStartCb = bruecke.onStart.mock.calls[0]?.[0] as (deviceId?: string) => void
      onStartCb('mic-a') // die ECHTE Aufnahme beginnt sofort danach — löst SOFORT auf

      await vi.waitFor(() => {
        expect(FakeMediaRecorder.instances).toHaveLength(1)
        expect(FakeMediaRecorder.instances[0]?.state).toBe('recording')
      })
      expect(bruecke.sendGestartet).toHaveBeenCalledTimes(1)

      loeseWarmup?.(warmupStream) // JETZT löst die (überholte) Vorwärmung endlich auf
      await vi.waitFor(() => {
        expect(warmupTrack.stop).toHaveBeenCalledTimes(1) // eigenen Stream sauber freigegeben
      })

      expect(FakeMediaRecorder.instances).toHaveLength(1) // kein Zombie
      expect(bruecke.sendGestartet).toHaveBeenCalledTimes(1) // weiterhin nur die echte Bestätigung
      expect(echtTrack.stop).not.toHaveBeenCalled() // die echte Aufnahme bleibt unberührt
    }
  )
})
