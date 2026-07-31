import { useEffect, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'

// v0.7.2: Ereignislog-Karte im Abschnitt „System & Diagnose" (unter DiagnoseKarte). Zeigt den
// lokalen Log-Pfad an und bietet Ordner-öffnen + Löschen. Das Log ist immer aktiv und text-frei
// (nie Diktate/Texte/API-Keys) — die Karte macht es nur zugänglich. Der Debug-Schalter steuert nur
// die Detailtiefe (BLITZTEXT_DEBUG=1 erzwingt sie ohnehin). IPC-Fehler (Pfad ermitteln/Ordner
// öffnen/Löschen) werden still gefangen: die Diagnose-Karte darf nie werfen.
// v0.8.0: `perfAktiv` (bislang nur per BLITZTEXT_PERF=1 env erzwingbar) als zweiter Schalter ergänzt —
// gleiche Karte, da beide Schalter „mehr interne Diagnose-Daten schreiben" bedeuten. Wirkt laut Vertrag
// erst nach einem Neustart (Perf-Messung wird beim Start einmalig verdrahtet, kein Live-Reconfigure).
export default function LogsKarte({
  an,
  aendere,
  perfAn,
  aendrePerfAn
}: {
  an: boolean
  aendere: (v: boolean) => void
  perfAn: boolean
  aendrePerfAn: (v: boolean) => void
}) {
  const [pfad, setPfad] = useState('')
  const [geleert, setGeleert] = useState(false)

  useEffect(() => {
    window.blitztext.log
      .pfad()
      .then(setPfad)
      .catch(() => setPfad(''))
  }, [])

  async function oeffneOrdner() {
    try {
      await window.blitztext.log.oeffneOrdner()
    } catch {
      // still: Ordner-Öffnen ist Komfort, kein Fehlerzustand der Karte
    }
  }

  async function loesche() {
    try {
      await window.blitztext.log.loeschen()
      setGeleert(true)
    } catch {
      // still: Löschen wirkt best-effort, kein Dialog/Toast
    }
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-5">
        <div className="flex items-center justify-between gap-4">
          <p className="text-sm font-medium">Ereignislog</p>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="secondary" onClick={oeffneOrdner}>
              Log-Ordner öffnen
            </Button>
            <Button size="sm" variant="secondary" onClick={loesche}>
              Logs löschen
            </Button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Technisches Log für die Fehlersuche — enthält nie Diktate, Texte oder API-Keys. Bleibt auf
          diesem Gerät.
        </p>
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium">Ausführliches Protokoll (Debug)</p>
            <p className="text-xs text-muted-foreground">
              Schreibt zusätzliche Detail-Zeilen für die Fehlersuche. Wirkt nach dem Speichern.
            </p>
          </div>
          <Switch checked={an} onCheckedChange={aendere} />
        </div>
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium">Performance-Messung</p>
            <p className="text-xs text-muted-foreground">
              Misst interne Laufzeiten zur Fehlersuche. Wirkt erst nach einem Neustart der App.
            </p>
          </div>
          <Switch checked={perfAn} onCheckedChange={aendrePerfAn} />
        </div>
        {pfad && <p className="font-mono text-xs text-muted-foreground">{pfad}</p>}
        {geleert && <p className="text-xs text-emerald-500">Logs gelöscht.</p>}
      </CardContent>
    </Card>
  )
}
