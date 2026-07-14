import { useState, type KeyboardEvent } from 'react'
import { X } from 'lucide-react'
import { begriffeFuerAsrPrompt } from '@shared/begriffe'
import { commitEingabe, commitAlles } from '@/lib/begriffe-eingabe'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'

// Terms-UI-Neubau (W2-S6): Chips-Editor statt Kommafeld. Kontrollierte Komponente — `begriffe` kommt
// vom Eltern-Entwurf, nur die Eingabezeile selbst ist lokaler State. Commit-Regel (begriffe-eingabe.ts):
// Komma committet das Fragment davor sofort (Rest bleibt stehen), Enter UND Blur committen den ganzen
// Rest — Blur bewusst wie Enter behandelt, damit ein angefangenes Fragment beim Wegklicken/Tab NICHT
// stillschweigend verloren geht (Datenverlust-Footgun).
export default function BegriffeFeld({
  begriffe,
  aendere
}: {
  begriffe: string[]
  aendere: (b: string[]) => void
}) {
  const [eingabe, setEingabe] = useState('')

  function entferne(begriff: string) {
    aendere(begriffe.filter((b) => b !== begriff))
  }

  function onChange(text: string) {
    if (!text.includes(',')) {
      setEingabe(text)
      return
    }
    const ergebnis = commitEingabe(begriffe, text)
    aendere(ergebnis.begriffe)
    setEingabe(ergebnis.restEingabe)
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter') return
    e.preventDefault()
    const ergebnis = commitAlles(begriffe, eingabe)
    aendere(ergebnis.begriffe)
    setEingabe(ergebnis.restEingabe)
  }

  function onBlur() {
    if (eingabe.trim() === '') return
    const ergebnis = commitAlles(begriffe, eingabe)
    aendere(ergebnis.begriffe)
    setEingabe(ergebnis.restEingabe)
  }

  const passendeAnzahl = begriffeFuerAsrPrompt(begriffe).length
  const uebersprungen = begriffe.length - passendeAnzahl

  return (
    <div className="flex flex-col gap-2">
      {begriffe.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {begriffe.map((begriff) => (
            <Badge key={begriff} variant="secondary" className="gap-1 py-1 pl-2 pr-1">
              {begriff}
              <button
                type="button"
                onClick={() => entferne(begriff)}
                title="Entfernen"
                aria-label={`„${begriff}" entfernen`}
                className="rounded-sm p-0.5 text-muted-foreground hover:bg-background/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X className="size-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
      <Input
        value={eingabe}
        placeholder="z. B. Produktname, Eigenname, Fachbegriff"
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={onBlur}
      />
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {begriffe.length} {begriffe.length === 1 ? 'Begriff' : 'Begriffe'}
        </p>
        {uebersprungen > 0 && (
          <p className="text-xs text-warning">
            Die ältesten {uebersprungen} Begriffe passen nicht mehr ins Erkennungs-Budget und werden bei
            der Aufnahme weggelassen.
          </p>
        )}
      </div>
    </div>
  )
}
