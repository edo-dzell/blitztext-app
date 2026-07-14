import { describe, it, expect } from 'vitest'
import { createProtokoll } from '@main/session/protokoll-adapter'
import type { VerlaufStore, VerlaufEintrag } from '@main/history/history-store'
import type { StatsStore, StatNutzung } from '@main/stats/stats-store'
import type { Abschlussdaten } from '@main/session/sitzung'

function fakeVerlauf() {
  const eintraege: VerlaufEintrag[] = []
  const store: VerlaufStore = {
    aktiv: () => true,
    async aufzeichnen(e) {
      eintraege.push(e)
      return true // P5b: geschrieben
    },
    async liste() {
      return eintraege
    },
    async loeschen() {
      eintraege.length = 0
    },
    async loeschenEintrag(id) {
      const i = eintraege.findIndex((e) => e.id === id)
      if (i >= 0) eintraege.splice(i, 1)
    }
  }
  return { store, eintraege }
}

function fakeStats() {
  const nutzungen: StatNutzung[] = []
  const store: StatsStore = {
    async aufzeichnen(n) {
      nutzungen.push(n)
    },
    async zusammenfassung() {
      return {
        zeilen: [],
        gesamtAnzahl: 0,
        gesamtAudioSekunden: 0,
        gesamtPromptTokens: 0,
        gesamtCompletionTokens: 0
      }
    },
    async loeschen() {
      nutzungen.length = 0
    }
  }
  return { store, nutzungen }
}

const basis: Abschlussdaten = {
  workflowId: 'improve',
  workflowLabel: 'Blitztext+',
  rohtext: 'roh',
  endtext: 'end',
  dauerSekunden: 2.5,
  asrModell: 'whisper-1',
  chatModell: 'gpt-4o-mini',
  usage: { promptTokens: 10, completionTokens: 20 },
  umgeschrieben: true
}

describe('createProtokoll', () => {
  it('baut id/Zeitstempel und schreibt Verlauf (mit Text) + Stats (text-frei)', async () => {
    const v = fakeVerlauf()
    const s = fakeStats()
    const protokoll = createProtokoll({
      verlauf: v.store,
      stats: s.store,
      jetzt: () => 123456,
      neueId: () => 'id-1'
    })

    expect(await protokoll.aufzeichnen(basis)).toBe(true) // P5b: gibt Verlauf-Schreib-Erfolg zurück

    expect(v.eintraege).toEqual([
      {
        id: 'id-1',
        zeitstempelMs: 123456,
        workflowId: 'improve',
        workflowLabel: 'Blitztext+',
        rohtext: 'roh',
        endtext: 'end',
        dauerSekunden: 2.5,
        asrModell: 'whisper-1',
        chatModell: 'gpt-4o-mini',
        usage: { promptTokens: 10, completionTokens: 20 }
      }
    ])
    expect(s.nutzungen).toEqual([
      {
        workflowId: 'improve',
        audioSekunden: 2.5,
        asrModell: 'whisper-1',
        chat: { model: 'gpt-4o-mini', promptTokens: 10, completionTokens: 20 }
      }
    ])
  })

  it('reine Transkription (umgeschrieben=false): Stats ohne chat-Teil', async () => {
    const v = fakeVerlauf()
    const s = fakeStats()
    const protokoll = createProtokoll({
      verlauf: v.store,
      stats: s.store,
      jetzt: () => 1,
      neueId: () => 'x'
    })

    await protokoll.aufzeichnen({ ...basis, umgeschrieben: false, chatModell: '', usage: undefined })

    expect(s.nutzungen[0]!.chat).toBeUndefined()
  })
})
