import type { WorkflowDefinition } from '@shared/workflows'
import { Select } from '@/components/ui/select'
import { Field } from '@/components/ui/field'

interface Props {
  promptModus: WorkflowDefinition['promptModus']
  tone: WorkflowDefinition['tone']
  emojiDensity: WorkflowDefinition['emojiDensity']
  onChange: (patch: Partial<WorkflowDefinition>) => void
}

// C3: Regler sind IMMER sichtbar (auch bei promptModus 'statisch') — der Main-Merge wendet
// explizit gesetzte def.tone/def.emojiDensity bereits zusätzlich zum festen Prompt-Text an, die UI
// muss dafür nur den Hint-Text anpassen. Vorher (D1) galt hier `if (promptModus !== 'berechnet')
// return null` — die Sichtbarkeits-Bedingung ist mit C3 bewusst entfernt.
export default function TonEmojiFelder({ promptModus, tone, emojiDensity, onChange }: Props) {
  const toneHint =
    promptModus === 'berechnet'
      ? 'Schreibstil beim Umschreiben.'
      : 'Schreibstil beim Umschreiben — wird zusätzlich zum festen Prompt-Text angewendet.'
  const emojiHint =
    promptModus === 'berechnet'
      ? 'Wie viele Emojis ergänzt werden.'
      : 'Wie viele Emojis ergänzt werden — wird zusätzlich zum festen Prompt-Text angewendet.'

  return (
    <div className="grid grid-cols-2 gap-4">
      <Field label="Ton" hint={toneHint}>
        <Select
          value={tone ?? 'neutral'}
          onChange={(ev) => onChange({ tone: ev.target.value as WorkflowDefinition['tone'] })}
        >
          <option value="formal">Formell</option>
          <option value="neutral">Neutral</option>
          <option value="casual">Locker</option>
        </Select>
      </Field>
      <Field label="Emoji-Dichte" hint={emojiHint}>
        <Select
          value={emojiDensity ?? 'mittel'}
          onChange={(ev) =>
            onChange({ emojiDensity: ev.target.value as WorkflowDefinition['emojiDensity'] })
          }
        >
          <option value="aus">Aus (keine Emojis)</option>
          <option value="wenig">Wenig</option>
          <option value="mittel">Mittel</option>
          <option value="viel">Viel</option>
        </Select>
      </Field>
    </div>
  )
}
