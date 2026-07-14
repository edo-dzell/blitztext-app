import { type ReactNode } from 'react'
import { Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'

// Wiederverwendbare Zwei-Ebenen-Navigation (ADR-0009, W-1/VL-1): zweites Menüband links (mit
// Aktiv-Hervorhebung im Sidebar-Stil) → großer Detailbereich rechts. Genutzt von Workflows und Verlauf.

export interface BandEintrag {
  id: string
  titel: string
  /** Kleine Beschreibung/Vorschau unter dem Titel. */
  unterzeile?: string
  badge?: ReactNode
  /** Wenn gesetzt: Papierkorb-Symbol je Eintrag (Schnell-Löschen, erscheint beim Überfahren). */
  onLoeschen?: () => void
}

interface Props {
  eintraege: BandEintrag[]
  aktivId: string | null
  onWaehle: (id: string) => void
  /** Optionaler Kopf über dem Band (Beschreibung, Aktionen). */
  bandKopf?: ReactNode
  /** Detailinhalt rechts (für den gewählten Eintrag). */
  children?: ReactNode
  /** Platzhalter im Detailbereich, wenn nichts gewählt ist. */
  leer?: ReactNode
  /** Volle Breite des Detailbereichs statt zentriertem max-w-3xl (P7: Statistik-Tabelle/KPIs). */
  breit?: boolean
}

export default function ZweiEbenenShell({
  eintraege,
  aktivId,
  onWaehle,
  bandKopf,
  children,
  leer,
  breit = false
}: Props) {
  return (
    <div className="flex h-full overflow-hidden">
      {/* Zweites Menüband */}
      <div className="flex w-72 shrink-0 flex-col border-r bg-sidebar">
        {bandKopf && <div className="shrink-0 border-b px-3 py-3">{bandKopf}</div>}
        <div className="flex flex-1 flex-col gap-1 overflow-auto p-2">
          {eintraege.map((e) => (
            <div
              key={e.id}
              className={cn(
                'group flex items-center rounded-md transition-colors',
                aktivId === e.id ? 'bg-sidebar-accent' : 'hover:bg-sidebar-accent/60'
              )}
            >
              <button
                type="button"
                onClick={() => onWaehle(e.id)}
                className={cn(
                  'flex min-w-0 flex-1 cursor-pointer flex-col items-start gap-0.5 px-3 py-2 text-left',
                  aktivId === e.id
                    ? 'text-sidebar-accent-foreground'
                    : 'text-muted-foreground group-hover:text-sidebar-foreground'
                )}
              >
                <span className="flex w-full items-center justify-between gap-2 text-sm font-medium">
                  <span className="truncate">{e.titel}</span>
                  {e.badge}
                </span>
                {e.unterzeile && (
                  <span className="line-clamp-2 w-full text-xs text-muted-foreground">
                    {e.unterzeile}
                  </span>
                )}
              </button>
              {e.onLoeschen && (
                <button
                  type="button"
                  title="Löschen"
                  onClick={e.onLoeschen}
                  className="mr-1 shrink-0 cursor-pointer rounded p-1.5 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100 group-focus-within:opacity-100"
                >
                  <Trash2 className="size-4" />
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Detailbereich */}
      <div className="flex-1 overflow-auto">
        {aktivId !== null ? (
          <div className={breit ? 'px-8 py-8' : 'mx-auto max-w-3xl px-8 py-8'}>{children}</div>
        ) : (
          <div className="flex h-full items-center justify-center p-8 text-center text-sm text-muted-foreground">
            {leer ?? 'Links einen Eintrag wählen.'}
          </div>
        )}
      </div>
    </div>
  )
}
