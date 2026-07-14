import { useEffect, useState } from 'react'
import { Trash2 } from 'lucide-react'
import type { AnbieterKonfig } from '@shared/anbieter'
import { getProvider, modelleFuerVorlage } from '@shared/providers'
import { istSichereAnbieterUrl } from '@/lib/anbieter-url-guard'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Field, Separator } from '@/components/ui/field'
import { useHinweis } from '@/components/Hinweis'
import { useNavGuard } from '@/components/NavGuard'
import { apiKeyEntwurfGeaendert } from '@/lib/dirty'

interface KarteProps {
  anbieter: AnbieterKonfig
  istStandard: boolean
  standardWaehlen: () => void
  aendere: (patch: Partial<AnbieterKonfig>) => void
  entferne?: () => void
}

export default function AnbieterKarte({
  anbieter,
  istStandard,
  standardWaehlen,
  aendere,
  entferne
}: KarteProps) {
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
