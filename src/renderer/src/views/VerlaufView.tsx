import { useEffect, useMemo, useState } from 'react'
import { ArrowDownUp } from 'lucide-react'
import type { BlitztextSettings } from '@main/settings/store'
import type { VerlaufEintrag } from '@main/history/history-store'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import ZweiEbenenShell from '@/components/ZweiEbenenShell'
import { useBestaetigung } from '@/components/Bestaetigung'
import { useHinweis } from '@/components/Hinweis'
import { naechsteAuswahl } from '@/lib/verlauf-auswahl'
import { istNeuesteZuerst, toggleSortierung } from '@/lib/verlauf-sortierung'
import { wortDiff } from '@/lib/wort-diff'
import { laufKosten } from '@shared/pricing'
import { normalisiereBegriffe } from '@shared/begriffe'
import { modellLabelFuerEintrag } from '@shared/modell-label'

interface Props {
  settings: BlitztextSettings
  speichern: (next: BlitztextSettings, opts?: { still?: boolean }) => Promise<void>
}

// Verlauf in zwei Ebenen (VL-1): zweites Band mit verkürzten Einträgen → Detail mit vollem Inhalt.
export default function VerlaufView({ settings, speichern }: Props) {
  const [eintraege, setEintraege] = useState<VerlaufEintrag[]>([])
  const [auswahl, setAuswahl] = useState<string | null>(null)
  // C2: Initial-State aus den persistierten Einstellungen; Umschalten aktualisiert lokal + speichert
  // still (kein Toast bei jedem Klick).
  const [neuesteZuerst, setNeuesteZuerst] = useState(() => istNeuesteZuerst(settings.verlaufSortierung))
  // Feature #1: Wort-Diff-Toggle im Detail — Default AUS (Nutzer-Entscheid: Standard ist die
  // klassische Original-vs-Bearbeitet-Ansicht, Diff nur auf Wunsch), pro Eintrag zurückgesetzt
  // (Reset bei Auswahlwechsel unten), damit eine eingeschaltete Diff-Ansicht nicht "durchsickert",
  // wenn man einen anderen Eintrag anklickt.
  const [diffAnzeigen, setDiffAnzeigen] = useState(false)
  // Korrektur-Loop: Eingabefeld „Begriff ins Wörterbuch" — pro Eintrag zurückgesetzt (gleiches
  // Muster wie diffAnzeigen oben), damit ein angefangener Begriff nicht am nächsten Eintrag kleben
  // bleibt.
  const [begriffEingabe, setBegriffEingabe] = useState('')
  const gesperrt = settings.verlaufGesperrt
  const bestaetige = useBestaetigung()
  const zeige = useHinweis()

  async function laden() {
    const liste = await window.blitztext.history.liste()
    setEintraege(liste)
    // P5a: gültige Auswahl behalten, sonst auf den neuesten (Variante 1 nach Löschen / Erst-Eintritt).
    setAuswahl((prev) => naechsteAuswahl(liste, prev))
  }

  useEffect(() => {
    void laden()
  }, [settings.verlaufAktiv, settings.verlaufGesperrt])

  // P5b: bei neuem Eintrag automatisch neu laden (Push-Event) — ersetzt den früheren focus-Reload
  // (kein Doppel-Load). Die Abmelde-Closure aus dem Preload räumt StrictMode-sicher auf.
  useEffect(() => {
    const abmelden = window.blitztext.history.onChanged(() => void laden())
    return abmelden
  }, [])

  // Diff-Toggle pro Eintrag zurücksetzen (Default: klassische Ansicht, Diff aus).
  useEffect(() => {
    setDiffAnzeigen(false)
  }, [auswahl])

  // Korrektur-Loop: angefangene Wörterbuch-Eingabe pro Eintrag zurücksetzen.
  useEffect(() => {
    setBegriffEingabe('')
  }, [auswahl])

  async function umschalten(v: boolean) {
    await speichern({ ...settings, verlaufAktiv: v })
  }

  function sortierungUmschalten() {
    const neu = toggleSortierung(settings.verlaufSortierung)
    setNeuesteZuerst(istNeuesteZuerst(neu))
    void speichern({ ...settings, verlaufSortierung: neu }, { still: true })
  }

  async function loeschen() {
    const ok = await bestaetige({
      titel: 'Gesamten Verlauf löschen?',
      text: `${eintraege.length} Einträge werden unwiderruflich gelöscht.`,
      bestaetigen: 'Alles löschen',
      gefahr: true
    })
    if (!ok) return
    await window.blitztext.history.loeschen()
    await laden() // Auswahl wird in laden() neu bestimmt (leere Liste → null)
    zeige('Verlauf gelöscht.', 'erfolg')
  }

  async function loescheEintrag(id: string) {
    const ok = await bestaetige({ titel: 'Eintrag löschen?', bestaetigen: 'Löschen', gefahr: true })
    if (!ok) return
    await window.blitztext.history.loeschenEintrag(id)
    await laden() // Variante 1: laden() springt auf den neuesten verbleibenden Eintrag
    zeige('Eintrag gelöscht.', 'erfolg')
  }

  // Korrektur-Loop: falsch erkannten Begriff direkt aus dem Verlauf ins Wörterbuch übernehmen.
  // Duplikat-Check ist ein trivialer Längenvergleich vor/nach normalisiereBegriffe (case-insensitive,
  // Erstschreibweise gewinnt — siehe shared/begriffe.ts), kein separater Lookup nötig.
  async function begriffUebernehmen() {
    const eingabe = begriffEingabe.trim()
    if (eingabe === '') return
    const normalisiert = normalisiereBegriffe([...settings.customTerms, eingabe])
    if (normalisiert.length === settings.customTerms.length) {
      zeige(`„${eingabe}" ist bereits im Wörterbuch.`, 'info')
      return
    }
    await speichern({ ...settings, customTerms: normalisiert })
    zeige(`„${eingabe}" zum Wörterbuch hinzugefügt.`, 'erfolg')
    setBegriffEingabe('')
  }

  const aktiv = eintraege.find((e) => e.id === auswahl) ?? null
  // A6 (Fehlerjagd-Nachtrag): das TATSÄCHLICH gelaufene Modell (asrModell/chatModell) war bislang
  // nirgends sichtbar — nur intern für laufKosten() genutzt. Alt-Einträge ohne diese Felder liefern
  // einen leeren String (siehe modellLabelFuerEintrag), dann wird gar kein Badge gerendert.
  const modellLabel = aktiv ? modellLabelFuerEintrag(aktiv) : ''

  // W3-F2 (Review-Befund D): wortDiff ist ein O(n·m)-DP über Token-Paare (bis 4000×4000 ≈ 64 MB Uint32Array,
  // s. MAX_DIFF_TOKENS) — ohne Memoisierung würde JEDER Re-Render von VerlaufView (z. B. durch das
  // begriffEingabe-Tippen im Feld weiter unten) den Diff neu berechnen, obwohl sich weder der Eintrag noch
  // der Toggle geändert haben. Nur berechnen, wenn diffAnzeigen an ist UND Roh-/Endtext sich unterscheiden
  // (sonst ist der Aufruf ohnehin sinnlos, s. Render-Zweig unten); Abhängigkeiten bewusst auf die
  // Primitiv-Felder beschränkt (nicht das ganze `aktiv`-Objekt), damit ein Referenzwechsel ohne Inhalts-
  // änderung (z. B. durch `laden()`, das bei jedem Push-Event ein neues Array/Objekt baut) keine
  // Neuberechnung auslöst.
  const diff = useMemo(() => {
    if (!aktiv || !diffAnzeigen || aktiv.rohtext === aktiv.endtext) return null
    return wortDiff(aktiv.rohtext, aktiv.endtext)
  }, [aktiv?.id, aktiv?.rohtext, aktiv?.endtext, diffAnzeigen])
  // Der Store liefert neueste zuerst; bei „Älteste zuerst" umdrehen.
  const sortiert = neuesteZuerst ? eintraege : [...eintraege].reverse()
  const band = sortiert.map((e) => ({
    id: e.id,
    titel: e.workflowLabel,
    unterzeile: e.endtext,
    badge: (
      <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
        {new Date(e.zeitstempelMs).toLocaleString('de-DE', {
          day: '2-digit',
          month: '2-digit',
          hour: '2-digit',
          minute: '2-digit'
        })}
      </span>
    ),
    onLoeschen: () => loescheEintrag(e.id)
  }))

  return (
    <ZweiEbenenShell
      eintraege={band}
      aktivId={auswahl}
      onWaehle={(id) => setAuswahl(id)}
      bandKopf={
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-xs font-medium">Aufzeichnen</p>
              <p className="text-[11px] leading-tight text-muted-foreground">
                {gesperrt ? 'Im Sicheren Modus aus.' : 'Lokal, verschlüsselt.'}
              </p>
            </div>
            <Switch
              checked={settings.verlaufAktiv && !gesperrt}
              disabled={gesperrt}
              onCheckedChange={umschalten}
            />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">{eintraege.length} Einträge</span>
            {eintraege.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs text-destructive"
                onClick={loeschen}
              >
                Alles löschen
              </Button>
            )}
          </div>
          {eintraege.length > 1 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-fit self-start px-2 text-xs text-muted-foreground"
              onClick={sortierungUmschalten}
              title={
                neuesteZuerst
                  ? 'Zu „Älteste zuerst" wechseln'
                  : 'Zu „Neueste zuerst" wechseln'
              }
            >
              <ArrowDownUp className="size-3.5" />
              {neuesteZuerst ? 'Neueste zuerst' : 'Älteste zuerst'}
            </Button>
          )}
        </div>
      }
      leer={
        settings.verlaufAktiv && !gesperrt
          ? eintraege.length === 0
            ? 'Noch keine Einträge — diktiere etwas, dann erscheint es hier.'
            : 'Wähle links einen Eintrag, um den vollen Text zu sehen.'
          : 'Der Verlauf ist aus. Schalte ihn links ein, um Diktate zu speichern.'
      }
    >
      {aktiv && (
        <Card>
          <CardContent className="flex flex-col gap-3 p-5">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                {aktiv.workflowLabel}
                {/* V5: dezenter Prompt-Stand-Badge — zeigt, welche Prompt-Fassung den Endtext erzeugt
                    hat (Kennung siehe promptKennungFuer, shared/workflows.ts). Fehlt bei Einträgen
                    ohne rewrite-Schritt und bei allen Vor-V5-Einträgen (optionales Feld). */}
                {aktiv.promptKennung && (
                  <span
                    className="rounded border px-1 py-0.5 font-mono text-[10px] leading-none text-muted-foreground/70"
                    title={`Prompt-Stand: ${aktiv.promptKennung}`}
                  >
                    {aktiv.promptKennung}
                  </span>
                )}
                {/* A6: das tatsächlich gelaufene Modell — gleicher Badge-Stil wie promptKennung oben,
                    direkt daneben. Alt-Einträge ohne asrModell/chatModell zeigen KEINEN Badge (leeres
                    modellLabel → kein Rendern, keine leere Hülle). */}
                {modellLabel && (
                  <span
                    className="rounded border px-1 py-0.5 font-mono text-[10px] leading-none text-muted-foreground/70"
                    title={`Modell: ${modellLabel}`}
                  >
                    {modellLabel}
                  </span>
                )}
              </span>
              <span>{new Date(aktiv.zeitstempelMs).toLocaleString('de-DE')}</span>
            </div>
            {(() => {
              const k = laufKosten(
                {
                  asrModell: aktiv.asrModell,
                  dauerSekunden: aktiv.dauerSekunden,
                  chatModell: aktiv.chatModell,
                  usage: aktiv.usage
                },
                // P7: dieselben Overrides + derselbe Kurs wie in der Statistik → konsistente EUR.
                { overrides: settings.preisOverrides, kurs: settings.usdEurKurs }
              )
              const tokens = aktiv.usage
                ? aktiv.usage.promptTokens + aktiv.usage.completionTokens
                : 0
              if (k.eur === null && tokens === 0) return null
              return (
                <p className="text-xs text-muted-foreground">
                  {k.eur !== null && `≈ ${k.eur.toFixed(4).replace('.', ',')} € (geschätzt)`}
                  {tokens > 0 && `${k.eur !== null ? ' · ' : ''}${tokens} Tokens`}
                </p>
              )
            })()}
            {aktiv.rohtext !== aktiv.endtext ? (
              // Nutzer-Entscheid nach HITL (K2, v0.7.1): Standard ist die klassische Zwei-Block-Ansicht
              // (Endtext + Rohtext) — der Wort-Diff (Feature #1) wird nur auf Wunsch eingeblendet.
              // `diff` kommt aus dem useMemo oben und ist nur bei diffAnzeigen && Ungleichheit gefüllt.
              <>
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {diff ? 'Änderungen' : 'Endtext'}
                  </p>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs text-muted-foreground"
                    onClick={() => setDiffAnzeigen(!diffAnzeigen)}
                  >
                    {diff ? 'Änderungen ausblenden' : 'Änderungen zeigen'}
                  </Button>
                </div>
                {diff ? (
                  <p className="whitespace-pre-wrap text-sm">
                    {diff.map((tok, idx) => {
                      if (tok.art === 'gleich') {
                        return <span key={idx}>{tok.text}</span>
                      }
                      if (tok.art === 'entfernt') {
                        return (
                          <del key={idx} className="bg-destructive/15 text-destructive line-through">
                            {tok.text}
                          </del>
                        )
                      }
                      return (
                        <ins key={idx} className="bg-success/15 text-success no-underline">
                          {tok.text}
                        </ins>
                      )
                    })}
                  </p>
                ) : (
                  <>
                    <p className="whitespace-pre-wrap text-sm">{aktiv.endtext}</p>
                    <div className="mt-3">
                      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Rohtext
                      </p>
                      <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                        {aktiv.rohtext}
                      </p>
                    </div>
                  </>
                )}
              </>
            ) : (
              <div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Endtext
                </p>
                <p className="whitespace-pre-wrap text-sm">{aktiv.endtext}</p>
              </div>
            )}
            {/* Korrektur-Loop: falsch transkribierte Fachbegriffe direkt hier ins Wörterbuch
                übernehmen — bewusst OHNE Kopier-/Re-Run-/Popover-Mechanik, nur der Wörterbuch-Eintrag
                selbst (Nutzer-Entscheid). Klar abgesetzt von Diff/Text oben und vom Lösch-Button unten. */}
            <div className="mt-1 border-t pt-3">
              <Field
                label="Begriff ins Wörterbuch"
                hint="Korrekte Schreibweise eines falsch erkannten Begriffs — wird bei künftigen Aufnahmen berücksichtigt."
              >
                <div className="flex items-center gap-2">
                  <Input
                    value={begriffEingabe}
                    placeholder="z. B. Produktname, Eigenname, Fachbegriff"
                    onChange={(e) => setBegriffEingabe(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void begriffUebernehmen()
                    }}
                  />
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={begriffEingabe.trim() === ''}
                    onClick={begriffUebernehmen}
                  >
                    Hinzufügen
                  </Button>
                </div>
              </Field>
            </div>
            <div className="pt-1">
              <Button variant="destructive" size="sm" onClick={() => loescheEintrag(aktiv.id)}>
                Diesen Eintrag löschen
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </ZweiEbenenShell>
  )
}
