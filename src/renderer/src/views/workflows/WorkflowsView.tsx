import { useEffect, useState } from 'react'
import { Plus } from 'lucide-react'
import type { BlitztextSettings } from '@main/settings/store'
import {
  NEUER_WORKFLOW_TEMPERATUR,
  historieNachSpeichern,
  type WorkflowDefinition
} from '@shared/workflows'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import ZweiEbenenShell from '@/components/ZweiEbenenShell'
import { useBestaetigung } from '@/components/Bestaetigung'
import { useNavGuard } from '@/components/NavGuard'
import { assistentSperrtAuswahl } from '@/lib/dirty'
import { chordLabel } from '@/lib/hotkey-capture'
import WorkflowEditor from './WorkflowEditor'

interface Props {
  settings: BlitztextSettings
  speichern: (next: BlitztextSettings) => Promise<void>
}

export default function WorkflowsView({ settings, speichern }: Props) {
  const [auswahl, setAuswahl] = useState<string | null>(settings.workflows[0]?.id ?? null)
  // W1-E (P1-Datenverlust): läuft eine Prompt-Assistent-Anfrage, sperrt die Bandliste (Variante a) —
  // ein Auswahl-Wechsel würde WorkflowEditor remounten (key={aktiv.id}) und die Antwort verwerfen.
  const [assistentBusy, setAssistentBusy] = useState(false)
  const bestaetige = useBestaetigung()
  const { versucheNavigation } = useNavGuard()

  // P2: immer ein gültiger Eintrag vorausgewählt (erster); nach Löschen/Listenänderung normalisieren.
  useEffect(() => {
    setAuswahl((prev) =>
      prev && settings.workflows.some((w) => w.id === prev)
        ? prev
        : (settings.workflows[0]?.id ?? null)
    )
  }, [settings.workflows])

  const aktiv = settings.workflows.find((w) => w.id === auswahl) ?? null

  async function neuerWorkflow() {
    const id = `custom-${globalThis.crypto.randomUUID()}`
    const neu: WorkflowDefinition = {
      id,
      label: 'Neuer Workflow',
      summary: '',
      builtin: false,
      rewrites: true,
      promptModus: 'statisch',
      systemPrompt: 'Schreibe das Transkript um. Gib NUR den fertigen Text zurück.',
      model: '',
      temperature: NEUER_WORKFLOW_TEMPERATUR
    }
    await speichern({ ...settings, workflows: [...settings.workflows, neu] })
    setAuswahl(id)
  }

  async function aktualisiereWorkflow(naechste: WorkflowDefinition, hotkey?: string[]) {
    // R3/#26: bei geändertem statischem Prompt eine Version anhängen (Vergleich gegen den GESPEICHERTEN
    // Stand, nicht den Editor-Entwurf). id/Zeitstempel hier injiziert.
    const alt = settings.workflows.find((w) => w.id === naechste.id)
    const mitHistorie = alt
      ? {
          ...naechste,
          promptHistorie: historieNachSpeichern(alt, naechste, {
            id: globalThis.crypto.randomUUID(),
            zeitstempelMs: Date.now(),
            text: naechste.systemPrompt,
            quelle: 'manuell'
          })
        }
      : naechste
    const workflows = settings.workflows.map((w) => (w.id === mitHistorie.id ? mitHistorie : w))
    const hotkeys = hotkey
      ? { ...settings.hotkeys, [mitHistorie.id]: hotkey }
      : settings.hotkeys
    await speichern({ ...settings, workflows, hotkeys })
  }

  async function loesche(id: string) {
    const w = settings.workflows.find((x) => x.id === id)
    const ok = await bestaetige({
      titel: 'Workflow löschen?',
      text: `„${w?.label ?? ''}" wird gelöscht.`,
      bestaetigen: 'Löschen',
      gefahr: true
    })
    if (!ok) return
    const workflows = settings.workflows.filter((w) => w.id !== id)
    const hotkeys = { ...settings.hotkeys }
    delete hotkeys[id]
    await speichern({ ...settings, workflows, hotkeys })
    setAuswahl(null)
  }

  const eintraege = settings.workflows.map((w) => ({
    id: w.id,
    titel: w.label,
    unterzeile: w.summary || (chordLabel(settings.hotkeys[w.id] ?? []) || 'Kein Hotkey'),
    badge: w.builtin ? (
      <Badge variant="secondary">eingebaut</Badge>
    ) : (
      <Badge variant="outline">eigen</Badge>
    )
  }))

  // W1-E: Bandliste bewusst NICHT über den Bestätigungs-Dialog laufen lassen — eine laufende
  // Netzwerk-Anfrage lässt sich nicht "wiederherstellen", ein Verwerfen-Dialog wäre nur Theater. Statt
  // dessen: harte Sperre (kein Wechsel möglich) + sichtbarer Hinweis, konsistent mit anderen
  // busy-Mustern (z. B. Speichern-Button-Text "Speichere…").
  const auswahlGesperrt = assistentSperrtAuswahl(assistentBusy)

  return (
    <ZweiEbenenShell
      eintraege={eintraege}
      aktivId={auswahl}
      onWaehle={(id) => {
        if (auswahlGesperrt) return
        versucheNavigation(() => setAuswahl(id))
      }}
      bandKopf={
        <div className="flex flex-col gap-2">
          <Button size="sm" className="w-full" onClick={neuerWorkflow} disabled={auswahlGesperrt}>
            <Plus /> Neuer Workflow
          </Button>
          {auswahlGesperrt && (
            <p className="text-[11px] leading-tight text-muted-foreground">
              Prompt-Assistent entwirft … Auswahl ist währenddessen gesperrt, damit die Antwort nicht
              verloren geht.
            </p>
          )}
        </div>
      }
      leer="Wähle links einen Workflow, um ihn zu bearbeiten — oder lege einen neuen an."
    >
      {aktiv && (
        <WorkflowEditor
          key={aktiv.id}
          def={aktiv}
          hotkey={settings.hotkeys[aktiv.id] ?? []}
          belegung={andereHotkeys(settings, aktiv.id)}
          anbieter={settings.anbieter}
          standardAnbieterId={settings.standardAnbieterId}
          rewriteSettings={{
            tone: settings.tone,
            emojiDensity: settings.emojiDensity,
            customTerms: settings.customTerms
          }}
          onSpeichern={aktualisiereWorkflow}
          onLoeschen={aktiv.builtin ? undefined : () => loesche(aktiv.id)}
          onAssistentBusyChange={setAssistentBusy}
        />
      )}
    </ZweiEbenenShell>
  )
}

function andereHotkeys(
  settings: BlitztextSettings,
  ziel: string
): Partial<Record<string, string[]>> {
  const o: Partial<Record<string, string[]>> = {}
  for (const [id, chord] of Object.entries(settings.hotkeys)) {
    if (id !== ziel) o[id] = chord
  }
  return o
}
