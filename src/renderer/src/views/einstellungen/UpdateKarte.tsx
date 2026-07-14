import { useEffect, useState } from 'react'
import type { UpdateErgebnis } from '@main/update/update-hinweis'
import { Card, CardContent } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'

// W3-δ: Opt-in Update-Hinweis. Default AUS (kein Netzabruf ohne Zustimmung). Bei „an" wird beim
// nächsten Start (und hier auf Wunsch) die GitHub-Releases-API des öffentlichen Forks abgefragt —
// anonym, kein Auto-Download. Zeigt einen dezenten Hinweis mit Link, wenn eine neuere Version vorliegt.
// A4b-Vorleistung: `letztesErgebnis` ist ein optionaler Anzeige-Fallback (z. B. ein beim App-Start
// bereits vorhandenes Ergebnis), solange der eigene useEffect-Check hier noch nichts geliefert hat.
// Die eigentliche Verdrahtung (woher der Wert kommt) macht ggf. ein Folge-Slice — diese Karte
// übernimmt ihn nur, falls gesetzt und noch kein eigenes Ergebnis vorliegt.
export default function UpdateKarte({
  an,
  aendere,
  letztesErgebnis
}: {
  an: boolean
  aendere: (v: boolean) => void
  letztesErgebnis?: UpdateErgebnis
}) {
  const [eigenesErgebnis, setEigenesErgebnis] = useState<UpdateErgebnis | null>(null)

  useEffect(() => {
    if (!an) {
      setEigenesErgebnis(null)
      return
    }
    let abgemeldet = false
    void window.blitztext.update.pruefe().then((r) => {
      if (!abgemeldet) setEigenesErgebnis(r)
    })
    return () => {
      abgemeldet = true
    }
  }, [an])

  const ergebnis = eigenesErgebnis ?? letztesErgebnis ?? null

  return (
    <Card>
      <CardContent className="flex flex-col gap-2 p-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium">Nach Updates suchen</p>
            <p className="text-xs text-muted-foreground">
              Fragt beim Start anonym die Releases-Seite ab (kein Auto-Download, keine Telemetrie).
              Standardmäßig aus.
            </p>
          </div>
          <Switch checked={an} onCheckedChange={aendere} />
        </div>
        {an && ergebnis?.neuVerfuegbar && ergebnis.url && (
          <p className="text-xs">
            {ergebnis.neueVersion ? `Version ${ergebnis.neueVersion} verfügbar` : 'Neue Version verfügbar'} —{' '}
            <a href={ergebnis.url} target="_blank" rel="noreferrer" className="underline">
              Release ansehen
            </a>
          </p>
        )}
        {an && ergebnis && !ergebnis.neuVerfuegbar && (
          <p className="text-xs text-muted-foreground">Aktuell auf dem neuesten Stand.</p>
        )}
      </CardContent>
    </Card>
  )
}
