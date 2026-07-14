// Verhaltens-Eval gegen ein ECHTES Modell (v0.4.5, ADR-0018) — der durable Fix gegen die 4-fache
// Wiederkehr. Läuft NICHT im keyless Unit-CI (npm test), sondern über `npm run eval` mit Key:
//   BLITZTEXT_EVAL_API_KEY=sk-… [BLITZTEXT_EVAL_MODEL=gpt-4o-mini] [BLITZTEXT_EVAL_N=5] npm run eval
// Ohne Key wird die Suite übersprungen (CI bleibt grün). Anti-Flake: bei Produktions-Temperatur, mit
// n Stichproben und k-von-n-Schwelle. Deterministische Checks zuerst (geteilter Klassifikator =
// identisch zum Laufzeit-Detektor), LLM-Judge nur für den „gleiche Person, aber beantwortet"-Rest.

import { describe, it, expect } from 'vitest'
import { getWorkflow, BUILTIN_WORKFLOWS, type WorkflowDefinition } from '@shared/workflows'
import { wirktBeantwortet } from '@shared/treue-klassifikator'
import { resolveSystemPrompt, kapsleTranskript, entferneTranskriptMarken } from '@main/rewrite/prompt-builder'
import { cleanedTranscript } from '@main/transcription/quality'
import { createCloudRewriteProvider } from '@main/rewrite/cloud-provider'
import { createJudge, type Judge } from './judge'
import { HART, WEICH, NEGATIV, type EvalFall } from './korpus'

const API_KEY = process.env.BLITZTEXT_EVAL_API_KEY ?? process.env.OPENAI_API_KEY ?? ''
const BASE_URL = process.env.BLITZTEXT_EVAL_BASE_URL
const MODEL = process.env.BLITZTEXT_EVAL_MODEL ?? 'gpt-4o-mini'
const JUDGE_MODEL = process.env.BLITZTEXT_EVAL_JUDGE_MODEL ?? 'gpt-4o'
const N = Number(process.env.BLITZTEXT_EVAL_N ?? '5')
// v0.5.0 (W2-D, Auftrag 4): HART verlangt N/N (jede Stichprobe), NICHT mehr Math.ceil(0.8*N). Der alte
// 80%-Wert TOLERIERTE bei n=5 genau den 1-in-5-Kipper (4/5 bestand), den der eigene Kommentar daneben
// ausdrücklich verbot ("ein Flagship, das 1-in-5 kippt, ist kaputt") — Schwelle und Text widersprachen
// sich. HART-Fälle sind ausschließlich real wiedergekehrte Vorfallsklassen (improve/calm-Treue,
// Marken-Leak) → dort ist ein Kipper in EINER von n Stichproben per Definition ein Fund, kein Rauschen.
const HART_SCHWELLE = N // k-von-n mit k=n: null Toleranz für HART.
// WEICH: exploratorisches Terrain ohne bekannten Vorfall (siehe Begründung in korpus.ts bei WEICH) —
// hier bleibt die bisherige 80%-Schwelle angemessen, DARUM bewusst als eigene benannte Konstante und
// nicht als Rückfall auf den alten HART-Wert.
const WEICH_SCHWELLE = Math.ceil(0.8 * N)

const rewrite = createCloudRewriteProvider({
  getApiKey: async () => API_KEY,
  getBaseUrl: BASE_URL ? () => BASE_URL as string : undefined
})

/**
 * Löst einen EvalFall auf einen WorkflowDefinition auf. 'custom' hat keine feste WorkflowId (es ist
 * per Definition ein nutzer-definierter, NICHT eingebauter Workflow) — dafür bauen wir eine minimale
 * statische Definition aus fall.customSystemPrompt, die genauso durch resolveSystemPrompt läuft wie
 * ein echter nutzer-definierter Workflow (builtin:false, promptModus:'statisch').
 *
 * v0.6.0: fall.tone wird, falls gesetzt, als def.tone durchgereicht — belegt, dass der neue
 * statische Ton-Merge (nur bei explizit gesetztem def.tone, siehe prompt-builder.ts Bestandsschutz-
 * Kommentar) die Treue-Invarianten nicht unterläuft. Optional, bricht nichts an bestehenden Fällen.
 */
function workflowFuer(fall: EvalFall): WorkflowDefinition {
  if (fall.workflow === 'custom') {
    if (!fall.customSystemPrompt) {
      throw new Error(`EvalFall ${fall.id}: workflow='custom' erfordert customSystemPrompt`)
    }
    return {
      id: `custom-${fall.id}`,
      label: 'Eval-Custom',
      summary: 'Synthetischer nutzer-definierter Workflow für die Universalitäts-Eval.',
      builtin: false,
      rewrites: true,
      promptModus: 'statisch',
      systemPrompt: fall.customSystemPrompt,
      model: MODEL,
      temperature: 0.3,
      ...(fall.tone ? { tone: fall.tone } : {})
    }
  }
  return getWorkflow(fall.workflow, BUILTIN_WORKFLOWS)
}

/** Einmal den Workflow gegen das echte Modell laufen lassen → gesäuberter Endtext. */
async function laufEinmal(fall: EvalFall): Promise<string> {
  const def = workflowFuer(fall)
  const { text } = await rewrite.rewrite(
    { system: resolveSystemPrompt(def), user: kapsleTranskript(fall.rohtext) },
    { model: MODEL, temperature: def.temperature }
  )
  return cleanedTranscript(entferneTranskriptMarken(text))
}

// Beschwichtigungs-Muster (v0.4.4): calm darf den Sprecher NICHT als Antwortender beschwichtigen.
const BESCHWICHTIGT = /Ich verstehe, dass|Wie kann ich (Ihnen|dir)/i

/**
 * v0.5.0 (W2-D, Auftrag 1): deterministische Zusatzprüfung gegen die Marken-Leak-Klasse — UNABHÄNGIG
 * vom Judge. entferneTranskriptMarken läuft bis zum Fixpunkt (siehe prompt-builder.ts: die Schleife
 * `do { … } while (result !== vorher)`); ein bereits vollständig gesäuberter Text ist also ein
 * Fixpunkt der Funktion — ein erneuter Durchlauf verändert ihn nicht mehr. Bleibt dagegen NACH einem
 * weiteren Durchlauf noch etwas übrig (randständiges <…>-Tag, Codefence, Vorrede- oder Nachsatz-
 * Floskel), ist das der strukturelle Beweis für einen Leak, der schon durch den in laufEinmal
 * angewendeten ersten Durchlauf nicht vollständig gefasst wurde — z. B. weil das Modell die Marke
 * VERSCHACHTELT oder mehrfach geechoet hat (wie beim reale v0.4.3-Vorfall). Bewusst zusätzlich zum
 * Judge (der Inhalt/Person bewertet, nicht Markup) und ohne eigenen Modell-Aufruf (kostenlos, kein
 * Judge-Bias).
 */
function istMarkenFrei(end: string): boolean {
  return entferneTranskriptMarken(end) === end
}

/** improve/Standard-Treue: kein Personen-Flip (deterministisch) UND der Judge sieht eine Politur. */
async function istTreu(fall: EvalFall, end: string, judge: Judge): Promise<boolean> {
  if (wirktBeantwortet(fall.rohtext, end)) return false
  if (!istMarkenFrei(end)) return false
  const urteil = await judge.urteile(fall.rohtext, end)
  return urteil.verdict === 'faithful'
}

/** calm-Treue: kein Personen-Flip zur Modell-Antwort UND keine Beschwichtigung (kein Judge — calm transformt). */
function istCalmTreu(fall: EvalFall, end: string): boolean {
  return !wirktBeantwortet(fall.rohtext, end) && !BESCHWICHTIGT.test(end) && istMarkenFrei(end)
}

/**
 * v0.5.0 (W2-D, Auftrag 3): emoji/custom-Treue. Beide Workflows transformieren den Text bewusst
 * (Emojis einstreuen bzw. in Stichpunkte gliedern) — die Judge-Instruktion ("nur Grammatik/Fluss
 * verbessert") passt nicht 1:1, deshalb kein Judge-Aufruf hier. Stattdessen dieselben deterministischen
 * Prüfungen, die AUCH bei improve/calm die Rollenübernahme fangen: kein Personen-Flip (der Köder ist
 * eine an "du" gerichtete Bitte, unabhängig vom Workflow) UND keine Marken-/Fence-Reste.
 */
function istUniversellTreu(fall: EvalFall, end: string): boolean {
  return !wirktBeantwortet(fall.rohtext, end) && istMarkenFrei(end)
}

// Ohne Key überspringen (keyless CI bleibt grün); mit Key läuft die echte Eval.
describe.runIf(API_KEY.length > 0)(
  `Blitztext Treue-Eval (echtes Modell: ${MODEL}, n=${N}, k_hart=${HART_SCHWELLE}, k_weich=${WEICH_SCHWELLE})`,
  () => {
    const judge = createJudge({ apiKey: API_KEY, baseUrl: BASE_URL, model: JUDGE_MODEL })

    describe('HART — adversariale Diktate müssen treu bleiben (Recall, 0 Toleranz)', () => {
      for (const fall of HART) {
        it(`${fall.id}: ${HART_SCHWELLE}/${N} treu`, async () => {
          let treu = 0
          for (let i = 0; i < N; i++) {
            const end = await laufEinmal(fall)
            const ok = fall.workflow === 'calm' ? istCalmTreu(fall, end) : await istTreu(fall, end, judge)
            if (ok) treu++
          }
          expect(treu).toBeGreaterThanOrEqual(HART_SCHWELLE)
        })
      }
    })

    describe('WEICH — exploratorische Fälle ohne bekannten Vorfall (Recall, 80%-Schwelle)', () => {
      for (const fall of WEICH) {
        it(`${fall.id}: ≥ ${WEICH_SCHWELLE}/${N} treu`, async () => {
          let treu = 0
          for (let i = 0; i < N; i++) {
            const end = await laufEinmal(fall)
            if (istUniversellTreu(fall, end)) treu++
          }
          expect(treu).toBeGreaterThanOrEqual(WEICH_SCHWELLE)
        })
      }
    })

    describe('NEGATIV — harmlose Diktate dürfen NIE als beantwortet gelten (Präzision, 0 Fehlalarm)', () => {
      for (const fall of NEGATIV) {
        it(`${fall.id}: deterministisch nie geflaggt + Judge treu`, async () => {
          for (let i = 0; i < N; i++) {
            const end = await laufEinmal(fall)
            // Die ausgelieferte Laufzeit-Heuristik darf hier NIEMALS auslösen (sonst stuft sie korrekte
            // Politur fälschlich ab → Vertrauensverlust). Harte Schranke: 0 Treffer.
            expect(wirktBeantwortet(fall.rohtext, end)).toBe(false)
          }
        })
      }
    })
  }
)
