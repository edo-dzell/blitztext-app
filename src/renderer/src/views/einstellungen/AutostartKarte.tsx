import { useEffect, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'

// W3-γ: Autostart-Schalter mit dem EHRLICHEN Hinweis (portable .exe: Eintrag zeigt auf den .exe-Pfad
// zum Einschalt-Zeitpunkt; Verschieben/Umbenennen macht ihn wirkungslos). Zeigt zusätzlich den echten
// Registry-Status (aktiv/verwaist), sobald er geladen ist.
export default function AutostartKarte({ an, aendere }: { an: boolean; aendere: (v: boolean) => void }) {
  const [statusText, setStatusText] = useState<string | null>(null)

  useEffect(() => {
    let abgemeldet = false
    void window.blitztext.autostart.status().then((s) => {
      if (abgemeldet) return
      if (s.zustand === 'verwaist') {
        setStatusText('Der hinterlegte Eintrag zeigt auf eine andere/verschobene .exe — bitte neu einschalten.')
      } else {
        setStatusText(null)
      }
    })
    return () => {
      abgemeldet = true
    }
  }, [an])

  return (
    <Card>
      <CardContent className="flex flex-col gap-2 p-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium">Mit Windows starten</p>
            <p className="text-xs text-muted-foreground">
              Startet Blitztext automatisch bei der Anmeldung. Hinweis: bricht, wenn die .exe verschoben
              oder umbenannt wird (portable App ohne Installer) — dann bitte hier neu einschalten.
            </p>
          </div>
          <Switch checked={an} onCheckedChange={aendere} />
        </div>
        {statusText && <p className="text-xs text-amber-600 dark:text-amber-500">{statusText}</p>}
      </CardContent>
    </Card>
  )
}
