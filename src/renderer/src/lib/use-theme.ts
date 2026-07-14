import { useEffect } from 'react'
import type { BlitztextSettings } from '@main/settings/store'

// Wendet das gewählte Farbschema auf <html> an: .dark-Klasse + color-scheme (für native Controls,
// Popups, Scrollbars). 'system' folgt nativeTheme aus dem Main (IPC); 'hell'/'dunkel' sind fix.
export function useTheme(theme: BlitztextSettings['theme'] | undefined): void {
  useEffect(() => {
    if (!theme) return
    const wende = (dark: boolean): void => {
      const root = document.documentElement
      root.classList.toggle('dark', dark)
      root.style.colorScheme = dark ? 'dark' : 'light'
    }
    if (theme === 'dunkel') return wende(true)
    if (theme === 'hell') return wende(false)
    // 'system': Initialwert holen + auf Änderungen lauschen.
    let abgemeldet = false
    void window.blitztext.theme.systemDark().then((dark) => {
      if (!abgemeldet) wende(dark)
    })
    // S21-Rest (Listener-Leak): onSystemChanged registriert bei jedem Effect-Lauf einen neuen
    // ipcRenderer-Listener; ohne Abmeldung akkumulieren sie (bei jedem Theme-Wechsel hin zu
    // 'system', StrictMode-Doppel-Mount etc.). preload/index.ts liefert (Muster wie
    // history.onChanged) jetzt eine echte Abmelde-Funktion zurück (removeListener auf dieselbe
    // Listener-Referenz) → hier zusätzlich zum `abgemeldet`-Flag aufgerufen, damit sowohl der
    // sichtbare Effekt (falsches Theme nach Wechsel) als auch die zugrundeliegende
    // ipcRenderer-Listener-Akkumulation behoben sind.
    const abgemeldeteWende = (dark: boolean): void => {
      if (!abgemeldet) wende(dark)
    }
    const abmelden = window.blitztext.theme.onSystemChanged(abgemeldeteWende)
    return () => {
      abgemeldet = true
      abmelden?.()
    }
  }, [theme])
}
