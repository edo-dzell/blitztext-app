// Barrel der Selbstdiagnose (Slice W3-ε): reine Check-Funktionen + Aggregat, alle hinter
// injizierbaren Ports. BEWUSST OHNE echte Adapter-Verdrahtung (Electron/IPC/uiohook) — das macht
// Staffel 3.2 (Ampel-UI), analog zum Split zwischen `secrets/api-key-vault.ts` (reiner Kern) und
// `secrets/index.ts` (echte Adapter, hier absichtlich nicht nachgebaut).

export type { HealthStatus, HealthErgebnis } from './types'
export { schlechtererStatus } from './types'

export { pruefeApiKey, type ApiKeyPort, type PruefeApiKeyDeps } from './pruefe-api-key'
export {
  pruefeErreichbarkeit,
  type ErreichbarkeitsPort,
  type ErreichbarkeitsErgebnis,
  type PruefeErreichbarkeitDeps
} from './pruefe-erreichbarkeit'
export { pruefeMikrofon, type MikrofonPort, type PruefeMikrofonDeps } from './pruefe-mikrofon'
export {
  pruefeHotkeyHook,
  type HotkeyHookPort,
  type PruefeHotkeyHookDeps
} from './pruefe-hotkey-hook'

export { fuehreDiagnose, type DiagnoseDeps, type DiagnoseErgebnis } from './diagnose'
