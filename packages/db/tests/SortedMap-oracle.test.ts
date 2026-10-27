import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { SortedMap } from '../src/SortedMap'
import { oraclePropertyOptions, oracleRuns } from './oracle-config'
import { createOracleReach } from './oracle-reach'

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
 * or mutation with another key throws before it reaches SortedMap. Deferred
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
 * type, NaN and -0 keys, a comparator that throws, and the work of key order
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

type Order = `key` | `ascending` | `descending`

// Production stores row objects so the driver can change one in place. The
// model stores each row's rank as a number and never shares an object.
type Row = { rank: number }

type ModelKey = number

// A burst writes more keys than one small batch holds, in an order derived
// from its seed value, so ordered restoration has many pending keys to place.
function burstEntries(seed: number): Array<[number, number]> {
  const count = 17 + (seed + 3) * 4
  const keys = Array.from({ length: count }, (_, index) => 10 + index)
  if (seed % 2 !== 0) keys.reverse()
  return keys.map((key) => [key, ((key * 7) % 5) - 2])
}

const probeKeys: Array<ModelKey> = [-3, -2, -1, 0, 1, 2, 3, 10, 26, 50]

// The generated keys are numbers, which key order sorts ascending.
const compareModelKeys = (a: ModelKey, b: ModelKey) => a - b

function modelOrder(model: Map<ModelKey, number>, order: Order) {
  return [...model].sort(
    ([ka, va], [kb, vb]) =>
      (order === `key` ? 0 : order === `ascending` ? va - vb : vb - va) ||
      compareModelKeys(ka, kb),
  )
}

// The work law's bound for restoring k deferred keys among n others.
function restoreBound(k: number, n: number): number {
  if (k === 0) return 0
  return k * (Math.ceil(Math.log2(k)) + Math.ceil(Math.log2(n + 1)) + 2)
}

const byKey = (entries: Array<[ModelKey, number]>) =>
  [...entries].sort(([a], [b]) => compareModelKeys(a, b))

// Compare one observed view with the model. Without the order promise, the
// view must still hold each key once with its current value.
function expectView(
  actual: Array<[ModelKey, number]>,
  expected: Array<[ModelKey, number]>,
  orderPromised: boolean,
) {
  if (orderPromised) expect(actual).toEqual(expected)
  else expect(byKey(actual)).toEqual(byKey(expected))
}

function expectMap(
  actual: SortedMap<number, Row>,
  model: Map<ModelKey, number>,
  order: Order,
  orderPromised = true,
) {
  // Recompute from a plain Map; do not copy SortedMap's binary insertion logic.
  const expected = modelOrder(model, order)
  const ranks = (entries: Iterable<[number, Row]>) =>
    // A stale slot reads no row; keep it visible to the comparison.
    [...entries].map(([key, row]): [ModelKey, number] => [
      key,
      (row as Row | undefined)?.rank as number,
    ])
  expect(actual.size).toBe(model.size)
  expectView(ranks(actual), expected, orderPromised)
  expectView(ranks(actual.entries()), expected, orderPromised)
  const values = [...actual.values()]
  expectView(
    [...actual.keys()].map((key, index) => [
      key,
      (values[index] as Row | undefined)?.rank as number,
    ]),
    expected,
    orderPromised,
  )
  for (const key of probeKeys) {
    expect(actual.has(key)).toBe(model.has(key))
    expect(actual.get(key)?.rank).toBe(model.get(key))
  }
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
]

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
            ...comparatorStates,
          ],
          { minimum: 5 },
        )
        await fc.assert(
          fc.asyncProperty(
            fc.array(
              fc.record({
                kind: fc.constantFrom(
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
                key: fc.integer({ min: -3, max: 3 }),
                value: fc.integer({ min: -3, max: 3 }),
                deferOrder: fc.boolean(),
                observe: fc.boolean(),
              }),
              { minLength: 6, maxLength: 40 },
            ),
            (actions) => {
              reach.beginHistory()
              // The driver counts comparator calls to check the work law.
              let comparatorCalls = 0
              const actual = new SortedMap<number, Row>(
                order === `key`
                  ? undefined
                  : (a, b) => {
                      comparatorCalls++
                      return order === `ascending`
                        ? a.rank - b.rank
                        : b.rank - a.rank
                    },
              )
              const model = new Map<ModelKey, number>()
              // Keys written or deleted with deferOrder since the last ordered
              // read or immediate write; the next ordered read restores them.
              const deferred = new Set<ModelKey>()
              // Rows changed in place after they were placed. Once one exists,
              // comparator order is no longer promised in this history.
              const changedPlaced = new Set<ModelKey>()
              let orderPromised = true
              const restored = () => {
                deferred.clear()
              }
              const observe = () => {
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
              }
              const written = (key: ModelKey) => {
                if (changedPlaced.delete(key))
                  reach.reach(`placed-row-changed-then-written`)
              }
              observe()
              for (const action of actions) {
                const key = action.key
                if (action.kind === `set`) {
                  written(key)
                  expect(
                    actual.set(key, { rank: action.value }, action.deferOrder),
                  ).toBe(actual)
                  model.set(key, action.value)
                  if (action.deferOrder) {
                    deferred.add(key)
                  } else restored()
                } else if (action.kind === `delete`) {
                  written(key)
                  expect(actual.delete(key, action.deferOrder)).toBe(
                    model.delete(key),
                  )
                  if (action.deferOrder) deferred.add(key)
                  else restored()
                } else if (action.kind === `mutate`) {
                  // Change a stored row object without a write, as a sync
                  // source that reuses its row objects does. The target is a
                  // deferred row when deferOrder is set, else a placed row.
                  const targets = [...model.keys()].filter(
                    (candidate) =>
                      deferred.has(candidate) === action.deferOrder,
                  )
                  if (targets.length > 0) {
                    const target = targets[(action.key + 3) % targets.length]!
                    actual.get(target)!.rank = action.value
                    model.set(target, action.value)
                    if (order !== `key`) {
                      if (action.deferOrder)
                        reach.reach(`deferred-row-changed-before-restore`)
                      else {
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

it(`rejects wrong default ordering, missing tied entries, stale overwrites, and lost keys`, () => {
  const byValue = new SortedMap<number, Row>((a, b) => a.rank - b.rank)
  byValue.set(1, { rank: 3 }).set(-1, { rank: 4 })
  expect(() =>
    expectMap(
      byValue,
      new Map([
        [1, 3],
        [-1, 4],
      ]),
      `key`,
    ),
  ).toThrow()
  const missingTie = new SortedMap<number, Row>((a, b) => a.rank - b.rank)
  missingTie.set(1, { rank: 3 })
  expect(() =>
    expectMap(
      missingTie,
      new Map([
        [1, 3],
        [-1, 3],
      ]),
      `ascending`,
    ),
  ).toThrow()
  const stale = new SortedMap<number, Row>()
  stale.set(1, { rank: 3 })
  expect(() => expectMap(stale, new Map([[1, 2]]), `key`)).toThrow()
  // Without the order promise, a view may reorder keys but must hold each
  // key once with its current value.
  const expected: Array<[ModelKey, number]> = [
    [1, 3],
    [2, 3],
  ]
  expect(() =>
    expectView(
      [
        [2, 3],
        [1, 3],
      ],
      expected,
      false,
    ),
  ).not.toThrow()
  expect(() =>
    expectView(
      [
        [1, 3],
        [1, 3],
      ],
      expected,
      false,
    ),
  ).toThrow()
  expect(() => expectView([[1, 3]], expected, false)).toThrow()
})
