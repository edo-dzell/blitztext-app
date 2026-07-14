// C2: reine Helfer für die Verlauf-Sortier-Affordance. Kein React/State — nur Typ + zwei Funktionen,
// damit VerlaufView und die Persistenz (store.ts) denselben Wertebereich teilen.

export type VerlaufSortierung = 'neuesteZuerst' | 'aeltesteZuerst'

export function istNeuesteZuerst(s: VerlaufSortierung): boolean {
  return s === 'neuesteZuerst'
}

export function toggleSortierung(s: VerlaufSortierung): VerlaufSortierung {
  return s === 'neuesteZuerst' ? 'aeltesteZuerst' : 'neuesteZuerst'
}
