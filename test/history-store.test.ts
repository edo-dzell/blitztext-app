import { describe, it, expect } from 'vitest'
import { createVerlaufStore, type VerlaufEintrag } from '@main/history/history-store'
import type { SecretCipher, CiphertextFile } from '@main/secrets/api-key-store'

// Fake-Cipher: „verschlüsselt" durch Markierung (umkehrbar), damit der Roundtrip prüfbar ist.
function fakeCipher(available = true): SecretCipher {
  return {
    isEncryptionAvailable: () => available,
    async encrypt(plain) {
      return new TextEncoder().encode('ENC:' + plain)
    },
    async decrypt(data) {
      const s = new TextDecoder().decode(data)
      if (!s.startsWith('ENC:')) throw new Error('kaputt')
      return s.slice(4)
    }
  }
}

function fakeFile(): CiphertextFile & { data: Uint8Array | null; beiseiteGelegt: number } {
  const f = {
    data: null as Uint8Array | null,
    beiseiteGelegt: 0,
    async read() {
      return f.data
    },
    async write(d: Uint8Array) {
      f.data = d
    },
    async remove() {
      f.data = null
    },
    // A1: Muster wie settings-file.test.ts — „umbenennen" simuliert durch Datei auf null setzen +
    // Zähler hochzählen, damit Tests die Reihenfolge/Häufigkeit prüfen können.
    async beiseiteLegen() {
      f.beiseiteGelegt++
      f.data = null
    }
  }
  return f
}

function eintrag(id: string): VerlaufEintrag {
  return {
    id,
    zeitstempelMs: 1000,
    workflowId: 'transcribe',
    workflowLabel: 'Blitztext',
    rohtext: 'roh ' + id,
    endtext: 'end ' + id,
    dauerSekunden: 1.2
  }
}

describe('createVerlaufStore', () => {
  it('zeichnet nichts auf, wenn inaktiv', async () => {
    const file = fakeFile()
    const store = createVerlaufStore({ cipher: fakeCipher(), file, istAktiv: () => false })
    expect(await store.aufzeichnen(eintrag('a'))).toBe(false) // P5b: nichts geschrieben → false
    expect(file.data).toBeNull()
    expect(await store.liste()).toEqual([])
  })

  it('verschlüsselter Roundtrip: aufzeichnen → liste (neueste zuerst)', async () => {
    const file = fakeFile()
    const store = createVerlaufStore({ cipher: fakeCipher(), file, istAktiv: () => true })
    expect(await store.aufzeichnen(eintrag('a'))).toBe(true) // P5b: geschrieben → true
    await store.aufzeichnen(eintrag('b'))
    expect(file.data).not.toBeNull()
    const liste = await store.liste()
    expect(liste.map((e) => e.id)).toEqual(['b', 'a'])
  })

  it('wahrt die Retentionsgrenze (neueste behalten)', async () => {
    const file = fakeFile()
    const store = createVerlaufStore({ cipher: fakeCipher(), file, istAktiv: () => true, maxEintraege: 2 })
    await store.aufzeichnen(eintrag('a'))
    await store.aufzeichnen(eintrag('b'))
    await store.aufzeichnen(eintrag('c'))
    const liste = await store.liste()
    expect(liste.map((e) => e.id)).toEqual(['c', 'b'])
  })

  it('löschen entfernt die Datei', async () => {
    const file = fakeFile()
    const store = createVerlaufStore({ cipher: fakeCipher(), file, istAktiv: () => true })
    await store.aufzeichnen(eintrag('a'))
    await store.loeschen()
    expect(file.data).toBeNull()
    expect(await store.liste()).toEqual([])
  })

  it('loeschenEintrag entfernt genau einen Eintrag, lässt die übrigen (VL-3)', async () => {
    const file = fakeFile()
    const store = createVerlaufStore({ cipher: fakeCipher(), file, istAktiv: () => true })
    await store.aufzeichnen(eintrag('a'))
    await store.aufzeichnen(eintrag('b'))
    await store.aufzeichnen(eintrag('c'))
    await store.loeschenEintrag('b')
    expect((await store.liste()).map((e) => e.id)).toEqual(['c', 'a'])
  })

  it('loeschenEintrag mit unbekannter Id ist ein No-Op', async () => {
    const file = fakeFile()
    const store = createVerlaufStore({ cipher: fakeCipher(), file, istAktiv: () => true })
    await store.aufzeichnen(eintrag('a'))
    await store.loeschenEintrag('x')
    expect((await store.liste()).map((e) => e.id)).toEqual(['a'])
  })

  it('loeschenEintrag des letzten Eintrags entfernt die Datei', async () => {
    const file = fakeFile()
    const store = createVerlaufStore({ cipher: fakeCipher(), file, istAktiv: () => true })
    await store.aufzeichnen(eintrag('a'))
    await store.loeschenEintrag('a')
    expect(file.data).toBeNull()
  })

  it('bei Entschlüsselungsfehler (anderer Benutzer/Profil) → leere Liste statt Wurf', async () => {
    const file = fakeFile()
    file.data = new TextEncoder().encode('NICHT-ENTSCHLUESSELBAR')
    const store = createVerlaufStore({ cipher: fakeCipher(), file, istAktiv: () => true })
    expect(await store.liste()).toEqual([])
  })

  it('schreibt nicht, wenn Verschlüsselung nicht verfügbar ist', async () => {
    const file = fakeFile()
    const store = createVerlaufStore({ cipher: fakeCipher(false), file, istAktiv: () => true })
    expect(await store.aufzeichnen(eintrag('a'))).toBe(false) // P5b: nicht verschlüsselbar → false
    expect(file.data).toBeNull()
  })

  // --- V5: promptKennung ist optional/migrationssicher (alte Einträge ohne das Feld) ---

  it('speichert promptKennung, wenn gesetzt, und liest sie unverändert zurück', async () => {
    const file = fakeFile()
    const store = createVerlaufStore({ cipher: fakeCipher(), file, istAktiv: () => true })
    await store.aufzeichnen({ ...eintrag('a'), promptKennung: 'builtin:improve@deadbeef' })
    const liste = await store.liste()
    expect(liste[0]!.promptKennung).toBe('builtin:improve@deadbeef')
  })

  it('lädt einen alten Eintrag ohne promptKennung klaglos (Migration), Feld ist undefined', async () => {
    const file = fakeFile()
    const alterEintrag = eintrag('alt') // kein promptKennung-Feld — simuliert Vor-V5-Datensatz
    const roh = JSON.stringify([alterEintrag])
    file.data = await fakeCipher().encrypt(roh)
    const store = createVerlaufStore({ cipher: fakeCipher(), file, istAktiv: () => true })
    const liste = await store.liste()
    expect(liste).toHaveLength(1)
    expect(liste[0]!.id).toBe('alt')
    expect(liste[0]!.promptKennung).toBeUndefined()
  })

  it('mischt alte (ohne promptKennung) und neue (mit) Einträge ohne Fehler', async () => {
    const file = fakeFile()
    const gemischt = [
      { ...eintrag('neu'), promptKennung: 'custom:12345678' },
      eintrag('alt')
    ]
    file.data = await fakeCipher().encrypt(JSON.stringify(gemischt))
    const store = createVerlaufStore({ cipher: fakeCipher(), file, istAktiv: () => true })
    const liste = await store.liste()
    expect(liste.map((e) => e.promptKennung)).toEqual(['custom:12345678', undefined])
  })

  // --- Off-by-one an der ECHTEN Default-Grenze STANDARD_MAX=200 (nicht der Test-Kleinstwert) ---
  // maxEintraege bewusst NICHT gesetzt → der reale Default greift.

  it('hält bei genau 200 Einträgen alle (kein vorzeitiges Kappen an der Grenze)', async () => {
    const file = fakeFile()
    const store = createVerlaufStore({ cipher: fakeCipher(), file, istAktiv: () => true })
    for (let i = 0; i < 200; i++) await store.aufzeichnen(eintrag(String(i)))
    const liste = await store.liste()
    expect(liste).toHaveLength(200)
    // Neueste zuerst: '199' vorne, ältester '0' ganz hinten — noch vorhanden.
    expect(liste[0]!.id).toBe('199')
    expect(liste[liste.length - 1]!.id).toBe('0')
  })

  // --- v0.8.0 (verlaufMaximum): Live-Getter, nimmt Vorrang vor der statischen maxEintraege ---

  describe('getMaxEintraege (Live-Getter)', () => {
    it('nimmt Vorrang vor der statischen maxEintraege', async () => {
      const file = fakeFile()
      const store = createVerlaufStore({
        cipher: fakeCipher(),
        file,
        istAktiv: () => true,
        maxEintraege: 5, // würde ohne den Getter gelten
        getMaxEintraege: () => 1
      })
      await store.aufzeichnen(eintrag('a'))
      await store.aufzeichnen(eintrag('b'))
      const liste = await store.liste()
      expect(liste.map((e) => e.id)).toEqual(['b']) // 1, nicht 5
    })

    it('wird bei JEDEM aufzeichnen()-Aufruf frisch gelesen (Live-Änderung ohne Store-Neubau)', async () => {
      const file = fakeFile()
      let grenze = 2
      const store = createVerlaufStore({
        cipher: fakeCipher(),
        file,
        istAktiv: () => true,
        getMaxEintraege: () => grenze
      })
      await store.aufzeichnen(eintrag('a'))
      await store.aufzeichnen(eintrag('b'))
      expect((await store.liste()).map((e) => e.id)).toEqual(['b', 'a'])

      grenze = 1 // Live-Änderung, wie composition-root sie über die Closure durchreicht
      await store.aufzeichnen(eintrag('c'))
      expect((await store.liste()).map((e) => e.id)).toEqual(['c'])
    })
  })

  it('kappt bei 201 Einträgen auf 200 und wirft den ältesten heraus', async () => {
    const file = fakeFile()
    const store = createVerlaufStore({ cipher: fakeCipher(), file, istAktiv: () => true })
    for (let i = 0; i < 201; i++) await store.aufzeichnen(eintrag(String(i)))
    const liste = await store.liste()
    expect(liste).toHaveLength(200) // exakt an der Default-Grenze gekappt
    expect(liste[0]!.id).toBe('200') // neuester behalten
    expect(liste[liste.length - 1]!.id).toBe('1') // '0' (ältester) herausgefallen
    expect(liste.some((e) => e.id === '0')).toBe(false)
  })

  // --- A1: kaputtes Chiffrat darf nie still überschrieben werden ---
  describe('Korruptions-Rettung (A1)', () => {
    it('kaputtes Chiffrat + Datei vorhanden: aufzeichnen() legt zuerst beiseite, DANN schreibt es, und meldet den Störfall', async () => {
      const file = fakeFile()
      file.data = new TextEncoder().encode('NICHT-ENTSCHLUESSELBAR')
      const reihenfolge: string[] = []
      const beobachtet: CiphertextFile = {
        read: () => file.read(),
        async write(d) {
          reihenfolge.push('write')
          await file.write(d)
        },
        remove: () => file.remove(),
        async beiseiteLegen() {
          reihenfolge.push('beiseiteLegen')
          await file.beiseiteLegen!()
        }
      }
      let korruptGemeldet = 0
      const store = createVerlaufStore({
        cipher: fakeCipher(),
        file: beobachtet,
        istAktiv: () => true,
        aufKorruption: () => korruptGemeldet++
      })

      expect(await store.aufzeichnen(eintrag('a'))).toBe(true)

      expect(reihenfolge).toEqual(['beiseiteLegen', 'write']) // beiseiteLegen VOR dem Schreiben
      expect(korruptGemeldet).toBe(1) // Störfall genau einmal gemeldet
      expect(file.beiseiteGelegt).toBe(1)
      // Die neu geschriebene Datei enthält NUR den neuen Eintrag — die alte (kaputte) ist weg, nicht
      // überschrieben (sie wurde vorher beiseitegelegt).
      expect((await store.liste()).map((e) => e.id)).toEqual(['a'])
    })

    it('Datei existiert NICHT: kein beiseiteLegen, kein Störfall-Callback (kein Lärm bei Erstnutzung)', async () => {
      const file = fakeFile() // data bleibt null
      let korruptGemeldet = 0
      const store = createVerlaufStore({
        cipher: fakeCipher(),
        file,
        istAktiv: () => true,
        aufKorruption: () => korruptGemeldet++
      })

      expect(await store.aufzeichnen(eintrag('a'))).toBe(true)

      expect(file.beiseiteGelegt).toBe(0)
      expect(korruptGemeldet).toBe(0)
    })

    it('liste() auf kaputtem Chiffrat legt ebenfalls beiseite + meldet (nicht nur aufzeichnen)', async () => {
      const file = fakeFile()
      file.data = new TextEncoder().encode('NICHT-ENTSCHLUESSELBAR')
      let korruptGemeldet = 0
      const store = createVerlaufStore({
        cipher: fakeCipher(),
        file,
        istAktiv: () => true,
        aufKorruption: () => korruptGemeldet++
      })

      expect(await store.liste()).toEqual([])

      expect(file.beiseiteGelegt).toBe(1)
      expect(korruptGemeldet).toBe(1)
    })

    it('Fake-Port OHNE beiseiteLegen: wirft nicht, meldet trotzdem den Störfall (optionale Methode)', async () => {
      // Minimal-Fake ohne beiseiteLegen — genau wie ein älterer/unvollständiger Fake-Port im Bestand.
      let data: Uint8Array | null = new TextEncoder().encode('NICHT-ENTSCHLUESSELBAR')
      const minimalesFile: CiphertextFile = {
        async read() {
          return data
        },
        async write(d) {
          data = d
        },
        async remove() {
          data = null
        }
      }
      let korruptGemeldet = 0
      const store = createVerlaufStore({
        cipher: fakeCipher(),
        file: minimalesFile,
        istAktiv: () => true,
        aufKorruption: () => korruptGemeldet++
      })

      await expect(store.aufzeichnen(eintrag('a'))).resolves.toBe(true)
      expect(korruptGemeldet).toBe(1)
    })

    it('ohne aufKorruption-Callback: kaputtes Chiffrat wird trotzdem beiseitegelegt (No-Op-Default)', async () => {
      const file = fakeFile()
      file.data = new TextEncoder().encode('NICHT-ENTSCHLUESSELBAR')
      const store = createVerlaufStore({ cipher: fakeCipher(), file, istAktiv: () => true })

      await expect(store.aufzeichnen(eintrag('a'))).resolves.toBe(true)
      expect(file.beiseiteGelegt).toBe(1)
    })
  })

  // --- Befund 14: aufzeichnen/loeschen/loeschenEintrag ohne gegenseitigen Ausschluss verlieren
  // Änderungen bei Überlappung (Lost Update). Fixture-Fakes sind bereits „echte" async-Funktionen
  // (mindestens ein Microtask-Tick pro read/encrypt/write) — zwei parallel gestartete Aufrufe
  // verzahnen sich dadurch deterministisch, ganz ohne setTimeout-Raten.
  describe('Serialisierung gleichzeitiger Schreibvorgänge (Befund 14)', () => {
    it('zwei GLEICHZEITIGE aufzeichnen()-Aufrufe verlieren keinen Eintrag', async () => {
      const file = fakeFile()
      const store = createVerlaufStore({ cipher: fakeCipher(), file, istAktiv: () => true })

      const p1 = store.aufzeichnen(eintrag('a'))
      const p2 = store.aufzeichnen(eintrag('b'))
      await Promise.all([p1, p2])

      const ids = (await store.liste()).map((e) => e.id).sort()
      expect(ids).toEqual(['a', 'b'])
    })

    it('aufzeichnen() gleichzeitig mit loeschenEintrag() bleibt konsistent (keine verlorene Änderung)', async () => {
      const file = fakeFile()
      const store = createVerlaufStore({ cipher: fakeCipher(), file, istAktiv: () => true })
      await store.aufzeichnen(eintrag('alt'))

      const p1 = store.aufzeichnen(eintrag('neu'))
      const p2 = store.loeschenEintrag('alt')
      await Promise.all([p1, p2])

      const ids = (await store.liste()).map((e) => e.id)
      expect(ids).toEqual(['neu']) // 'alt' gelöscht, 'neu' nicht verloren gegangen
    })

    it('drei GLEICHZEITIGE aufzeichnen()-Aufrufe behalten alle drei Einträge', async () => {
      const file = fakeFile()
      const store = createVerlaufStore({ cipher: fakeCipher(), file, istAktiv: () => true })

      const ps = [eintrag('a'), eintrag('b'), eintrag('c')].map((e) => store.aufzeichnen(e))
      await Promise.all(ps)

      const ids = (await store.liste()).map((e) => e.id).sort()
      expect(ids).toEqual(['a', 'b', 'c'])
    })
  })
})
