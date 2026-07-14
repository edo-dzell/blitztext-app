import { useEffect, useState } from 'react'
// REINE Logik aus @main (framework-unabhängig, vom Renderer-Build via @main-Alias gebündelt). Gleiche,
// bewusste Ausnahme zur Architektur-Lint-Regel wie WorkflowEditor.tsx (prompt-builder, R2/#10) —
// pillenStatus ist eine reine Mapping-Funktion (Phase → sichtbar/label), kein Main-/Electron-Code.
// eslint-disable-next-line @typescript-eslint/no-restricted-imports
import { pillenStatus, type PillenStatus } from '@main/window/pill-status'

const LEER: PillenStatus = { sichtbar: false, label: '' }

// C4: Live-Workflow-Status fürs Settings-Fenster (Header-Indikator). Abonniert
// window.blitztext.workflowStatus.onChanged (Muster wie use-theme.ts) und mappt die rohe Phase über
// dieselbe pillenStatus-Funktion, die auch die Status-Pille im Recorder-Fenster speist — nur
// sichtbar/label werden genutzt (pillenStatus kann um weitere Felder wie dauerMs erweitert werden,
// ohne dass dieser Hook etwas davon sieht).
export function useWorkflowStatus(): PillenStatus {
  const [status, setStatus] = useState<PillenStatus>(LEER)

  useEffect(() => {
    const abmelden = window.blitztext.workflowStatus.onChanged((phase) => {
      const s = pillenStatus(phase)
      setStatus({ sichtbar: s.sichtbar, label: s.label })
    })
    return () => {
      abmelden?.()
    }
  }, [])

  return status
}
