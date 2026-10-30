import { writeSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { D2 } from '../../src/d2.js'
import { MultiSet } from '../../src/multiset.js'
import { output } from '../../src/operators/index.js'
import { topKWithFractionalIndex } from '../../src/operators/topKWithFractionalIndex.js'
import { groupedTopKWithFractionalIndex } from '../../src/operators/groupedTopKWithFractionalIndex.js'
import {
  oraclePropertyOptions,
  oracleReplayTest,
  oracleRuns,
} from '../../../db/tests/oracle-config.js'
import { declareOracle } from '../../../db/tests/oracle-declaration.js'
import { createOracleReach } from '../../../db/tests/oracle-reach.js'
import { TopKRelation } from './topk-relation-oracle.js'

declareOracle({
  check: [TopKRelation, checkNumericWindow],
  model: [selectedWindowKeys, requestedWindowChanged],
})

/**
 * A top-K window selects support from a signed, typed-key relation.
 *
 * The top-K operator APIs and existing window tests establish selection of
 * present relation rows in key order within an offset/limit window.
 * Fractional-index top-K emits one indexed row for positive support. The
 * model below integrates signed input weights by typed key and selects from a
 * fixed, independently ordered key domain. `TopKRelation` only
 * checks accumulated signed fractional-index output; its companion tests
 * calibrate that checker without exercising production.
 *
 * The grammar covers five finite scalar keys, one fixed payload per key,
 * support 0..3, and offset/limit 0..6. The numeric-window lane also reaches
 * safe-integer offsets and widths near Number.MAX_SAFE_INTEGER. Every input turn and window move has
 * a graph-run checkpoint for output rows and reported window size.
 * The pinned 0/1/2 support crossing and boundary history distinguish presence
 * from raw multiplicity and inclusive from displaced window cuts. Row replacements,
 * multiple groups, negative net support, and downstream lazy acquisition are
 * outside this owner. The numeric lane does observe the empty output message
 * that lets a downstream graph respond to changed requested demand.
 */

const keys = [1, `1`, 2, `2`, `a`] as const
const orderedKeys = [`1`, `2`, `a`, 1, 2] as const
type Key = (typeof keys)[number]
type Row = { id: number; value: string }
type Step = { slot: number; support: number; offset: number; limit: number }
type Window = { offset: number; limit: number }

// Selection is a predicate on each installed row's rank. It never enumerates
// absent ranks or adds offset and width, so large bounds cannot corrupt the
// reference through floating-point addition. Authored offset and width remain
// independent: a later partial move must retain the other exact bound.
function selectedWindowKeys(present: ReadonlyArray<Key>, window: Window) {
  return present.filter(
    (_, rank) => rank >= window.offset && rank - window.offset < window.limit,
  )
}

// A requested window is a set of ranks, independently of installed rows.
// Distinct nonempty windows differ even when both currently select no row.
// Two zero-width windows both request the empty set.
function requestedWindowChanged(before: Window, after: Window): boolean {
  return (
    (before.limit > 0 || after.limit > 0) &&
    (before.offset !== after.offset || before.limit !== after.limit)
  )
}

// The fixed and random campaigns share the same property, recorder, checks,
// and run budget. A path replay of this property selects only its random
// campaign; a seed without a path reseeds it.
const supportWindowProperty = `ivm.topk-support-window`
const runs = oracleRuns(100)
const campaigns = [
  {
    name: `fixed`,
    test: oracleReplayTest(it),
    parameters: { numRuns: runs, seed: 409033 },
  },
  {
    name: `random`,
    test: oracleReplayTest(it, supportWindowProperty),
    parameters: oraclePropertyOptions(100, supportWindowProperty),
  },
]
// Slot chooses typed identity and rank; support chooses the presence crossing;
// offset chooses the first selected rank; limit chooses window width. Removing
// any of these axes loses its corresponding distinction. The grammar rejects
// out-of-range slots, negative net support, and negative or fractional windows.
// The fixed example reaches a zero-width window on present rows, a one-row
// window, an offset beyond all rows, and a return to the original window. The
// same history holds all five keys present and then withdraws support
// partially and finally. A shifted start or inclusive end selects a
// different row at the one-row boundary checkpoint.
const boundaryHistory: Array<Step> = [
  { slot: 0, support: 2, offset: 0, limit: 3 },
  { slot: 0, support: 3, offset: 0, limit: 3 },
  { slot: 1, support: 1, offset: 0, limit: 1 },
  { slot: 2, support: 1, offset: 1, limit: 1 },
  { slot: 3, support: 1, offset: 2, limit: 1 },
  { slot: 4, support: 1, offset: 4, limit: 1 },
  { slot: 0, support: 2, offset: 0, limit: 0 },
  { slot: 0, support: 1, offset: 6, limit: 1 },
  { slot: 0, support: 0, offset: 0, limit: 3 },
  { slot: 1, support: 0, offset: 1, limit: 1 },
]
const grouped: typeof topKWithFractionalIndex = (compare, options) =>
  groupedTopKWithFractionalIndex(compare, {
    ...options,
    groupKeyFn: () => `one`,
  })

describe.each([
  { name: `array`, operator: topKWithFractionalIndex },
  { name: `grouped`, operator: grouped },
])(`Signed support and window oracle: $name`, ({ operator }) => {
  for (const campaign of campaigns)
    campaign.test(
      `matches counted typed keys at every cut (${campaign.name} campaign)`,
      () => {
        let firstFailure:
          | {
              observation: `rows` | `size`
              checkpoint: `input` | `move`
              step: number
              steps: Array<Step>
              message: string
            }
          | undefined
        fc.assert(
          fc.property(
            fc.array(
              fc.record({
                slot: fc.integer({ min: 0, max: keys.length - 1 }),
                support: fc.integer({ min: 0, max: 3 }),
                offset: fc.integer({ min: 0, max: 6 }),
                limit: fc.integer({ min: 0, max: 6 }),
              }),
              { minLength: 1, maxLength: 35 },
            ),
            (steps) => {
              const graph = new D2()
              const input = graph.newInput<[Key, Row]>()
              const relation = new TopKRelation<Key>()
              const counts = new Map<Key, number>()
              let window = { offset: 0, limit: 3 }
              let size!: () => number
              let move!: (options: typeof window) => void
              const rowFor = (key: Key): Row => ({
                id: 10 - keys.indexOf(key),
                value: `tie`,
              })
              input.pipe(
                operator(() => 0, {
                  ...window,
                  setSizeCallback: (getSize) => {
                    size = getSize
                  },
                  setWindowFn: (setWindow) => {
                    move = setWindow
                  },
                }),
                output((message) => relation.add(message.getInner())),
              )
              graph.finalize()
              expect(size).toBeTypeOf(`function`)
              expect(move).toBeTypeOf(`function`)
              const check = (
                checkpoint: `input` | `move`,
                step: number,
              ): boolean => {
                const selected = selectedWindowKeys(
                  orderedKeys.filter((key) => (counts.get(key) ?? 0) > 0),
                  window,
                )
                const assertAt = (
                  observation: `rows` | `size`,
                  assertion: () => void,
                ): boolean => {
                  try {
                    assertion()
                    return true
                  } catch (error) {
                    firstFailure ??= {
                      observation,
                      checkpoint,
                      step,
                      steps: [...steps],
                      message:
                        error instanceof Error ? error.message : String(error),
                    }
                    // A smaller history is a replay only if it violates the
                    // same observation at the same graph-run checkpoint.
                    if (
                      firstFailure.observation === observation &&
                      firstFailure.checkpoint === checkpoint
                    ) {
                      if (error instanceof Error)
                        error.message += `\nOriginal ${firstFailure.observation} mismatch after ${firstFailure.checkpoint} run at step ${firstFailure.step}: ${firstFailure.message}; generated history: ${JSON.stringify(firstFailure.steps)}`
                      throw error
                    }
                    return false
                  }
                }
                if (
                  !assertAt(`rows`, () =>
                    relation.expectRows(
                      selected.map((key) => [key, rowFor(key).id, `tie`]),
                    ),
                  )
                )
                  return false
                return assertAt(`size`, () =>
                  expect(size()).toBe(selected.length),
                )
              }
              // Pin positivity crossings before every generated history.
              const history = [1, 2, 1, 0, 2, 1, 0].map((support) => ({
                slot: 0,
                support,
                offset: 0,
                limit: 3,
              }))
              for (const [index, action] of [...history, ...steps].entries()) {
                const key = keys[action.slot]!
                const weight = action.support - (counts.get(key) ?? 0)
                counts.set(key, action.support)
                input.sendData(new MultiSet([[[key, rowFor(key)], weight]]))
                graph.run()
                if (!check(`input`, index)) return
                window = { offset: action.offset, limit: action.limit }
                move(window)
                graph.run()
                if (!check(`move`, index)) return
              }
            },
          ),
          {
            ...campaign.parameters,
            examples: [[boundaryHistory]],
          },
        )
      },
    )
})

/**
 * Finite authored bounds select installed support and each move must return.
 * The operator's offset/limit API supplies that law; the live-query architecture's
 * ordered-demand contract requires graph work when a requested window changes,
 * including when the source has not supplied any selected row. An empty output
 * message is this operator boundary's demand signal, not source completeness.
 * Extra graph messages remain permitted, including for unchanged requested sets.
 *
 * This lane keeps three to five positive typed keys installed. It varies the
 * installed size, near-maximum offset, finite width, and empty-range gap.
 * The four profiles distinguish overflowing arithmetic, work proportional to
 * absent ranks, exact width retention after a partial move, and lost demand
 * signals when installed ranges agree. Negative, fractional and unsafe authored
 * bounds are excluded. It does not impose a CPU threshold or claim real provider
 * acquisition; the external RED watchdog classifies nontermination separately.
 */
type NumericWindowInput = {
  installed: number
  nearMaximum: number
  width: number
  gap: number
}
const numericWindowProperty = `ivm.topk-numeric-window`
const numericWindowInput = fc.record({
  installed: fc.integer({ min: 3, max: keys.length }),
  nearMaximum: fc.integer({ min: 0, max: 2 }),
  width: fc.integer({ min: 2, max: 4 }),
  gap: fc.integer({ min: 1, max: 3 }),
})
const numericWindowExample: NumericWindowInput = {
  installed: 3,
  nearMaximum: 0,
  width: 3,
  gap: 2,
}
type NumericProfile = `offset` | `width` | `partial` | `demand`

// Every fixed regression is an input to this same history builder and model.
// Removing nearMaximum loses overflow neighbors; removing partial options loses
// width retention; removing the empty-range gap loses changed-but-uninstalled
// demand. Width zero distinguishes empty requested sets from nonempty ones.
function numericWindowHistory(
  profile: NumericProfile,
  input: NumericWindowInput,
): Array<Partial<Window>> {
  const emptyOffset = input.installed + input.gap
  const first: Window =
    profile === `offset`
      ? {
          offset: Number.MAX_SAFE_INTEGER - input.nearMaximum,
          limit: input.width,
        }
      : profile === `width`
        ? { offset: 0, limit: Number.MAX_SAFE_INTEGER - input.nearMaximum }
        : profile === `partial`
          ? { offset: Number.MAX_SAFE_INTEGER - input.nearMaximum, limit: 2 }
          : { offset: emptyOffset, limit: input.width }
  return [
    first,
    { offset: 0 },
    { offset: emptyOffset, limit: input.width },
    { offset: emptyOffset + 1 },
    { limit: input.width + 1 },
    { limit: 0 },
    { offset: emptyOffset + 2 },
    { offset: 0, limit: input.width },
  ]
}

function checkNumericWindow(
  relation: TopKRelation<Key>,
  present: ReadonlyArray<Key>,
  window: Window,
  size: number,
  moveSignals: number,
  before?: Window,
) {
  const selected = selectedWindowKeys(present, window)
  const checks = [
    [
      `rows`,
      () =>
        relation.expectRows(
          selected.map((key) => [key, 10 - keys.indexOf(key), `tie`]),
        ),
    ],
    [`size`, () => expect(size).toBe(selected.length)],
    [
      `demand`,
      () => {
        if (before && requestedWindowChanged(before, window)) {
          expect(
            moveSignals,
            `changed requested window must drive graph demand`,
          ).toBeGreaterThan(0)
        }
      },
    ],
  ] as const
  for (const [observation, check] of checks) {
    try {
      check()
    } catch (error) {
      throw new NumericWindowMismatch(observation, error)
    }
  }
}

class NumericWindowMismatch extends Error {
  constructor(
    readonly observation: `rows` | `size` | `demand`,
    cause: unknown,
  ) {
    super(
      `${observation}: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    )
  }
}

declareOracle({ grammar: [numericWindowInput] })

describe.each([
  { name: `array`, operator: topKWithFractionalIndex },
  { name: `grouped`, operator: grouped },
])(`Numeric window oracle: $name`, ({ operator }) => {
  for (const profile of [`offset`, `width`, `partial`, `demand`] as const) {
    for (const campaign of [
      {
        name: `fixed`,
        test: oracleReplayTest(it),
        parameters: { numRuns: runs, seed: 2291 },
      },
      {
        name: `random`,
        test: oracleReplayTest(it, numericWindowProperty),
        parameters: oraclePropertyOptions(100, numericWindowProperty),
      },
    ]) {
      campaign.test(
        `preserves ${profile} bounds and demand (${campaign.name} campaign)`,
        () => {
          const profileState =
            profile === `offset`
              ? `large offset move returned`
              : profile === `width`
                ? `large width move returned`
                : profile === `partial`
                  ? `partial move returned to installed rows`
                  : `empty installed range changed demand`
          const reach = createOracleReach(
            `${numericWindowProperty}.${profile}`,
            [profileState, `returned to installed rows`],
            { fixedHistories: 1 },
          )
          let begun = 0
          let firstFailure:
            { step: number; error: NumericWindowMismatch } | undefined
          try {
            fc.assert(
              fc.property(numericWindowInput, (generated) => {
                reach.beginHistory({ fixed: begun++ === 0 })
                const graph = new D2()
                const input = graph.newInput<[Key, Row]>()
                const relation = new TopKRelation<Key>()
                const present = orderedKeys.slice(0, generated.installed)
                let window: Window = { offset: 0, limit: 1 }
                let size!: () => number
                let move!: (options: Partial<Window>) => void
                let signals = 0
                input.pipe(
                  operator(() => 0, {
                    ...window,
                    setSizeCallback: (getSize) => {
                      size = getSize
                    },
                    setWindowFn: (setWindow) => {
                      move = setWindow
                    },
                  }),
                  output((message) => {
                    signals++
                    relation.add(message.getInner())
                  }),
                )
                graph.finalize()
                input.sendData(
                  new MultiSet(
                    present.map((key) => [
                      [key, { id: 10 - keys.indexOf(key), value: `tie` }],
                      1,
                    ]),
                  ),
                )
                graph.run()
                const checkAt = (step: number, before?: Window): boolean => {
                  try {
                    checkNumericWindow(
                      relation,
                      present,
                      window,
                      size(),
                      signals,
                      before,
                    )
                    return true
                  } catch (error) {
                    if (!(error instanceof NumericWindowMismatch)) throw error
                    firstFailure ??= { step, error }
                    // Reject reductions that switch observation or move boundary.
                    if (
                      firstFailure.step !== step ||
                      firstFailure.error.observation !== error.observation
                    )
                      return false
                    error.message += `\nOriginal ${firstFailure.error.observation} mismatch at move ${firstFailure.step}: ${firstFailure.error.message}`
                    throw error
                  }
                }
                if (!checkAt(-1)) return
                for (const [index, options] of numericWindowHistory(
                  profile,
                  generated,
                ).entries()) {
                  const before = window
                  window = { ...window, ...options }
                  signals = 0
                  // Log only the fixed history. An external watchdog can then
                  // distinguish a move that never returns from setup failure.
                  if (begun === 1)
                    writeSync(
                      1,
                      `numeric-window ${profile} move ${index} entered ${JSON.stringify(options)}\n`,
                    )
                  move(options)
                  graph.run()
                  if (!checkAt(index, before)) return
                  if (
                    index ===
                    (profile === `partial` ? 1 : profile === `demand` ? 3 : 0)
                  )
                    reach.reach(profileState)
                  if (index === 7) reach.reach(`returned to installed rows`)
                }
              }),
              { ...campaign.parameters, examples: [[numericWindowExample]] },
            )
            reach.assertReached()
          } finally {
            writeSync(
              1,
              `${numericWindowProperty}.${profile} ${campaign.name} reach ${JSON.stringify(Object.fromEntries(reach.counts()))}\n`,
            )
          }
        },
      )
    }
  }
})

it.each([-2, 2])(
  `rejects excess signed weight %s across a moved window`,
  (weight) => {
    const check = (corrupt: boolean) => {
      const relation = new TopKRelation<Key>()
      relation.add([[[1, [{ id: 9, value: `tie` }, `a0`]], 1]])
      relation.expectRows([[1, 9, `tie`]])
      relation.add([
        [
          [1, [{ id: 9, value: `tie` }, `a0`]],
          corrupt && weight < 0 ? weight : -1,
        ],
        [
          [`1`, [{ id: 8, value: `tie` }, `a1`]],
          corrupt && weight > 0 ? weight : 1,
        ],
      ])
      relation.expectRows([[`1`, 8, `tie`]])
    }
    check(false)
    expect(() => check(true)).toThrowError(
      expect.objectContaining({ name: `AssertionError` }),
    )
  },
)
