import {
  NETZWERK_PROFIL_STUFEN,
  NETZWERK_PROFIL_DEFAULT,
  type NetzwerkProfil,
  RETRY_VERSUCHE_STUFEN,
  RETRY_VERSUCHE_DEFAULT,
  VERLAUF_MAXIMUM_STUFEN,
  VERLAUF_MAXIMUM_DEFAULT,
  STATISTIK_KOMPAKTIERUNG_TAGE_STUFEN,
  STATISTIK_KOMPAKTIERUNG_TAGE_DEFAULT
} from '@shared/laufzeit-profile'
import {
  mitStandardMarkierung,
  netzwerkProfilLabel,
  retryVersucheLabel,
  verlaufMaximumLabel,
  statistikKompaktierungTageLabel
} from '@/lib/einstellungen-labels'
import { Card, CardContent } from '@/components/ui/card'
import { Select } from '@/components/ui/select'
import { Field } from '@/components/ui/field'

// v0.8.0: Karte für die restlichen Laufzeit-Stufen im Abschnitt „System & Diagnose" — Netzwerk-
// Zeitlimit, Anbieter-Wiederholungsversuche sowie die beiden Aufbewahrungs-Obergrenzen (Verlauf/
// Statistik). Jede Stufenliste kommt aus @shared/laufzeit-profile (EINE Quelle, siehe dort) — die
// Optionen werden iteriert, nie hartkodiert.
interface Props {
  netzwerkProfil: NetzwerkProfil
  aendereNetzwerkProfil: (v: NetzwerkProfil) => void
  retryVersuche: number
  aendereRetryVersuche: (v: number) => void
  verlaufMaximum: number
  aendereVerlaufMaximum: (v: number) => void
  statistikKompaktierungTage: number
  aendereStatistikKompaktierungTage: (v: number) => void
}

export default function LaufzeitKarte({
  netzwerkProfil,
  aendereNetzwerkProfil,
  retryVersuche,
  aendereRetryVersuche,
  verlaufMaximum,
  aendereVerlaufMaximum,
  statistikKompaktierungTage,
  aendereStatistikKompaktierungTage
}: Props) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-4 p-5">
        <p className="text-sm font-medium">Zeitlimits &amp; Grenzwerte</p>
        <Field
          label="Netzwerk-Zeitlimit"
          hint={
            'Wie lange auf eine Antwort des Anbieters gewartet wird, bevor abgebrochen/wiederholt wird. ' +
            '„Lang" hilft bei langsamem Netz oder großen Aufnahmen, „Kurz" meldet Probleme schneller.'
          }
        >
          <Select
            value={netzwerkProfil}
            onChange={(e) => aendereNetzwerkProfil(e.target.value as NetzwerkProfil)}
          >
            {NETZWERK_PROFIL_STUFEN.map((p) => (
              <option key={p} value={p}>
                {mitStandardMarkierung(netzwerkProfilLabel(p), p === NETZWERK_PROFIL_DEFAULT)}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="Wiederholungsversuche bei Anbieter-Fehlern"
          hint="Wie oft ein fehlgeschlagener Transkriptions-/Umschreib-Versuch automatisch wiederholt wird, bevor ein Fehler gemeldet wird."
        >
          <Select
            value={String(retryVersuche)}
            onChange={(e) => aendereRetryVersuche(Number(e.target.value))}
          >
            {RETRY_VERSUCHE_STUFEN.map((n) => (
              <option key={n} value={n}>
                {mitStandardMarkierung(retryVersucheLabel(n), n === RETRY_VERSUCHE_DEFAULT)}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="Verlauf-Obergrenze"
          hint="Ältere Einträge werden automatisch gelöscht, sobald diese Anzahl überschritten wird."
        >
          <Select
            value={String(verlaufMaximum)}
            onChange={(e) => aendereVerlaufMaximum(Number(e.target.value))}
          >
            {VERLAUF_MAXIMUM_STUFEN.map((n) => (
              <option key={n} value={n}>
                {mitStandardMarkierung(verlaufMaximumLabel(n), n === VERLAUF_MAXIMUM_DEFAULT)}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="Statistik-Kompaktierung"
          hint="Einzeltage, die älter als dieser Zeitraum sind, werden zu Monatssummen zusammengefasst (spart Platz, Tages-Details gehen dabei verloren)."
        >
          <Select
            value={String(statistikKompaktierungTage)}
            onChange={(e) => aendereStatistikKompaktierungTage(Number(e.target.value))}
          >
            {STATISTIK_KOMPAKTIERUNG_TAGE_STUFEN.map((n) => (
              <option key={n} value={n}>
                {mitStandardMarkierung(
                  statistikKompaktierungTageLabel(n),
                  n === STATISTIK_KOMPAKTIERUNG_TAGE_DEFAULT
                )}
              </option>
            ))}
          </Select>
        </Field>
      </CardContent>
    </Card>
  )
}
