import { rename, rm } from 'node:fs/promises'

// Atomares Ersetzen unter Windows ist nicht trivial (RESEARCH R2): `rename` über ein existierendes
// Ziel kann EEXIST werfen, und Virenscanner sperren die neue Datei kurz (EPERM/EBUSY). Daher: in eine
// temporäre Datei schreiben und mit Retry umbenennen — so wird die Zieldatei nie halb geschrieben.
//
// Neutrales fs-Modul (v0.7.3, A3): wörtlich aus ciphertext-file.ts gehoben, damit settings-file.ts
// und stats-file.ts dieselbe Windows-erprobte Ersetzung teilen, ohne settings→secrets zu koppeln.
export async function ersetzeAtomar(von: string, nach: string, versuche = 6): Promise<void> {
  for (let i = 0; i < versuche; i++) {
    try {
      await rename(von, nach)
      return
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'EEXIST') {
        await rm(nach, { force: true }) // Windows: Ziel zuerst entfernen, dann umbenennen
        continue
      }
      if ((code === 'EPERM' || code === 'EBUSY') && i < versuche - 1) {
        await new Promise((r) => setTimeout(r, 25 * (i + 1))) // AV-Lock kurz abwarten
        continue
      }
      throw error
    }
  }
}
