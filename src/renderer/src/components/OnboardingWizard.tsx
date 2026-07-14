import { useEffect, useRef, useState } from 'react'
import type { BlitztextSettings } from '@main/settings/store'
import type { AnbieterKonfig } from '@shared/anbieter'
import { getProvider } from '@shared/providers'
import type { WorkflowPhase } from '@main/workflow/runner'
// REINE Logik aus @main (framework-unabhängig) — gleiche, bewusste Ausnahme wie use-workflow-status.ts.
// eslint-disable-next-line @typescript-eslint/no-restricted-imports
import { pillenStatus } from '@main/window/pill-status'
import {
  initialerZustand,
  naechsterSchritt,
  vorherigerSchritt,
  kannWeiter,
  type WizardZustand
} from '@/lib/onboarding-wizard'
import { geraeteliste } from '@/lib/mikrofon-auswahl'
import { chordLabel } from '@/lib/hotkey-capture'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/ui/field'
import type { HealthErgebnis } from '@main/health'

// Onboarding-Wizard (W2-S8): Fullscreen-Overlay für die Ersteinrichtung. Erscheint einmalig (App.tsx
// zeigt es, solange settings.onboardingAbgeschlossen === false) und führt durch Anbieter-Wahl → API-Key
// bzw. lokalen Server → Mikrofon-Check → Probe-Aufnahme → Abschluss. „Überspringen"/„Einrichtung später
// beenden" (X) sind IMMER sichtbar und schließen den Wizard sofort (onAbschluss), unabhängig vom Schritt
// — kein Schritt erzwingt eine Aktion außer der ersten Anbieter-Wahl (siehe kannWeiter).

const SCHRITT_TITEL: Record<WizardZustand['schritt'], string> = {
  willkommen: 'Willkommen',
  key: 'API-Key',
  mikrofon: 'Mikrofon',
  probe: 'Probe-Aufnahme',
  fertig: 'Fertig'
}
const SCHRITT_REIHENFOLGE: WizardZustand['schritt'][] = [
  'willkommen',
  'key',
  'mikrofon',
  'probe',
  'fertig'
]

// Timeout-Fallback (Probe-Schritt): ohne funktionierenden Key/Server bleibt die Phase auf 'idle' hängen
// (der Runner startet nie in 'aufnehmen') — nach dieser Frist einen Hinweis zeigen statt endlos zu warten.
const PROBE_TIMEOUT_MS = 2500

interface Props {
  settings: BlitztextSettings
  speichern: (next: BlitztextSettings, opts?: { still?: boolean }) => Promise<void>
  onAbschluss: () => void
}

export default function OnboardingWizard({ settings, speichern, onAbschluss }: Props) {
  const [zustand, setZustand] = useState<WizardZustand>(initialerZustand())
  const primaryRef = useRef<HTMLButtonElement>(null)

  // Bestaetigung.tsx-Muster: Autofokus auf die primäre Aktion bei jedem Schrittwechsel + Escape schließt.
  useEffect(() => {
    primaryRef.current?.focus()
  }, [zustand.schritt])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onAbschluss()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onAbschluss])

  const idx = SCHRITT_REIHENFOLGE.indexOf(zustand.schritt)

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background text-foreground">
      <header className="flex shrink-0 items-center justify-between border-b px-8 py-5">
        <div>
          <p className="text-xs text-muted-foreground">
            Schritt {idx + 1}/{SCHRITT_REIHENFOLGE.length}
          </p>
          <h1 className="text-xl font-semibold tracking-tight">{SCHRITT_TITEL[zustand.schritt]}</h1>
        </div>
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={onAbschluss}
            className="cursor-pointer text-sm text-muted-foreground underline-offset-4 hover:underline"
          >
            Überspringen
          </button>
          <button
            type="button"
            onClick={onAbschluss}
            aria-label="Einrichtung später beenden"
            title="Einrichtung später beenden"
            className="cursor-pointer rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            ✕
          </button>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center px-8 py-8">
        {zustand.schritt === 'willkommen' && (
          <WillkommenSchritt zustand={zustand} setZustand={setZustand} primaryRef={primaryRef} />
        )}
        {zustand.schritt === 'key' && (
          <KeySchritt
            zustand={zustand}
            setZustand={setZustand}
            settings={settings}
            speichern={speichern}
            primaryRef={primaryRef}
          />
        )}
        {zustand.schritt === 'mikrofon' && (
          <MikrofonSchritt zustand={zustand} setZustand={setZustand} primaryRef={primaryRef} />
        )}
        {zustand.schritt === 'probe' && (
          <ProbeSchritt zustand={zustand} setZustand={setZustand} primaryRef={primaryRef} />
        )}
        {zustand.schritt === 'fertig' && (
          <FertigSchritt settings={settings} onAbschluss={onAbschluss} primaryRef={primaryRef} />
        )}
      </div>

      {zustand.schritt !== 'fertig' && (
        <footer className="flex shrink-0 items-center justify-between border-t px-8 py-4">
          <Button
            variant="outline"
            onClick={() => setZustand(vorherigerSchritt)}
            disabled={zustand.schritt === 'willkommen'}
          >
            Zurück
          </Button>
          <Button onClick={() => setZustand(naechsterSchritt)} disabled={!kannWeiter(zustand)}>
            Weiter
          </Button>
        </footer>
      )}
    </div>
  )
}

interface SchrittProps {
  zustand: WizardZustand
  setZustand: React.Dispatch<React.SetStateAction<WizardZustand>>
  primaryRef: React.RefObject<HTMLButtonElement | null>
}

function WillkommenSchritt({ zustand, setZustand, primaryRef }: SchrittProps) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Blitztext wandelt gesprochene Sprache in Text um. Wie möchtest du starten?
      </p>
      <div className="grid grid-cols-2 gap-4">
        <button
          type="button"
          ref={zustand.anbieterWahl === null ? primaryRef : undefined}
          onClick={() => setZustand((z) => ({ ...z, anbieterWahl: 'cloud' }))}
          className={`flex flex-col gap-2 rounded-lg border p-5 text-left transition-colors ${
            zustand.anbieterWahl === 'cloud' ? 'border-foreground' : 'hover:bg-accent'
          }`}
        >
          <p className="text-sm font-semibold">Cloud</p>
          <p className="text-xs text-muted-foreground">
            Schnell eingerichtet — ein API-Key eines Anbieters (z. B. OpenAI) genügt.
          </p>
        </button>
        <button
          type="button"
          onClick={() => setZustand((z) => ({ ...z, anbieterWahl: 'lokal' }))}
          className={`flex flex-col gap-2 rounded-lg border p-5 text-left transition-colors ${
            zustand.anbieterWahl === 'lokal' ? 'border-foreground' : 'hover:bg-accent'
          }`}
        >
          <p className="text-sm font-semibold">Lokal</p>
          <p className="text-xs text-muted-foreground">
            Kostenlos, privat — eigener Server nötig (z. B. Speaches auf deinem Rechner).
          </p>
        </button>
      </div>
    </div>
  )
}

function KeySchritt({
  zustand,
  setZustand,
  settings,
  speichern,
  primaryRef
}: SchrittProps & {
  settings: BlitztextSettings
  speichern: (next: BlitztextSettings, opts?: { still?: boolean }) => Promise<void>
}) {
  const [keyInput, setKeyInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [fehler, setFehler] = useState<string | null>(null)
  const [serverErgebnis, setServerErgebnis] = useState<HealthErgebnis | null>(null)
  const [serverBusy, setServerBusy] = useState(false)

  const istLokal = zustand.anbieterWahl === 'lokal'

  // Lokal: Anbieter-Instanz aus der Vorlage anlegen, falls noch keine existiert (Wahl kann jederzeit
  // wieder auf 'lokal' wechseln — nur anlegen, wenn wirklich noch keine 'lokal'-Instanz da ist).
  const lokalerAnbieter = settings.anbieter.find((a) => a.vorlage === 'lokal')

  async function legeLokalenAnbieterAn(): Promise<AnbieterKonfig | undefined> {
    if (lokalerAnbieter) return lokalerAnbieter
    const d = getProvider('lokal')
    if (!d) return undefined
    const neu: AnbieterKonfig = {
      id: globalThis.crypto.randomUUID(),
      vorlage: d.id,
      label: d.label,
      baseUrl: d.baseUrl,
      asrModell: d.asrModelle[0]?.id ?? '',
      chatModell: d.chatModelle[0]?.id ?? '',
      keinKeyNoetig: true
    }
    await speichern({ ...settings, anbieter: [...settings.anbieter, neu] }, { still: true })
    return neu
  }

  async function pruefeServer() {
    setServerBusy(true)
    const anbieter = await legeLokalenAnbieterAn()
    if (anbieter) setServerErgebnis(await window.blitztext.anbieter.pruefeErreichbarkeit(anbieter.id))
    setServerBusy(false)
  }

  const standardAnbieterId = settings.standardAnbieterId

  async function speichereUndTeste() {
    setBusy(true)
    setFehler(null)
    const anbieter =
      settings.anbieter.find((a) => a.id === standardAnbieterId) ?? settings.anbieter[0]
    if (!anbieter) {
      setFehler('Kein Anbieter konfiguriert.')
      setBusy(false)
      return
    }
    const v = await window.blitztext.apiKey.save(anbieter.id, keyInput.trim(), anbieter.baseUrl)
    if (v.status === 'valid') {
      setKeyInput('')
      setZustand((z) => ({ ...z, keyGetestet: true }))
    } else {
      setFehler(v.status === 'network-error' ? `Netzwerkfehler: ${v.message}` : 'Key ungültig.')
    }
    setBusy(false)
  }

  const ampelFarbe = (s: HealthErgebnis['status']) =>
    s === 'ok' ? 'bg-emerald-500' : s === 'warnung' ? 'bg-amber-500' : 'bg-red-500'

  if (istLokal) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          Lege dazu einen lokalen Server (z. B. Speaches) auf deinem Rechner an und starte ihn. Blitztext
          nutzt die Vorlage „Lokal" — kein API-Key nötig.
        </p>
        <Card>
          <CardContent className="flex flex-col gap-3 p-5">
            <Field
              label="Server-Adresse"
              hint='Wird beim Wechsel auf „Lokal" automatisch angelegt; in den Einstellungen editierbar.'
            >
              <Input value={lokalerAnbieter?.baseUrl ?? getProvider('lokal')?.baseUrl ?? ''} readOnly />
            </Field>
            <div className="flex items-center gap-2">
              <Button ref={primaryRef} size="sm" variant="secondary" onClick={pruefeServer} disabled={serverBusy}>
                {serverBusy ? 'Prüfe…' : 'Server prüfen'}
              </Button>
              {serverErgebnis && (
                <span className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className={`size-2.5 shrink-0 rounded-full ${ampelFarbe(serverErgebnis.status)}`} />
                  {serverErgebnis.detail}
                </span>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Trage den API-Key deines Standard-Anbieters ein — er wird verschlüsselt im Benutzerprofil
        gespeichert (DPAPI) und sofort getestet.
      </p>
      <Card>
        <CardContent className="flex flex-col gap-3 p-5">
          <Field label="API-Key">
            <div className="flex items-center gap-2">
              <Input
                type="password"
                placeholder="sk-…"
                value={keyInput}
                onChange={(e) => {
                  setKeyInput(e.target.value)
                  setFehler(null)
                }}
                disabled={busy}
              />
              <Button
                ref={primaryRef}
                size="sm"
                onClick={speichereUndTeste}
                disabled={busy || keyInput.trim() === ''}
              >
                {busy ? 'Teste…' : 'Key speichern & testen'}
              </Button>
            </div>
          </Field>
          {fehler && <p className="text-xs text-destructive">{fehler}</p>}
          {zustand.keyGetestet && <p className="text-xs text-emerald-500">Key getestet und gespeichert.</p>}
        </CardContent>
      </Card>
    </div>
  )
}

function MikrofonSchritt({ setZustand, primaryRef }: SchrittProps) {
  const [anzahl, setAnzahl] = useState<number | null>(null)
  const [ergebnis, setErgebnis] = useState<HealthErgebnis | null>(null)
  const [busy, setBusy] = useState(false)

  async function pruefe() {
    setBusy(true)
    let mikrofonAnzahl = 0
    try {
      const alle = await navigator.mediaDevices.enumerateDevices()
      mikrofonAnzahl = geraeteliste(alle).length
    } catch {
      mikrofonAnzahl = 0
    }
    setAnzahl(mikrofonAnzahl)
    const diagnose = await window.blitztext.health.diagnose(mikrofonAnzahl)
    // Titel „Mikrofon" (pruefe-mikrofon.ts) — nur diesen einen Check aus der Diagnose zeigen.
    const mikrofonCheck = diagnose.checks.find((c) => c.titel === 'Mikrofon') ?? null
    setErgebnis(mikrofonCheck)
    setZustand((z) => ({ ...z, mikroGeprueft: mikrofonCheck?.status === 'ok' }))
    setBusy(false)
  }

  const ampelFarbe = (s: HealthErgebnis['status']) =>
    s === 'ok' ? 'bg-emerald-500' : s === 'warnung' ? 'bg-amber-500' : 'bg-red-500'

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Blitztext braucht ein Mikrofon zum Diktieren. Prüfe, ob eins gefunden wird.
      </p>
      <Card>
        <CardContent className="flex flex-col gap-3 p-5">
          <Button ref={primaryRef} size="sm" variant="secondary" onClick={pruefe} disabled={busy}>
            {busy ? 'Prüfe…' : 'Mikrofon prüfen'}
          </Button>
          {ergebnis && (
            <span className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className={`size-2.5 shrink-0 rounded-full ${ampelFarbe(ergebnis.status)}`} />
              {ergebnis.detail}
            </span>
          )}
          {anzahl !== null && (
            <p className="text-xs text-muted-foreground">
              {anzahl === 1 ? 'Ein Mikrofon gefunden.' : `${anzahl} Mikrofone gefunden.`}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function ProbeSchritt({ zustand, setZustand, primaryRef }: SchrittProps) {
  const [phase, setPhase] = useState<WorkflowPhase>({ status: 'idle' })
  const [laeuft, setLaeuft] = useState(false)
  const [timeoutHinweis, setTimeoutHinweis] = useState(false)

  // Listener-Lifecycle-Fix (Review R1+R2, Befund A): die Abmelden-Funktion lebt in einem Ref (nicht in
  // einer Closure-Variable), damit sie von drei Stellen aus erreichbar ist — Terminal-Callback, erneuter
  // starte()-Aufruf (Retry) und Unmount-Cleanup. Ohne das leckt der Listener bei „Zurück“/Schließen
  // während einer laufenden Probe: die Eltern-Komponente (OnboardingWizard) bleibt zwar unmounted, aber
  // der pro-Aufruf registrierte Callback würde sonst NIE abgemeldet und bei einem Retry stapeln sich
  // mehrere Listener übereinander.
  const abmeldenRef = useRef<(() => void) | null>(null)
  // Kontaminations-Schutz: Der IPC-Listener ist global (workflowStatus.onChanged meldet JEDEN
  // Workflow-Lauf, nicht nur den der Probe). Ohne dieses Flag würde ein ECHTER Diktat-Lauf, der zufällig
  // läuft/nachläuft während die Probe längst beendet ist (aber der Listener aus irgendeinem Grund noch
  // aktiv wäre), den probeErgebnis-State der (weiterhin gemounteten) Eltern-Komponente kontaminieren.
  // probeAktiv wird bei starte() gesetzt und bei Terminal-Phase/Stop/Unmount zurückgesetzt; der Callback
  // ignoriert Phasen-Updates, wenn probeAktiv bereits false ist.
  const probeAktivRef = useRef(false)

  function meldeAb(): void {
    abmeldenRef.current?.()
    abmeldenRef.current = null
    probeAktivRef.current = false
  }

  // Unmount-Cleanup: greift IMMER, unabhängig davon, ob die Probe terminal beendet wurde (z. B. „Zurück“
  // oder Wizard-Schließen mitten in der Aufnahme/Transkription).
  useEffect(() => {
    return () => meldeAb()
  }, [])

  async function starte() {
    // Falls starte() erneut aufgerufen wird (Retry) während noch ein alter Listener registriert ist:
    // erst den alten abmelden, bevor ein neuer registriert wird — sonst Stapelung.
    meldeAb()
    setTimeoutHinweis(false)
    setLaeuft(true)
    probeAktivRef.current = true
    // ZUERST den Listener registrieren, DANN erst auslösen — sonst könnte eine sehr schnelle erste
    // Phase (aufnehmen) am Listener vorbeilaufen (Race zwischen IPC-Antwort und Subscribe).
    abmeldenRef.current = window.blitztext.workflowStatus.onChanged((p) => {
      if (!probeAktivRef.current) return // Kontaminations-Schutz, s. o.
      setPhase(p)
      if (p.status === 'aufnehmen') setTimeoutHinweis(false)
      if (p.status === 'fertig' || p.status === 'teilErfolg' || p.status === 'fehler') {
        setLaeuft(false)
        setZustand((z) => ({
          ...z,
          probeErgebnis: p.status === 'fertig' ? p.text : z.probeErgebnis
        }))
        meldeAb()
      }
    })
    const timer = setTimeout(() => setTimeoutHinweis(true), PROBE_TIMEOUT_MS)
    await window.blitztext.sitzung.starteManuell('transcribe')
    clearTimeout(timer)
  }

  async function stoppe() {
    await window.blitztext.sitzung.stoppeManuell()
  }

  async function erneut() {
    setZustand((z) => ({ ...z, probeErgebnis: null }))
    setPhase({ status: 'idle' })
    await starte()
  }

  const label = pillenStatus(phase).label

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Probiere eine kurze Aufnahme aus — sprich einen Satz, dann drücke „Aufnahme stoppen".
      </p>
      <Card>
        <CardContent className="flex flex-col gap-3 p-5">
          {phase.status === 'idle' && !zustand.probeErgebnis && (
            <Button ref={primaryRef} onClick={starte} disabled={laeuft}>
              Aufnahme starten
            </Button>
          )}
          {phase.status === 'aufnehmen' && (
            <div className="flex flex-col gap-2">
              <p className="text-sm">Sprich jetzt… (Stopp über den Button unten, nicht automatisch)</p>
              <Button variant="destructive" onClick={stoppe}>
                Aufnahme stoppen
              </Button>
            </div>
          )}
          {(phase.status === 'transkribieren' || phase.status === 'umschreiben') && (
            <p className="text-sm text-muted-foreground">{label}</p>
          )}
          {phase.status === 'fertig' && (
            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium text-emerald-500">Das hat geklappt.</p>
              <p className="rounded-md border bg-muted/30 p-3 text-sm">{phase.text}</p>
            </div>
          )}
          {(phase.status === 'teilErfolg' || phase.status === 'fehler') && (
            <div className="flex flex-col gap-2">
              <p className="text-sm text-destructive">
                {phase.status === 'fehler' ? phase.message : phase.warnung}
              </p>
              <Button size="sm" variant="secondary" onClick={erneut}>
                Erneut
              </Button>
            </div>
          )}
          {timeoutHinweis && phase.status === 'idle' && (
            <p className="text-xs text-amber-500">
              Kein API-Key? Zurück zu Schritt 2.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function FertigSchritt({
  settings,
  onAbschluss,
  primaryRef
}: {
  settings: BlitztextSettings
  onAbschluss: () => void
  primaryRef: React.RefObject<HTMLButtonElement | null>
}) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">Blitztext ist startklar. Deine aktiven Hotkeys:</p>
      <Card>
        <CardContent className="flex flex-col gap-2 p-5">
          {settings.workflows.map((w) => {
            const chord = settings.hotkeys[w.id] ?? []
            return (
              <div key={w.id} className="flex items-start justify-between gap-3 text-sm">
                <span>{w.label}</span>
                <span className="shrink-0 font-mono text-xs text-muted-foreground">
                  {chord.length > 0 ? chordLabel(chord) : '—'}
                </span>
              </div>
            )
          })}
        </CardContent>
      </Card>
      <Button ref={primaryRef} onClick={onAbschluss}>
        Los geht's
      </Button>
    </div>
  )
}
