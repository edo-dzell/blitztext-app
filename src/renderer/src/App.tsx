import { useEffect, useState, type ComponentType, type ReactNode } from 'react'
import { LayoutDashboard, Wand2, History, ChartColumn, Settings, Info, HelpCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { BlitztextSettings } from '@main/settings/store'
import {
  type Section,
  NAV_TOP_IDS,
  NAV_BOTTOM_IDS,
  TITEL,
  HELP_TOPIC_FUER_SECTION
} from '@/config/navigation'
import { chordLabel } from '@/lib/hotkey-capture'
import { berechneKaltstart } from '@/lib/kaltstart'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useTheme } from '@/lib/use-theme'
import { useWorkflowStatus } from '@/lib/use-workflow-status'
import { useHinweis } from '@/components/Hinweis'
import { useNavGuard } from '@/components/NavGuard'
import EinstellungenView from './views/einstellungen/EinstellungenView'
import WorkflowsView from './views/workflows/WorkflowsView'
import VerlaufView from './views/VerlaufView'
import StatistikView from './views/StatistikView'
import HilfeView from './views/HilfeView'
import OnboardingWizard from './components/OnboardingWizard'

// Dashboard-Shell (ADR-0009, V2): Sidebar-Navigation + Inhaltsbereich, dark-first. Lädt die
// Einstellungen einmal und reicht sie (samt Speichern) an die Bereiche; Speichern persistiert über IPC
// und löst im Main den Live-Reconfigure aus.

type NavItem = { id: Section; label: string; icon: ComponentType<{ className?: string }> }

// Icons bleiben LOKAL — navigation.ts ist bewusst lucide-frei, damit der node-only Governance-Test
// die Navigationsdaten importieren kann.
const ICONS: Record<Section, ComponentType<{ className?: string }>> = {
  home: LayoutDashboard,
  workflows: Wand2,
  history: History,
  stats: ChartColumn,
  settings: Settings,
  about: Info,
  help: HelpCircle
}

const NAV_TOP: NavItem[] = NAV_TOP_IDS.map((n) => ({ ...n, icon: ICONS[n.id] }))
const NAV_BOTTOM: NavItem[] = NAV_BOTTOM_IDS.map((n) => ({ ...n, icon: ICONS[n.id] }))

export default function App() {
  const [section, setSection] = useState<Section>('home')
  const [settings, setSettings] = useState<BlitztextSettings | null>(null)
  const [hilfeTopic, setHilfeTopic] = useState<string | undefined>(undefined)
  // W3-F2 (Review-Befund B): solange der Onboarding-Wizard sichtbar ist, liegt die restliche Shell
  // (Sidebar + Inhaltsbereich) VERDECKT darunter, ist aber weiterhin im DOM und damit Tab-erreichbar —
  // ohne Schutz wandert Tab aus dem Wizard-Overlay heraus in die verdeckte Sidebar. `inert` ist hier der
  // einfachste Fix (statt einer manuellen Tab-Falle wie in Bestaetigung.tsx/fokus-falle.ts): es entfernt
  // die Shell komplett aus der Tab-Reihenfolge UND aus der Accessibility-Tree, solange der Wizard offen
  // ist. Wird unten VOR dem Rendern von OnboardingWizard ausgewertet.
  const wizardSichtbar = settings !== null && !settings.onboardingAbgeschlossen

  useTheme(settings?.theme)
  const workflowStatus = useWorkflowStatus()
  const zeige = useHinweis()
  const { versucheNavigation } = useNavGuard()

  useEffect(() => {
    window.blitztext.settings.get().then(setSettings)
  }, [])

  // Gemeinsamer Speicherpfad (Workflows/Einstellungen/Verlauf) → generischer Erfolg-/Fehler-Toast (P6).
  // Fehler werden hier abgefangen (heute schweigt die App bei Speicherfehlern); kein Rethrow, damit
  // der Busy-Zustand der Aufrufer sauber zurückgesetzt wird.
  // A4b: Läuft gerade eine Aufnahme, verschiebt der Main-Prozess die Übernahme der Einstellungen bis
  // zu deren Ende und liefert dafür `false` zurück — WICHTIG: strikt `=== false` prüfen (nicht falsy!),
  // denn bis der parallele Main-Agent den Handler entsprechend erweitert hat, ist der Rückgabewert zur
  // Laufzeit `undefined` (Altverhalten = sofort übernommen, kein Info-Toast).
  // `opts.still` unterdrückt jeden Toast (Vorleistung für den Verlauf-Agenten: automatische
  // Zwischenspeicherungen sollen nicht bei jedem Tastendruck aufploppen).
  async function speichern(next: BlitztextSettings, opts?: { still?: boolean }): Promise<void> {
    try {
      const uebernommen = await window.blitztext.settings.save(next)
      setSettings(next)
      if (opts?.still) return
      if (uebernommen === false) {
        zeige('Gespeichert — wird nach der laufenden Aufnahme übernommen.', 'info')
      } else {
        zeige('Gespeichert.', 'erfolg')
      }
    } catch (err) {
      zeige(`Speichern fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`, 'fehler')
    }
  }

  // „?"-Brücke (P1): springt zur Hilfe beim passenden Topic. Auf about/help ausgeblendet.
  function oeffneHilfe(s: Section): void {
    versucheNavigation(() => {
      setHilfeTopic(HELP_TOPIC_FUER_SECTION[s])
      setSection('help')
    })
  }

  // Alle Daten-/Konfig-Ansichten nutzen die Zwei-Ebenen-Navigation (volle Höhe/Breite); nur Übersicht
  // und Über bleiben zentriert. WICHTIG: Einstellungen rendert intern eine ZweiEbenenShell und MUSS
  // daher hier (nicht im zentrierten max-w-3xl-Zweig) laufen, sonst wird sie gequetscht.
  const zweiEbenen =
    section === 'workflows' ||
    section === 'history' ||
    section === 'stats' ||
    section === 'settings' ||
    section === 'help'

  const renderNav = (items: NavItem[]): ReactNode =>
    items.map(({ id, label, icon: Icon }) => (
      <button
        key={id}
        type="button"
        onClick={() => versucheNavigation(() => setSection(id))}
        className={cn(
          'flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
          section === id
            ? 'bg-sidebar-accent text-sidebar-accent-foreground'
            : 'text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground'
        )}
      >
        <Icon className="size-4 shrink-0" />
        {label}
      </button>
    ))

  return (
    <div className="flex h-full bg-background text-foreground">
      <aside
        inert={wizardSichtbar}
        className="flex w-56 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground"
      >
        <div className="px-5 py-5 text-lg font-semibold tracking-tight">
          Blitztext <span className="text-sm font-normal text-muted-foreground">für Windows</span>
        </div>
        <nav className="flex flex-1 flex-col gap-1 px-2">{renderNav(NAV_TOP)}</nav>
        <nav className="flex flex-col gap-1 px-2 pb-3">{renderNav(NAV_BOTTOM)}</nav>
      </aside>

      <main inert={wizardSichtbar} className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex shrink-0 items-center justify-between border-b px-8 py-5">
          <h1 className="text-xl font-semibold tracking-tight">{TITEL[section]}</h1>
          <div className="flex items-center gap-3">
            {/* C4: dezenter Live-Indikator — nur sichtbar, während eine Aufnahme/Verarbeitung läuft
                (workflow:status aus dem Main-Prozess). Rein informativ, kein interaktives Element. */}
            {workflowStatus.sichtbar && (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className="size-2 animate-pulse rounded-full bg-emerald-500" aria-hidden />
                <span>{workflowStatus.label}</span>
              </div>
            )}
            {section !== 'about' && section !== 'help' && (
              <button
                type="button"
                onClick={() => oeffneHilfe(section)}
                title="Hilfe zu dieser Seite"
                aria-label="Hilfe zu dieser Seite"
                className="cursor-pointer rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-sidebar-accent/60 hover:text-foreground"
              >
                <HelpCircle className="size-5" />
              </button>
            )}
          </div>
        </header>
        {zweiEbenen ? (
          <div className="min-h-0 flex-1">
            {section === 'help' ? (
              <HilfeView zielTopic={hilfeTopic} />
            ) : settings === null ? (
              <p className="px-8 py-8 text-sm text-muted-foreground">Lade…</p>
            ) : section === 'workflows' ? (
              <WorkflowsView settings={settings} speichern={speichern} />
            ) : section === 'history' ? (
              <VerlaufView settings={settings} speichern={speichern} />
            ) : section === 'stats' ? (
              <StatistikView settings={settings} speichern={speichern} />
            ) : (
              <EinstellungenView settings={settings} speichern={speichern} />
            )}
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-auto">
            <div className="mx-auto max-w-3xl px-8 py-8">
              {section === 'about' ? (
                <AboutView />
              ) : settings === null ? (
                <p className="text-sm text-muted-foreground">Lade…</p>
              ) : (
                <HomeView
                  settings={settings}
                  aufEinstellungen={() => versucheNavigation(() => setSection('settings'))}
                />
              )}
            </div>
          </div>
        )}
      </main>
      {/* W2-S8: Fullscreen-Overlay, solange der Wizard nicht abgeschlossen/übersprungen wurde. Minimal-
          invasiv über der bestehenden Shell gerendert (KEINE neue Sidebar-Section). */}
      {wizardSichtbar && (
        <OnboardingWizard
          settings={settings}
          speichern={speichern}
          onAbschluss={() => void speichern({ ...settings, onboardingAbgeschlossen: true })}
        />
      )}
    </div>
  )
}

function HomeView({
  settings,
  aufEinstellungen
}: {
  settings: BlitztextSettings
  aufEinstellungen: () => void
}) {
  // P1: Kaltstart-Status aus der HARTEN Quelle (apiKey.has = Vault). Beim Mount + bei Anbieter-Änderung
  // neu prüfen → nach Key-Test (Wechsel Einstellungen→Übersicht) ist das Banner ohne Neustart frisch.
  const [keyMap, setKeyMap] = useState<Record<string, boolean> | null>(null)
  useEffect(() => {
    let aktiv = true
    Promise.all(
      settings.anbieter.map(
        async (a) => [a.id, await window.blitztext.apiKey.has(a.id)] as const
      )
    ).then((paare) => {
      if (aktiv) setKeyMap(Object.fromEntries(paare))
    })
    return () => {
      aktiv = false
    }
  }, [settings.anbieter])

  const kaltstart = keyMap
    ? berechneKaltstart({
        standardAnbieterId: settings.standardAnbieterId,
        anbieter: settings.anbieter,
        workflows: settings.workflows,
        hatKey: (id) => keyMap[id] ?? false
      })
    : null

  return (
    <div className="flex flex-col gap-4">
      {kaltstart?.rot && (
        <Card className="border-destructive">
          <CardContent className="flex items-center justify-between gap-4 p-5">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-destructive">Kein gültiger API-Key</p>
              <p className="text-sm text-muted-foreground">
                Ohne getesteten API-Key des Standard-Anbieters ist Blitztext nicht nutzbar.
              </p>
            </div>
            <Button onClick={aufEinstellungen}>Key hinterlegen</Button>
          </CardContent>
        </Card>
      )}
      {kaltstart && kaltstart.gelbeWorkflows.length > 0 && (
        <Card className="border-warning">
          <CardContent className="p-5">
            <p className="text-sm font-medium text-warning">Workflows ohne Key</p>
            <p className="text-sm text-muted-foreground">
              Diese Workflows nutzen einen Anbieter ohne hinterlegten Key:{' '}
              {kaltstart.gelbeWorkflows.join(', ')}.
            </p>
          </CardContent>
        </Card>
      )}
      <Card>
        <CardContent className="p-5">
          <p className="text-sm text-muted-foreground">
            Halte deinen Hotkey, sprich, lass los — Blitztext fügt den Text ins aktive Fenster ein.
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="flex flex-col gap-2 p-5">
          <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Aktive Hotkeys
          </h2>
          {settings.workflows.map((w) => {
            const chord = settings.hotkeys[w.id] ?? []
            return (
              <div key={w.id} className="flex items-start justify-between gap-3 text-sm">
                <div className="min-w-0">
                  <span>{w.label}</span>
                  {w.summary && <p className="text-xs text-muted-foreground">{w.summary}</p>}
                </div>
                <span className="shrink-0 font-mono text-xs text-muted-foreground">
                  {chord.length > 0 ? chordLabel(chord) : '—'}
                </span>
              </div>
            )
          })}
        </CardContent>
      </Card>
    </div>
  )
}

function AboutView() {
  const [version, setVersion] = useState('…')
  useEffect(() => {
    window.blitztext
      .getAppVersion()
      .then(setVersion)
      .catch(() => setVersion('unbekannt'))
  }, [])

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 p-5">
        <div>
          <p className="text-base font-semibold">Blitztext für Windows</p>
          <p className="text-sm text-muted-foreground">Version {version}</p>
        </div>
        <p className="text-sm">© 2026 edo-dzell</p>
        <div className="border-t pt-4 text-sm text-muted-foreground">
          <p>
            Basiert auf <span className="font-medium text-foreground">Blitztext</span> (macOS) —
            © 2026 Blitztext contributors, MIT-Lizenz.
          </p>
          <p className="mt-1 font-mono text-xs">github.com/cmagnussen/blitztext-app</p>
        </div>
        <p className="text-xs text-muted-foreground">MIT-Lizenz · siehe LICENSE im Projekt.</p>
      </CardContent>
    </Card>
  )
}
