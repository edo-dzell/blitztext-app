// Protokoll-Adapter (V2 Strang D): verbindet die Sitzung mit Verlauf- und Statistik-Store.
// Hier — in der Kompositionsschicht — entstehen id/Zeitstempel (echte randomUUID/Date.now), damit
// die reinen Stores deterministisch/testbar bleiben. Splittet die Abschlussdaten so, dass NUR der
// Verlauf Text bekommt; die Statistik erhält ausschließlich Zahlen/Modellnamen (text-frei, ADR-0009).

import type { Protokoll, Abschlussdaten } from '@main/session/sitzung'
import type { VerlaufStore } from '@main/history/history-store'
import type { StatsStore } from '@main/stats/stats-store'
import { NOOP_EREIGNISLOG, redigiereFehler, type EreignisLog } from '@main/diagnostics/ereignis-log'

export function createProtokoll(deps: {
  verlauf: VerlaufStore
  stats: StatsStore
  jetzt: () => number
  neueId: () => string
  /**
   * Ereignislog (v0.7.2): macht einen Statistik-Schreibfehler TEXT-FREI sichtbar (nur redigierter
   * Fehler). Optional — fehlt er, NOOP; Verhalten unverändert.
   */
  log?: EreignisLog
}): Protokoll {
  const log = deps.log ?? NOOP_EREIGNISLOG
  return {
    // Liefert true, wenn der Verlauf tatsächlich geschrieben wurde (für das history:changed-Event, P5b).
    // Stats bleibt fire-and-forget (text-frei, kein Event nötig).
    async aufzeichnen(daten: Abschlussdaten): Promise<boolean> {
      const jetztMs = deps.jetzt()
      // Statistik (text-frei) — immer.
      void deps.stats.aufzeichnen(
        {
          workflowId: daten.workflowId,
          audioSekunden: daten.dauerSekunden,
          asrModell: daten.asrModell,
          chat: daten.umgeschrieben
            ? {
                model: daten.chatModell,
                promptTokens: daten.usage?.promptTokens ?? 0,
                completionTokens: daten.usage?.completionTokens ?? 0
              }
            : undefined
        },
        jetztMs
      ).catch((err) => {
        // v0.7.2: zusätzlich TEXT-FREI ins Log (nur redigierter Fehler: name+message).
        log.fehler('statistik.schreiben_fehl', redigiereFehler(err))
        console.error('Statistik schreiben fehlgeschlagen (ignoriert):', err)
      })
      // Verlauf (Text) — der Store entscheidet selbst per aktiv()-Gate, ob er schreibt. Awaiten +
      // zurückgeben, damit der Aufrufer das history:changed-Event erst nach erfolgtem Schreiben feuert.
      return deps.verlauf.aufzeichnen({
        id: deps.neueId(),
        zeitstempelMs: jetztMs,
        workflowId: daten.workflowId,
        workflowLabel: daten.workflowLabel,
        rohtext: daten.rohtext,
        endtext: daten.endtext,
        dauerSekunden: daten.dauerSekunden,
        // Tatsächlich genutzte Modelle + Verbrauch für die Kosten-Anzeige je Eintrag (VL-2).
        asrModell: daten.asrModell,
        chatModell: daten.umgeschrieben ? daten.chatModell : '',
        usage: daten.usage,
        // V5 (W3-μ): reicht die bereits in der Sitzung berechnete Prompt-Kennung unverändert durch.
        promptKennung: daten.promptKennung
      })
    }
  }
}
