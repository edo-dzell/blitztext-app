import { useEffect, useState } from 'react'
import { Trash2, Plus } from 'lucide-react'
import type { BlitztextSettings } from '@main/settings/store'
import type { AnbieterKonfig } from '@shared/anbieter'
import { PROVIDER, getProvider, modelleFuerVorlage } from '@shared/providers'
import { SPRACHEN } from '@shared/sprachen'
import { geraeteliste, aufgeloesteGeraetewahl, type MikrofonGeraet } from '@/lib/mikrofon-auswahl'
import { istSichereAnbieterUrl } from '@/lib/anbieter-url-guard'
import type { DiagnoseErgebnis } from '@main/health'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Field, Separator } from '@/components/ui/field'
import ZweiEbenenShell from '@/components/ZweiEbenenShell'
import { useBestaetigung } from '@/components/Bestaetigung'
import { useHinweis } from '@/components/Hinweis'
import { useNavGuard } from '@/components/NavGuard'
import { einstellungenGeaendert, apiKeyEntwurfGeaendert } from '@/lib/dirty'

// Einstellungen (P8): Zwei-Ebenen-Ansicht. Band = Anbieter (vorausgewählt) / Transkription & Umschreiben
// / Datenschutz / Darstellung. Speicher-Modell A: EIN globaler Entwurf, EIN fest sichtbarer (dirty-
// aware) Speichern-Button im Band-Kopf. Erfolg/Fehler über Toast (App.speichern). API-Keys werden je
// Anbieter weiterhin sofort/separat gespeichert. apiKeyStatus ist Main-only → NICHT Teil des Entwurfs.

interface Props {
  settings: BlitztextSettings
  speichern: (next: BlitztextSettings) => Promise<void>
}

type Abschnitt = 'anbieter' | 'transkription' | 'datenschutz' | 'darstellung' | 'system'

export default function EinstellungenView({ settings, speichern }: Props) {
  const [entwurf, setEntwurf] = useState<BlitztextSettings>(settings)
  const [busy, setBusy] = useState(false)
  const [vorlage, setVorlage] = useState('openai')
  const [auswahl, setAuswahl] = useState<Abschnitt>('anbieter')
  const bestaetige = useBestaetigung()
  const { registriereDirty } = useNavGuard()

  // P8: ein überlebender Entwurf; dirty-aware (apiKeyStatus ausgenommen). Beim Sidebar-Verlassen
  // schützt der globale Guard; Band-interne Wechsel sind sicher (Entwurf bleibt erhalten).
  const geaendert = einstellungenGeaendert(entwurf, settings)
  useEffect(() => registriereDirty('settings', () => geaendert), [registriereDirty, geaendert])

  function setAnbieter(id: string, patch: Partial<AnbieterKonfig>) {
    setEntwurf((e) => ({
      ...e,
      anbieter: e.anbieter.map((a) => (a.id === id ? { ...a, ...patch } : a))
    }))
  }

  function fuegeAnbieterHinzu() {
    const d = getProvider(vorlage)
    if (!d) return
    const neu: AnbieterKonfig = {
      id: globalThis.crypto.randomUUID(),
      vorlage: d.id,
      label: d.label,
      baseUrl: d.baseUrl,
      asrModell: d.asrModelle.find((m) => m.empfohlen)?.id ?? d.asrModelle[0]?.id ?? '',
      chatModell: d.chatModelle.find((m) => m.empfohlen)?.id ?? d.chatModelle[0]?.id ?? ''
    }
    setEntwurf((e) => ({ ...e, anbieter: [...e.anbieter, neu] }))
  }

  async function entferneAnbieter(id: string) {
    const a = entwurf.anbieter.find((x) => x.id === id)
    const ok = await bestaetige({
      titel: 'Anbieter entfernen?',
      text: `„${a?.label ?? ''}" und sein gespeicherter API-Key werden entfernt.`,
      bestaetigen: 'Entfernen',
      gefahr: true
    })
    if (!ok) return
    await window.blitztext.apiKey.clear(id) // Key dieses Anbieters räumen (Vault + apiKeyStatus, Main)
    setEntwurf((e) => {
      const rest = e.anbieter.filter((a) => a.id !== id)
      const standard = e.standardAnbieterId === id ? (rest[0]?.id ?? '') : e.standardAnbieterId
      return { ...e, anbieter: rest, standardAnbieterId: standard }
    })
  }

  async function speichereAlles() {
    setBusy(true)
    await speichern(entwurf) // Erfolg/Fehler-Toast über den gemeinsamen App.speichern-Pfad
    setBusy(false)
  }

  const eintraege = [
    { id: 'anbieter', titel: 'Anbieter' },
    { id: 'transkription', titel: 'Transkription & Umschreiben' },
    { id: 'datenschutz', titel: 'Datenschutz' },
    { id: 'darstellung', titel: 'Darstellung' },
    { id: 'system', titel: 'System & Diagnose' }
  ]

  return (
    <ZweiEbenenShell
      eintraege={eintraege}
      aktivId={auswahl}
      onWaehle={(id) => setAuswahl(id as Abschnitt)}
      bandKopf={
        <div className="flex flex-col gap-2">
          <Button className="w-full" onClick={speichereAlles} disabled={busy || !geaendert}>
            {busy ? 'Speichere…' : 'Einstellungen speichern'}
          </Button>
          <p className="text-[11px] leading-tight text-muted-foreground">
            API-Keys werden je Anbieter sofort gespeichert (separat von „Speichern").
          </p>
        </div>
      }
    >
      {auswahl === 'anbieter' && (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            OpenAI-kompatible Anbieter für Transkription und Umschreiben. Pro Workflow lässt sich ein
            Anbieter zuordnen; ohne Zuordnung gilt der Standard.
          </p>
          {entwurf.anbieter.map((a) => (
            <AnbieterKarte
              key={a.id}
              anbieter={a}
              istStandard={a.id === entwurf.standardAnbieterId}
              standardWaehlen={() => setEntwurf((e) => ({ ...e, standardAnbieterId: a.id }))}
              aendere={(patch) => setAnbieter(a.id, patch)}
              entferne={entwurf.anbieter.length > 1 ? () => entferneAnbieter(a.id) : undefined}
            />
          ))}
          <div className="flex items-center gap-2">
            <Select value={vorlage} onChange={(e) => setVorlage(e.target.value)}>
              {PROVIDER.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </Select>
            <Button size="sm" variant="secondary" onClick={fuegeAnbieterHinzu}>
              <Plus /> Hinzufügen
            </Button>
          </div>
        </div>
      )}

      {auswahl === 'transkription' && (
        <div className="flex flex-col gap-4">
          <Field
            label="Sprache"
            hint="Sprache, in der du diktierst — verbessert die Transkription. Pro Workflow überschreibbar."
          >
            <Select
              value={entwurf.language}
              onChange={(e) => setEntwurf({ ...entwurf, language: e.target.value })}
            >
              <option value="">Automatisch erkennen</option>
              {SPRACHEN.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.anzeigeName}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Eigene Begriffe"
            hint="Eigennamen/Fachbegriffe, durch Komma getrennt — verbessert Transkription und Umschreiben."
          >
            <Input
              value={entwurf.customTerms.join(', ')}
              placeholder="z. B. Produktname, Eigenname, Fachbegriff"
              onChange={(e) =>
                setEntwurf({
                  ...entwurf,
                  customTerms: e.target.value
                    .split(',')
                    .map((t) => t.trim())
                    .filter((t) => t !== '')
                })
              }
            />
          </Field>
          <Field
            label="Aufnahmemodus"
            hint="Halten: Hotkey gedrückt halten = aufnehmen, loslassen = stopp (Push-to-Talk). Drücken: einmal drücken startet, nochmal oder Escape stoppt."
          >
            <Select
              value={entwurf.aufnahmemodus}
              onChange={(e) =>
                setEntwurf({
                  ...entwurf,
                  aufnahmemodus: e.target.value as BlitztextSettings['aufnahmemodus']
                })
              }
            >
              <option value="hold">Halten</option>
              <option value="toggle">Drücken</option>
            </Select>
          </Field>
          <MikrofonFeld
            gewaehlt={entwurf.mikrofonDeviceId}
            aendere={(id) => setEntwurf({ ...entwurf, mikrofonDeviceId: id })}
          />
        </div>
      )}

      {auswahl === 'datenschutz' && (
        <Card>
          <CardContent className="flex items-center justify-between gap-4 p-5">
            <div>
              <p className="text-sm font-medium">Verlauf-Sperre</p>
              <p className="text-xs text-muted-foreground">
                Erzwingt den Verlauf AUS, egal was unter „Verlauf" eingestellt ist. Audio und Text werden
                weiterhin an den Anbieter gesendet.
              </p>
            </div>
            <Switch
              checked={entwurf.verlaufGesperrt}
              onCheckedChange={(v) => setEntwurf({ ...entwurf, verlaufGesperrt: v })}
            />
          </CardContent>
        </Card>
      )}

      {auswahl === 'darstellung' && (
        <Field label="Farbschema" hint="Folgt dem System, oder fest hell/dunkel.">
          <Select
            value={entwurf.theme}
            onChange={(e) =>
              setEntwurf({ ...entwurf, theme: e.target.value as BlitztextSettings['theme'] })
            }
          >
            <option value="system">System</option>
            <option value="hell">Hell</option>
            <option value="dunkel">Dunkel</option>
          </Select>
        </Field>
      )}

      {auswahl === 'system' && (
        <div className="flex flex-col gap-4">
          <AutostartKarte
            an={entwurf.autostart}
            aendere={(v) => setEntwurf({ ...entwurf, autostart: v })}
          />
          <UpdateKarte
            an={entwurf.updateHinweisAktiv}
            aendere={(v) => setEntwurf({ ...entwurf, updateHinweisAktiv: v })}
          />
          <DiagnoseKarte />
        </div>
      )}
    </ZweiEbenenShell>
  )
}

// W3-ζ: Mikrofon-Auswahl. Speist sich aus enumerateDevices() (Renderer-API) + geraeteliste() (reine
// Filter-Logik). „Automatisch (Standard)" = leere deviceId (OS-Standardgerät, rückwärtskompatibel).
// Labels sind leer, solange keine Mikrofon-Berechtigung erteilt wurde — dann greift der Fallback-Text.
// Reale Geräte-Enumeration ist HITL-only (Windows/Berechtigung); headless liefert enumerateDevices [].
function MikrofonFeld({
  gewaehlt,
  aendere
}: {
  gewaehlt: string
  aendere: (id: string) => void
}) {
  const [geraete, setGeraete] = useState<MikrofonGeraet[]>([])

  useEffect(() => {
    let abgemeldet = false
    async function lade() {
      try {
        const alle = await navigator.mediaDevices.enumerateDevices()
        if (!abgemeldet) setGeraete(geraeteliste(alle))
      } catch {
        if (!abgemeldet) setGeraete([]) // keine Berechtigung/kein Zugriff → nur „Automatisch"
      }
    }
    void lade()
    return () => {
      abgemeldet = true
    }
  }, [])

  // Fallback-Auflösung: eine gespeicherte, aber nicht (mehr) vorhandene deviceId zeigt „Automatisch".
  const aktiv = aufgeloesteGeraetewahl(gewaehlt || undefined, geraete.map((g) => g.id)) ?? ''

  return (
    <Field
      label="Mikrofon"
      hint='Aufnahmegerät für das Diktieren. „Automatisch" nutzt das Windows-Standardgerät. Gerätenamen erscheinen erst nach erteilter Mikrofon-Berechtigung.'
    >
      <Select value={aktiv} onChange={(e) => aendere(e.target.value)}>
        <option value="">Automatisch (Standard)</option>
        {geraete.map((g, i) => (
          <option key={g.id || i} value={g.id}>
            {g.label || `Mikrofon ${i + 1}`}
          </option>
        ))}
      </Select>
    </Field>
  )
}

// W3-γ: Autostart-Schalter mit dem EHRLICHEN Hinweis (portable .exe: Eintrag zeigt auf den .exe-Pfad
// zum Einschalt-Zeitpunkt; Verschieben/Umbenennen macht ihn wirkungslos). Zeigt zusätzlich den echten
// Registry-Status (aktiv/verwaist), sobald er geladen ist.
function AutostartKarte({ an, aendere }: { an: boolean; aendere: (v: boolean) => void }) {
  const [statusText, setStatusText] = useState<string | null>(null)

  useEffect(() => {
    let abgemeldet = false
    void window.blitztext.autostart.status().then((s) => {
      if (abgemeldet) return
      if (s.zustand === 'verwaist') {
        setStatusText('Der hinterlegte Eintrag zeigt auf eine andere/verschobene .exe — bitte neu einschalten.')
      } else {
        setStatusText(null)
      }
    })
    return () => {
      abgemeldet = true
    }
  }, [an])

  return (
    <Card>
      <CardContent className="flex flex-col gap-2 p-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium">Mit Windows starten</p>
            <p className="text-xs text-muted-foreground">
              Startet Blitztext automatisch bei der Anmeldung. Hinweis: bricht, wenn die .exe verschoben
              oder umbenannt wird (portable App ohne Installer) — dann bitte hier neu einschalten.
            </p>
          </div>
          <Switch checked={an} onCheckedChange={aendere} />
        </div>
        {statusText && <p className="text-xs text-amber-600 dark:text-amber-500">{statusText}</p>}
      </CardContent>
    </Card>
  )
}

// W3-δ: Opt-in Update-Hinweis. Default AUS (kein Netzabruf ohne Zustimmung). Bei „an" wird beim
// nächsten Start (und hier auf Wunsch) die GitHub-Releases-API des öffentlichen Forks abgefragt —
// anonym, kein Auto-Download. Zeigt einen dezenten Hinweis mit Link, wenn eine neuere Version vorliegt.
function UpdateKarte({ an, aendere }: { an: boolean; aendere: (v: boolean) => void }) {
  const [ergebnis, setErgebnis] = useState<{ neuVerfuegbar: boolean; url: string; aktuelleVersion: string } | null>(
    null
  )

  useEffect(() => {
    if (!an) {
      setErgebnis(null)
      return
    }
    let abgemeldet = false
    void window.blitztext.update.pruefe().then((r) => {
      if (!abgemeldet) setErgebnis(r)
    })
    return () => {
      abgemeldet = true
    }
  }, [an])

  return (
    <Card>
      <CardContent className="flex flex-col gap-2 p-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium">Nach Updates suchen</p>
            <p className="text-xs text-muted-foreground">
              Fragt beim Start anonym die Releases-Seite ab (kein Auto-Download, keine Telemetrie).
              Standardmäßig aus.
            </p>
          </div>
          <Switch checked={an} onCheckedChange={aendere} />
        </div>
        {an && ergebnis?.neuVerfuegbar && ergebnis.url && (
          <p className="text-xs">
            Neue Version verfügbar —{' '}
            <a href={ergebnis.url} target="_blank" rel="noreferrer" className="underline">
              Release ansehen
            </a>
          </p>
        )}
        {an && ergebnis && !ergebnis.neuVerfuegbar && (
          <p className="text-xs text-muted-foreground">Aktuell auf dem neuesten Stand.</p>
        )}
      </CardContent>
    </Card>
  )
}

// W3-ε: Selbstdiagnose-Ampel. Ruft health.diagnose mit der im Renderer ermittelten Mikrofon-Anzahl
// (enumerateDevices) auf und zeigt je Check + Gesamt eine Ampel (ok/warnung/fehler). „Erneut prüfen"
// löst eine frische Diagnose aus. Reale Werte (Erreichbarkeit/Mikrofon/Hotkey) sind HITL-only (Windows).
function DiagnoseKarte() {
  const [ergebnis, setErgebnis] = useState<DiagnoseErgebnis | null>(null)
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
    setErgebnis(await window.blitztext.health.diagnose(mikrofonAnzahl))
    setBusy(false)
  }

  const farbe = (s: 'ok' | 'warnung' | 'fehler') =>
    s === 'ok'
      ? 'bg-emerald-500'
      : s === 'warnung'
        ? 'bg-amber-500'
        : 'bg-red-500'

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-5">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            {ergebnis && <span className={`size-3 rounded-full ${farbe(ergebnis.gesamtstatus)}`} />}
            <p className="text-sm font-medium">Selbstdiagnose</p>
          </div>
          <Button size="sm" variant="secondary" onClick={pruefe} disabled={busy}>
            {busy ? 'Prüfe…' : 'Erneut prüfen'}
          </Button>
        </div>
        {ergebnis ? (
          <ul className="flex flex-col gap-2">
            {ergebnis.checks.map((c) => (
              <li key={c.titel} className="flex items-start gap-2">
                <span className={`mt-1 size-2.5 shrink-0 rounded-full ${farbe(c.status)}`} />
                <div>
                  <p className="text-sm">{c.titel}</p>
                  <p className="text-xs text-muted-foreground">{c.detail}</p>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">
            Prüft API-Key, Anbieter-Erreichbarkeit, Mikrofon und Hotkey-Erkennung.
          </p>
        )}
      </CardContent>
    </Card>
  )
}

interface KarteProps {
  anbieter: AnbieterKonfig
  istStandard: boolean
  standardWaehlen: () => void
  aendere: (patch: Partial<AnbieterKonfig>) => void
  entferne?: () => void
}

function AnbieterKarte({ anbieter, istStandard, standardWaehlen, aendere, entferne }: KarteProps) {
  const istCustom = getProvider(anbieter.vorlage)?.anpassbar ?? false
  const { asr, chat } = modelleFuerVorlage(anbieter.vorlage)
  const zeige = useHinweis()

  const [maske, setMaske] = useState<string | null>(null)
  const [keyInput, setKeyInput] = useState('')
  const [keyBusy, setKeyBusy] = useState(false)
  const [keyFehler, setKeyFehler] = useState<string | null>(null)
  const { registriereDirty } = useNavGuard()

  useEffect(() => {
    void window.blitztext.apiKey.maske(anbieter.id).then(setMaske)
  }, [anbieter.id])

  // W1-E (P1-Datenverlust): ein getippter, nicht gespeicherter API-Key zählt als dirty — sonst geht er
  // beim Wegnavigieren stumm verloren (Keys werden separat/sofort gespeichert, nicht über den
  // Settings-Entwurf, daher eigene Guard-Quelle je Anbieter-Karte).
  const keyGeaendert = apiKeyEntwurfGeaendert(keyInput)
  useEffect(
    () => registriereDirty(`api-key:${anbieter.id}`, () => keyGeaendert),
    [registriereDirty, anbieter.id, keyGeaendert]
  )

  async function speichereKey() {
    // S21-Rest (URL-Guard): bei Custom-Anbietern mit unsicherer Base-URL (weder https noch
    // localhost/127.0.0.1/::1) den Key NICHT senden — sonst ginge er im Klartext übers Netz.
    if (istCustom && !istSichereAnbieterUrl(anbieter.baseUrl)) {
      setKeyFehler('Unsichere Base-URL — bitte erst https:// (oder localhost) eintragen.')
      return
    }
    setKeyBusy(true)
    setKeyFehler(null)
    const v = await window.blitztext.apiKey.save(anbieter.id, keyInput.trim(), anbieter.baseUrl)
    if (v.status === 'valid') {
      setKeyInput('')
      setMaske(await window.blitztext.apiKey.maske(anbieter.id))
      zeige('Key getestet und gespeichert.', 'erfolg') // P6: Erfolg als Toast
    } else {
      // P6: Validierungsfehler bleibt INLINE am Feld (laufender Zustand, kein Ereignis).
      setKeyFehler(v.status === 'network-error' ? `Netzwerkfehler: ${v.message}` : 'Key ungültig.')
    }
    setKeyBusy(false)
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border p-4">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={standardWaehlen}
          className="flex items-center gap-2 text-sm font-medium"
        >
          <span
            className={`flex size-4 items-center justify-center rounded-full border ${
              istStandard ? 'border-foreground' : 'border-muted-foreground'
            }`}
          >
            {istStandard && <span className="size-2 rounded-full bg-foreground" />}
          </span>
          {anbieter.label}
        </button>
        <div className="flex items-center gap-2">
          {istStandard && <Badge variant="outline">Standard</Badge>}
          {entferne && (
            <Button variant="ghost" size="sm" className="h-7 px-2 text-destructive" onClick={entferne}>
              <Trash2 />
            </Button>
          )}
        </div>
      </div>

      <Field label="Anzeigename" hint="Frei wählbarer Name dieses Anbieters in der Liste.">
        <Input value={anbieter.label} onChange={(e) => aendere({ label: e.target.value })} />
      </Field>

      {istCustom && (
        <Field label="Base-URL" hint="OpenAI-kompatibel, ohne Schrägstrich am Ende (…/v1).">
          <Input
            value={anbieter.baseUrl}
            placeholder="https://…/v1"
            onChange={(e) => aendere({ baseUrl: e.target.value })}
          />
          {/* S21-Rest (Klartext-Warnung): dezenter Hinweis bei unsicherer Base-URL (weder https
              noch localhost/127.0.0.1/::1) — API-Key ginge sonst im Klartext übers Netz. Blockiert
              nichts hart (leeres Feld/Tippen in Ruhe möglich), warnt nur inline. */}
          {anbieter.baseUrl.trim() !== '' && !istSichereAnbieterUrl(anbieter.baseUrl) && (
            <p className="text-xs text-destructive">
              Unsichere URL — bitte https:// verwenden (http:// nur für localhost/127.0.0.1).
            </p>
          )}
        </Field>
      )}

      <div className="grid grid-cols-2 gap-4">
        <Field label="ASR-Modell" hint="Modell für die Transkription (Sprache → Text).">
          {asr.length > 0 ? (
            <Select value={anbieter.asrModell} onChange={(e) => aendere({ asrModell: e.target.value })}>
              {asr.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                  {m.empfohlen ? ' (empfohlen)' : ''}
                </option>
              ))}
            </Select>
          ) : (
            <Input value={anbieter.asrModell} onChange={(e) => aendere({ asrModell: e.target.value })} />
          )}
        </Field>
        <Field label="Chat-Modell" hint="Modell für das Umschreiben des Transkripts.">
          {chat.length > 0 ? (
            <Select
              value={anbieter.chatModell}
              onChange={(e) => aendere({ chatModell: e.target.value })}
            >
              {chat.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                  {m.empfohlen ? ' (empfohlen)' : ''}
                </option>
              ))}
            </Select>
          ) : (
            <Input
              value={anbieter.chatModell}
              onChange={(e) => aendere({ chatModell: e.target.value })}
            />
          )}
        </Field>
      </div>

      <Separator />
      <Field
        label="API-Key"
        hint={maske ? `Gespeichert: ${maske}…` : 'Wird verschlüsselt im Benutzerprofil gespeichert (DPAPI).'}
      >
        <div className="flex items-center gap-2">
          <Input
            type="password"
            placeholder={maske ? 'Neuen Key eingeben (ersetzt)' : 'sk-…'}
            value={keyInput}
            onChange={(e) => {
              setKeyInput(e.target.value)
              setKeyFehler(null)
            }}
            disabled={keyBusy}
          />
          <Button size="sm" onClick={speichereKey} disabled={keyBusy || keyInput.trim() === ''}>
            {keyBusy ? 'Teste…' : 'Testen & speichern'}
          </Button>
        </div>
      </Field>
      {keyFehler && <p className="text-xs text-destructive">{keyFehler}</p>}
    </div>
  )
}
