import { useState } from 'react'
import { HELP_TOPICS } from '@/config/navigation'
import { Card, CardContent } from '@/components/ui/card'
import ZweiEbenenShell from '@/components/ZweiEbenenShell'

// Hilfe (P1): zentrale, statische Anlaufstelle als Zwei-Ebenen-Ansicht. Bewusst GRUNDLEGEND gehalten —
// die App zum Laufen bringen + die Absicht je Funktion nachvollziehbar machen. Topics spiegeln die
// Navigation (+ Erste Schritte/Konzept + Problemlösung). Die „?"-Brücke springt hierher (zielTopic).

interface Inhalt {
  titel: string
  absaetze: string[]
  punkte?: string[]
}

const INHALTE: Record<string, Inhalt> = {
  'erste-schritte': {
    titel: 'Erste Schritte',
    absaetze: [
      'Blitztext wandelt gesprochene Sprache in Text um und fügt ihn ins zuvor aktive Fenster ein. So funktioniert es:',
      'Damit etwas passiert, muss ein gültiger API-Key des Standard-Anbieters hinterlegt sein (siehe Übersicht/Einstellungen). Ohne Key ist die App nicht nutzbar.'
    ],
    punkte: [
      'Hotkey gedrückt halten und sprechen.',
      'Loslassen — Blitztext transkribiert, schreibt (je nach Workflow) um und fügt den Text ein.',
      'Die aktiven Hotkeys stehen auf der Übersicht.'
    ]
  },
  workflows: {
    titel: 'Workflows',
    absaetze: [
      'Ein Workflow bestimmt, was nach dem Diktat passiert: reine Transkription oder zusätzliches Umschreiben per KI (z. B. sauber formulieren, Emojis ergänzen, ruhiger formulieren).',
      'Eingebaute Workflows lassen sich anpassen (Modell, Temperatur, Ton, Emoji, Prompt) und jederzeit über „Auf Auslieferung zurücksetzen" auf den Werkszustand bringen. Ton und Emoji wirken auch bei eigenen/statischen Prompts, sobald sie dort explizit gesetzt sind. Eigene Workflows kannst du anlegen und löschen.'
    ],
    punkte: [
      'Jeder Workflow hat einen globalen Hotkey.',
      'Pro Workflow ist ein Anbieter, eine Sprache und ein Modell wählbar (sonst gilt der Standard).',
      'Speichern ist nur aktiv, wenn es ungespeicherte Änderungen gibt.'
    ]
  },
  verlauf: {
    titel: 'Verlauf',
    absaetze: [
      'Der Verlauf speichert deine Diktate lokal und verschlüsselt (opt-in). Du siehst Roh- und Endtext, Datum und geschätzte Kosten je Eintrag.',
      'Der Verlauf aktualisiert sich automatisch, sobald ein neues Diktat fertig ist. Einträge lassen sich einzeln oder komplett löschen.'
    ],
    punkte: [
      'Im „Sicheren Lokalen Modus" wird nichts aufgezeichnet.',
      'Sortierung nach Datum (neueste/älteste) ist umschaltbar.'
    ]
  },
  statistik: {
    titel: 'Statistik & Kosten',
    absaetze: [
      'Die Statistik zeigt Nutzung (Diktate, Audiominuten, Eingabe-/Ausgabe-Tokens) und eine Kostenschätzung in Euro.',
      'Unter „Preise & Kosten" kannst du die Preise je Modell (in US-Dollar) und den USD→EUR-Kurs anpassen. Das ist optional und rein kosmetisch — ohne Eintrag gelten die mitgelieferten Standardpreise.'
    ]
  },
  einstellungen: {
    titel: 'Einstellungen',
    absaetze: [
      'Hier verwaltest du Anbieter und API-Keys, Sprache und eigene Begriffe, den Aufnahmemodus, den Datenschutz (Sicherer Lokaler Modus) und das Farbschema.',
      'Änderungen werden mit „Einstellungen speichern" übernommen. API-Keys werden je Anbieter sofort und separat gespeichert (verschlüsselt im Benutzerprofil).'
    ],
    punkte: [
      'Verlässt du eine Seite mit ungespeicherten Änderungen, fragt Blitztext nach.',
      'Ein Anbieter kann als Standard markiert werden (gilt für Workflows ohne eigene Zuordnung).'
    ]
  },
  problemloesung: {
    titel: 'Problemlösung',
    absaetze: ['Die häufigsten Fälle:'],
    punkte: [
      'Nichts passiert beim Diktieren: ist ein gültiger, getesteter API-Key hinterlegt? Die Übersicht warnt sonst rot.',
      'Ein Workflow scheitert: nutzt er einen Anbieter ohne Key? Die Übersicht warnt dann gelb.',
      'Text wird nicht eingefügt: das Ziel-Fenster muss eine Texteingabe im Fokus haben.',
      'Hotkey reagiert nicht oder kollidiert: in den Workflow-Einstellungen eine andere Kombination wählen.'
    ]
  }
}

const LEER_INHALT: Inhalt = { titel: '', absaetze: [] }

export default function HilfeView({ zielTopic }: { zielTopic?: string }) {
  const ersterTopic = HELP_TOPICS[0]?.id ?? ''
  const [auswahl, setAuswahl] = useState<string>(zielTopic ?? ersterTopic)
  const inhalt = INHALTE[auswahl] ?? INHALTE[ersterTopic] ?? LEER_INHALT

  return (
    <ZweiEbenenShell
      eintraege={HELP_TOPICS.map((t) => ({ id: t.id, titel: t.titel }))}
      aktivId={auswahl}
      onWaehle={(id) => setAuswahl(id)}
    >
      <Card>
        <CardContent className="flex flex-col gap-4 p-5">
          <h2 className="text-base font-semibold">{inhalt.titel}</h2>
          {inhalt.absaetze.map((p, i) => (
            <p key={i} className="text-sm text-muted-foreground">
              {p}
            </p>
          ))}
          {inhalt.punkte && (
            <ul className="ml-4 flex list-disc flex-col gap-1 text-sm text-muted-foreground">
              {inhalt.punkte.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </ZweiEbenenShell>
  )
}
