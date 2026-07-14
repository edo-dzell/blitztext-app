import { Wand2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface Props {
  beschreibung: string
  onBeschreibungChange: (text: string) => void
  assistentBusy: boolean
  assistentFehler: string | null
  kannErweitern: boolean
  onAssistent: (erweitern: boolean) => void
}

// D1: reine Extraktion aus WorkflowEditor — der Handler `assistent` bleibt eine Closure im Editor
// (Zugriff auf beschreibung/kannErweitern/setPrompt/Fehlerzustand) und wird als Callback durchgereicht.
export default function PromptAssistent({
  beschreibung,
  onBeschreibungChange,
  assistentBusy,
  assistentFehler,
  kannErweitern,
  onAssistent
}: Props) {
  return (
    <div className="rounded-md border p-3">
      <p className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <Wand2 className="size-3.5" /> Prompt-Assistent
      </p>
      <div className="flex items-center gap-2">
        <Input
          placeholder="z. B. „formell auf Englisch zusammenfassen"
          value={beschreibung}
          onChange={(ev) => onBeschreibungChange(ev.target.value)}
        />
        <Button
          size="sm"
          variant="secondary"
          onClick={() => onAssistent(false)}
          disabled={assistentBusy || beschreibung.trim() === ''}
        >
          {assistentBusy ? 'Entwerfe…' : 'Neu erstellen'}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => onAssistent(true)}
          disabled={assistentBusy || beschreibung.trim() === '' || !kannErweitern}
          title={kannErweitern ? undefined : 'Kein bestehender Prompt zum Erweitern'}
        >
          Erweitern
        </Button>
      </div>
      {assistentFehler && <p className="mt-2 text-xs text-destructive">{assistentFehler}</p>}
    </div>
  )
}
