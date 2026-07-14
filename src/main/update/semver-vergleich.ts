// Minimaler, abhängigkeitsfreier SemVer-Vergleich (Kern von `pruefeAufUpdate`). Deckt nur, was für
// den Update-Hinweis gebraucht wird: MAJOR.MINOR.PATCH + optionaler Pre-Release-Suffix
// (`-beta.1`, `-rc.2` …). Build-Metadaten (`+...`) werden ignoriert (SemVer-Spec: kein Einfluss auf
// Vorrang). Kein Anspruch auf volle SemVer-2.0.0-Konformität (z. B. keine Pre-Release-Feld-für-Feld-
// Sortierung) — reicht für „ist die Remote-Version neuer als die lokale?".

export interface ZerlegteVersion {
  major: number
  minor: number
  patch: number
  /** Pre-Release-Suffix ohne führenden Bindestrich, z. B. „beta.1"; fehlt bei stabilen Versionen. */ preRelease?: string
}

/**
 * Parst eine Versionsangabe („v0.5.0", „0.5.0-beta.1" …). Führendes „v"/"V" wird toleriert (übliche
 * GitHub-Tag-Konvention). Liefert `null` bei nicht interpretierbarem Format, statt zu werfen — der
 * Aufrufer (pruefeAufUpdate) behandelt das als „kein Update" statt abzustürzen.
 */
export function parseVersion(rohtext: string): ZerlegteVersion | null {
  const bereinigt = rohtext.trim().replace(/^[vV]/, '')
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/.exec(bereinigt)
  if (!match) return null
  const [, major, minor, patch, preRelease] = match
  return {
    major: Number(major),
    minor: Number(minor),
    patch: Number(patch),
    preRelease: preRelease || undefined
  }
}

/**
 * true, wenn `remote` gegenüber `lokal` eine echte Versionserhöhung ist (SemVer-Vorrangregeln:
 * MAJOR.MINOR.PATCH numerisch, danach Pre-Release < Stable bei sonst gleichem Kern). Nicht
 * interpretierbare Eingaben (kaputtes Tag-Format) gelten als „nicht neuer" (Fail-safe: lieber keinen
 * Hinweis zeigen als einen falschen).
 */
export function istNeuer(remote: string, lokal: string): boolean {
  const r = parseVersion(remote)
  const l = parseVersion(lokal)
  if (!r || !l) return false

  if (r.major !== l.major) return r.major > l.major
  if (r.minor !== l.minor) return r.minor > l.minor
  if (r.patch !== l.patch) return r.patch > l.patch

  // Gleicher Kern (X.Y.Z). SemVer-Vorrang: eine Pre-Release-Version hat NIEDRIGEREN Vorrang als die
  // zugehörige stabile Version → „remote hat Pre-Release, lokal nicht" ist NICHT neuer.
  if (r.preRelease && !l.preRelease) return false
  if (!r.preRelease && l.preRelease) return true // lokal ist ein Pre-Release des gleichen Kerns → remote (stable) ist neuer
  if (r.preRelease && l.preRelease) return r.preRelease > l.preRelease // grobe lexikographische Ordnung reicht hier

  return false // exakt gleich
}
