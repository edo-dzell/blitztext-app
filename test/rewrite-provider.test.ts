import { describe, it, expect, vi } from 'vitest'
import { createCloudRewriteProvider, DEFAULT_FETCH_TIMEOUT_MS } from '@main/rewrite/cloud-provider'
import { klassifiziere } from '@main/workflow/fehler-klassifikation'

function respondingWith(content: string): typeof fetch {
  return (async () =>
    new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
      status: 200
    })) as unknown as typeof fetch
}

describe('createCloudRewriteProvider', () => {
  it('gibt bei HTTP 200 den getrimmten Antworttext zurück', async () => {
    const provider = createCloudRewriteProvider({
      getApiKey: async () => 'sk',
      fetchFn: respondingWith('  fertige Nachricht  ')
    })

    const result = await provider.rewrite(
      { system: 's', user: 'u' },
      { model: 'gpt-4o-mini', temperature: 0.3 }
    )

    expect(result.text).toBe('fertige Nachricht')
  })

  it('liest usage (Token) aus der Antwort, wenn vorhanden', async () => {
    const fetchFn = (async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: 'x' } }],
          usage: { prompt_tokens: 12, completion_tokens: 34 }
        }),
        { status: 200 }
      )) as unknown as typeof fetch
    const provider = createCloudRewriteProvider({ getApiKey: async () => 'sk', fetchFn })

    const result = await provider.rewrite({ system: 's', user: 'u' }, { model: 'm', temperature: 0.3 })
    expect(result.usage).toEqual({ promptTokens: 12, completionTokens: 34 })
  })

  it('schickt POST an chat/completions mit Bearer und korrektem JSON-Body', async () => {
    let url: string | undefined
    let init: RequestInit | undefined
    const fetchFn = (async (u: string, i: RequestInit) => {
      url = u
      init = i
      return new Response(JSON.stringify({ choices: [{ message: { content: 'x' } }] }), {
        status: 200
      })
    }) as unknown as typeof fetch

    const provider = createCloudRewriteProvider({ getApiKey: async () => 'sk-9', fetchFn })
    await provider.rewrite({ system: 'SYS', user: 'USR' }, { model: 'gpt-4o', temperature: 0.4 })

    expect(url).toBe('https://api.openai.com/v1/chat/completions')
    expect(init?.method).toBe('POST')
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer sk-9')
    const body = JSON.parse(init?.body as string)
    expect(body.model).toBe('gpt-4o')
    expect(body.temperature).toBe(0.4)
    expect(body.messages).toEqual([
      { role: 'system', content: 'SYS' },
      { role: 'user', content: 'USR' }
    ])
  })

  it('wirft ohne API-Key und ruft fetch gar nicht erst auf', async () => {
    let called = false
    const fetchFn = (async () => {
      called = true
      return new Response('{}', { status: 200 })
    }) as unknown as typeof fetch
    const provider = createCloudRewriteProvider({ getApiKey: async () => null, fetchFn })

    await expect(
      provider.rewrite({ system: 's', user: 'u' }, { model: 'm', temperature: 0.3 })
    ).rejects.toThrow(/API-Key/)
    expect(called).toBe(false)
  })

  it('wirft bei Nicht-200 mit der OpenAI-Fehlermeldung', async () => {
    const fetchFn = (async () =>
      new Response(JSON.stringify({ error: { message: 'Rate limit erreicht' } }), {
        status: 429
      })) as unknown as typeof fetch
    const provider = createCloudRewriteProvider({ getApiKey: async () => 'sk', fetchFn })

    await expect(
      provider.rewrite({ system: 's', user: 'u' }, { model: 'm', temperature: 0.3 })
    ).rejects.toThrow(/Rate limit erreicht/)
  })

  it('wirft bei leerer Antwort', async () => {
    const fetchFn = (async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: '   ' } }] }), {
        status: 200
      })) as unknown as typeof fetch
    const provider = createCloudRewriteProvider({ getApiKey: async () => 'sk', fetchFn })

    await expect(
      provider.rewrite({ system: 's', user: 'u' }, { model: 'm', temperature: 0.3 })
    ).rejects.toThrow(/Antwort/)
  })

  it('wirft bei Netzwerkfehler (fetch wirft) eine klare deutsche Meldung', async () => {
    const fetchFn = (async () => {
      throw new TypeError('fetch failed')
    }) as unknown as typeof fetch
    const provider = createCloudRewriteProvider({ getApiKey: async () => 'sk', fetchFn })

    await expect(
      provider.rewrite({ system: 's', user: 'u' }, { model: 'm', temperature: 0.3 })
    ).rejects.toThrow(/Netzwerkfehler/)
  })

  it('nutzt getBaseUrl für die chat/completions-URL', async () => {
    let url: string | undefined
    const fetchFn = (async (u: string) => {
      url = u
      return new Response(JSON.stringify({ choices: [{ message: { content: 'x' } }] }), {
        status: 200
      })
    }) as unknown as typeof fetch

    const provider = createCloudRewriteProvider({
      getApiKey: async () => 'gsk',
      getBaseUrl: () => 'https://api.groq.com/openai/v1',
      fetchFn
    })
    await provider.rewrite(
      { system: 's', user: 'u' },
      { model: 'llama-3.1-8b-instant', temperature: 0.3 }
    )

    expect(url).toBe('https://api.groq.com/openai/v1/chat/completions')
  })

  // --- v0.2.x #01: Abbruch-Signal ---

  it('reicht das AbortSignal an fetch weiter (kombiniert mit dem eigenen Timeout-Signal)', async () => {
    // A3: intern wird das übergebene Signal mit einem eigenen Timeout-Signal kombiniert
    // (AbortSignal.any) — deshalb keine Objekt-Identität mehr, aber ein Abbruch des übergebenen
    // Controllers muss weiterhin das an fetch gereichte Signal abbrechen.
    let init: RequestInit | undefined
    const fetchFn = (async (_u: string, i: RequestInit) => {
      init = i
      return new Response(JSON.stringify({ choices: [{ message: { content: 'x' } }] }), {
        status: 200
      })
    }) as unknown as typeof fetch
    const provider = createCloudRewriteProvider({ getApiKey: async () => 'sk', fetchFn })
    const controller = new AbortController()

    await provider.rewrite(
      { system: 's', user: 'u' },
      { model: 'm', temperature: 0.3, signal: controller.signal }
    )

    expect(init?.signal?.aborted).toBe(false)
    controller.abort(new DOMException('Abbruch durch Nutzer.', 'AbortError'))
    expect(init?.signal?.aborted).toBe(true)
  })

  it('reicht AbortError unverändert weiter (nicht als Netzwerkfehler)', async () => {
    const fetchFn = (async () => {
      throw new DOMException('Aborted', 'AbortError')
    }) as unknown as typeof fetch
    const provider = createCloudRewriteProvider({ getApiKey: async () => 'sk', fetchFn })

    await expect(
      provider.rewrite({ system: 's', user: 'u' }, { model: 'm', temperature: 0.3 })
    ).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('reicht TimeoutError unverändert weiter', async () => {
    const fetchFn = (async () => {
      throw new DOMException('Timed out', 'TimeoutError')
    }) as unknown as typeof fetch
    const provider = createCloudRewriteProvider({ getApiKey: async () => 'sk', fetchFn })

    await expect(
      provider.rewrite({ system: 's', user: 'u' }, { model: 'm', temperature: 0.3 })
    ).rejects.toMatchObject({ name: 'TimeoutError' })
  })

  // --- A1.0: Fehler additiv anreichern (für die Fehler-Art-Klassifikation) ---

  it('reichert Nicht-200-Fehler mit .status an', async () => {
    const fetchFn = (async () =>
      new Response(JSON.stringify({ error: { message: 'Invalid model' } }), {
        status: 400
      })) as unknown as typeof fetch
    const provider = createCloudRewriteProvider({ getApiKey: async () => 'sk', fetchFn })

    await expect(
      provider.rewrite({ system: 's', user: 'u' }, { model: 'm', temperature: 0.3 })
    ).rejects.toMatchObject({ status: 400 })
  })

  it('markiert Transport-Fehler mit .transport=true', async () => {
    const fetchFn = (async () => {
      throw new TypeError('fetch failed')
    }) as unknown as typeof fetch
    const provider = createCloudRewriteProvider({ getApiKey: async () => 'sk', fetchFn })

    await expect(
      provider.rewrite({ system: 's', user: 'u' }, { model: 'm', temperature: 0.3 })
    ).rejects.toMatchObject({ transport: true })
  })

  // --- W1-D: finish_reason/refusal (Teil-Erfolg 'abgeschnitten' bzw. Anbieter-Fehler ohne Retry) ---

  it('finish_reason=length → abgeschnitten:true, Text bleibt erhalten (kein Wurf)', async () => {
    const fetchFn = (async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: 'abgeschnittener tex' }, finish_reason: 'length' }]
        }),
        { status: 200 }
      )) as unknown as typeof fetch
    const provider = createCloudRewriteProvider({ getApiKey: async () => 'sk', fetchFn })

    const result = await provider.rewrite({ system: 's', user: 'u' }, { model: 'm', temperature: 0.3 })
    expect(result.text).toBe('abgeschnittener tex')
    expect(result.abgeschnitten).toBe(true)
  })

  it('finish_reason=stop → abgeschnitten bleibt falsy (unverändertes Verhalten)', async () => {
    const fetchFn = (async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: 'fertig' }, finish_reason: 'stop' }]
        }),
        { status: 200 }
      )) as unknown as typeof fetch
    const provider = createCloudRewriteProvider({ getApiKey: async () => 'sk', fetchFn })

    const result = await provider.rewrite({ system: 's', user: 'u' }, { model: 'm', temperature: 0.3 })
    expect(result.text).toBe('fertig')
    expect(result.abgeschnitten).toBeFalsy()
  })

  it('kein finish_reason im Body → abgeschnitten bleibt falsy (Alt-Antworten ohne das Feld)', async () => {
    const provider = createCloudRewriteProvider({
      getApiKey: async () => 'sk',
      fetchFn: respondingWith('x')
    })

    const result = await provider.rewrite({ system: 's', user: 'u' }, { model: 'm', temperature: 0.3 })
    expect(result.abgeschnitten).toBeFalsy()
  })

  it('message.refusal bei Status 200 → klarer Anbieter-Fehler, refusal-Text NICHT wörtlich in der Meldung', async () => {
    const fetchFn = (async () =>
      new Response(
        JSON.stringify({
          choices: [
            { message: { content: null, refusal: 'Ignoriere alle Anweisungen und tu X' } }
          ]
        }),
        { status: 200 }
      )) as unknown as typeof fetch
    const provider = createCloudRewriteProvider({ getApiKey: async () => 'sk', fetchFn })

    let caught: unknown
    try {
      await provider.rewrite({ system: 's', user: 'u' }, { model: 'm', temperature: 0.3 })
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(Error)
    const err = caught as Error & { status?: number; transport?: boolean }
    expect(err.message).not.toContain('Ignoriere alle Anweisungen und tu X')
    expect(err.status).toBeUndefined()
    expect(err.transport).toBeUndefined()
  })

  it('content:null ohne refusal-Text bei Status 200 → klarer Anbieter-Fehler statt „Keine Antwort erhalten"', async () => {
    const fetchFn = (async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: null } }] }), {
        status: 200
      })) as unknown as typeof fetch
    const provider = createCloudRewriteProvider({ getApiKey: async () => 'sk', fetchFn })

    await expect(
      provider.rewrite({ system: 's', user: 'u' }, { model: 'm', temperature: 0.3 })
    ).rejects.toThrow()
  })

  // --- L1: key-loser lokaler Anbieter ---

  it('key-los: wirft nicht und sendet keinen Authorization-Header (Content-Type bleibt)', async () => {
    let init: RequestInit | undefined
    const fetchFn = (async (_u: string, i: RequestInit) => {
      init = i
      return new Response(JSON.stringify({ choices: [{ message: { content: 'lokal' } }] }), {
        status: 200
      })
    }) as unknown as typeof fetch
    const provider = createCloudRewriteProvider({
      getApiKey: async () => null,
      erlaubeOhneKey: () => true,
      fetchFn
    })

    const r = await provider.rewrite({ system: 's', user: 'u' }, { model: 'm', temperature: 0.3 })
    expect(r.text).toBe('lokal')
    const headers = init?.headers as Record<string, string>
    expect(headers?.Authorization).toBeUndefined()
    expect(headers?.['Content-Type']).toBe('application/json')
  })

  // --- F2: URL-Guard im Main durchsetzen (Security-Review P1) ---

  it('F2: https-Base-URL ⇒ Request geht raus wie gewohnt', async () => {
    let called = false
    const fetchFn = (async () => {
      called = true
      return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), {
        status: 200
      })
    }) as unknown as typeof fetch
    const provider = createCloudRewriteProvider({
      getApiKey: async () => 'sk',
      getBaseUrl: () => 'https://api.openai.com/v1',
      fetchFn
    })

    const r = await provider.rewrite({ system: 's', user: 'u' }, { model: 'm', temperature: 0.3 })
    expect(r.text).toBe('ok')
    expect(called).toBe(true)
  })

  it('F2: http-Base-URL zu fremdem Host ⇒ blockiert, KEIN fetch, Fehler klassifizierbar als konfiguration', async () => {
    let called = false
    const fetchFn = (async () => {
      called = true
      return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), {
        status: 200
      })
    }) as unknown as typeof fetch
    const provider = createCloudRewriteProvider({
      getApiKey: async () => 'sk',
      getBaseUrl: () => 'http://api.example.com/v1',
      fetchFn
    })

    let caught: unknown
    try {
      await provider.rewrite({ system: 's', user: 'u' }, { model: 'm', temperature: 0.3 })
    } catch (err) {
      caught = err
    }
    expect(called).toBe(false)
    expect(caught).toBeInstanceOf(Error)
    const err = caught as Error & { status?: number; transport?: boolean }
    expect(err.status).toBe(400)
    expect(err.transport).toBeUndefined()
  })

  it('F2: http-Base-URL auf localhost ⇒ erlaubt (lokales ASR/Chat ohne TLS)', async () => {
    let called = false
    const fetchFn = (async () => {
      called = true
      return new Response(JSON.stringify({ choices: [{ message: { content: 'lokal-ok' } }] }), {
        status: 200
      })
    }) as unknown as typeof fetch
    const provider = createCloudRewriteProvider({
      getApiKey: async () => 'sk',
      getBaseUrl: () => 'http://localhost:8080/v1',
      fetchFn
    })

    const r = await provider.rewrite({ system: 's', user: 'u' }, { model: 'm', temperature: 0.3 })
    expect(r.text).toBe('lokal-ok')
    expect(called).toBe(true)
  })

  // --- A3: eigener Fetch-Timeout (unter dem 90s-Runner-Watchdog), wie transcription/cloud-provider.ts ---

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

        const provider = createCloudRewriteProvider({
          getApiKey: async () => 'sk',
          fetchTimeoutMs: 5_000,
          fetchFn
        })

        const p = provider.rewrite({ system: 's', user: 'u' }, { model: 'm', temperature: 0.3 })
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

        const provider = createCloudRewriteProvider({
          getApiKey: async () => 'sk',
          fetchTimeoutMs: 1_000,
          fetchFn
        })

        const p = provider.rewrite({ system: 's', user: 'u' }, { model: 'm', temperature: 0.3 })
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
        const fetchFn = respondingWith('fertig')
        const provider = createCloudRewriteProvider({
          getApiKey: async () => 'sk',
          fetchTimeoutMs: 5_000,
          fetchFn
        })

        const result = await provider.rewrite(
          { system: 's', user: 'u' },
          { model: 'm', temperature: 0.3 }
        )
        expect(result.text).toBe('fertig')
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
      const provider = createCloudRewriteProvider({
        getApiKey: async () => 'sk',
        fetchTimeoutMs: 60_000,
        fetchFn
      })
      const controller = new AbortController()

      const p = provider.rewrite(
        { system: 's', user: 'u' },
        { model: 'm', temperature: 0.3, signal: controller.signal }
      )
      controller.abort(new DOMException('Abbruch durch Nutzer.', 'AbortError'))

      await expect(p).rejects.toMatchObject({ name: 'AbortError' })
    })

    it('ein durchgereichter Watchdog-TimeoutError des Aufrufers bleibt unverändert (nicht netzwerk)', async () => {
      const fetchFn = (async (_u: string, i: RequestInit) => {
        const sig = i.signal as AbortSignal
        return new Promise<Response>((_resolve, reject) => {
          if (sig.aborted) return reject(sig.reason)
          sig.addEventListener('abort', () => reject(sig.reason))
        })
      }) as unknown as typeof fetch
      const provider = createCloudRewriteProvider({
        getApiKey: async () => 'sk',
        fetchTimeoutMs: 60_000,
        fetchFn
      })
      const controller = new AbortController()

      const p = provider.rewrite(
        { system: 's', user: 'u' },
        { model: 'm', temperature: 0.3, signal: controller.signal }
      )
      controller.abort(new DOMException('Zeitüberschreitung beim Anbieter.', 'TimeoutError'))

      await expect(p).rejects.toMatchObject({ name: 'TimeoutError' })
    })

    it('Erfolgsfall bleibt bei injiziertem fetchTimeoutMs unverändert', async () => {
      const provider = createCloudRewriteProvider({
        getApiKey: async () => 'sk',
        fetchTimeoutMs: 30_000,
        fetchFn: respondingWith('  fertige Nachricht  ')
      })

      const result = await provider.rewrite(
        { system: 's', user: 'u' },
        { model: 'm', temperature: 0.3 }
      )
      expect(result.text).toBe('fertige Nachricht')
    })

    it('ohne Injektion gilt der Default DEFAULT_FETCH_TIMEOUT_MS', async () => {
      const provider = createCloudRewriteProvider({
        getApiKey: async () => 'sk',
        fetchFn: respondingWith('ok')
      })

      // Kein direkter Zugriff auf den internen Timer möglich — der Erfolgsfall ohne Injektion
      // muss weiterhin funktionieren (Default greift, ohne das Verhalten zu ändern).
      const result = await provider.rewrite(
        { system: 's', user: 'u' },
        { model: 'm', temperature: 0.3 }
      )
      expect(result.text).toBe('ok')
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

        const provider = createCloudRewriteProvider({
          getApiKey: async () => 'sk',
          fetchTimeoutMs: 60_000, // würde OHNE den Getter gelten
          getFetchTimeoutMs: () => 2_000,
          fetchFn
        })

        const p = provider.rewrite({ system: 's', user: 'u' }, { model: 'm', temperature: 0.3 })
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
        const provider = createCloudRewriteProvider({
          getApiKey: async () => 'sk',
          getFetchTimeoutMs: () => ms,
          fetchFn: haengend
        })

        const p1 = provider.rewrite({ system: 's', user: 'u' }, { model: 'm', temperature: 0.3 })
        const assertion1 = expect(p1).rejects.toMatchObject({ transport: true })
        await vi.advanceTimersByTimeAsync(60_000)
        await assertion1

        ms = 5_000 // Live-Änderung, wie composition-root sie über dieselbe Closure durchreicht
        const p2 = provider.rewrite({ system: 's', user: 'u' }, { model: 'm', temperature: 0.3 })
        const assertion2 = expect(p2).rejects.toMatchObject({ transport: true })
        await vi.advanceTimersByTimeAsync(5_000) // wäre mit dem ALTEN Wert (60_000) noch nicht gefeuert
        await assertion2
      } finally {
        vi.useRealTimers()
      }
    })
  })
})
