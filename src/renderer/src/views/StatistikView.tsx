import { useEffect, useMemo, useState } from 'react'
import type { StatsSummary, StatZeile } from '@main/stats/stats-store'
import type { BlitztextSettings } from '@main/settings/store'
import {
  PREISE,
  aufgelosteTabelle,
  zeileKostenUsd,
  eurAus,
  type ModellPreis,
  type PreisOverrides
} from '@shared/pricing'
import { preisModellListen } from '@/lib/preis-modelle'
import { preiseGeaendert } from '@/lib/dirty'
import { sortiereStatistikZeilen } from '@shared/statistik-zeilen'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/ui/field'
import ZweiEbenenShell from '@/components/ZweiEbenenShell'
import { useBestaetigung } from '@/components/Bestaetigung'
import { useHinweis } from '@/components/Hinweis'
import { useNavGuard } from '@/components/NavGuard'

// Statistik (P7): Zwei-Ebenen-Ansicht (volle Breite). Band „Nutzung" = Kennzahlen (inkl. Eingabe-/
// Ausgabe-/Gesamt-Token) + Detailtabelle mit EUR-Kosten. Band „Preise & Kosten" = editierbare lokale
// Preistabelle + USD→EUR-Kurs. Der Store liefert nur Zahlen; die EUR-Kosten entstehen hier aus
// Default-Preisen + Overrides + Kurs (app-weit EUR, an den Verlauf angeglichen).

interface Props {
  settings: BlitztextSettings
  speichern: (next: BlitztextSettings) => Promise<void>
}

const eurFmt = (n: number): string => `${n.toFixed(4).replace('.', ',')} €`
const zahl = (n: number): string => n.toLocaleString('de-DE')

type Band = 'nutzung' | 'preise'

export default function StatistikView({ settings, speichern }: Props) {
  const [auswahl, setAuswahl] = useState<Band>('nutzung')
  return (
    <ZweiEbenenShell
      breit
      eintraege={[
        { id: 'nutzung', titel: 'Nutzung' },
        { id: 'preise', titel: 'Preise & Kosten' }
      ]}
      aktivId={auswahl}
      onWaehle={(id) => setAuswahl(id as Band)}
    >
      {auswahl === 'nutzung' ? (
        <NutzungPane settings={settings} />
      ) : (
        <PreisePane settings={settings} speichern={speichern} />
      )}
    </ZweiEbenenShell>
  )
}

function NutzungPane({ settings }: { settings: BlitztextSettings }) {
  const [summary, setSummary] = useState<StatsSummary | null>(null)
  const bestaetige = useBestaetigung()
  const zeige = useHinweis()

  async function laden() {
    setSummary(await window.blitztext.stats.zusammenfassung())
  }
  useEffect(() => {
    void laden()
  }, [])

  const tabelle = useMemo(() => aufgelosteTabelle(settings.preisOverrides), [settings.preisOverrides])
  const zeileEur = (z: StatZeile): number | null => {
    const usd = zeileKostenUsd(z, { tabelle })
    return usd === null ? null : eurAus(usd, settings.usdEurKurs)
  }

  async function zuruecksetzen() {
    const ok = await bestaetige({
      titel: 'Statistik zurücksetzen?',
      text: 'Alle Nutzungszahlen werden gelöscht.',
      bestaetigen: 'Zurücksetzen',
      gefahr: true
    })
    if (!ok) return
    await window.blitztext.stats.loeschen()
    await laden()
    zeige('Statistik zurückgesetzt.', 'erfolg')
  }

  if (!summary) return <p className="text-sm text-muted-foreground">Lade…</p>

  // A5: der Store liefert Zeilen in Einfüge-Reihenfolge; im Grenzmonat (90-Tage-Kompaktierungsschwelle)
  // stehen dort arithmetisch korrekt sowohl eine 'YYYY-MM'-Monatszeile als auch mehrere
  // 'YYYY-MM-DD'-Tageszeilen desselben Monats nebeneinander — ohne Sortierung wirkt das wie doppelte/
  // durcheinandergewürfelte Zeilen. sortiereStatistikZeilen macht die Reihenfolge deterministisch
  // (neueste zuerst, sekundär workflowId) und mutiert `summary.zeilen` nicht.
  const zeilenSortiert = sortiereStatistikZeilen(summary.zeilen)

  const gesamtTokens = summary.gesamtPromptTokens + summary.gesamtCompletionTokens
  let gesamtEur = 0
  let unbekannt = false
  for (const z of zeilenSortiert) {
    const e = zeileEur(z)
    if (e === null) unbekannt = true
    else gesamtEur += e
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Nutzung und geschätzte Kosten (EUR).</p>
        {summary.gesamtAnzahl > 0 && (
          <Button variant="outline" size="sm" onClick={zuruecksetzen}>
            Zurücksetzen
          </Button>
        )}
      </div>

      <div className="grid grid-cols-3 gap-3 lg:grid-cols-6">
        <Kennzahl titel="Diktate" wert={zahl(summary.gesamtAnzahl)} />
        <Kennzahl titel="Audio (Min.)" wert={(summary.gesamtAudioSekunden / 60).toFixed(1)} />
        <Kennzahl titel="Eingabe-Tokens" wert={zahl(summary.gesamtPromptTokens)} />
        <Kennzahl titel="Ausgabe-Tokens" wert={zahl(summary.gesamtCompletionTokens)} />
        <Kennzahl titel="Tokens gesamt" wert={zahl(gesamtTokens)} />
        <Kennzahl titel="Kosten (geschätzt)" wert={eurFmt(gesamtEur)} />
      </div>

      {unbekannt && (
        <p className="text-xs text-warning">
          Für einzelne Modelle liegen keine Preise vor — diese Kosten fehlen in der Summe (in „Preise &amp;
          Kosten" ergänzbar).
        </p>
      )}

      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="p-3 font-medium">Datum</th>
                <th className="p-3 font-medium">Workflow</th>
                <th className="p-3 font-medium">Anzahl</th>
                <th className="p-3 font-medium">Audio (s)</th>
                <th className="p-3 font-medium">Modelle</th>
                <th className="p-3 font-medium">Eingabe</th>
                <th className="p-3 font-medium">Ausgabe</th>
                <th className="p-3 font-medium">Kosten</th>
              </tr>
            </thead>
            <tbody>
              {zeilenSortiert.map((z, i) => {
                const e = zeileEur(z)
                return (
                  <tr key={i} className="border-b last:border-0">
                    <td className="p-3">{z.datum}</td>
                    <td className="p-3">{z.workflowId}</td>
                    <td className="p-3">{z.anzahl}</td>
                    <td className="p-3">{z.audioSekunden.toFixed(1)}</td>
                    <td className="p-3 text-xs text-muted-foreground">
                      {z.asrModell}
                      {z.chatModell ? ` + ${z.chatModell}` : ''}
                    </td>
                    <td className="p-3">{zahl(z.promptTokens)}</td>
                    <td className="p-3">{zahl(z.completionTokens)}</td>
                    <td className="p-3">{e === null ? '—' : eurFmt(e)}</td>
                  </tr>
                )
              })}
              {zeilenSortiert.length === 0 && (
                <tr>
                  <td colSpan={8} className="p-5 text-center text-muted-foreground">
                    Noch keine Daten.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Kosten sind eine Schätzung auf Basis der hinterlegten Preise (anpassbar unter „Preise &amp; Kosten")
        und des USD→EUR-Kurses; sie können abweichen.
      </p>
    </div>
  )
}

function Kennzahl({ titel, wert }: { titel: string; wert: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground">{titel}</p>
        <p className="text-2xl font-semibold tracking-tight">{wert}</p>
      </CardContent>
    </Card>
  )
}

function PreisePane({ settings, speichern }: Props) {
  const [overrides, setOverrides] = useState<PreisOverrides>(settings.preisOverrides)
  // Editierbare Modelle = Defaults (PREISE) ∪ Katalog der konfigurierten Anbieter ∪ Override-Keys.
  // So erscheinen auch Mistral/konfigurierte Anbieter (nicht nur die OpenAI/Groq-Defaults).
  const { asr: ASR_MODELLE, chat: CHAT_MODELLE } = useMemo(
    () => preisModellListen(settings.anbieter, settings.preisOverrides),
    [settings.anbieter, settings.preisOverrides]
  )
  const [kurs, setKurs] = useState<string>(String(settings.usdEurKurs))
  const [busy, setBusy] = useState(false)
  const { registriereDirty } = useNavGuard()

  const kursNum = Number(kurs)
  const kursGueltig = Number.isFinite(kursNum) && kursNum > 0
  const geaendert = preiseGeaendert(
    overrides,
    settings.preisOverrides,
    kursNum,
    kursGueltig,
    settings.usdEurKurs
  )

  useEffect(() => registriereDirty('preise', () => geaendert), [registriereDirty, geaendert])

  function feldWert(id: string, field: keyof ModellPreis): string {
    const v = overrides[id]?.[field] ?? PREISE[id]?.[field]
    return v === undefined ? '' : String(v)
  }

  function setFeld(id: string, field: keyof ModellPreis, raw: string) {
    setOverrides((prev) => {
      const next: PreisOverrides = { ...prev }
      const eintrag: ModellPreis = { ...(next[id] ?? {}) }
      const num = raw.trim() === '' ? undefined : Number(raw)
      if (num === undefined || !Number.isFinite(num)) delete eintrag[field]
      else eintrag[field] = num
      if (Object.keys(eintrag).length === 0) delete next[id]
      else next[id] = eintrag
      return next
    })
  }

  async function speichere() {
    if (!kursGueltig) return
    setBusy(true)
    await speichern({ ...settings, preisOverrides: overrides, usdEurKurs: kursNum })
    setBusy(false)
  }

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Preise je Modell (Eingabe in <span className="font-medium">US-Dollar</span>), Anzeige in Euro über
        den Kurs. Rein kosmetisch — leere Felder nutzen den mitgelieferten Standardpreis.
      </p>

      <Card>
        <CardContent className="flex flex-col gap-4 p-5">
          <Field label="USD → EUR Kurs" hint="Wie viele Euro ein US-Dollar entspricht (anpassbar).">
            <Input
              type="number"
              step="0.01"
              value={kurs}
              onChange={(e) => setKurs(e.target.value)}
            />
          </Field>
          {!kursGueltig && <p className="-mt-2 text-xs text-destructive">Kurs muss eine Zahl &gt; 0 sein.</p>}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-col gap-4 p-5">
          <h3 className="text-sm font-semibold">Transkription (ASR) — USD pro Audiominute</h3>
          {ASR_MODELLE.map((id) => (
            <Field key={id} label={id}>
              <Input
                type="number"
                step="0.001"
                value={feldWert(id, 'asrProMinuteUsd')}
                onChange={(e) => setFeld(id, 'asrProMinuteUsd', e.target.value)}
              />
            </Field>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-col gap-4 p-5">
          <h3 className="text-sm font-semibold">Umschreiben (Chat) — USD pro 1 Mio. Token</h3>
          {CHAT_MODELLE.map((id) => (
            <div key={id} className="grid grid-cols-2 gap-4">
              <Field label={`${id} · Eingabe`}>
                <Input
                  type="number"
                  step="0.01"
                  value={feldWert(id, 'inputPro1MUsd')}
                  onChange={(e) => setFeld(id, 'inputPro1MUsd', e.target.value)}
                />
              </Field>
              <Field label={`${id} · Ausgabe`}>
                <Input
                  type="number"
                  step="0.01"
                  value={feldWert(id, 'outputPro1MUsd')}
                  onChange={(e) => setFeld(id, 'outputPro1MUsd', e.target.value)}
                />
              </Field>
            </div>
          ))}
        </CardContent>
      </Card>

      <div>
        <Button onClick={speichere} disabled={busy || !geaendert || !kursGueltig}>
          {busy ? 'Speichere…' : 'Speichern'}
        </Button>
      </div>
    </div>
  )
}
