import { describe, it, expect } from 'vitest'
import { createCloudRewriteProvider } from '@main/rewrite/cloud-provider'

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

  it('reicht das AbortSignal an fetch weiter', async () => {
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

    expect(init?.signal).toBe(controller.signal)
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
})
