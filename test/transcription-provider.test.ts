import { describe, it, expect, vi } from 'vitest'
import {
  createCloudTranscriptionProvider,
  MAX_UPLOAD_BYTES,
  DEFAULT_FETCH_TIMEOUT_MS
} from '@main/transcription/cloud-provider'
import { klassifiziere } from '@main/workflow/fehler-klassifikation'

function audioBlob(): Blob {
  return new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/webm' })
}

/** Blob, dessen `.size` beliebig gefälscht ist — ohne wirklich N Bytes zu allozieren. */
function fakeSizedBlob(size: number): Blob {
  const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/webm' })
  Object.defineProperty(blob, 'size', { value: size })
  return blob
}

describe('createCloudTranscriptionProvider', () => {
  it('gibt bei HTTP 200 den getrimmten Transkript-Text zurück', async () => {
    const fetchFn = (async () =>
      new Response('  Hallo Welt  ', { status: 200 })) as unknown as typeof fetch

    const provider = createCloudTranscriptionProvider({
      getApiKey: async () => 'sk-key',
      fetchFn
    })

    expect(await provider.transcribe(audioBlob())).toBe('Hallo Welt')
  })

  it('schickt POST an die Transcriptions-URL mit Bearer-Auth', async () => {
    let url: string | undefined
    let init: RequestInit | undefined
    const fetchFn = (async (u: string, i: RequestInit) => {
      url = u
      init = i
      return new Response('ok', { status: 200 })
    }) as unknown as typeof fetch

    const provider = createCloudTranscriptionProvider({ getApiKey: async () => 'sk-123', fetchFn })
    await provider.transcribe(audioBlob())

    expect(url).toBe('https://api.openai.com/v1/audio/transcriptions')
    expect(init?.method).toBe('POST')
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer sk-123')
  })

  it('setzt model + response_format und – nur wenn gesetzt – language und prompt', async () => {
    let body: FormData | undefined
    const fetchFn = (async (_u: string, i: RequestInit) => {
      body = i.body as FormData
      return new Response('ok', { status: 200 })
    }) as unknown as typeof fetch
    const provider = createCloudTranscriptionProvider({ getApiKey: async () => 'sk', fetchFn })

    await provider.transcribe(audioBlob(), {
      language: 'de',
      vocabularyHints: ['Widget', 'Blitztext']
    })

    expect(body?.get('model')).toBe('whisper-1')
    expect(body?.get('response_format')).toBe('text')
    expect(body?.get('language')).toBe('de')
    expect(body?.get('prompt')).toBe('Eigennamen und Begriffe: Widget, Blitztext')
  })

  // --- A4: Upload-Dateiname folgt dem echten Blob-MIME-Typ statt hart 'audio.webm' ---

  it('A4: Blob mit type audio/ogg → das file-Feld trägt den Namen audio.ogg', async () => {
    let body: FormData | undefined
    const fetchFn = (async (_u: string, i: RequestInit) => {
      body = i.body as FormData
      return new Response('ok', { status: 200 })
    }) as unknown as typeof fetch
    const provider = createCloudTranscriptionProvider({ getApiKey: async () => 'sk', fetchFn })

    const oggBlob = new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/ogg' })
    await provider.transcribe(oggBlob)

    const file = body?.get('file') as File
    expect(file.name).toBe('audio.ogg')
  })

  it('lässt language und prompt weg, wenn nicht gesetzt', async () => {
    let body: FormData | undefined
    const fetchFn = (async (_u: string, i: RequestInit) => {
      body = i.body as FormData
      return new Response('ok', { status: 200 })
    }) as unknown as typeof fetch
    const provider = createCloudTranscriptionProvider({ getApiKey: async () => 'sk', fetchFn })

    await provider.transcribe(audioBlob())

    expect(body?.get('language')).toBeNull()
    expect(body?.get('prompt')).toBeNull()
  })

  it('Terms-Kern: Leerstrings/Duplikate in vocabularyHints erzeugen keinen ", ,"-String im prompt', async () => {
    let body: FormData | undefined
    const fetchFn = (async (_u: string, i: RequestInit) => {
      body = i.body as FormData
      return new Response('ok', { status: 200 })
    }) as unknown as typeof fetch
    const provider = createCloudTranscriptionProvider({ getApiKey: async () => 'sk', fetchFn })

    await provider.transcribe(audioBlob(), {
      vocabularyHints: ['Acme', '', '  ', 'GmbH', 'acme']
    })

    expect(body?.get('prompt')).toBe('Eigennamen und Begriffe: Acme, GmbH')
  })

  it('lässt den prompt weg, wenn vocabularyHints nur aus Leerstrings besteht', async () => {
    let body: FormData | undefined
    const fetchFn = (async (_u: string, i: RequestInit) => {
      body = i.body as FormData
      return new Response('ok', { status: 200 })
    }) as unknown as typeof fetch
    const provider = createCloudTranscriptionProvider({ getApiKey: async () => 'sk', fetchFn })

    await provider.transcribe(audioBlob(), { vocabularyHints: ['', '   '] })

    expect(body?.get('prompt')).toBeNull()
  })

  it('wirft ohne API-Key und ruft fetch gar nicht erst auf', async () => {
    let called = false
    const fetchFn = (async () => {
      called = true
      return new Response('', { status: 200 })
    }) as unknown as typeof fetch
    const provider = createCloudTranscriptionProvider({ getApiKey: async () => null, fetchFn })

    await expect(provider.transcribe(audioBlob())).rejects.toThrow(/API-Key/)
    expect(called).toBe(false)
  })

  it('wirft bei Nicht-200 mit der OpenAI-Fehlermeldung', async () => {
    const fetchFn = (async () =>
      new Response(JSON.stringify({ error: { message: 'Ungültiger Key' } }), {
        status: 401
      })) as unknown as typeof fetch
    const provider = createCloudTranscriptionProvider({ getApiKey: async () => 'sk', fetchFn })

    await expect(provider.transcribe(audioBlob())).rejects.toThrow(/Ungültiger Key/)
  })

  it('wirft bei Netzwerkfehler (fetch wirft) eine klare deutsche Meldung', async () => {
    const fetchFn = (async () => {
      throw new TypeError('fetch failed')
    }) as unknown as typeof fetch
    const provider = createCloudTranscriptionProvider({ getApiKey: async () => 'sk', fetchFn })

    await expect(provider.transcribe(audioBlob())).rejects.toThrow(/Netzwerkfehler/)
  })

  // --- V2 Strang B: Provider-Config (baseUrl + Modell) ---

  it('nutzt baseUrl + Modell aus getConfig und komponiert die URL korrekt', async () => {
    let url: string | undefined
    let body: FormData | undefined
    const fetchFn = (async (u: string, i: RequestInit) => {
      url = u
      body = i.body as FormData
      return new Response('text', { status: 200 })
    }) as unknown as typeof fetch

    const provider = createCloudTranscriptionProvider({
      getApiKey: async () => 'gsk',
      getConfig: () => ({ baseUrl: 'https://api.groq.com/openai/v1', model: 'whisper-large-v3' }),
      fetchFn
    })
    await provider.transcribe(audioBlob())

    expect(url).toBe('https://api.groq.com/openai/v1/audio/transcriptions')
    expect(body?.get('model')).toBe('whisper-large-v3')
    expect(body?.get('response_format')).toBe('text') // Whisper-Familie
  })

  it('fordert bei nicht-Whisper-Modellen JSON an und parst das text-Feld', async () => {
    let body: FormData | undefined
    const fetchFn = (async (_u: string, i: RequestInit) => {
      body = i.body as FormData
      return new Response(JSON.stringify({ text: '  aus JSON  ' }), { status: 200 })
    }) as unknown as typeof fetch

    const provider = createCloudTranscriptionProvider({
      getApiKey: async () => 'sk',
      getConfig: () => ({ baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-transcribe' }),
      fetchFn
    })

    expect(await provider.transcribe(audioBlob())).toBe('aus JSON')
    expect(body?.get('response_format')).toBe('json')
  })

  // --- v0.2.x #01: Abbruch-Signal ---

  it('reicht das AbortSignal an fetch weiter (kombiniert mit dem eigenen Timeout-Signal)', async () => {
    // W1-F: intern wird das übergebene Signal mit einem eigenen Timeout-Signal kombiniert
    // (AbortSignal.any) — deshalb keine Objekt-Identität mehr, aber ein Abbruch des übergebenen
    // Controllers muss weiterhin das an fetch gereichte Signal abbrechen.
    let init: RequestInit | undefined
    const fetchFn = (async (_u: string, i: RequestInit) => {
      init = i
      return new Response('ok', { status: 200 })
    }) as unknown as typeof fetch
    const provider = createCloudTranscriptionProvider({ getApiKey: async () => 'sk', fetchFn })
    const controller = new AbortController()

    await provider.transcribe(audioBlob(), { signal: controller.signal })

    expect(init?.signal?.aborted).toBe(false)
    controller.abort(new DOMException('Abbruch durch Nutzer.', 'AbortError'))
    expect(init?.signal?.aborted).toBe(true)
  })

  it('reicht AbortError unverändert weiter (nicht als Netzwerkfehler)', async () => {
    const fetchFn = (async () => {
      throw new DOMException('Aborted', 'AbortError')
    }) as unknown as typeof fetch
    const provider = createCloudTranscriptionProvider({ getApiKey: async () => 'sk', fetchFn })

    await expect(provider.transcribe(audioBlob())).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('reicht TimeoutError unverändert weiter', async () => {
    const fetchFn = (async () => {
      throw new DOMException('Timed out', 'TimeoutError')
    }) as unknown as typeof fetch
    const provider = createCloudTranscriptionProvider({ getApiKey: async () => 'sk', fetchFn })

    await expect(provider.transcribe(audioBlob())).rejects.toMatchObject({ name: 'TimeoutError' })
  })

  // --- A1.0: Fehler additiv anreichern (für die Fehler-Art-Klassifikation) ---

  it('reichert Nicht-200-Fehler mit .status und providerCode an', async () => {
    const fetchFn = (async () =>
      new Response(JSON.stringify({ error: { message: 'Quota', code: 'insufficient_quota' } }), {
        status: 429
      })) as unknown as typeof fetch
    const provider = createCloudTranscriptionProvider({ getApiKey: async () => 'sk', fetchFn })

    await expect(provider.transcribe(audioBlob())).rejects.toMatchObject({
      status: 429,
      providerCode: 'insufficient_quota'
    })
  })

  it('markiert Transport-Fehler mit .transport=true', async () => {
    const fetchFn = (async () => {
      throw new TypeError('fetch failed')
    }) as unknown as typeof fetch
    const provider = createCloudTranscriptionProvider({ getApiKey: async () => 'sk', fetchFn })

    await expect(provider.transcribe(audioBlob())).rejects.toMatchObject({ transport: true })
  })

  it('liest nicht-String-detail typsicher (kein [object Object])', async () => {
    const fetchFn = (async () =>
      new Response(JSON.stringify({ detail: [{ msg: 'bad input' }] }), {
        status: 422
      })) as unknown as typeof fetch
    const provider = createCloudTranscriptionProvider({ getApiKey: async () => 'sk', fetchFn })

    await expect(provider.transcribe(audioBlob())).rejects.toThrow(/bad input/)
  })

  // --- L1/L2: key-loser lokaler Anbieter (z. B. whisper.cpp/Speaches auf localhost) ---

  it('key-los: wirft nicht und sendet keinen Authorization-Header', async () => {
    let init: RequestInit | undefined
    const fetchFn = (async (_u: string, i: RequestInit) => {
      init = i
      return new Response('lokal ok', { status: 200 })
    }) as unknown as typeof fetch
    const provider = createCloudTranscriptionProvider({
      getApiKey: async () => null,
      erlaubeOhneKey: () => true,
      getConfig: () => ({ baseUrl: 'http://localhost:8000/v1', model: 'whisper-1' }),
      fetchFn
    })

    expect(await provider.transcribe(audioBlob())).toBe('lokal ok')
    expect((init?.headers as Record<string, string>)?.Authorization).toBeUndefined()
  })

  // --- W1-F: Größen-Guard (Upload-Limit ~25 MB der OpenAI-kompatiblen Endpunkte) ---

  describe('Größen-Guard', () => {
    it('wirft SOFORT bei Überschreitung von MAX_UPLOAD_BYTES, ohne fetch aufzurufen', async () => {
      let called = false
      const fetchFn = (async () => {
        called = true
        return new Response('ok', { status: 200 })
      }) as unknown as typeof fetch
      const provider = createCloudTranscriptionProvider({ getApiKey: async () => 'sk', fetchFn })

      await expect(
        provider.transcribe(fakeSizedBlob(MAX_UPLOAD_BYTES + 1))
      ).rejects.toThrow(/zu lang/)
      expect(called).toBe(false)
    })

    it('lässt eine Blob-Größe GENAU an der Grenze durch (kein Guard-Fehler)', async () => {
      const fetchFn = (async () =>
        new Response('ok', { status: 200 })) as unknown as typeof fetch
      const provider = createCloudTranscriptionProvider({ getApiKey: async () => 'sk', fetchFn })

      await expect(provider.transcribe(fakeSizedBlob(MAX_UPLOAD_BYTES))).resolves.toBe('ok')
    })

    it('klassifiziert die Größen-Guard-Meldung NICHT als netzwerk (kein sinnloser Retry)', async () => {
      const fetchFn = (async () =>
        new Response('ok', { status: 200 })) as unknown as typeof fetch
      const provider = createCloudTranscriptionProvider({ getApiKey: async () => 'sk', fetchFn })

      try {
        await provider.transcribe(fakeSizedBlob(MAX_UPLOAD_BYTES + 1))
        expect.unreachable('sollte werfen')
      } catch (err) {
        expect(klassifiziere(err, { istWatchdogTimeout: false })).not.toBe('netzwerk')
      }
    })

    it('respektiert eine injizierte maxUploadBytes-Grenze (Test-Override)', async () => {
      let called = false
      const fetchFn = (async () => {
        called = true
        return new Response('ok', { status: 200 })
      }) as unknown as typeof fetch
      const provider = createCloudTranscriptionProvider({
        getApiKey: async () => 'sk',
        maxUploadBytes: 10,
        fetchFn
      })

      await expect(provider.transcribe(fakeSizedBlob(11))).rejects.toThrow(/zu lang/)
      expect(called).toBe(false)
    })
  })

  // --- W1-F: Fetch-Timeout (eigener AbortController, unter dem 90s-Runner-Watchdog) ---

  describe('Fetch-Timeout', () => {
    it('DEFAULT_FETCH_TIMEOUT_MS liegt unter dem 90s-Runner-Watchdog', () => {
      expect(DEFAULT_FETCH_TIMEOUT_MS).toBeLessThan(90_000)
    })

    it('bricht die fetch mit dem eigenen Timeout ab, wenn sie hängt (fake timers)', async () => {
      vi.useFakeTimers()
      try {
        let signalSeenAsAborted: boolean | undefined
        const fetchFn = ((_u: string, i: RequestInit) => {
          return new Promise<Response>((_resolve, reject) => {
            const sig = i.signal as AbortSignal
            sig.addEventListener('abort', () => {
              signalSeenAsAborted = sig.aborted
              reject(sig.reason)
            })
          })
        }) as unknown as typeof fetch

        const provider = createCloudTranscriptionProvider({
          getApiKey: async () => 'sk',
          fetchTimeoutMs: 5_000,
          fetchFn
        })

        const p = provider.transcribe(audioBlob())
        // Erwartete Ablehnung erst NACH dem Timer beobachten (sonst unhandled rejection vor advance).
        const assertion = expect(p).rejects.toMatchObject({ transport: true })
        await vi.advanceTimersByTimeAsync(5_000)
        await assertion
        expect(signalSeenAsAborted).toBe(true)
      } finally {
        vi.useRealTimers()
      }
    })

    it('der eigene Timeout wird als netzwerk-artig klassifiziert (Retry greift)', async () => {
      vi.useFakeTimers()
      try {
        const fetchFn = ((_u: string, i: RequestInit) => {
          return new Promise<Response>((_resolve, reject) => {
            const sig = i.signal as AbortSignal
            sig.addEventListener('abort', () => reject(sig.reason))
          })
        }) as unknown as typeof fetch

        const provider = createCloudTranscriptionProvider({
          getApiKey: async () => 'sk',
          fetchTimeoutMs: 1_000,
          fetchFn
        })

        const p = provider.transcribe(audioBlob())
        const assertion = (async () => {
          try {
            await p
            expect.unreachable('sollte werfen')
          } catch (err) {
            expect(klassifiziere(err, { istWatchdogTimeout: false })).toBe('netzwerk')
          }
        })()
        await vi.advanceTimersByTimeAsync(1_000)
        await assertion
      } finally {
        vi.useRealTimers()
      }
    })

    it('räumt den Timeout-Timer bei Erfolg auf (kein hängender Timer)', async () => {
      vi.useFakeTimers()
      try {
        const fetchFn = (async () =>
          new Response('Hallo', { status: 200 })) as unknown as typeof fetch
        const provider = createCloudTranscriptionProvider({
          getApiKey: async () => 'sk',
          fetchTimeoutMs: 5_000,
          fetchFn
        })

        expect(await provider.transcribe(audioBlob())).toBe('Hallo')
        // Nach Erfolg dürfen keine offenen Timer mehr aus dem Provider stammen.
        expect(vi.getTimerCount()).toBe(0)
      } finally {
        vi.useRealTimers()
      }
    })

    it('ein durchgereichter Nutzer-Abbruch bleibt AbortError (nicht vom eigenen Timeout überschrieben)', async () => {
      const fetchFn = (async (_u: string, i: RequestInit) => {
        const sig = i.signal as AbortSignal
        // Wie echtes fetch: sofort ablehnen, falls das Signal beim Aufruf bereits abgebrochen ist —
        // sonst erst bei einem SPÄTEREN abort-Event.
        return new Promise<Response>((_resolve, reject) => {
          if (sig.aborted) return reject(sig.reason)
          sig.addEventListener('abort', () => reject(sig.reason))
        })
      }) as unknown as typeof fetch
      const provider = createCloudTranscriptionProvider({
        getApiKey: async () => 'sk',
        fetchTimeoutMs: 60_000,
        fetchFn
      })
      const controller = new AbortController()

      const p = provider.transcribe(audioBlob(), { signal: controller.signal })
      controller.abort(new DOMException('Abbruch durch Nutzer.', 'AbortError'))

      await expect(p).rejects.toMatchObject({ name: 'AbortError' })
    })

    it('ein durchgereichter Watchdog-TimeoutError des Aufrufers bleibt unverändert (nicht netzwerk)', async () => {
      const fetchFn = (async (_u: string, i: RequestInit) => {
        const sig = i.signal as AbortSignal
        // Wie echtes fetch: sofort ablehnen, falls das Signal beim Aufruf bereits abgebrochen ist —
        // sonst erst bei einem SPÄTEREN abort-Event.
        return new Promise<Response>((_resolve, reject) => {
          if (sig.aborted) return reject(sig.reason)
          sig.addEventListener('abort', () => reject(sig.reason))
        })
      }) as unknown as typeof fetch
      const provider = createCloudTranscriptionProvider({
        getApiKey: async () => 'sk',
        fetchTimeoutMs: 60_000,
        fetchFn
      })
      const controller = new AbortController()

      const p = provider.transcribe(audioBlob(), { signal: controller.signal })
      controller.abort(new DOMException('Zeitüberschreitung beim Anbieter.', 'TimeoutError'))

      await expect(p).rejects.toMatchObject({ name: 'TimeoutError' })
    })

    it('Erfolgsfall bleibt bei injiziertem fetchTimeoutMs unverändert', async () => {
      const fetchFn = (async () =>
        new Response('  Hallo Welt  ', { status: 200 })) as unknown as typeof fetch
      const provider = createCloudTranscriptionProvider({
        getApiKey: async () => 'sk',
        fetchTimeoutMs: 30_000,
        fetchFn
      })

      expect(await provider.transcribe(audioBlob())).toBe('Hallo Welt')
    })

    // --- v0.8.0 (netzwerkProfil): getFetchTimeoutMs (Live-Getter) nimmt Vorrang vor der statischen
    // fetchTimeoutMs — composition-root reicht ihn als Closure über die lebende Settings-Kopie durch. ---

    it('getFetchTimeoutMs nimmt Vorrang vor der statischen fetchTimeoutMs (fake timers)', async () => {
      vi.useFakeTimers()
      try {
        const fetchFn = ((_u: string, i: RequestInit) => {
          return new Promise<Response>((_resolve, reject) => {
            const sig = i.signal as AbortSignal
            sig.addEventListener('abort', () => reject(sig.reason))
          })
        }) as unknown as typeof fetch

        const provider = createCloudTranscriptionProvider({
          getApiKey: async () => 'sk',
          fetchTimeoutMs: 60_000, // würde OHNE den Getter gelten
          getFetchTimeoutMs: () => 2_000,
          fetchFn
        })

        const p = provider.transcribe(audioBlob())
        const assertion = expect(p).rejects.toMatchObject({ transport: true })
        // Bei 2_000ms (Getter) bricht der Timeout bereits ab — bei 60_000 (statisch) wäre er hier noch nicht gefeuert.
        await vi.advanceTimersByTimeAsync(2_000)
        await assertion
      } finally {
        vi.useRealTimers()
      }
    })

    it('wird bei JEDEM Aufruf frisch gelesen (dieselbe Provider-Instanz, Live-Änderung ohne Neubau)', async () => {
      vi.useFakeTimers()
      try {
        let ms = 60_000
        const haengend = ((_u: string, i: RequestInit) => {
          return new Promise<Response>((_resolve, reject) => {
            const sig = i.signal as AbortSignal
            sig.addEventListener('abort', () => reject(sig.reason))
          })
        }) as unknown as typeof fetch
        const provider = createCloudTranscriptionProvider({
          getApiKey: async () => 'sk',
          getFetchTimeoutMs: () => ms,
          fetchFn: haengend
        })

        const p1 = provider.transcribe(audioBlob())
        const assertion1 = expect(p1).rejects.toMatchObject({ transport: true })
        await vi.advanceTimersByTimeAsync(60_000)
        await assertion1

        ms = 5_000 // Live-Änderung, wie composition-root sie über dieselbe Closure durchreicht
        const p2 = provider.transcribe(audioBlob())
        const assertion2 = expect(p2).rejects.toMatchObject({ transport: true })
        await vi.advanceTimersByTimeAsync(5_000) // wäre mit dem ALTEN Wert (60_000) noch nicht gefeuert
        await assertion2
      } finally {
        vi.useRealTimers()
      }
    })
  })

  // --- B1: Mistral/Voxtral kennt kein `prompt`-Feld (Whisper-spezifisch) — die Begriffsliste
  // muss stattdessen im dokumentierten `context_bias`-Array-Feld ankommen, sonst verpufft das
  // Wörterbuch des Nutzers still (keine Fehlermeldung, unbekannte Multipart-Felder werden ignoriert).

  it('B1 RED-Beweis: Voxtral bekommt HEUTE (Bug) die Begriffe im prompt-Feld statt in context_bias', async () => {
    let body: FormData | undefined
    const fetchFn = (async (_u: string, i: RequestInit) => {
      body = i.body as FormData
      return new Response(JSON.stringify({ text: 'ok' }), { status: 200 })
    }) as unknown as typeof fetch
    const provider = createCloudTranscriptionProvider({
      getApiKey: async () => 'sk',
      getConfig: () => ({ baseUrl: 'https://api.mistral.ai/v1', model: 'voxtral-mini-latest' }),
      fetchFn
    })

    await provider.transcribe(audioBlob(), { vocabularyHints: ['Acme', 'Blitztext'] })

    // Soll-Zustand (nach dem Fix): context_bias trägt die Begriffe, prompt bleibt leer.
    expect(body?.getAll('context_bias')).toEqual(['Acme', 'Blitztext'])
    expect(body?.get('prompt')).toBeNull()
  })

  it('B1: Voxtral mit leerem Wörterbuch → weder prompt noch context_bias werden gesendet', async () => {
    let body: FormData | undefined
    const fetchFn = (async (_u: string, i: RequestInit) => {
      body = i.body as FormData
      return new Response(JSON.stringify({ text: 'ok' }), { status: 200 })
    }) as unknown as typeof fetch
    const provider = createCloudTranscriptionProvider({
      getApiKey: async () => 'sk',
      getConfig: () => ({ baseUrl: 'https://api.mistral.ai/v1', model: 'voxtral-mini-latest' }),
      fetchFn
    })

    await provider.transcribe(audioBlob())

    expect(body?.getAll('context_bias')).toEqual([])
    expect(body?.get('prompt')).toBeNull()
  })

  it('B1: Voxtral kappt context_bias auf die dokumentierte 100er-Obergrenze (neueste zuerst)', async () => {
    let body: FormData | undefined
    const fetchFn = (async (_u: string, i: RequestInit) => {
      body = i.body as FormData
      return new Response(JSON.stringify({ text: 'ok' }), { status: 200 })
    }) as unknown as typeof fetch
    const provider = createCloudTranscriptionProvider({
      getApiKey: async () => 'sk',
      getConfig: () => ({ baseUrl: 'https://api.mistral.ai/v1', model: 'voxtral-mini-latest' }),
      fetchFn
    })
    const begriffe = Array.from({ length: 130 }, (_, i) => `Begriff-${i}`)

    await provider.transcribe(audioBlob(), { vocabularyHints: begriffe })

    const gesendet = body?.getAll('context_bias')
    expect(gesendet).toHaveLength(100)
    expect(gesendet).toEqual(begriffe.slice(30)) // die 100 neuesten (Begriff-30 … Begriff-129)
  })

  it('B1 Regression: whisper-1 bleibt exakt wie heute (prompt gesetzt, KEIN context_bias)', async () => {
    let body: FormData | undefined
    const fetchFn = (async (_u: string, i: RequestInit) => {
      body = i.body as FormData
      return new Response('ok', { status: 200 })
    }) as unknown as typeof fetch
    const provider = createCloudTranscriptionProvider({
      getApiKey: async () => 'sk',
      getConfig: () => ({ baseUrl: 'https://api.openai.com/v1', model: 'whisper-1' }),
      fetchFn
    })

    await provider.transcribe(audioBlob(), { vocabularyHints: ['Acme', 'Blitztext'] })

    expect(body?.get('prompt')).toBe('Eigennamen und Begriffe: Acme, Blitztext')
    expect(body?.getAll('context_bias')).toEqual([])
    expect(body?.get('response_format')).toBe('text')
  })

  it('B1 Regression: gpt-4o-mini-transcribe bleibt exakt wie heute (prompt gesetzt, KEIN context_bias)', async () => {
    let body: FormData | undefined
    const fetchFn = (async (_u: string, i: RequestInit) => {
      body = i.body as FormData
      return new Response(JSON.stringify({ text: 'ok' }), { status: 200 })
    }) as unknown as typeof fetch
    const provider = createCloudTranscriptionProvider({
      getApiKey: async () => 'sk',
      getConfig: () => ({ baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini-transcribe' }),
      fetchFn
    })

    await provider.transcribe(audioBlob(), { vocabularyHints: ['Acme', 'Blitztext'] })

    expect(body?.get('prompt')).toBe('Eigennamen und Begriffe: Acme, Blitztext')
    expect(body?.getAll('context_bias')).toEqual([])
    expect(body?.get('response_format')).toBe('json')
  })

  // --- F2: URL-Guard im Main durchsetzen (Security-Review P1) ---

  describe('F2: URL-Guard vor dem Key-tragenden fetch', () => {
    it('https-Base-URL ⇒ Request geht raus wie gewohnt', async () => {
      let called = false
      const fetchFn = (async () => {
        called = true
        return new Response('ok', { status: 200 })
      }) as unknown as typeof fetch
      const provider = createCloudTranscriptionProvider({
        getApiKey: async () => 'sk',
        getConfig: () => ({ baseUrl: 'https://api.openai.com/v1', model: 'whisper-1' }),
        fetchFn
      })

      expect(await provider.transcribe(audioBlob())).toBe('ok')
      expect(called).toBe(true)
    })

    it('http-Base-URL zu fremdem Host ⇒ blockiert, KEIN fetch, Fehler klassifizierbar als konfiguration', async () => {
      let called = false
      const fetchFn = (async () => {
        called = true
        return new Response('ok', { status: 200 })
      }) as unknown as typeof fetch
      const provider = createCloudTranscriptionProvider({
        getApiKey: async () => 'sk',
        getConfig: () => ({ baseUrl: 'http://api.example.com/v1', model: 'whisper-1' }),
        fetchFn
      })

      let caught: unknown
      try {
        await provider.transcribe(audioBlob())
      } catch (err) {
        caught = err
      }
      expect(called).toBe(false)
      expect(caught).toBeInstanceOf(Error)
      const err = caught as Error & { status?: number; transport?: boolean }
      expect(err.status).toBe(400)
      expect(err.transport).toBeUndefined()
      expect(klassifiziere(err, { istWatchdogTimeout: false })).toBe('konfiguration')
    })

    it('http-Base-URL auf localhost ⇒ erlaubt (lokales ASR ohne TLS)', async () => {
      let called = false
      const fetchFn = (async () => {
        called = true
        return new Response('lokal ok', { status: 200 })
      }) as unknown as typeof fetch
      const provider = createCloudTranscriptionProvider({
        getApiKey: async () => 'sk',
        getConfig: () => ({ baseUrl: 'http://localhost:8000/v1', model: 'whisper-1' }),
        fetchFn
      })

      expect(await provider.transcribe(audioBlob())).toBe('lokal ok')
      expect(called).toBe(true)
    })
  })
})
