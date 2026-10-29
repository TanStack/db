import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { SortedMap } from '../src/SortedMap'
import {
  oraclePropertyOptions,
  oracleReplayTest,
  oracleRuns,
} from './oracle-config'
import { createOracleReach } from './oracle-reach'
import { declareOracle } from './oracle-declaration'
import { expectMap, expectView, modelOrder } from './sorted-map-support'
import type { ModelKey, Row } from './sorted-map-support'

/**
 * SortedMap is the ordered map behind Collection state: synced rows, ordered
 * by the Collection's compare option or by key, and active transactions. It
 * promises what those callers use, not every Map behavior.
 *
 * Keys have Map ownership: setting a key replaces its value, deleting reports
 * whether the key existed, and clearing removes everything. Iteration presents
 * the surviving entries in either key order or the caller's value order. Equal
 * values use key order as a stable tie-breaker, so no entry disappears inside
 * a tie. Keys are strings or numbers, the Collection key type; a sync write
 * or mutation with another key throws before it reaches SortedMap. `NaN` is a
 * number, and a grouped live query keys a `NaN` group by it, so a `NaN` key
 * is one key that key order places after every other number. Deferred
 * writes may postpone ordering within one synchronous batch, but point reads
 * remain current and ordered reads restore the same view.
 *
 * Three further laws come from Collection state's use:
 *
 * - A sync source may change a row object in place. A row changed before
 *   ordering is restored sorts by its current value. A row changed after it
 *   was placed may leave the comparator order wrong, but every view still
 *   holds each key once with its current value, and a later write or delete
 *   of that row affects only its own key.
 * - Deleting entries with deferOrder while iterating yields each entry of the
 *   order the iteration began with exactly once. Pruning settled transactions
 *   relies on this.
 * - Restoring the order after k deferred writes over n other keys makes at
 *   most k * (ceil(log2 k) + ceil(log2 (n + 1)) + 2) comparator calls, and an
 *   ordered read with nothing deferred makes none. A large sync publication
 *   depends on this; re-sorting or comparing every key would exceed it once n
 *   is large beside k.
 *
 * Not promised: other mutation during iteration (immediate writes, clear),
 * the order of rows once a placed row changed in place, keys outside the key
 * type, -0 keys, a comparator that throws, and the work of key order
 * without a comparator, which the public API cannot observe. The coverage map
 * records these limits.
 *
 * The reference model is deliberately dull: a native Map of numbers owns the
 * values, and a fresh full sort derives every observation. The production
 * structure may update its ordered index incrementally, but it must refine
 * that recomputation after every generated command. The driver observes size,
 * point lookup, every iterator, and comparator calls at each ordered read;
 * checking only the final values would miss stale keys, lost ties,
 * inconsistent views of the same state, and work that grows with the map.
 */

// A burst writes more keys than one small batch holds, in an order derived
// from its seed value, so ordered restoration has many pending keys to place.
function burstEntries(seed: number): Array<[number, number]> {
  const count = 17 + (seed + 3) * 4
  const keys = Array.from({ length: count }, (_, index) => 10 + index)
  if (seed % 2 !== 0) keys.reverse()
  return keys.map((key) => [key, ((key * 7) % 5) - 2])
}

// The work law's bound for restoring k deferred keys among n others.
function restoreBound(k: number, n: number): number {
  if (k === 0) return 0
  return k * (Math.ceil(Math.log2(k)) + Math.ceil(Math.log2(n + 1)) + 2)
}

type Action = {
  kind: `set` | `delete` | `clear` | `burst` | `prune` | `mutate`
  key: ModelKey
  value: number
  deferOrder: boolean
  observe: boolean
}

const fixedStep = (
  kind: Action[`kind`],
  key: ModelKey,
  value = 0,
  deferOrder = false,
  observe = false,
): Action => ({ kind, key, value, deferOrder, observe })

/**
 * Fixed regressions replay through the same model, driver, and comparison.
 *
 * - Deferred writes, an immediate rewrite of a tie, a deferred delete, and
 *   clear.
 * - A placed row changed in place, then neighbours deleted and rewritten. A
 *   binary search guided by the stale order would remove a neighbour.
 * - A deferred key deleted before a large deferred batch.
 * - A placed `NaN` key deleted and rewritten without deferral. A miss check by
 *   `===` never matches `NaN`, and a fallback `indexOf` returns -1, so a
 *   splice there removes the last key instead.
 */
const fixedHistories: Array<Array<Action>> = [
  [
    fixedStep(`set`, 1, 3, true),
    fixedStep(`set`, -1, 3, true),
    fixedStep(`set`, 1, -3, false, true),
    fixedStep(`delete`, -1, 0, true),
    fixedStep(`clear`, 0, 0, false, true),
    fixedStep(`set`, -1, 2, true, true),
  ],
  [
    fixedStep(`set`, -2, 0),
    fixedStep(`set`, -1, 1),
    fixedStep(`set`, 0, 2),
    fixedStep(`set`, 1, 3),
    fixedStep(`set`, 2, 3),
    fixedStep(`mutate`, -1, 3),
    fixedStep(`delete`, -1, 0, false, true),
    fixedStep(`mutate`, 1, -3),
    fixedStep(`set`, 1, 1, false, true),
    fixedStep(`delete`, 0, 0, true, true),
  ],
  [
    fixedStep(`set`, -3, 0, true),
    fixedStep(`set`, 1, 0, true, true),
    fixedStep(`delete`, -3, 0, true),
    fixedStep(`burst`, 0, 3),
    fixedStep(`set`, 2, 0, false, true),
  ],
  [
    fixedStep(`set`, Number.NaN, 0),
    fixedStep(`set`, 1, 1),
    fixedStep(`set`, 2, 2),
    fixedStep(`set`, Number.NaN, 3, false, true),
    fixedStep(`delete`, Number.NaN, 0, false, true),
  ],
]

// This is reach bookkeeping, not a second ordering model. It remembers the
// authored rank before an in-place change until a restoring comparison, write,
// delete, or clear consumes that evidence.
type ReachState =
  | `deferred-burst-observed`
  | `entry-yielded-after-pruning`
  | `placed-nan-key-written`
  | `restore-bound-below-order-size`
  | `placed-row-changed-then-written`
  | `deferred-row-changed-before-restore`

type HistoryReach = Pick<
  ReturnType<typeof createOracleReach<ReachState>>,
  `beginHistory` | `reach`
>

function runHistory(
  actions: ReadonlyArray<Action>,
  order: `key` | `ascending` | `descending`,
  reach: HistoryReach,
): void {
  reach.beginHistory()
  // The driver counts comparator calls to check the work law.
  let comparatorCalls = 0
  const actual = new SortedMap<number, Row>(
    order === `key`
      ? undefined
      : (a, b) => {
          comparatorCalls++
          return order === `ascending` ? a.rank - b.rank : b.rank - a.rank
        },
  )
  const model = new Map<ModelKey, number>()
  // Keys written or deleted with deferOrder since the last ordered
  // read or immediate write; the next ordered read restores them.
  const deferred = new Set<ModelKey>()
  // Rows changed in place after they were placed. Once one exists,
  // comparator order is no longer promised in this history.
  const changedPlaced = new Set<ModelKey>()
  // A key counts only while its current rank differs from the authored rank
  // before its first in-place mutation. Returning to that rank loses the
  // distinguishing state. Replacing the row loses this evidence too.
  const changedDeferred = new Map<ModelKey, number>()
  let orderPromised = true
  const restored = () => {
    deferred.clear()
    changedDeferred.clear()
  }
  const changedDeferredAtRead = () =>
    order !== `key` &&
    orderPromised &&
    [...changedDeferred.keys()].some(
      (key) => deferred.has(key) && model.has(key),
    )
  const observe = () => {
    const observesDeferredChange = changedDeferredAtRead()
    if (deferred.size > 16) reach.reach(`deferred-burst-observed`)
    if (order !== `key`) {
      // The first ordered read restores the deferred keys.
      const k = [...deferred].filter((key) => model.has(key)).length
      const bound = restoreBound(k, model.size - k)
      if (k > 0 && bound < model.size - k)
        reach.reach(`restore-bound-below-order-size`)
      comparatorCalls = 0
      void [...actual.keys()]
      expect(comparatorCalls).toBeLessThanOrEqual(bound)
    }
    restored()
    expectMap(actual, model, order, orderPromised)
    // Credit the state after the restoring comparison actually enforced order,
    // never merely because a mutation once ran before some later clear.
    if (observesDeferredChange)
      reach.reach(`deferred-row-changed-before-restore`)
  }
  const written = (key: ModelKey) => {
    changedDeferred.delete(key)
    if (changedPlaced.delete(key))
      reach.reach(`placed-row-changed-then-written`)
  }
  observe()
  for (const action of actions) {
    const key = action.key
    if (
      (action.kind === `set` || action.kind === `delete`) &&
      !action.deferOrder &&
      Number.isNaN(key) &&
      model.has(key) &&
      !deferred.has(key)
    )
      reach.reach(`placed-nan-key-written`)
    if (action.kind === `set`) {
      written(key)
      expect(actual.set(key, { rank: action.value }, action.deferOrder)).toBe(
        actual,
      )
      model.set(key, action.value)
      if (action.deferOrder) {
        deferred.add(key)
      } else restored()
    } else if (action.kind === `delete`) {
      written(key)
      expect(actual.delete(key, action.deferOrder)).toBe(model.delete(key))
      if (action.deferOrder) deferred.add(key)
      else restored()
    } else if (action.kind === `mutate`) {
      // Change a stored row object without a write, as a sync
      // source that reuses its row objects does. The target is a
      // deferred row when deferOrder is set, else a placed row.
      const targets = [...model.keys()].filter(
        (candidate) => deferred.has(candidate) === action.deferOrder,
      )
      if (targets.length > 0) {
        const target = targets[(action.value + 3) % targets.length]!
        const before = changedDeferred.get(target) ?? model.get(target)!
        actual.get(target)!.rank = action.value
        model.set(target, action.value)
        if (order !== `key`) {
          if (action.deferOrder) {
            if (before === action.value) changedDeferred.delete(target)
            else changedDeferred.set(target, before)
          } else {
            changedDeferred.clear()
            changedPlaced.add(target)
            orderPromised = false
          }
        }
      }
    } else if (action.kind === `burst`) {
      for (const [burstKey, value] of burstEntries(action.value)) {
        written(burstKey)
        actual.set(burstKey, { rank: value }, true)
        model.set(burstKey, value)
        deferred.add(burstKey)
      }
    } else if (action.kind === `prune`) {
      // Iterate in order, deleting each entry whose value has the
      // action's parity with deferOrder, as settled transactions
      // are pruned. The iteration yields the order it began with.
      const observesDeferredChange = changedDeferredAtRead()
      const expected = modelOrder(model, order)
      const yielded: Array<[ModelKey, number]> = []
      let pruned = false
      for (const [entryKey, row] of actual) {
        if (pruned) reach.reach(`entry-yielded-after-pruning`)
        yielded.push([entryKey, row.rank])
        if ((row.rank - action.value) % 2 === 0) {
          expect(actual.delete(entryKey, true)).toBe(true)
          pruned = true
        }
      }
      expectView(yielded, expected, orderPromised)
      if (observesDeferredChange)
        reach.reach(`deferred-row-changed-before-restore`)
      // Iteration restored the order before the deletes.
      restored()
      for (const [entryKey, value] of expected) {
        if ((value - action.value) % 2 !== 0) continue
        written(entryKey)
        model.delete(entryKey)
        deferred.add(entryKey)
      }
    } else {
      actual.clear()
      model.clear()
      deferred.clear()
      changedDeferred.clear()
      changedPlaced.clear()
      // No slot survives clear, so order is promised again.
      orderPromised = true
    }
    expect(actual.size).toBe(model.size)
    expect(actual.has(key)).toBe(model.has(key))
    expect(actual.get(key)?.rank).toBe(model.get(key))
    if (
      action.kind === `clear` ||
      ((action.kind === `set` || action.kind === `delete`) &&
        !action.deferOrder) ||
      action.observe
    )
      observe()
  }
  observe()
}

/**
 * Every generated array keeps its original actions as an unchanged suffix.
 * Before it, a fresh two-row episode changes the only deferred row across its
 * peer's rank and observes its restored order. A clear then restores the old
 * suffix's empty starting condition, including the original final read.
 *
 * Keys and crossing direction come from generated values, not a selected seed.
 * Both signs, finite keys, and NaN remain legal. The peer always has a distinct
 * key. An empty input stays empty; the campaign's arrays have 6 to 40 actions.
 * Existing fixed examples bypass this prefix and still replay unchanged.
 */
function withDeferredChange(actions: Array<Action>): Array<Action> {
  const first = actions[0]
  if (first === undefined) return actions
  const peer = first.key === 0 ? 1 : 0
  const before = first.value < 0 ? -3 : 3
  return [
    fixedStep(`set`, peer, 0),
    fixedStep(`set`, first.key, before, true),
    fixedStep(`mutate`, first.key, -before, true, true),
    fixedStep(`clear`, 0),
    ...actions,
  ]
}

declareOracle({
  check: [expectMap, expectView],
  model: [modelOrder, restoreBound],
  grammar: [withDeferredChange],
})

describe.each([`key`, `ascending`, `descending`] as const)(
  `SortedMap %s history`,
  (order) => {
    const property = {
      key: `sorted-map.key`,
      ascending: `sorted-map.ascending`,
      descending: `sorted-map.descending`,
    }[order]
    const comparatorStates =
      order === `key`
        ? []
        : ([
            `restore-bound-below-order-size`,
            `placed-row-changed-then-written`,
            `deferred-row-changed-before-restore`,
          ] as const)
    it.each([20260912, undefined])(
      `agrees with full recomputation (seed %s)`,
      async (seed) => {
        const reach = createOracleReach(
          property,
          [
            `deferred-burst-observed`,
            `entry-yielded-after-pruning`,
            `placed-nan-key-written`,
            ...comparatorStates,
          ],
          { minimum: 5 },
        )
        await fc.assert(
          fc.asyncProperty(
            fc
              .array(
                fc.record({
                  kind: fc.constantFrom<Action[`kind`]>(
                    `set`,
                    `set`,
                    `set`,
                    `delete`,
                    `delete`,
                    `delete`,
                    `clear`,
                    `burst`,
                    `prune`,
                    `mutate`,
                    `mutate`,
                  ),
                  key: fc.oneof(
                    { arbitrary: fc.integer({ min: -3, max: 3 }), weight: 6 },
                    { arbitrary: fc.constant(Number.NaN), weight: 2 },
                  ),
                  value: fc.integer({ min: -3, max: 3 }),
                  deferOrder: fc.boolean(),
                  observe: fc.boolean(),
                }),
                { minLength: 6, maxLength: 40 },
              )
              .map(withDeferredChange),
            (actions) => {
              runHistory(actions, order, reach)
              return Promise.resolve()
            },
          ),
          {
            ...(seed === undefined
              ? oraclePropertyOptions(100, property)
              : { seed, numRuns: oracleRuns(100) }),
            examples: fixedHistories.map((history) => [history]),
          },
        )
        if (process.env.TANSTACK_DB_ORACLE_REACH_REPORT)
          console.log(property, seed ?? `random`, [...reach.counts()])
        reach.assertReached()
      },
    )
  },
)

/**
 * These grammar ablations replay the shared production driver and Map/full-sort
 * check. Only a still-present changed deferred row at a promised-order read
 * earns reach. Reading after a clear, replacement, delete, eager restore, or a
 * placed-row change cannot stand in for that observation. Returning to the
 * authored pre-mutation rank is also not a distinguishing changed-row state.
 *
 * The 16 bounded inputs vary every small key, NaN, and both crossing directions.
 * Each positive control exceeds the unchanged minimum of five histories. Each
 * ablation must fail that same reach obligation; it is a missing-premise control,
 * not a rejection of wrong production output.
 */
describe.each([`ascending`, `descending`] as const)(
  `SortedMap %s deferred-change reach calibration`,
  (order) => {
    oracleReplayTest(it).each([
      `observed`,
      `omitted observation`,
      `empty history`,
      `equal rank`,
      `returned rank`,
      `overwrite`,
      `delete`,
      `eager restore`,
      `unpromised order`,
      `prune observation`,
    ] as const)(`credits only a restoring comparison: %s`, (control) => {
      const state = `deferred-row-changed-before-restore`
      const reach = createOracleReach<ReachState>(
        `sorted-map.${order}.${control}`,
        [state],
        { minimum: 5, replaying: false },
      )
      const watchedReach: HistoryReach = {
        beginHistory: reach.beginHistory,
        reach: (reached) => {
          if (reached === state) reach.reach(reached)
        },
      }
      for (const key of [-3, -2, -1, 0, 1, 2, 3, Number.NaN]) {
        for (const value of [-3, 3]) {
          const prefix = withDeferredChange([
            fixedStep(`set`, key, value),
          ]).slice(0, 3)
          const target = prefix[1]!
          const mutation = prefix[2]!
          const held = { ...mutation, observe: false }
          const peer = prefix[0]!
          let actions: Array<Action>
          switch (control) {
            case `observed`:
              actions = prefix
              break
            case `prune observation`:
              actions = [...prefix.slice(0, 2), held, fixedStep(`prune`, 0)]
              break
            case `unpromised order`:
              actions = [
                ...prefix.slice(0, 2),
                fixedStep(`mutate`, peer.key, 1),
                mutation,
              ]
              break
            case `empty history`:
              actions = withDeferredChange([])
              break
            default: {
              const after =
                control === `returned rank`
                  ? fixedStep(`mutate`, target.key, target.value, true, true)
                  : control === `overwrite`
                    ? fixedStep(`set`, target.key, 2, true, true)
                    : control === `delete`
                      ? fixedStep(`delete`, target.key, 0, true, true)
                      : control === `eager restore`
                        ? fixedStep(`set`, peer.key, 0)
                        : fixedStep(`clear`, 0)
              actions = [
                ...prefix.slice(0, 2),
                control === `equal rank`
                  ? { ...mutation, value: target.value }
                  : held,
                after,
              ]
            }
          }
          runHistory(actions, order, watchedReach)
        }
      }
      if (process.env.TANSTACK_DB_ORACLE_REACH_REPORT)
        console.log(`sorted-map.${order}.${control}`, [...reach.counts()])
      if (control === `observed` || control === `prune observation`) {
        reach.assertReached()
      } else {
        expect(() => reach.assertReached()).toThrow(`${state} (0)`)
      }
    })
  },
)
