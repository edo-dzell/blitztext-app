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
}): VerlaufStore {
  const max = deps.maxEintraege ?? STANDARD_MAX

  async function ladeAlle(): Promise<VerlaufEintrag[]> {
    const data = await deps.file.read()
    if (data === null) return []
    try {
      const klartext = await deps.cipher.decrypt(data)
      const parsed = JSON.parse(klartext)
      return Array.isArray(parsed) ? (parsed as VerlaufEintrag[]) : []
    } catch {
      // Entschlüsselung/Parsing fehlgeschlagen (z. B. anderer Benutzer/Profil, RESEARCH §4) →
      // als „kein lesbarer Verlauf" behandeln statt zu werfen.
      return []
    }
  }

  return {
    aktiv() {
      return deps.istAktiv()
    },
    async aufzeichnen(eintrag) {
      if (!deps.istAktiv()) return false
      if (!deps.cipher.isEncryptionAvailable()) return false // ohne Verschlüsselung lieber nichts schreiben
      const alle = await ladeAlle()
      const naechste = [eintrag, ...alle].slice(0, max)
      const data = await deps.cipher.encrypt(JSON.stringify(naechste))
      await deps.file.write(data)
      return true
    },
    async liste() {
      return ladeAlle()
    },
    async loeschen() {
      await deps.file.remove()
    },
    async loeschenEintrag(id) {
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
    }
  }
}
