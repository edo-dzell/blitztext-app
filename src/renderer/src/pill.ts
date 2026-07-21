// Renderer der Status-Pille (ADR-0007/0009): zeigt nur das vom Main-Prozess gesendete Phasen-Label.
// Kein UI-Zustand, kein Design-System (v1, bewusst minimal). Sichtbarkeit/Position steuert der Main.

declare global {
  interface Window {
    blitztextPill: {
      onStatus(cb: (label: string) => void): void
    }
  }
}

const el = document.getElementById('pille')
window.blitztextPill.onStatus((label) => {
  if (el) el.textContent = label
})

// v0.7.2 „Ereignislog": unerwartete Fehler im Pillen-Renderer als Feld-Beleg für die Fehlerjagd
// („Pille fehlt/hängt") sichtbar machen. Nur die redigierte, gekürzte message — nie Diktat-/Textinhalt.
// Das Logging darf NIE selbst werfen (still gefangen), sonst würde ein Log-Fehler den Handler stören.
window.addEventListener('error', (e) => {
  try {
    window.blitztext?.log?.schreibe('fehler', 'pill.fehler', {
      message: String(e.message).slice(0, 200)
    })
  } catch {
    // Log-Bridge fehlt oder wirft → still verschlucken.
  }
})

export {}
