import { Card, CardContent } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'

// v0.8.0: GUI für das bislang oberflächenlose Feld `fokusRueckkehr` (Weg B, ADR-0011). Ehrlicher
// Hinweis: der Schalter kehrt NICHT aktiv zu einem anderen Fenster zurück, sondern verhindert das
// blinde Einfügen in ein FREMDES Fenster, wenn der Fokus zwischen Aufnahme und Einfügen gewandert ist
// (siehe paste-service.ts „verify-or-degrade"). Gleicher Karten-Stil wie AutostartKarte.
export default function FokusRueckkehrKarte({
  an,
  aendere
}: {
  an: boolean
  aendere: (v: boolean) => void
}) {
  return (
    <Card>
      <CardContent className="flex items-center justify-between gap-4 p-5">
        <div>
          <p className="text-sm font-medium">Fokus-Sicherung vor dem Einfügen</p>
          <p className="text-xs text-muted-foreground">
            Ist der Fokus während Aufnahme/Verarbeitung zu einem anderen Fenster gewandert, wird NICHT
            dorthin eingefügt — der Text bleibt in der Zwischenablage, mit Hinweis. Ausgeschaltet wird
            immer eingefügt, auch bei gewechseltem Fokus.
          </p>
        </div>
        <Switch checked={an} onCheckedChange={aendere} />
      </CardContent>
    </Card>
  )
}
