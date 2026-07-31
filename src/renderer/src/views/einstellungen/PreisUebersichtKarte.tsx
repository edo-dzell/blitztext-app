import { preisUebersichtZusammenfassung } from '@/lib/einstellungen-labels'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

// v0.8.0: Lesekarte für `preisOverrides`/`usdEurKurs` (heute nur in der Statistik-Ansicht editierbar).
// BEWUSST kein Eingabefeld hier — beides sind freie Dezimalwerte (ein Wechselkurs hat keine sinnvollen
// Stufen) und lassen sich nicht verlustfrei in Switch/Select pressen. Der Button ist eine Navigations-
// Aktion, kein Einstellungswert, verletzt also die Schalter/Dropdown-Vorgabe nicht.
export default function PreisUebersichtKarte({
  anzahlOverrides,
  kurs,
  aufStatistik
}: {
  anzahlOverrides: number
  kurs: number
  aufStatistik: () => void
}) {
  return (
    <Card>
      <CardContent className="flex items-center justify-between gap-4 p-5">
        <div>
          <p className="text-sm font-medium">Preise &amp; Wechselkurs</p>
          <p className="text-xs text-muted-foreground">
            {preisUebersichtZusammenfassung(anzahlOverrides, kurs)}. Freie Zahlenwerte (Preis je Modell,
            Wechselkurs) passen nicht sinnvoll in ein Dropdown — bearbeitbar in der Statistik-Ansicht.
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={aufStatistik}>
          Zur Statistik
        </Button>
      </CardContent>
    </Card>
  )
}
