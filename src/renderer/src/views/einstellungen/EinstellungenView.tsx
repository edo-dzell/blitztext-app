import { useEffect, useState } from 'react'
import { Plus } from 'lucide-react'
import type { BlitztextSettings } from '@main/settings/store'
import type { AnbieterKonfig } from '@shared/anbieter'
import { PROVIDER, getProvider } from '@shared/providers'
import { SPRACHEN } from '@shared/sprachen'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Field } from '@/components/ui/field'
import ZweiEbenenShell from '@/components/ZweiEbenenShell'
import { useBestaetigung } from '@/components/Bestaetigung'
import { useNavGuard } from '@/components/NavGuard'
import { einstellungenGeaendert } from '@/lib/dirty'
import AnbieterKarte from './AnbieterKarte'
import MikrofonFeld from './MikrofonFeld'
import BegriffeFeld from './BegriffeFeld'
import AutostartKarte from './AutostartKarte'
import UpdateKarte from './UpdateKarte'
import DiagnoseKarte from './DiagnoseKarte'
import LogsKarte from './LogsKarte'

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
            hint="Enter oder Komma fügt hinzu. Eigennamen/Fachbegriffe verbessern Transkription und Umschreiben."
          >
            <BegriffeFeld
              begriffe={entwurf.customTerms}
              aendere={(customTerms) => setEntwurf({ ...entwurf, customTerms })}
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
          <LogsKarte
            an={entwurf.ausfuehrlichesProtokoll}
            aendere={(v) => setEntwurf({ ...entwurf, ausfuehrlichesProtokoll: v })}
          />
        </div>
      )}
    </ZweiEbenenShell>
  )
}
