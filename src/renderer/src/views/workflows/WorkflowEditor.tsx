import { useEffect, useRef, useState } from 'react'
import { Trash2, RotateCcw } from 'lucide-react'
import {
  TEMPERATUR_STUFEN,
  werksVerhalten,
  weichtVomWerkAb,
  type WorkflowDefinition
} from '@shared/workflows'
// REINE Logik aus @main (framework-unabhängig, vom Renderer-Build via @main-Alias gebündelt). Bewusste,
// einzige Ausnahme zur Architektur-Lint-Regel (electron.vite.config erlaubt diesen Wert-Import, R2/#10).
// eslint-disable-next-line @typescript-eslint/no-restricted-imports
import { berechneterPrompt, wandleAufStatisch, type RewriteSettings } from '@main/rewrite/prompt-builder'
import { modelleFuerVorlage } from '@shared/providers'
import type { AnbieterKonfig } from '@shared/anbieter'
import { validateChord } from '@shared/validate-chord'
import { SPRACHEN } from '@shared/sprachen'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Field, Separator } from '@/components/ui/field'
import { useBestaetigung } from '@/components/Bestaetigung'
import { useNavGuard } from '@/components/NavGuard'
import { workflowEntwurfGeaendert, assistentSperrtAuswahl } from '@/lib/dirty'
import {
  normalisiereChord,
  istAltGr,
  istVollstaendig,
  istModifierCode
} from '@/lib/hotkey-capture'
import TonEmojiFelder from './TonEmojiFelder'
import PromptAssistent from './PromptAssistent'
import PromptHistorie from './PromptHistorie'
import HotkeyErfassung from './HotkeyErfassung'

export interface EditorProps {
  def: WorkflowDefinition
  hotkey: string[]
  belegung: Partial<Record<string, string[]>>
  anbieter: AnbieterKonfig[]
  standardAnbieterId: string
  rewriteSettings: RewriteSettings
  onSpeichern: (def: WorkflowDefinition, hotkey?: string[]) => Promise<void>
  onLoeschen?: () => void
  /** W1-E: meldet den Busy-Zustand der Prompt-Assistent-Anfrage nach oben (sperrt dort die Bandliste). */
  onAssistentBusyChange?: (busy: boolean) => void
}

export default function WorkflowEditor({
  def,
  hotkey,
  belegung,
  anbieter,
  standardAnbieterId,
  rewriteSettings,
  onSpeichern,
  onLoeschen,
  onAssistentBusyChange
}: EditorProps) {
  const [e, setE] = useState<WorkflowDefinition>(def)
  // Der für diesen Workflow aufgelöste Anbieter (Override → sonst Standard) bestimmt die Modell-Liste.
  const aufgeloesterAnbieter =
    anbieter.find((a) => a.id === e.anbieterId) ??
    anbieter.find((a) => a.id === standardAnbieterId) ??
    anbieter[0]
  const chatModelle = modelleFuerVorlage(aufgeloesterAnbieter?.vorlage ?? '').chat
  const providerChatModell = aufgeloesterAnbieter?.chatModell ?? ''
  const [chord, setChord] = useState<string[]>(hotkey)
  const [faengt, setFaengt] = useState(false)
  // Akkumuliert die SEITEN-GENAUEN Codes (ControlRight …) über die einzelnen keydown-Events einer
  // Aufnahme. Wichtig: nicht getModifierState (seiten-agnostisch) nutzen — der uiohook-Matcher
  // unterscheidet links/rechts, sonst feuert ein neu eingefangener Chord nicht.
  const gedrueckteRef = useRef<Set<string>>(new Set())
  const [beschreibung, setBeschreibung] = useState('')
  const [assistentBusy, setAssistentBusy] = useState(false)
  const [assistentFehler, setAssistentFehler] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const bestaetige = useBestaetigung()
  const { registriereDirty } = useNavGuard()

  // P4: Speichern nur aktiv bei echter Änderung — über BEIDE Entwürfe (Definition UND Hotkey-Chord).
  const geaendert = workflowEntwurfGeaendert(e, def, chord, hotkey)
  // Dirty-Quelle für den globalen Guard (P8): Workflow-Wechsel/Sidebar fragen bei ungespeichertem Stand.
  useEffect(() => registriereDirty('workflow', () => geaendert), [registriereDirty, geaendert])

  // W1-E (P1-Datenverlust): eine laufende Prompt-Assistent-Anfrage zählt ebenfalls als dirty — sonst
  // könnte die App-Sidebar (App.tsx → versucheNavigation) mitten in der Anfrage wegnavigieren und die
  // Antwort ginge verloren. Die Bandliste selbst wird zusätzlich hart gesperrt (siehe WorkflowsView).
  useEffect(
    () => registriereDirty('workflow-assistent', () => assistentSperrtAuswahl(assistentBusy)),
    [registriereDirty, assistentBusy]
  )
  // Busy-Zustand nach oben melden (sperrt dort die Bandliste selbst).
  useEffect(() => {
    onAssistentBusyChange?.(assistentBusy)
    return () => onAssistentBusyChange?.(false)
  }, [assistentBusy, onAssistentBusyChange])

  // P3: Verhalten auf Werkszustand laden (Variante A — Übernahme erst per Speichern). Warn-Dialog davor.
  async function aufWerkZuruecksetzen() {
    const ok = await bestaetige({
      titel: 'Auf Auslieferung zurücksetzen?',
      text: 'Das Verhalten (Umschreiben, Prompt, Modell, Temperatur, Ton, Emoji) wird auf den Werkszustand geladen. Übernahme erst per „Speichern".',
      bestaetigen: 'Zurücksetzen',
      gefahr: true
    })
    if (!ok) return
    const werk = werksVerhalten(e.id)
    if (werk) setE((prev) => ({ ...prev, ...werk }))
  }

  // Beim Bearbeiten des Prompts wird ein eingebauter Workflow auf 'statisch' umgestellt
  // (der dynamische v1-Builder wird durch den festen Text ersetzt — bewusst).
  function setPrompt(text: string) {
    setE({ ...e, systemPrompt: text, promptModus: 'statisch' })
  }

  function starteCapture() {
    gedrueckteRef.current = new Set()
    setChord([])
    setFaengt(true)
  }

  function onKeyDown(ev: React.KeyboardEvent) {
    if (!faengt) return
    ev.preventDefault()
    if (istAltGr(ev)) return // AltGr-Chords ablehnen (tippen Zeichen)
    // Den TATSÄCHLICHEN, seiten-genauen Code (ControlRight/MetaLeft/Digit2 …) akkumulieren.
    gedrueckteRef.current.add(ev.code)
    const neu = normalisiereChord(gedrueckteRef.current)
    setChord(neu)
    // Mit der ersten Nicht-Modifier-Taste ist der Chord komplett → Aufnahme beenden.
    if (istVollstaendig(neu) && !istModifierCode(ev.code)) setFaengt(false)
  }

  const urteil = validateChord(chord, { belegung, ziel: e.id })

  const kannErweitern = e.promptModus === 'statisch' && e.systemPrompt.trim() !== ''

  async function assistent(erweitern: boolean) {
    setAssistentBusy(true)
    setAssistentFehler(null)
    try {
      // „Erweitern" gibt den bestehenden Prompt mit (W-4); „Neu erstellen" beginnt von vorn.
      const bestehend = erweitern && kannErweitern ? e.systemPrompt : ''
      const entwurf = await window.blitztext.workflow.assistEntwurf(beschreibung, bestehend)
      setPrompt(entwurf)
    } catch (err) {
      setAssistentFehler(err instanceof Error ? err.message : String(err))
    }
    setAssistentBusy(false)
  }

  async function speichere() {
    setBusy(true)
    await onSpeichern(e, chord)
    setBusy(false)
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 p-5">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Workflow bearbeiten</h3>
          {def.builtin
            ? weichtVomWerkAb(def) && (
                <Button variant="outline" size="sm" onClick={aufWerkZuruecksetzen}>
                  <RotateCcw /> Auf Auslieferung zurücksetzen
                </Button>
              )
            : onLoeschen && (
                <Button variant="destructive" size="sm" onClick={onLoeschen}>
                  <Trash2 /> Löschen
                </Button>
              )}
        </div>

        <Field label="Name" hint="Anzeigename des Workflows.">
          <Input value={e.label} onChange={(ev) => setE({ ...e, label: ev.target.value })} />
        </Field>

        <Field
          label="Kurzbeschreibung"
          hint="Erscheint in der Übersicht und im Workflow-Band unter dem Namen."
        >
          <Input value={e.summary} onChange={(ev) => setE({ ...e, summary: ev.target.value })} />
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Anbieter" hint="Welcher Anbieter diesen Workflow ausführt.">
            <Select
              value={e.anbieterId ?? ''}
              onChange={(ev) => {
                // Anbieter wechseln: ein für den neuen Anbieter ungültiges (fremdes) Modell auf
                // „Anbieter-Standard" (leer) zurücksetzen → kein leeres Feld / kein Absturz (Fix B).
                const neuId = ev.target.value
                const neuAnb =
                  anbieter.find((a) => a.id === neuId) ??
                  anbieter.find((a) => a.id === standardAnbieterId) ??
                  anbieter[0]
                const chat = neuAnb ? modelleFuerVorlage(neuAnb.vorlage).chat : []
                const modellOk =
                  e.model === '' || chat.length === 0 || chat.some((m) => m.id === e.model)
                setE({ ...e, anbieterId: neuId, model: modellOk ? e.model : '' })
              }}
            >
              <option value="">Erbt Standard</option>
              {anbieter.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Sprache" hint="Leer = erbt die globale Sprache.">
            <Select
              value={e.language ?? ''}
              onChange={(ev) => setE({ ...e, language: ev.target.value })}
            >
              <option value="">Erbt global</option>
              {SPRACHEN.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.anzeigeName}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">Umschreiben</p>
            <p className="text-xs text-muted-foreground">
              Aus: reine Transkription. Ein: das Transkript wird per LLM umgeschrieben.
            </p>
          </div>
          <Switch checked={e.rewrites} onCheckedChange={(v) => setE({ ...e, rewrites: v })} />
        </div>

        {e.rewrites && (
          <>
            <Field
              label="Ausgabesprache"
              hint="Sprache der umgeschriebenen Ausgabe. Leer = wie die Eingabe (keine Übersetzung)."
            >
              <Select
                value={e.ausgabeSprache ?? ''}
                onChange={(ev) => setE({ ...e, ausgabeSprache: ev.target.value })}
              >
                <option value="">Keine Vorgabe (wie Eingabe)</option>
                {SPRACHEN.map((s) => (
                  <option key={s.code} value={s.code}>
                    {s.anzeigeName}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label="System-Prompt"
              hint={
                e.promptModus === 'berechnet'
                  ? 'Eingebaut: dynamisch aus deinen Einstellungen. „Bearbeiten" lädt diesen Text als festen Prompt zum Anpassen.'
                  : 'Fester Prompt-Text. Beschreibe genau, was mit dem Transkript geschehen soll.'
              }
            >
              {/* R2/#10: berechnet → read-only-Anzeige + „Bearbeiten" (Vorbefüllung == Anzeige). */}
              {e.promptModus === 'berechnet' ? (
                <div className="flex flex-col gap-2">
                  <Textarea
                    className="min-h-32"
                    readOnly
                    value={berechneterPrompt(e, rewriteSettings)}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    className="self-start"
                    onClick={() => setE((prev) => wandleAufStatisch(prev, rewriteSettings))}
                  >
                    Bearbeiten
                  </Button>
                </div>
              ) : (
                <Textarea
                  className="min-h-32"
                  value={e.systemPrompt}
                  placeholder="Beschreibe, was mit dem Transkript geschehen soll. Verlange am Ende NUR den fertigen Text."
                  onChange={(ev) => setPrompt(ev.target.value)}
                />
              )}
            </Field>

            {/* R3/#26: Prompt-Historie mit Wiederherstellen (nur bei statischem Prompt mit Versionen). */}
            {e.promptModus === 'statisch' && (e.promptHistorie?.length ?? 0) > 0 && (
              <PromptHistorie
                historie={e.promptHistorie!}
                onWiederherstellen={(text) =>
                  setE((prev) => ({ ...prev, promptModus: 'statisch', systemPrompt: text }))
                }
              />
            )}

            <TonEmojiFelder
              promptModus={e.promptModus}
              tone={e.tone}
              emojiDensity={e.emojiDensity}
              onChange={(patch) => setE({ ...e, ...patch })}
            />

            <PromptAssistent
              beschreibung={beschreibung}
              onBeschreibungChange={setBeschreibung}
              assistentBusy={assistentBusy}
              assistentFehler={assistentFehler}
              kannErweitern={kannErweitern}
              onAssistent={assistent}
            />

            <div className="grid grid-cols-2 gap-4">
              <Field label="Modell" hint={`Leer = Anbieter-Standard (${providerChatModell}).`}>
                {chatModelle.length > 0 ? (
                  <Select
                    value={chatModelle.some((m) => m.id === e.model) ? e.model : ''}
                    onChange={(ev) => setE({ ...e, model: ev.target.value })}
                  >
                    <option value="">Anbieter-Standard ({providerChatModell})</option>
                    {chatModelle.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label}
                        {m.empfohlen ? ' (empfohlen)' : ''}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <Input
                    value={e.model}
                    placeholder={providerChatModell}
                    onChange={(ev) => setE({ ...e, model: ev.target.value })}
                  />
                )}
              </Field>
              <Field label="Temperatur" hint="Niedrig = präzise/konsistent, hoch = kreativer/freier.">
                <Select
                  value={String(e.temperature)}
                  onChange={(ev) => setE({ ...e, temperature: Number(ev.target.value) })}
                >
                  {[...new Set([...TEMPERATUR_STUFEN, e.temperature])]
                    .sort((a, b) => a - b)
                    .map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                </Select>
              </Field>
            </div>
          </>
        )}

        <Separator />

        <HotkeyErfassung
          workflowId={e.id}
          chord={chord}
          faengt={faengt}
          urteil={urteil}
          onKeyDown={onKeyDown}
          onStarteCapture={starteCapture}
          onBlur={() => setFaengt(false)}
          onSetChord={setChord}
        />

        <div className="flex items-center gap-3">
          <Button onClick={speichere} disabled={busy || urteil.hart.length > 0 || !geaendert}>
            {busy ? 'Speichere…' : 'Speichern'}
          </Button>
          {urteil.hart.length > 0 && (
            <span className="text-xs text-destructive">Harter Hotkey-Konflikt — bitte ändern.</span>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
