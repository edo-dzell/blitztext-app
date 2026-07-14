import { useState } from 'react'
import { geraeteliste } from '@/lib/mikrofon-auswahl'
import type { DiagnoseErgebnis } from '@main/health'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

// W3-ε: Selbstdiagnose-Ampel. Ruft health.diagnose mit der im Renderer ermittelten Mikrofon-Anzahl
// (enumerateDevices) auf und zeigt je Check + Gesamt eine Ampel (ok/warnung/fehler). „Erneut prüfen"
// löst eine frische Diagnose aus. Reale Werte (Erreichbarkeit/Mikrofon/Hotkey) sind HITL-only (Windows).
export default function DiagnoseKarte() {
  const [ergebnis, setErgebnis] = useState<DiagnoseErgebnis | null>(null)
  const [busy, setBusy] = useState(false)

  async function pruefe() {
    setBusy(true)
    let mikrofonAnzahl = 0
    try {
      const alle = await navigator.mediaDevices.enumerateDevices()
      mikrofonAnzahl = geraeteliste(alle).length
    } catch {
      mikrofonAnzahl = 0
    }
    setErgebnis(await window.blitztext.health.diagnose(mikrofonAnzahl))
    setBusy(false)
  }

  const farbe = (s: 'ok' | 'warnung' | 'fehler') =>
    s === 'ok'
      ? 'bg-emerald-500'
      : s === 'warnung'
        ? 'bg-amber-500'
        : 'bg-red-500'

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-5">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            {ergebnis && <span className={`size-3 rounded-full ${farbe(ergebnis.gesamtstatus)}`} />}
            <p className="text-sm font-medium">Selbstdiagnose</p>
          </div>
          <Button size="sm" variant="secondary" onClick={pruefe} disabled={busy}>
            {busy ? 'Prüfe…' : 'Erneut prüfen'}
          </Button>
        </div>
        {ergebnis ? (
          <ul className="flex flex-col gap-2">
            {ergebnis.checks.map((c) => (
              <li key={c.titel} className="flex items-start gap-2">
                <span className={`mt-1 size-2.5 shrink-0 rounded-full ${farbe(c.status)}`} />
                <div>
                  <p className="text-sm">{c.titel}</p>
                  <p className="text-xs text-muted-foreground">{c.detail}</p>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">
            Prüft API-Key, Anbieter-Erreichbarkeit, Mikrofon und Hotkey-Erkennung.
          </p>
        )}
      </CardContent>
    </Card>
  )
}
