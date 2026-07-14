import type { WorkflowDefinition } from '@shared/workflows'
import { Button } from '@/components/ui/button'

interface Props {
  historie: NonNullable<WorkflowDefinition['promptHistorie']>
  onWiederherstellen: (text: string) => void
}

// D1: reine Extraktion aus WorkflowEditor — „Wiederherstellen" bleibt eine Closure im Editor
// (setzt promptModus+systemPrompt über setE) und wird als Callback durchgereicht.
export default function PromptHistorie({ historie, onWiederherstellen }: Props) {
  return (
    <div className="rounded-md border p-3">
      <p className="mb-2 text-xs font-medium text-muted-foreground">Frühere Prompt-Versionen</p>
      <div className="flex flex-col gap-1">
        {historie.map((v) => (
          <div key={v.id} className="flex items-center justify-between gap-2">
            <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
              {new Date(v.zeitstempelMs).toLocaleString('de-DE')} · {v.text.slice(0, 50)}
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 shrink-0 px-2 text-xs"
              onClick={() => onWiederherstellen(v.text)}
            >
              Wiederherstellen
            </Button>
          </div>
        ))}
      </div>
    </div>
  )
}
