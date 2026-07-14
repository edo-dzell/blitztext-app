import { useEffect, useState } from 'react'
import { Plus, Upload } from 'lucide-react'
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
import { useHinweis } from '@/components/Hinweis'
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
  const zeige = useHinweis()
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

  // Workflow-Import aus einer Preset-Datei. Vor der Übernahme eine Vorschau (Transparenz-Dialog, kein
  // Vertrauensvorschuss auf fremde Prompts) — erst nach Bestätigung wird tatsächlich gespeichert.
  async function importiereWorkflow() {
    const ergebnis = await window.blitztext.workflow.import()
    if (!ergebnis.ok) {
      if (ergebnis.grund === 'ungueltig') {
        zeige('Keine gültige Blitztext-Preset-Datei.', 'fehler')
      }
      return // 'abgebrochen' → still
    }
    const w = ergebnis.workflow
    const promptAuszug =
      w.systemPrompt.length > 200 ? `${w.systemPrompt.slice(0, 200)}…` : w.systemPrompt
    const ok = await bestaetige({
      titel: `„${w.label}" importieren?`,
      text: `${promptAuszug || '(kein Prompt-Text)'} — Prompt bitte kurz prüfen.`,
      bestaetigen: 'Importieren',
      gefahr: false
    })
    if (!ok) return
    // W3-F1: kein zusätzlicher Erfolgs-Toast hier — speichern() zeigt bereits „Gespeichert."
    // bzw. (A4b) den ehrlichen Aufschub-Hinweis bei laufender Aufnahme; ein zweiter Toast würde
    // Letzteren optisch verdrängen/verschleiern. Das Erfolgssignal ist die automatische Auswahl
    // des neuen Workflows (setAuswahl unten) — die Bandliste springt sichtbar auf den Import.
    await speichern({ ...settings, workflows: [...settings.workflows, w] })
    setAuswahl(w.id)
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
          <div className="flex gap-2">
            <Button
              size="sm"
              className="flex-1"
              onClick={neuerWorkflow}
              disabled={auswahlGesperrt}
            >
              <Plus /> Neuer Workflow
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="flex-1"
              onClick={importiereWorkflow}
              disabled={auswahlGesperrt}
            >
              <Upload /> Importieren…
            </Button>
          </div>
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
