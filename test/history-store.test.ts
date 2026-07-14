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

function fakeFile(): CiphertextFile & { data: Uint8Array | null } {
  const f = {
    data: null as Uint8Array | null,
    async read() {
      return f.data
    },
    async write(d: Uint8Array) {
      f.data = d
    },
    async remove() {
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
})
