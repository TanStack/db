import { beforeAll, describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { D2 } from '../../src/d2.js'
import { MultiSet } from '../../src/multiset.js'
import { output } from '../../src/operators/index.js'
import { topKWithFractionalIndex } from '../../src/operators/topKWithFractionalIndex.js'
import { groupedTopKWithFractionalIndex } from '../../src/operators/groupedTopKWithFractionalIndex.js'
import {
  loadBTree,
  topKWithFractionalIndexBTree,
} from '../../src/operators/topKWithFractionalIndexBTree.js'
import { topK, topKWithIndex } from '../../src/operators/topK.js'
import { TopKRelation } from './topk-relation-oracle.js'

/**
 * A top-K window selects support from a signed, typed-key relation.
 *
 * The top-K operator APIs and existing window tests establish selection of
 * present relation rows in key order within an offset/limit window. Ordinary
 * top-K retains a selected row's input
 * multiplicity; fractional-index top-K emits one indexed row for positive
 * support. The model below integrates signed input weights by typed key and
 * selects from a fixed, independently ordered key domain. `TopKRelation` only
 * checks accumulated signed fractional-index output; its companion tests
 * calibrate that checker without exercising production.
 *
 * The grammar covers five finite scalar keys, one fixed payload per key,
 * support 0..3, and offset/limit 0..6. Every input turn and supported window
 * move has a graph-run checkpoint for output rows and reported window size.
 * BTree has a fixed 0..3 window because it does not support moves. The pinned
 * 0/1/2 support crossing and boundary history distinguish presence from raw
 * multiplicity and inclusive from displaced window cuts. Row replacements,
 * multiple groups, negative net support, and downstream lazy acquisition are
 * outside this owner.
 */

const keys = [1, `1`, 2, `2`, `a`] as const
const orderedKeys = [`1`, `2`, `a`, 1, 2] as const
type Key = (typeof keys)[number]
type Row = { id: number; value: string }
type Step = { slot: number; support: number; offset: number; limit: number }

// Normal campaigns share the same property, recorder, checks, and run budget.
// Replay with TANSTACK_DB_IVM_TOPK_SUPPORT_SEED and
// TANSTACK_DB_IVM_TOPK_SUPPORT_PATH on the focused Vitest command.
const replaySeedText = process.env.TANSTACK_DB_IVM_TOPK_SUPPORT_SEED
const replaySeed =
  replaySeedText === undefined ? undefined : Number(replaySeedText)
const replayPath = process.env.TANSTACK_DB_IVM_TOPK_SUPPORT_PATH
const runs = Number(process.env.TANSTACK_DB_IVM_TOPK_SUPPORT_RUNS ?? 100)
if (
  replaySeedText !== undefined &&
  (replaySeedText.trim() === `` || !Number.isSafeInteger(replaySeed))
)
  throw new Error(`TANSTACK_DB_IVM_TOPK_SUPPORT_SEED must be an integer`)
if (!Number.isSafeInteger(runs) || runs <= 0)
  throw new Error(`TANSTACK_DB_IVM_TOPK_SUPPORT_RUNS must be positive`)
if (replayPath !== undefined && replaySeed === undefined)
  throw new Error(
    `TANSTACK_DB_IVM_TOPK_SUPPORT_PATH requires TANSTACK_DB_IVM_TOPK_SUPPORT_SEED`,
  )
const campaigns: Array<{
  name: string
  seed: number | undefined
  path: string | undefined
}> =
  replaySeed === undefined
    ? [
        { name: `fixed`, seed: 409033, path: undefined },
        { name: `random`, seed: undefined, path: undefined },
      ]
    : [{ name: `replay`, seed: replaySeed, path: replayPath }]

// Slot chooses typed identity and rank; support chooses the presence crossing;
// offset chooses the first selected rank; limit chooses window width. Removing
// any of these axes loses its corresponding distinction. The grammar rejects
// out-of-range slots, negative net support, and negative or fractional windows.
// The fixed example reaches a zero-width window on present rows, a one-row
// window, an offset beyond all rows, and a return to the original window. The
// same history reaches the fixed BTree limit with five present rows and a
// partial then final withdrawal. A shifted start or inclusive end selects a
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

beforeAll(loadBTree)

it.each([false, true])(
  `preserves selected multiplicity in ordinary top-K (indexed %s)`,
  (indexed) => {
    const graph = new D2()
    const input = graph.newInput<[null, Row]>()
    const observed = new Map<string, number>()
    const capture = (message: MultiSet<unknown>) => {
      for (const [value, weight] of message.getInner()) {
        const identity = JSON.stringify(value)
        const count = (observed.get(identity) ?? 0) + weight
        if (count === 0) observed.delete(identity)
        else observed.set(identity, count)
      }
    }
    const comparator = (a: Row, b: Row) => a.id - b.id
    if (indexed)
      input.pipe(topKWithIndex(comparator, { limit: 1 }), output(capture))
    else input.pipe(topK(comparator, { limit: 1 }), output(capture))
    graph.finalize()
    const row = { id: 1, value: `a` }
    let prior = 0
    for (const count of [1, 2, 1, 0, 2, 1, 0]) {
      input.sendData(new MultiSet([[[null, row], count - prior]]))
      prior = count
      graph.run()
      expect([...observed]).toEqual(
        count === 0
          ? []
          : [[JSON.stringify([null, indexed ? [row, 0] : row]), count]],
      )
    }
  },
)

describe.each([
  { name: `array`, operator: topKWithFractionalIndex, movable: true },
  { name: `grouped`, operator: grouped, movable: true },
  { name: `BTree`, operator: topKWithFractionalIndexBTree, movable: false },
])(`Signed support and window oracle: $name`, ({ operator, movable }) => {
  it.each(campaigns)(
    `matches counted typed keys at every cut ($name campaign)`,
    ({ seed, path }) => {
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
            const relation = new TopKRelation<Key, string>()
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
            if (movable) expect(move).toBeTypeOf(`function`)
            const check = (
              checkpoint: `input` | `move`,
              step: number,
            ): boolean => {
              const selected = orderedKeys
                .filter((key) => (counts.get(key) ?? 0) > 0)
                .slice(window.offset, window.offset + window.limit)
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
              if (movable) {
                window = { offset: action.offset, limit: action.limit }
                move(window)
                graph.run()
                if (!check(`move`, index)) return
              }
            }
          },
        ),
        {
          numRuns: runs,
          ...(seed === undefined ? {} : { seed }),
          ...(path === undefined ? {} : { path }),
          examples: [[boundaryHistory]],
        },
      )
    },
  )
})

it.each([-2, 2])(
  `rejects excess signed weight %s across a moved window`,
  (weight) => {
    const check = (corrupt: boolean) => {
      const relation = new TopKRelation<Key, string>()
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
