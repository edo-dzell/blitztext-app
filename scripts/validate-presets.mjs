// Validiert jedes presets/*/preset.json GEGEN DIE ECHTE Import-Validierung der App
// (`parseImportierterWorkflow` in src/shared/workflows.ts) — keine Nachbildung, kein Drift.
//
// Läuft dank Node's nativer TypeScript-Typlöschung (Node >=22.6, unflagged ab 22.18; CI/README
// verlangen ohnehin Node 22) per direktem `import()` der .ts-Datei — KEINE neue Abhängigkeit nötig.
// `workflows.ts` verwendet nur Typen/Interfaces (kein enum/namespace/Parameter-Properties), ist also
// "erasable syntax" und damit für Node's Typlöschung unproblematisch.
//
// Geprüft wird bewusst nur die Hülle + Pflichtfelder, die `parseImportierterWorkflow` akzeptiert
// (siehe Doku dort): Presets liefern nie 'builtin'/'id'/'anbieterId'/'promptHistorie' — diese vergibt
// erst der Import. Ein Preset gilt als gültig, wenn der Parser KEIN `null` liefert.

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PRESETS_DIR = join(ROOT, 'presets')

async function ladeParser() {
  const mod = await import(join(ROOT, 'src', 'shared', 'workflows.ts'))
  if (typeof mod.parseImportierterWorkflow !== 'function') {
    throw new Error(
      'parseImportierterWorkflow nicht exportiert von src/shared/workflows.ts — Format-Drift?'
    )
  }
  return mod.parseImportierterWorkflow
}

function findePresetOrdner() {
  return readdirSync(PRESETS_DIR).filter((name) => statSync(join(PRESETS_DIR, name)).isDirectory())
}

async function main() {
  const parseImportierterWorkflow = await ladeParser()
  const ordner = findePresetOrdner()

  if (ordner.length === 0) {
    console.error(`validate-presets: keine Ordner unter ${PRESETS_DIR} gefunden.`)
    process.exit(1)
  }

  let fehler = 0
  for (const slug of ordner) {
    const presetPfad = join(PRESETS_DIR, slug, 'preset.json')
    const readmePfad = join(PRESETS_DIR, slug, 'README.md')

    let roh
    try {
      roh = readFileSync(presetPfad, 'utf-8')
    } catch {
      console.error(`✗ ${slug}: preset.json fehlt (${presetPfad})`)
      fehler++
      continue
    }

    let json
    try {
      json = JSON.parse(roh)
    } catch (e) {
      console.error(`✗ ${slug}: preset.json ist kein gültiges JSON (${e.message})`)
      fehler++
      continue
    }

    const ergebnis = parseImportierterWorkflow(json, [])
    if (ergebnis === null) {
      console.error(`✗ ${slug}: von parseImportierterWorkflow abgelehnt (Format ungültig)`)
      fehler++
      continue
    }

    try {
      statSync(readmePfad)
    } catch {
      console.error(`✗ ${slug}: README.md fehlt (${readmePfad})`)
      fehler++
      continue
    }

    console.log(`✓ ${slug}: gültig ("${ergebnis.label}", model=${ergebnis.model || '(Standard)'})`)
  }

  if (fehler > 0) {
    console.error(`\nvalidate-presets: ${fehler} Fehler.`)
    process.exit(1)
  }
  console.log(`\nvalidate-presets: alle ${ordner.length} Presets gültig.`)
}

main().catch((e) => {
  console.error('validate-presets: unerwarteter Fehler:', e)
  process.exit(1)
})
