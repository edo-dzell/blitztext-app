import { useEffect, useState } from 'react'
import { geraeteliste, aufgeloesteGeraetewahl, type MikrofonGeraet } from '@/lib/mikrofon-auswahl'
import { Select } from '@/components/ui/select'
import { Field } from '@/components/ui/field'

// W3-ζ: Mikrofon-Auswahl. Speist sich aus enumerateDevices() (Renderer-API) + geraeteliste() (reine
// Filter-Logik). „Automatisch (Standard)" = leere deviceId (OS-Standardgerät, rückwärtskompatibel).
// Labels sind leer, solange keine Mikrofon-Berechtigung erteilt wurde — dann greift der Fallback-Text.
// Reale Geräte-Enumeration ist HITL-only (Windows/Berechtigung); headless liefert enumerateDevices [].
export default function MikrofonFeld({
  gewaehlt,
  aendere
}: {
  gewaehlt: string
  aendere: (id: string) => void
}) {
  const [geraete, setGeraete] = useState<MikrofonGeraet[]>([])

  useEffect(() => {
    let abgemeldet = false
    async function lade() {
      try {
        const alle = await navigator.mediaDevices.enumerateDevices()
        if (!abgemeldet) setGeraete(geraeteliste(alle))
      } catch {
        if (!abgemeldet) setGeraete([]) // keine Berechtigung/kein Zugriff → nur „Automatisch"
      }
    }
    void lade()
    return () => {
      abgemeldet = true
    }
  }, [])

  // Fallback-Auflösung: eine gespeicherte, aber nicht (mehr) vorhandene deviceId zeigt „Automatisch".
  const aktiv = aufgeloesteGeraetewahl(gewaehlt || undefined, geraete.map((g) => g.id)) ?? ''

  return (
    <Field
      label="Mikrofon"
      hint='Aufnahmegerät für das Diktieren. „Automatisch" nutzt das Windows-Standardgerät. Gerätenamen erscheinen erst nach erteilter Mikrofon-Berechtigung.'
    >
      <Select value={aktiv} onChange={(e) => aendere(e.target.value)}>
        <option value="">Automatisch (Standard)</option>
        {geraete.map((g, i) => (
          <option key={g.id || i} value={g.id}>
            {g.label || `Mikrofon ${i + 1}`}
          </option>
        ))}
      </Select>
    </Field>
  )
}
