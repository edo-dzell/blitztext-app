import { Keyboard } from 'lucide-react'
import { DEFAULT_HOTKEYS } from '@shared/workflows'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { chordLabel } from '@/lib/hotkey-capture'
import type { ChordUrteil } from '@shared/validate-chord'

interface Props {
  workflowId: string
  chord: string[]
  faengt: boolean
  urteil: ChordUrteil
  onKeyDown: (ev: React.KeyboardEvent) => void
  onStarteCapture: () => void
  onBlur: () => void
  onSetChord: (chord: string[]) => void
}

// D1: reine Extraktion aus WorkflowEditor. Die Aufnahme-Logik (gedrueckteRef, onKeyDown-Semantik)
// bleibt eine Closure im Editor — hier nur die Darstellung + Callback-Weiterleitung.
export default function HotkeyErfassung({
  workflowId,
  chord,
  faengt,
  urteil,
  onKeyDown,
  onStarteCapture,
  onBlur,
  onSetChord
}: Props) {
  return (
    <>
      <Field
        label="Hotkey"
        hint="Globale Tastenkombination — funktioniert auch in anderen Apps."
        error={urteil.hart[0]?.meldung}
      >
        <div className="flex items-center gap-2">
          <div
            tabIndex={0}
            onKeyDown={onKeyDown}
            onClick={onStarteCapture}
            onBlur={onBlur}
            className={`flex h-9 flex-1 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm ${
              faengt ? 'ring-2 ring-ring' : ''
            }`}
          >
            <Keyboard className="size-4 text-muted-foreground" />
            {faengt
              ? 'Tasten drücken…'
              : chord.length > 0
                ? chordLabel(chord)
                : 'Klicken und Tasten drücken'}
          </div>
          <Button variant="outline" size="sm" onClick={() => onSetChord(DEFAULT_HOTKEYS[workflowId] ?? [])}>
            Standard
          </Button>
        </div>
      </Field>
      {urteil.weich.map((w, i) => (
        <p key={i} className="-mt-2 text-xs text-warning">
          {w.meldung}
        </p>
      ))}
    </>
  )
}
