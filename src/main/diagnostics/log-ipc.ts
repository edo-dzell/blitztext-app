// v0.7.2 „Ereignislog": Validierung der aus dem Renderer über `log:schreibe` (fire-and-forget)
// gemeldeten Log-Nachrichten. Der Renderer ist UNTRUSTED — alles wird defensiv geprüft, gleicher
// Stil wie der `health:diagnose`-Handler in index.ts: bei jedem Verstoß lieber verwerfen als raten.
//
// Bewusst KEIN debug aus dem Renderer (nur info/warnung/fehler): das Debug-Gate steuert der Main
// über `BLITZTEXT_DEBUG`, ein Renderer soll es nicht umgehen können. Der Ereignis-Slug bekommt hier
// zwingend das Präfix `renderer.` — so kann keine Renderer-Nachricht ein Main-Ereignis (z. B.
// `app.fatal`) im Log vortäuschen (Spoofing-Schutz).

import type { LogFelder } from './ereignis-log'

/** Nur diese drei Stufen dürfen aus dem Renderer kommen (kein debug). */
type RendererStufe = 'info' | 'warnung' | 'fehler'

export interface RendererLogNachricht {
  stufe: RendererStufe
  /** Ereignis-Slug MIT vorangestelltem `renderer.`-Präfix (Spoofing-Schutz). */
  ereignis: string
  felder?: LogFelder
}

// Erlaubte Renderer-Stufen (kein debug).
const ERLAUBTE_STUFEN: readonly RendererStufe[] = ['info', 'warnung', 'fehler']
// Roh-Ereignis-Slug wie im Port: bereich.aktion-Form, konservativ begrenzt.
const EREIGNIS_MUSTER = /^[a-z0-9._-]{1,64}$/i
// Erlaubte Feld-Keys — identisch zur Port-Regel (keine Punkte/Bindestriche).
const FELD_KEY_MUSTER = /^[a-zA-Z0-9_]{1,32}$/
// Höchstzahl der übernommenen Felder (überzählige werden ignoriert, nicht abgelehnt).
const MAX_FELDER = 10
// Kürzungsgrenze für String-Werte (zusätzlich zur Kürzung im Formatierer).
const MAX_WERT_LAENGE = 200

/** true, wenn `wert` ein loggbares Primitiv ist (String/Number/Boolean, keine Sonderwerte-Prüfung). */
function istPrimitiv(wert: unknown): wert is string | number | boolean {
  const typ = typeof wert
  return typ === 'string' || typ === 'number' || typ === 'boolean'
}

/**
 * Übernimmt aus einem beliebigen Objekt bis zu MAX_FELDER gültige Feld-Einträge: Key nach Muster,
 * Wert ein Primitiv, String-Werte auf MAX_WERT_LAENGE gekürzt. Ungültige Einträge werden still
 * verworfen (nie die ganze Nachricht ablehnen — der Steuerzeichenfilter/das finale Format erledigt
 * der Port beim Schreiben zusätzlich). Rückgabe `undefined`, wenn kein einziges Feld übrig bleibt.
 */
function parseFelder(roh: unknown): LogFelder | undefined {
  if (typeof roh !== 'object' || roh === null || Array.isArray(roh)) return undefined
  const felder: LogFelder = {}
  let anzahl = 0
  for (const key of Object.keys(roh)) {
    if (anzahl >= MAX_FELDER) break
    if (!FELD_KEY_MUSTER.test(key)) continue
    const wert = (roh as Record<string, unknown>)[key]
    if (!istPrimitiv(wert)) continue
    felder[key] = typeof wert === 'string' && wert.length > MAX_WERT_LAENGE ? wert.slice(0, MAX_WERT_LAENGE) : wert
    anzahl++
  }
  return anzahl > 0 ? felder : undefined
}

/**
 * Validiert eine rohe, aus dem Renderer gesendete Log-Nachricht. Erwartet ein Objekt
 * `{ stufe, ereignis, felder? }`. Bei jedem strukturellen Verstoß (falscher Typ, unbekannte Stufe,
 * Slug-Regex-Verstoß) → `null`; der Aufrufer (index.ts `log:schreibe`) tut dann nichts. Erfolgt die
 * Prüfung, trägt das Ergebnis-`ereignis` das Präfix `renderer.` (Spoofing-Schutz).
 */
export function parseRendererLog(roh: unknown): RendererLogNachricht | null {
  if (typeof roh !== 'object' || roh === null || Array.isArray(roh)) return null
  const obj = roh as Record<string, unknown>

  const stufe = obj['stufe']
  if (typeof stufe !== 'string' || !ERLAUBTE_STUFEN.includes(stufe as RendererStufe)) return null

  const ereignis = obj['ereignis']
  if (typeof ereignis !== 'string' || !EREIGNIS_MUSTER.test(ereignis)) return null

  const felder = parseFelder(obj['felder'])

  return {
    stufe: stufe as RendererStufe,
    ereignis: `renderer.${ereignis}`,
    ...(felder ? { felder } : {})
  }
}
