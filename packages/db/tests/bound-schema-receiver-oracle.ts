/**
 * Native hooks keep the declared mutation schema until query identity changes.
 * The schema guide's input/output contract and the optimistic-history contract
 * require held updates to expose transformed rows and handler payloads, then
 * restore the authored source rows. Sync publications remain unparsed.
 *
 * This property receives the existing bounded schema law: valid synchronous
 * absent/trim/uppercase schemas, explicit string keys and settled updates before
 * replacement. It makes no typed-schema, provider, SSR or concurrent-render claim.
 */
import {
  boundSchemaCuts,
  boundSchemaGrammar,
  checkBoundSchemaMutation,
  checkBoundSchemaRows,
  checkBoundSchemaValues,
  modelBoundSchemaBinding,
  modelBoundSchemaMutation,
  modelBoundSchemaRows,
} from './live-query-bound-options-oracle'
import { declareOracle, differs, pass, violation } from './oracle-config'
import type {
  BoundSchemaHistory,
  BoundSchemaObservation,
  BoundSchemaPhase,
  BoundSchemaRow,
} from './live-query-bound-options-oracle'
import type { Observation, Verdict } from './oracle-config'

export type BoundSchemaReceiverHistory = BoundSchemaHistory & {
  sourceRows: ReadonlyArray<BoundSchemaRow>
  retainedSourceLabel: string
  reboundSourceLabel: string
}

// Source rows and source publications are history inputs. Expected mutations
// come from the existing independent schema model, never the fixture parser or
// a hook result. Each cut retains its own rows so a later result hides nothing.
export function modelBoundSchemaReceiver(history: BoundSchemaReceiverHistory) {
  const initial = history.sourceRows.map((row) => ({ ...row }))
  const retained = initial.map((row, index) =>
    index === 0 ? { ...row, label: history.retainedSourceLabel } : { ...row },
  )
  const rebound = retained.map((row, index) =>
    index === 0 ? { ...row, label: history.reboundSourceLabel } : { ...row },
  )
  const cut = (
    checkpoint: string,
    phase: BoundSchemaPhase,
    base: ReadonlyArray<BoundSchemaRow>,
    held = false,
  ) => ({
    checkpoint,
    rows: modelBoundSchemaRows(
      base,
      modelBoundSchemaBinding(history, phase).key,
    ),
    mutation: held ? modelBoundSchemaMutation(history, phase, base) : undefined,
  })
  return {
    cuts: [
      cut(`initial-source-raw`, `initial`, initial),
      cut(`initial-held`, `initial`, initial, true),
      cut(`initial-settled`, `initial`, initial),
      cut(`retained-held`, `retained`, initial, true),
      cut(`retained-settled`, `retained`, initial),
      cut(`retained-source-raw`, `retained`, retained),
      cut(`rebound-source-raw`, `rebound`, retained),
      cut(`rebound-held`, `rebound`, retained, true),
      cut(`rebound-settled`, `rebound`, retained),
      cut(`rebound-followup-source-raw`, `rebound`, rebound),
      cut(`rebound-followup-held`, `rebound`, rebound, true),
      cut(`rebound-followup-settled`, `rebound`, rebound),
    ],
    reach: boundSchemaCuts.map(
      (name) => `${boundSchemaGrammar(history)}/${name}`,
    ),
  }
}

// This is the same shared row/payload judgment used by the legacy React
// receiver. Reference booleans preserve only the relations it checked. Every
// case requires all twelve cuts and reach entries, including the next update
// after replacement and the later source publication; omissions fail directly.
// Judge recorded facts in their observed order before requiring later cuts. An
// earlier wrong binding or held result must survive a subsequent driver error.
export function checkBoundSchemaReceiver(
  _history: BoundSchemaReceiverHistory,
  trace: ReadonlyArray<Observation>,
  expected: ReturnType<typeof modelBoundSchemaReceiver>,
): Verdict {
  for (const entry of trace) {
    const { checkpoint, value } = entry
    if (checkpoint === `retained binding` || checkpoint === `rebound binding`) {
      const wrong = differs(
        checkpoint,
        `bound schema binding`,
        value,
        checkpoint === `retained binding`
          ? { collection: true, getKey: true, schema: true }
          : { collection: false },
      )
      if (wrong) return wrong
      continue
    }
    if (checkpoint === `handler hold`) {
      const wrong = differs(checkpoint, `bound schema hold`, value, true)
      if (wrong) return wrong
      continue
    }
    if (checkpoint === `reach`) {
      if (!expected.reach.includes(value as string))
        return violation(checkpoint, `unknown state`, `bound schema reach`)
      continue
    }
    const cut = expected.cuts.find(
      (candidate) => candidate.checkpoint === checkpoint,
    )
    if (!cut)
      return violation(
        checkpoint,
        `unexpected observation`,
        `bound schema history`,
      )
    const actual = value as BoundSchemaObservation & { settled: boolean }
    if (cut.mutation) {
      if (actual.settled !== false)
        return violation(
          cut.checkpoint,
          `handler settled while held`,
          `bound schema hold`,
        )
      try {
        checkBoundSchemaMutation(actual, cut.mutation, cut.checkpoint)
      } catch (error) {
        return violation(cut.checkpoint, String(error), `bound schema mutation`)
      }
    } else {
      try {
        checkBoundSchemaRows(
          actual.collection,
          cut.rows,
          `${cut.checkpoint}/Collection`,
        )
        checkBoundSchemaRows(
          actual.state,
          cut.rows,
          `${cut.checkpoint}/host state`,
        )
        checkBoundSchemaValues(
          actual.data,
          cut.rows.map(({ value: row }) => row),
          `${cut.checkpoint}/host data`,
        )
      } catch (error) {
        return violation(cut.checkpoint, String(error), `bound schema rows`)
      }
    }
  }
  // Completeness is checked only after every recorded fact has been judged.
  for (const cut of expected.cuts) {
    const entries = trace.filter(
      ({ checkpoint }) => checkpoint === cut.checkpoint,
    )
    if (entries.length !== 1)
      return violation(
        cut.checkpoint,
        `expected one observation`,
        `bound schema history`,
      )
  }
  for (const [checkpoint, value] of [
    [`retained binding`, { collection: true, getKey: true, schema: true }],
    [`rebound binding`, { collection: false }],
  ] as const) {
    const entries = trace.filter((entry) => entry.checkpoint === checkpoint)
    const wrong = differs(
      checkpoint,
      `bound schema binding`,
      entries.map((entry) => entry.value),
      [value],
    )
    if (wrong) return wrong
  }
  const holds = trace
    .filter(({ checkpoint }) => checkpoint === `handler hold`)
    .map(({ value }) => value)
  const hold = differs(`handler hold`, `bound schema hold`, holds, [
    true,
    true,
    true,
    true,
  ])
  if (hold) return hold
  const reach = differs(
    `reach`,
    `bound schema reach`,
    trace
      .filter(({ checkpoint }) => checkpoint === `reach`)
      .map(({ value }) => value),
    expected.reach,
  )
  if (reach) return reach
  if (trace.length !== 30)
    return violation(
      `history`,
      `unexpected observations`,
      `bound schema history`,
    )
  return pass
}

declareOracle({
  model: [modelBoundSchemaReceiver],
  check: [checkBoundSchemaReceiver],
})
