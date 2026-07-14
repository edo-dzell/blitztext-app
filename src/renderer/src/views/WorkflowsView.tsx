import { useEffect, useRef, useState } from 'react'
import { Plus, Trash2, Wand2, Keyboard, RotateCcw } from 'lucide-react'
import type { BlitztextSettings } from '@main/settings/store'
import {
  NEUER_WORKFLOW_TEMPERATUR,
  TEMPERATUR_STUFEN,
  DEFAULT_HOTKEYS,
  werksVerhalten,
  weichtVomWerkAb,
  historieNachSpeichern,
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
import { Badge } from '@/components/ui/badge'
import { Select } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Field, Separator } from '@/components/ui/field'
import ZweiEbenenShell from '@/components/ZweiEbenenShell'
import { useBestaetigung } from '@/components/Bestaetigung'
import { useNavGuard } from '@/components/NavGuard'
import { workflowEntwurfGeaendert, assistentSperrtAuswahl } from '@/lib/dirty'
import {
  normalisiereChord,
  istAltGr,
  istVollstaendig,
  chordLabel,
  istModifierCode
} from '@/lib/hotkey-capture'

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

interface EditorProps {
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

function WorkflowEditor({
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
              <div className="rounded-md border p-3">
                <p className="mb-2 text-xs font-medium text-muted-foreground">
                  Frühere Prompt-Versionen
                </p>
                <div className="flex flex-col gap-1">
                  {e.promptHistorie!.map((v) => (
                    <div key={v.id} className="flex items-center justify-between gap-2">
                      <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                        {new Date(v.zeitstempelMs).toLocaleString('de-DE')} · {v.text.slice(0, 50)}
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 shrink-0 px-2 text-xs"
                        onClick={() =>
                          setE((prev) => ({ ...prev, promptModus: 'statisch', systemPrompt: v.text }))
                        }
                      >
                        Wiederherstellen
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {e.promptModus === 'berechnet' && (
              <div className="grid grid-cols-2 gap-4">
                <Field label="Ton" hint="Schreibstil beim Umschreiben.">
                  <Select
                    value={e.tone ?? 'neutral'}
                    onChange={(ev) =>
                      setE({ ...e, tone: ev.target.value as WorkflowDefinition['tone'] })
                    }
                  >
                    <option value="formal">Formell</option>
                    <option value="neutral">Neutral</option>
                    <option value="casual">Locker</option>
                  </Select>
                </Field>
                <Field label="Emoji-Dichte" hint="Wie viele Emojis ergänzt werden.">
                  <Select
                    value={e.emojiDensity ?? 'mittel'}
                    onChange={(ev) =>
                      setE({
                        ...e,
                        emojiDensity: ev.target.value as WorkflowDefinition['emojiDensity']
                      })
                    }
                  >
                    <option value="aus">Aus (keine Emojis)</option>
                    <option value="wenig">Wenig</option>
                    <option value="mittel">Mittel</option>
                    <option value="viel">Viel</option>
                  </Select>
                </Field>
              </div>
            )}

            <div className="rounded-md border p-3">
              <p className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <Wand2 className="size-3.5" /> Prompt-Assistent
              </p>
              <div className="flex items-center gap-2">
                <Input
                  placeholder="z. B. „formell auf Englisch zusammenfassen"
                  value={beschreibung}
                  onChange={(ev) => setBeschreibung(ev.target.value)}
                />
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => assistent(false)}
                  disabled={assistentBusy || beschreibung.trim() === ''}
                >
                  {assistentBusy ? 'Entwerfe…' : 'Neu erstellen'}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => assistent(true)}
                  disabled={assistentBusy || beschreibung.trim() === '' || !kannErweitern}
                  title={kannErweitern ? undefined : 'Kein bestehender Prompt zum Erweitern'}
                >
                  Erweitern
                </Button>
              </div>
              {assistentFehler && (
                <p className="mt-2 text-xs text-destructive">{assistentFehler}</p>
              )}
            </div>

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

        <Field
          label="Hotkey"
          hint="Globale Tastenkombination — funktioniert auch in anderen Apps."
          error={urteil.hart[0]?.meldung}
        >
          <div className="flex items-center gap-2">
            <div
              tabIndex={0}
              onKeyDown={onKeyDown}
              onClick={starteCapture}
              onBlur={() => setFaengt(false)}
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
            <Button variant="outline" size="sm" onClick={() => setChord(DEFAULT_HOTKEYS[e.id] ?? [])}>
              Standard
            </Button>
          </div>
        </Field>
        {urteil.weich.map((w, i) => (
          <p key={i} className="-mt-2 text-xs text-warning">
            {w.meldung}
          </p>
        ))}

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
