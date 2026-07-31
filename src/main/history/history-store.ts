// Verlauf (ADR-0009, V2 Strang D): opt-in, lokal, DPAPI-verschlüsselt. Reiner Kern hinter den
// vorhandenen Secret-Ports (SecretCipher + CiphertextFile, ADR-0004) → ohne echtes safeStorage/fs
// testbar. Sensibler Transkript-Text: NIE im Klartext auf Platte; bei „Sicherem Lokalem Modus" oder
// ausgeschaltetem Verlauf wird gar nichts aufgezeichnet. id/Zeitstempel baut der Aufrufer (Adapter).

import type { SecretCipher, CiphertextFile } from '@main/secrets/api-key-store'

export interface VerlaufEintrag {
  id: string
  zeitstempelMs: number
  workflowId: string
  workflowLabel: string
  rohtext: string
  endtext: string
  dauerSekunden: number
  // Tatsächlich genutzte Modelle + Verbrauch (für die Kosten-Anzeige je Eintrag, VL-2). Optional —
  // ältere Einträge und reine Transkription ohne Chat-Teil haben sie (teilweise) nicht.
  asrModell?: string
  chatModell?: string
  usage?: { promptTokens: number; completionTokens: number }
  // V5: Kennung des Prompt-Stands, der den Endtext erzeugt hat (siehe `promptKennungFuer` in
  // shared/workflows.ts). Optional + migrationssicher — ältere Einträge (vor V5) UND reine
  // Transkription ohne Umschreibeschritt haben sie nicht; `ladeAlle` liest sie einfach als
  // `undefined`, kein Schema-Bruch (JSON.parse liefert das fehlende Feld nicht mit).
  promptKennung?: string
}

export interface VerlaufStore {
  /** Ist der Verlauf aktiv (opt-in an UND nicht im Sicheren Lokalen Modus)? */
  aktiv(): boolean
  /**
   * Eintrag aufzeichnen — no-op, wenn inaktiv/nicht verschlüsselbar. Neueste zuerst; Retentionsgrenze
   * gewahrt. Liefert true NUR, wenn tatsächlich geschrieben wurde (für das `history:changed`-Event, P5b).
   */
  aufzeichnen(eintrag: VerlaufEintrag): Promise<boolean>
  liste(): Promise<VerlaufEintrag[]>
  loeschen(): Promise<void>
  /** Einen einzelnen Eintrag löschen (VL-3). Unbekannte Id = No-Op. */
  loeschenEintrag(id: string): Promise<void>
}

const STANDARD_MAX = 200

export function createVerlaufStore(deps: {
  cipher: SecretCipher
  file: CiphertextFile
  /** Liefert, ob der Verlauf aktuell aktiv ist (liest die Einstellung live). */
  istAktiv: () => boolean
  maxEintraege?: number
  /**
   * v0.8.0 (verlaufMaximum): Live-Getter — nimmt Vorrang vor der statischen `maxEintraege` (Tests),
   * falls gesetzt. Composition-root reicht ihn als Closure über die lebende Settings-Kopie durch
   * (Muster wie `istAktiv` oben), damit eine Änderung ab dem NÄCHSTEN `aufzeichnen()` greift, ohne
   * den Store neu zu bauen.
   */
  getMaxEintraege?: () => number
  /**
   * Störfall-Callback (A1, Muster wörtlich wie `SettingsStore.aufKorruption` in settings/store.ts):
   * feuert, wenn die Verlauf-Datei EXISTIERT, aber nicht entschlüsselbar/parsebar ist (anderer
   * Benutzer/Profil, DPAPI-Bindungswechsel, Korruption — insbesondere ein bevorstehendes Electron-
   * Major-Upgrade). Optional, No-Op-Default; der Kern loggt/benachrichtigt bewusst NICHT selbst
   * (keine log-/GUI-Dep hier) — das übernimmt der Aufrufer (index.ts), analog `meldeSettingsKorrupt`.
   */
  aufKorruption?: () => void
}): VerlaufStore {
  // v0.8.0: NICHT mehr einmalig beim Store-Bau aufgelöst — `getMaxEintraege` (falls gesetzt) wird bei
  // JEDEM aufzeichnen()-Aufruf frisch gelesen, damit eine Live-Änderung der Einstellung greift.
  function aktuellesMax(): number {
    return deps.getMaxEintraege ? deps.getMaxEintraege() : (deps.maxEintraege ?? STANDARD_MAX)
  }

  async function ladeAlle(): Promise<VerlaufEintrag[]> {
    const data = await deps.file.read()
    if (data === null) return [] // Datei existiert nicht → frische Installation, KEIN Störfall
    try {
      const klartext = await deps.cipher.decrypt(data)
      const parsed = JSON.parse(klartext)
      return Array.isArray(parsed) ? (parsed as VerlaufEintrag[]) : []
    } catch {
      // Die Datei EXISTIERT, ist aber nicht entschlüsselbar/parsebar (RESEARCH §4) → NICHT wie „kein
      // Verlauf" stillschweigend behandeln: das ließe den nächsten aufzeichnen()-Aufruf die kaputte
      // Datei unwiederbringlich überschreiben. Stattdessen beiseite legen (Muster settings-file.ts,
      // .korrupt-Suffix) UND den Störfall melden — beides BEVOR wir mit einer leeren Liste weiterlaufen.
      // Ist die Datei danach weg (umbenannt), liefert der nächste read() null → kein zweiter Störfall
      // für dieselbe Datei (natürliche Einmaligkeit, kein zusätzliches Flag nötig).
      await deps.file.beiseiteLegen?.()
      deps.aufKorruption?.()
      return []
    }
  }

  // Serialisierung (Befund 14): aufzeichnen/loeschen/loeschenEintrag laufen alle als
  // ladeAlle()→ändern→write() OHNE gegenseitigen Ausschluss — zwei gleichzeitige Aufrufe lesen sonst
  // denselben Stand, und der zuletzt schreibende gewinnt (Lost Update). Die App ist Single-Instance
  // (app.requestSingleInstanceLock() in index.ts) → eine prozessinterne Kette genügt, kein Datei-
  // Locking nötig. Jede Aufgabe hängt sich an die vorherige (Erfolg ODER Fehler) an; die Ketten-
  // Referenz selbst wird mit `.catch` entschärft, damit ein einzelner Fehlschlag die Kette nicht
  // dauerhaft in den rejected-Zustand versetzt (sonst würde JEDE künftige Operation sofort mitwerfen).
  let kette: Promise<unknown> = Promise.resolve()
  function serialisiert<T>(aufgabe: () => Promise<T>): Promise<T> {
    const ergebnis = kette.then(aufgabe, aufgabe)
    kette = ergebnis.then(
      () => undefined,
      () => undefined
    )
    return ergebnis
  }

  return {
    aktiv() {
      return deps.istAktiv()
    },
    aufzeichnen(eintrag) {
      return serialisiert(async () => {
        if (!deps.istAktiv()) return false
        if (!deps.cipher.isEncryptionAvailable()) return false // ohne Verschlüsselung lieber nichts schreiben
        const alle = await ladeAlle()
        const naechste = [eintrag, ...alle].slice(0, aktuellesMax())
        const data = await deps.cipher.encrypt(JSON.stringify(naechste))
        await deps.file.write(data)
        return true
      })
    },
    async liste() {
      return ladeAlle()
    },
    loeschen() {
      return serialisiert(async () => {
        await deps.file.remove()
      })
    },
    loeschenEintrag(id) {
      return serialisiert(async () => {
        const alle = await ladeAlle()
        const gefiltert = alle.filter((e) => e.id !== id)
        if (gefiltert.length === alle.length) return // unbekannte Id → No-Op
        if (gefiltert.length === 0) {
          await deps.file.remove()
          return
        }
        if (!deps.cipher.isEncryptionAvailable()) return
        const data = await deps.cipher.encrypt(JSON.stringify(gefiltert))
        await deps.file.write(data)
      })
    }
  }
}
