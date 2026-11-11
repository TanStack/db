import { writeSync } from 'node:fs'
import { beforeEach, describe, expect, it as vitestIt } from 'vitest'
import fc from 'fast-check'
import { D2 } from '../../src/d2.js'
import { MultiSet } from '../../src/multiset.js'
import { output } from '../../src/operators/index.js'
import { topKWithFractionalIndex } from '../../src/operators/topKWithFractionalIndex.js'
import { groupedTopKWithFractionalIndex } from '../../src/operators/groupedTopKWithFractionalIndex.js'
import { orderByWithFractionalIndex } from '../../src/operators/orderBy.js'
import {
  oracleReplayTest,
  oracleRoute,
} from '../../../db/tests/oracle-config.js'
import { declareOracle } from '../../../db/tests/oracle-declaration.js'
import { oracleProperty } from '../../../db/tests/oracle-property.js'
import { atOracleCheckpoint } from '../../../db/tests/oracle-failure-fidelity.js'
import {
  checkTopKComparisons,
  topKRecorder,
  topKReferences,
} from './topk-property-oracle.js'
import { TopKRelation } from './topk-relation-oracle.js'
import type { TopKComparisonRecorder } from './topk-relation-oracle.js'
import type { TopKWithFractionalIndexOptions } from '../../src/operators/topKWithFractionalIndex.js'

// What this oracle owns: the gap report judges these entries, and their
// reference trees within the package, by this file's tests.
declareOracle({
  owns: [
    `src/operators/topKWithFractionalIndex.ts#topKWithFractionalIndex`,
    `src/operators/groupedTopKWithFractionalIndex.ts#groupedTopKWithFractionalIndex`,
    `src/operators/orderBy.ts#orderByWithFractionalIndex`,
  ],
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
 * support 0..3, and offset/limit 0..6. The numeric-window grammar also reaches
 * safe-integer offsets and widths near Number.MAX_SAFE_INTEGER. Every input turn and window move has
 * a graph-run checkpoint for output rows and reported window size.
 * The fixed 0/1/2 support crossing and boundary history distinguish presence
 * from raw multiplicity and inclusive from displaced window cuts. Row replacements,
 * multiple groups, negative net support, and downstream lazy acquisition are
 * outside this owner. The numeric-window grammar does observe the empty output message
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
const it = oracleReplayTest(vitestIt)
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
  let firstFailure:
    | {
        observation: `rows` | `size`
        checkpoint: `input` | `move`
        step: number
        steps: Array<Step>
        message: string
      }
    | undefined
  beforeEach(() => {
    firstFailure = undefined
  })
  oracleProperty<Array<Step>, Array<unknown>>({
    id: `ivm.topk-support-window`,
    law: {
      statement: `Select positive typed-key support at every input and window-move cut, with unit indexed output and the reported selected size.`,
      authority: `The existing top-K support/window contract documented above.`,
      limits: `The original five-key, support 0..3 and offset/limit 0..6 grammar, with one payload per key.`,
    },
    histories: {
      arbitrary: fc.array(
        fc.record({
          slot: fc.integer({ min: 0, max: keys.length - 1 }),
          support: fc.integer({ min: 0, max: 3 }),
          offset: fc.integer({ min: 0, max: 6 }),
          limit: fc.integer({ min: 0, max: 6 }),
        }),
        { minLength: 1, maxLength: 35 },
      ),
      runs: 100,
      fixedSeeds: [409033],
      fixed: [
        { name: `support and boundary history`, history: boundaryHistory },
      ],
    },
    model: topKReferences,
    driver: (steps, observe) => {
      const graph = new D2()
      const input = graph.newInput<[Key, Row]>()
      const recorder = topKRecorder(observe)
      const relation = new TopKRelation<Key>(recorder.record)
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
      recorder.record(`size callback installed`, typeof size, `function`)
      expect(size).toBeTypeOf(`function`)
      recorder.record(`move callback installed`, typeof move, `function`)
      expect(move).toBeTypeOf(`function`)
      const check = (checkpoint: `input` | `move`, step: number): boolean => {
        recorder.at(checkpoint)
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
              message: error instanceof Error ? error.message : String(error),
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
        return assertAt(`size`, () => {
          const actualSize = size()
          recorder.record(`size`, actualSize, selected.length)
          expect(actualSize).toBe(selected.length)
        })
      }
      // Fix positivity crossings before every generated history.
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
    check: checkTopKComparisons,
  })
})

/**
 * Finite authored bounds select installed support and each move must return.
 * The operator's offset/limit API supplies that law; the live-query architecture's
 * ordered-demand contract requires graph work when a requested window changes,
 * including when the source has not supplied any selected row. An empty output
 * message is this operator boundary's demand signal, not source completeness.
 * Extra graph messages remain permitted, including for unchanged requested sets.
 *
 * This grammar keeps three to five positive typed keys installed. It varies the
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
  record?: TopKComparisonRecorder,
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
    [
      `size`,
      () => {
        record?.(`size`, size, selected.length)
        expect(size).toBe(selected.length)
      },
    ],
    [
      `demand`,
      () => {
        if (before && requestedWindowChanged(before, window)) {
          record?.(`demand`, moveSignals > 0, true)
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
    describe(profile, () => {
      const profileState =
        profile === `offset`
          ? `large offset move returned`
          : profile === `width`
            ? `large width move returned`
            : profile === `partial`
              ? `partial move returned to installed rows`
              : `empty installed range changed demand`
      const states = [profileState, `returned to installed rows`]
      let firstFailure:
        { step: number; error: NumericWindowMismatch } | undefined
      beforeEach(() => {
        firstFailure = undefined
      })
      oracleProperty<NumericWindowInput, Array<unknown>>({
        id: `ivm.topk-numeric-window`,
        law: {
          statement: `Finite authored bounds preserve selected rows, reported size, partial bounds and changed-window demand.`,
          authority: `The existing numeric-window and demand contracts documented above.`,
          limits: `The original three-to-five-key safe-integer numeric profiles; no CPU threshold or provider-acquisition claim.`,
        },
        histories: {
          arbitrary: numericWindowInput,
          runs: 100,
          fixedSeeds: [2291],
          states,
          constructed: [
            {
              name: `numeric profile and return`,
              enters: states,
              build: (generated) => generated,
            },
          ],
          fixed: [
            {
              name: `numeric window regression`,
              history: numericWindowExample,
              enters: states,
            },
          ],
        },
        model: topKReferences,
        driver: (generated, observe) => {
          const recorder = topKRecorder(observe)
          const reach = { reach: (state: string) => observe(`reach`, state) }
          const begun = generated === numericWindowExample ? 1 : 2
          const graph = new D2()
          const input = graph.newInput<[Key, Row]>()
          const relation = new TopKRelation<Key>(recorder.record)
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
            recorder.at(`move ${step}`)
            try {
              checkNumericWindow(
                relation,
                present,
                window,
                size(),
                signals,
                before,
                recorder.record,
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
        },
        check: checkTopKComparisons,
      })
    })
  }
})

/**
 * Negative offsets still name absolute ranks. Existing public top-K and
 * orderBy tests select nothing when the whole interval precedes rank zero
 * (topKWithFractionalIndex.test.ts and orderByWithFractionalIndex.test.ts).
 * The maintainer accepted the absolute-rank oracle proposal on 2026-11-02,
 * including negative offsets, crossing zero and nonnegative widths. The older
 * examples alone establish only the wholly-before-zero part of that decision.
 * The same rank-membership rule above intersects a crossing-zero interval
 * with installed ranks; clamping its offset before applying width changes it.
 * Negative limits and fractional bounds have no authority here and stay out.
 *
 * This grammar adds the missing offset domain without replacing the support or
 * large-numeric campaigns. Installed cardinality, negative depth, width and gap
 * distinguish absolute intervals from JavaScript's end-relative slice indices.
 * A legal support tail adds nearby edits and moves. A constructive prefix
 * reaches empty-to-empty movement, both sides of zero, partial moves, return
 * moves and source edits while a negative window is active in every history.
 * All comparisons retain signed residue, row values, order and reported size.
 *
 * The three real D2 paths use the same model and comparison: direct top-K,
 * one-group top-K and the public orderBy wrapper. Where the public size getter
 * accepts a predicate, an always-true predicate must count the same selected
 * rows. Multiple groups, varying prefix predicates and downstream acquisition
 * remain outside this grammar. Mismatches
 * accumulate through the history so a size defect cannot hide row movement or
 * a source-edit defect. A runtime interruption remains a separate failure.
 */
type NegativeWindowHistory = {
  installed: number
  depth: number
  width: number
  gap: number
  tail: Array<Step>
}
const negativeWindowHistory = fc.record({
  installed: fc.integer({ min: 3, max: keys.length }),
  depth: fc.integer({ min: 2, max: 4 }),
  width: fc.integer({ min: 1, max: 2 }),
  gap: fc.integer({ min: 1, max: 3 }),
  tail: fc.array(
    fc.record({
      slot: fc.integer({ min: 0, max: keys.length - 1 }),
      support: fc.integer({ min: 0, max: 3 }),
      offset: fc.integer({ min: -6, max: 6 }),
      limit: fc.integer({ min: 0, max: 6 }),
    }),
    { maxLength: 12 },
  ),
})
const negativeWindowExamples: Array<[NegativeWindowHistory]> = [
  [
    {
      installed: 3,
      depth: 2,
      width: 1,
      gap: 2,
      tail: [],
    },
  ],
]
const negativeStates = [
  `empty to wholly negative window`,
  `negative zero width`,
  `crossed rank zero`,
  `source deletion under negative offset`,
  `source insertion under negative offset`,
  `returned to nonnegative window`,
  `offset below negative cardinality`,
  `partial move retained width`,
] as const
const ordered: typeof topKWithFractionalIndex = <K extends string | number, T>(
  compare: (a: T, b: T) => number,
  options?: TopKWithFractionalIndexOptions,
) =>
  orderByWithFractionalIndex<[K, T], T>((row) => row, {
    ...options,
    comparator: compare,
  })

function checkNegativeWindowHistory(
  operator: typeof topKWithFractionalIndex,
  generated: NegativeWindowHistory,
  reach: { reach: (state: (typeof negativeStates)[number]) => void },
  countsLeading: boolean,
  observe?: (checkpoint: string, value: unknown) => void,
) {
  const graph = new D2()
  const input = graph.newInput<[Key, Row]>()
  const recorder = observe ? topKRecorder(observe) : undefined
  const relation = new TopKRelation<Key>(recorder?.record)
  const counts = new Map<Key, number>()
  let window: Window = {
    offset: generated.installed + generated.gap,
    limit: generated.width,
  }
  let size!: (counts?: (value: unknown) => boolean) => number
  let move!: (options: Partial<Window>) => void
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
  const failures: Array<unknown> = []
  const compare = (law: string, checkpoint: string, check: () => void) => {
    try {
      atOracleCheckpoint(law, checkpoint, check)
    } catch (error) {
      failures.push(error)
    }
  }
  const check = (checkpoint: string) => {
    recorder?.at(checkpoint)
    const present = orderedKeys.filter((key) => (counts.get(key) ?? 0) > 0)
    const selected = selectedWindowKeys(present, window)
    compare(`absolute-rank rows`, checkpoint, () =>
      relation.expectRows(selected.map((key) => [key, rowFor(key).id, `tie`])),
    )
    compare(`selected window size`, checkpoint, () => {
      const actualSize = size()
      recorder?.record(`selected window size`, actualSize, selected.length)
      expect(actualSize).toBe(selected.length)
    })
    if (countsLeading)
      compare(`leading window size`, checkpoint, () => {
        const actualSize = size(() => true)
        recorder?.record(`leading window size`, actualSize, selected.length)
        expect(actualSize).toBe(selected.length)
      })
  }
  const setSupport = (key: Key, support: number, checkpoint: string) => {
    const weight = support - (counts.get(key) ?? 0)
    counts.set(key, support)
    input.sendData(new MultiSet([[[key, rowFor(key)], weight]]))
    graph.run()
    check(checkpoint)
  }
  try {
    for (const key of orderedKeys.slice(0, generated.installed))
      setSupport(key, 1, `initial installed rows`)

    const depth = Math.min(generated.depth, generated.installed - 1)
    const width = Math.min(generated.width, depth - 1)
    const moveAt = (
      options: Partial<Window>,
      state: (typeof negativeStates)[number],
    ) => {
      window = { ...window, ...options }
      move(options)
      graph.run()
      reach.reach(state)
      check(state)
    }
    moveAt({ offset: -depth, limit: width }, `empty to wholly negative window`)
    moveAt({ limit: 0 }, `negative zero width`)
    moveAt({ offset: -1, limit: 2 }, `crossed rank zero`)
    setSupport(orderedKeys[0], 0, `source deletion under negative offset`)
    reach.reach(`source deletion under negative offset`)
    setSupport(orderedKeys[0], 1, `source insertion under negative offset`)
    reach.reach(`source insertion under negative offset`)
    moveAt({ offset: 0 }, `partial move retained width`)
    reach.reach(`returned to nonnegative window`)
    moveAt(
      { offset: -generated.installed - generated.gap, limit: 1 },
      `offset below negative cardinality`,
    )
    moveAt(
      { offset: 0, limit: generated.width },
      `returned to nonnegative window`,
    )
    for (const action of generated.tail) {
      setSupport(keys[action.slot]!, action.support, `generated source edit`)
      window = { offset: action.offset, limit: action.limit }
      move(window)
      graph.run()
      check(`generated move`)
    }
  } catch (error) {
    // Retain a later graph/runtime interruption after the original comparison.
    failures.push(error)
  }
  if (failures.length)
    throw new AggregateError(failures, failures.map(String).join(`\n`), {
      cause: failures[0],
    })
}

declareOracle({
  grammar: [negativeWindowHistory],
  check: [checkNegativeWindowHistory],
})

// Rival interpretations must disagree with the rank predicate. Feed their
// wrong rows to the same signed-output checker; no production helper supplies
// the expected answer, and no output normalization removes the distinction.
it(`rejects end-relative slicing and offset-first clamping`, () => {
  oracleRoute(`calibration`)
  const present = orderedKeys.slice(0, 3)
  for (const window of [
    { offset: -2, limit: 1 },
    { offset: -1, limit: 2 },
  ]) {
    const expected = selectedWindowKeys(present, window).map(
      (key): [Key, number, string] => [key, 10 - keys.indexOf(key), `tie`],
    )
    const wrong =
      window.limit === 1
        ? present.slice(window.offset, window.offset + window.limit)
        : present.slice(0, window.limit)
    const relation = new TopKRelation<Key>()
    relation.add(
      wrong.map((key, index) => [
        [key, [{ id: 10 - keys.indexOf(key), value: `tie` }, `a${index}`]],
        1,
      ]),
    )
    expect(() => relation.expectRows(expected)).toThrow()
  }
})

describe.each([
  {
    name: `array`,
    operator: topKWithFractionalIndex,
    property: `ivm.topk-negative-window-array`,
  },
  {
    name: `grouped`,
    operator: grouped,
    property: `ivm.topk-negative-window-grouped`,
  },
  {
    name: `orderBy`,
    operator: ordered,
    property: `ivm.topk-negative-window-orderBy`,
  },
])(
  `Absolute-rank negative window oracle: $name`,
  ({ name, operator, property }) => {
    oracleProperty<NegativeWindowHistory, Array<unknown>>({
      id: property,
      law: {
        statement: `Negative offsets select absolute rank intersections and retain signed row, size and source-edit fidelity.`,
        authority: `The maintainer's 2026-11-02 absolute-rank decision documented above.`,
        limits: `The original negative-depth, installed-cardinality, width, gap and legal support-tail grammar; multiple groups and downstream acquisition remain outside this owner.`,
      },
      histories: {
        arbitrary: negativeWindowHistory,
        runs: 100,
        fixedSeeds: [2316],
        states: negativeStates,
        constructed: [
          {
            name: `negative-window transitions`,
            enters: negativeStates,
            build: (history) => history,
          },
        ],
        fixed: negativeWindowExamples.map(([history], index) => ({
          name: `negative window regression ${index}`,
          history,
          enters: negativeStates,
        })),
      },
      model: topKReferences,
      driver: (history, observe) =>
        checkNegativeWindowHistory(
          operator,
          history,
          { reach: (state) => observe(`reach`, state) },
          name !== `grouped`,
          observe,
        ),
      check: checkTopKComparisons,
    })
  },
)

it.each([-2, 2])(
  `rejects excess signed weight %s across a moved window`,
  (weight) => {
    oracleRoute(`calibration`)
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
