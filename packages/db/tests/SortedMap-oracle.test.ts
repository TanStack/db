import { describe, expect, it, vi } from 'vitest'
import fc from 'fast-check'
import { SortedMap } from '../src/SortedMap'
import { createCollection } from '../src/collection/index.js'
import { createTransaction } from '../src/transactions.js'
import { oraclePropertyOptions, oracleRuns } from './oracle-config'
import { createOracleReach } from './oracle-reach'
import type { SyncConfig } from '../src/types.js'

/**
 * SortedMap is the ordered map behind Collection state: synced rows, ordered
 * by the Collection's compare option or by key, and active transactions. It
 * promises what those callers use, not every Map behavior.
 *
 * Keys have Map ownership: setting a key replaces its value, deleting reports
 * whether the key existed, and clearing removes everything. Iteration presents
 * the surviving entries in either key order or the caller's value order. Equal
 * values use key order as a stable tie-breaker, so no entry disappears inside
 * a tie. Key order is total over the keys Collections produce: `undefined`,
 * then `null` (grouped Collections can produce these at runtime even though
 * the key type excludes them), then strings, then numbers. Deferred writes may
 * postpone ordering within one synchronous batch, but point reads remain
 * current and ordered reads restore the same view.
 *
 * One mutation during iteration is promised, because pruning settled
 * transactions relies on it: deleting entries with deferOrder while iterating
 * yields each entry of the order the iteration began with exactly once. Other
 * mutation during iteration, NaN and -0 keys, values mutated in place without
 * a write, and a comparator that throws are not promised; the coverage map
 * records these limits.
 *
 * The reference model is deliberately dull: a native Map owns the values and
 * a fresh full sort derives every observation. The production structure may
 * update its ordered index incrementally, but it must refine that
 * recomputation after every generated command. The driver observes size,
 * point lookup, and every iterator; checking only the final values would miss
 * stale keys, lost ties, and inconsistent views of the same state.
 */

type Order = `key` | `ascending` | `descending`

async function countDisplacedSlots(
  action: () => void | Promise<void>,
): Promise<number> {
  const splice = Array.prototype.splice
  let displaced = 0
  const spy = vi.spyOn(Array.prototype, `splice`).mockImplementation(function (
    this: Array<unknown>,
    start: number,
    deleteCount?: number,
    ...items: Array<unknown>
  ) {
    const removed = deleteCount ?? this.length - start
    displaced += Math.max(0, this.length - start - removed)
    return splice.call(this, start, removed, ...items)
  })
  try {
    await action()
  } finally {
    spy.mockRestore()
  }
  return displaced
}

type RuntimeKey = undefined | null
type ModelKey = number | RuntimeKey

const isRuntimeKey = (key: unknown): key is RuntimeKey => key == null
const asKey = (key: ModelKey) => key as number

// A burst writes more keys than one small batch holds, in an order derived
// from its seed value, so ordered restoration has many pending keys to place.
function burstEntries(seed: number): Array<[number, number]> {
  const count = 17 + (seed + 3) * 4
  const keys = Array.from({ length: count }, (_, index) => 10 + index)
  if (seed % 2 !== 0) keys.reverse()
  return keys.map((key) => [key, ((key * 7) % 5) - 2])
}

const probeKeys: Array<ModelKey> = [
  -3,
  -2,
  -1,
  0,
  1,
  2,
  3,
  undefined,
  null,
  10,
  26,
  50,
]

// The promised total key order: undefined, null, then numbers (the generated
// keys hold no strings).
function compareModelKeys(a: ModelKey, b: ModelKey): number {
  const rank = (key: ModelKey) => (key === undefined ? 0 : key === null ? 1 : 2)
  return rank(a) - rank(b) || (rank(a) === 2 ? a! - b! : 0)
}

function modelOrder(model: Map<ModelKey, number>, order: Order) {
  return [...model].sort(
    ([ka, va], [kb, vb]) =>
      (order === `key` ? 0 : order === `ascending` ? va - vb : vb - va) ||
      compareModelKeys(ka, kb),
  )
}

function expectMap(
  actual: SortedMap<number, number>,
  model: Map<ModelKey, number>,
  order: Order,
) {
  // Recompute from a plain Map; do not copy SortedMap's binary insertion logic.
  const expected = modelOrder(model, order)
  expect(actual.size).toBe(model.size)
  expect([...actual]).toEqual(expected)
  expect([...actual.entries()]).toEqual(expected)
  expect([...actual.keys()]).toEqual(expected.map(([key]) => key))
  expect([...actual.values()]).toEqual(expected.map(([, value]) => value))
  for (const key of probeKeys) {
    expect(actual.has(asKey(key))).toBe(model.has(key))
    expect(actual.get(asKey(key))).toBe(model.get(key))
  }
}

describe.each([`key`, `ascending`, `descending`] as const)(
  `SortedMap %s history`,
  (order) => {
    const property = {
      key: `sorted-map.key`,
      ascending: `sorted-map.ascending`,
      descending: `sorted-map.descending`,
    }[order]
    it.each([20260912, undefined])(
      `agrees with full recomputation (seed %s)`,
      async (seed) => {
        const reach = createOracleReach(
          property,
          [
            `placed-runtime-key-deleted`,
            `runtime-key-observed`,
            `deferred-burst-observed`,
            `entry-yielded-after-pruning`,
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
                ),
                key: fc.oneof(
                  { arbitrary: fc.integer({ min: -3, max: 3 }), weight: 3 },
                  { arbitrary: fc.constantFrom(undefined, null), weight: 3 },
                ),
                value: fc.integer({ min: -3, max: 3 }),
                deferOrder: fc.boolean(),
                observe: fc.boolean(),
              }),
              { minLength: 6, maxLength: 40 },
            ),
            (actions) => {
              reach.beginHistory()
              const actual = new SortedMap<number, number>(
                order === `key`
                  ? undefined
                  : order === `ascending`
                    ? (a, b) => a - b
                    : (a, b) => b - a,
              )
              const model = new Map<ModelKey, number>()
              // Keys written with deferOrder since the last ordered read or
              // ordering write; an ordered read must place all of them.
              const deferred = new Set<ModelKey>()
              // Keys whose ordered slot reflects their current value: written
              // without deferral, or read in order since their last write.
              const placed = new Set<ModelKey>()
              const observe = () => {
                for (const key of model.keys()) placed.add(key)
                if (deferred.size > 16) reach.reach(`deferred-burst-observed`)
                if ([...model.keys()].some(isRuntimeKey))
                  reach.reach(`runtime-key-observed`)
                expectMap(actual, model, order)
                deferred.clear()
              }
              observe()
              for (const action of actions) {
                const key = action.key
                if (action.kind === `set`) {
                  expect(
                    actual.set(asKey(key), action.value, action.deferOrder),
                  ).toBe(actual)
                  model.set(key, action.value)
                  if (action.deferOrder) {
                    deferred.add(key)
                    placed.delete(key)
                  } else {
                    deferred.clear()
                    for (const modelKey of model.keys()) placed.add(modelKey)
                  }
                } else if (action.kind === `delete`) {
                  if (isRuntimeKey(key) && placed.has(key))
                    reach.reach(`placed-runtime-key-deleted`)
                  expect(actual.delete(asKey(key), action.deferOrder)).toBe(
                    model.delete(key),
                  )
                  placed.delete(key)
                  if (action.deferOrder) deferred.add(key)
                  else {
                    deferred.clear()
                    for (const modelKey of model.keys()) placed.add(modelKey)
                  }
                } else if (action.kind === `burst`) {
                  for (const [burstKey, value] of burstEntries(action.value)) {
                    actual.set(burstKey, value, true)
                    model.set(burstKey, value)
                    deferred.add(burstKey)
                    placed.delete(burstKey)
                  }
                } else if (action.kind === `prune`) {
                  // Iterate in order, deleting each entry whose value has the
                  // action's parity with deferOrder, as settled transactions
                  // are pruned. The iteration yields the order it began with.
                  const expected = modelOrder(model, order)
                  const yielded: Array<[number, number]> = []
                  let pruned = false
                  for (const [entryKey, value] of actual) {
                    if (pruned) reach.reach(`entry-yielded-after-pruning`)
                    yielded.push([entryKey, value])
                    if ((value - action.value) % 2 === 0) {
                      expect(actual.delete(entryKey, true)).toBe(true)
                      pruned = true
                    }
                  }
                  expect(yielded).toEqual(expected)
                  for (const [entryKey, value] of expected) {
                    if ((value - action.value) % 2 !== 0) continue
                    model.delete(entryKey)
                    deferred.add(entryKey)
                    placed.delete(entryKey)
                  }
                } else {
                  actual.clear()
                  model.clear()
                  deferred.clear()
                  placed.clear()
                }
                expect(actual.size).toBe(model.size)
                expect(actual.has(asKey(key))).toBe(model.has(key))
                expect(actual.get(asKey(key))).toBe(model.get(key))
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
            examples: [
              [
                [
                  {
                    kind: `set`,
                    key: 1,
                    value: 3,
                    deferOrder: true,
                    observe: false,
                  },
                  {
                    kind: `set`,
                    key: -1,
                    value: 3,
                    deferOrder: true,
                    observe: false,
                  },
                  {
                    kind: `set`,
                    key: 1,
                    value: -3,
                    deferOrder: false,
                    observe: true,
                  },
                  {
                    kind: `delete`,
                    key: -1,
                    value: 0,
                    deferOrder: true,
                    observe: false,
                  },
                  {
                    kind: `clear`,
                    key: 0,
                    value: 0,
                    deferOrder: false,
                    observe: true,
                  },
                  {
                    kind: `set`,
                    key: -1,
                    value: 2,
                    deferOrder: true,
                    observe: true,
                  },
                ],
              ],
            ],
          },
        )
        reach.assertReached()
      },
    )
  },
)

it(`rejects wrong default ordering, missing tied entries, and stale overwrites`, () => {
  const byValue = new SortedMap<number, number>((a, b) => a - b)
  byValue.set(1, 3).set(-1, 4)
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
  const missingTie = new SortedMap<number, number>((a, b) => a - b)
  missingTie.set(1, 3)
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
  const stale = new SortedMap<number, number>()
  stale.set(1, 3)
  expect(() => expectMap(stale, new Map([[1, 2]]), `key`)).toThrow()
})

describe(`SortedMap`, () => {
  it(`keeps ordered-key movement bounded during descending bulk inserts`, async () => {
    // This work counter records the array elements displaced by splice. The
    // old ordered-key array moves every earlier key on each descending insert.
    // It is a diagnostic for this work class, not a wall-clock threshold.
    async function displacedSlots(size: number) {
      const map = new SortedMap<number, number>()
      const displaced = await countDisplacedSlots(() => {
        for (let key = size - 1; key >= 0; key--) map.set(key, key, true)
      })
      return { map, displaced }
    }
    const small = await displacedSlots(512)
    const large = await displacedSlots(2048)
    expect(large.displaced).toBeLessThan(2048 * 64)
    if (small.displaced > 0)
      expect(large.displaced).toBeLessThan(small.displaced * 8)
    large.map.restoreOrder()
    expect([...large.map.keys()]).toEqual(
      Array.from({ length: 2048 }, (_, key) => key),
    )
  })

  it.each([`key`, `ascending`, `descending`] as const)(
    `keeps exact order after deferred %s inserts, reorders, and deletes`,
    (order) => {
      const map = new SortedMap<number, number>(
        order === `key`
          ? undefined
          : order === `ascending`
            ? (a, b) => a - b
            : (a, b) => b - a,
      )
      const model = new Map<number, number>()
      for (let key = 255; key >= 0; key--) {
        map.set(key, key % 17, true)
        model.set(key, key % 17)
      }
      expectMap(map, model, order)
      for (let key = 0; key < 256; key += 5) {
        map.set(key, -key, true)
        model.set(key, -key)
      }
      expectMap(map, model, order)
      for (let key = 0; key < 256; key += 7) {
        expect(map.delete(key, true)).toBe(model.delete(key))
      }
      expectMap(map, model, order)
    },
  )

  it(`keeps a default-order key iterator live across set and delete`, () => {
    const map = new SortedMap<number, number>()
    map.set(1, 1).set(3, 3)
    const pending = map.keys()
    map.set(2, 2, true)
    map.restoreOrder()
    expect([...pending]).toEqual([1, 2, 3])

    const running = map.keys()
    expect(running.next().value).toBe(1)
    map.delete(2, true)
    map.restoreOrder()
    expect([...running]).toEqual([3])

    const resumed = map.keys()
    expect(resumed.next().value).toBe(1)
    map.set(2, 2, true)
    map.restoreOrder()
    expect([...resumed]).toEqual([2, 3])
  })

  it(`keeps mixed string, number, and NaN keys distinct in default order`, () => {
    const map = new SortedMap<string | number, number>()
    for (const key of [2, `2`, Number.NaN, -1, `a`, `0`, 0]) {
      map.set(key, 1, true)
    }
    expect([...map.keys()]).toEqual([`0`, `2`, `a`, -1, 0, 2, Number.NaN])
    map.delete(`2`, true)
    map.set(Number.NaN, 2, true)
    expect([...map.keys()]).toEqual([`0`, `a`, -1, 0, 2, Number.NaN])
    expect(map.size).toBe(6)
    expect(map.get(Number.NaN)).toBe(2)
  })

  it(`retains runtime undefined keys and does not resort clean scans`, () => {
    const compare = vi.fn((left: number, right: number) => left - right)
    const map = new SortedMap<string, number>(compare)
    const absent = undefined as unknown as string
    map.set(`a`, 2, true)
    map.set(absent, 1, true)
    map.restoreOrder()
    expect([...map.keys()]).toEqual([absent, `a`])
    compare.mockClear()
    for (let scan = 0; scan < 20; scan++) {
      expect([...map.keys()]).toEqual([absent, `a`])
    }
    expect(compare).not.toHaveBeenCalled()
    expect(map.delete(absent, true)).toBe(true)
    map.restoreOrder()
    expect([...map.keys()]).toEqual([`a`])
  })

  it(`preserves insertion behavior around transient nullish numeric keys`, () => {
    const map = new SortedMap<number, number>()
    const absent = undefined as unknown as number
    map.set(absent, 0, true)
    map.set(1, 0, true)
    expect([...map.keys()]).toEqual([absent, 1])
    expect(map.delete(absent, true)).toBe(true)
    for (let key = 128; key > 1; key--) map.set(key, 0, true)
    map.restoreOrder()
    expect([...map.keys()]).toEqual(
      Array.from({ length: 128 }, (_, i) => i + 1),
    )
  })

  it(`keeps ordered-key movement bounded during deferred bulk deletes and reorders`, async () => {
    // A bulk commit can remove or reorder many existing keys, not only add
    // new ones. Moving every later key once per removed or reordered key is
    // quadratic; the bound allows a constant number of passes.
    const size = 2048
    const map = new SortedMap<number, number>((a, b) => a - b)
    for (let key = 0; key < size; key++) map.set(key, key, true)
    map.restoreOrder()
    const deleted = await countDisplacedSlots(() => {
      for (let key = 0; key < size; key += 2) map.delete(key, true)
      map.restoreOrder()
    })
    expect(deleted).toBeLessThan(size * 64)
    const reordered = await countDisplacedSlots(() => {
      for (let key = 1; key < size; key += 4) map.set(key, -key, true)
      map.restoreOrder()
    })
    expect(reordered).toBeLessThan(size * 64)
    const expected = Array.from(
      { length: size / 2 },
      (_, index) => 2 * index + 1,
    )
      .map((key) => [key, key % 4 === 1 ? -key : key] as const)
      .sort(([, a], [, b]) => a - b)
      .map(([key]) => key)
    expect([...map.keys()]).toEqual(expected)
  })

  it(`keeps Map ownership when a placed comparator value was mutated in place`, () => {
    // A sync source may reuse a row object it already wrote. Where the mutated
    // row sorts is not promised, but deleting or rewriting it must affect only
    // its own key: a binary search guided by the stale order would otherwise
    // remove a neighbor.
    for (const deferOrder of [false, true]) {
      const map = new SortedMap<string, { rank: number }>(
        (left, right) => left.rank - right.rank,
      )
      const rows = [`a`, `b`, `c`, `d`, `e`].map((key, rank) => {
        const row = { rank }
        map.set(key, row)
        return row
      })
      rows[1]!.rank = 10
      expect(map.delete(`b`, deferOrder)).toBe(true)
      map.restoreOrder()
      expect([...map.keys()]).toEqual([`a`, `c`, `d`, `e`])
      rows[3]!.rank = -10
      map.set(`d`, { rank: 1.5 }, deferOrder)
      map.restoreOrder()
      expect([...map.keys()]).toEqual([`a`, `d`, `c`, `e`])
      expect(map.size).toBe(4)
    }
  })

  it(`orders mutable comparator values at the batch checkpoint`, () => {
    const map = new SortedMap<string, { rank: number }>(
      (left, right) => left.rank - right.rank,
    )
    const first = { rank: 1 }
    map.set(`a`, first, true)
    map.set(`b`, { rank: 2 }, true)
    first.rank = 3
    map.restoreOrder()
    expect([...map.keys()]).toEqual([`b`, `a`])
    expect(map.delete(`a`)).toBe(true)
    expect([...map.keys()]).toEqual([`b`])
  })

  it(`bounds ordered-key movement in a bulk Collection sync commit`, async () => {
    type Row = { id: number }
    let sync!: Parameters<SyncConfig<Row, number>[`sync`]>[0]
    const collection = createCollection<Row, number>({
      getKey: (row) => row.id,
      startSync: true,
      sync: {
        sync: (actions) => {
          sync = actions
          actions.markReady()
        },
      },
    })
    try {
      sync.begin()
      for (let id = 4095; id >= 0; id--)
        sync.write({ type: `insert`, value: { id } })
      const displaced = await countDisplacedSlots(() => {
        expect(sync.commit()).toBe(true)
      })
      expect(displaced).toBeLessThan(4096 * 64)
      expect([...collection.keys()]).toEqual(
        Array.from({ length: 4096 }, (_, id) => id),
      )

      sync.begin()
      for (let id = -1; id >= -1024; id--)
        sync.write({ type: `insert`, value: { id } })
      const retainedDisplaced = await countDisplacedSlots(() => {
        expect(sync.commit()).toBe(true)
      })
      expect(retainedDisplaced).toBeLessThan(4096 * 32)
      expect([...collection.keys()]).toEqual(
        Array.from({ length: 5120 }, (_, index) => index - 1024),
      )
    } finally {
      await collection.cleanup()
    }
  })

  it(`bounds ordered-key movement across queued sync transactions`, async () => {
    type Row = { id: number; value: number }
    let sync!: Parameters<SyncConfig<Row, number>[`sync`]>[0]
    let release!: () => void
    const persistence = new Promise<void>((resolve) => {
      release = resolve
    })
    const collection = createCollection<Row, number>({
      getKey: (row) => row.id,
      startSync: true,
      sync: {
        sync: (actions) => {
          sync = actions
          actions.begin()
          actions.write({ type: `insert`, value: { id: 0, value: 0 } })
          actions.commit()
          actions.markReady()
        },
      },
    })
    const blocker = createTransaction<Row>({
      autoCommit: false,
      mutationFn: () => persistence,
    })
    let blockerCommit: Promise<unknown> | undefined
    const receipts: Array<Promise<void>> = []
    try {
      await collection.stateWhenReady()
      blocker.mutate(() =>
        collection.update(0, (draft) => {
          draft.value = 1
        }),
      )
      blockerCommit = blocker.commit()
      await Promise.resolve()
      expect(blocker.state).toBe(`persisting`)

      for (let batch = 0; batch < 16; batch++) {
        sync.begin()
        for (let offset = 0; offset < 64; offset++) {
          const id = 1024 - batch * 64 - offset
          sync.write({ type: `insert`, value: { id, value: id } })
        }
        const receipt = sync.commit()
        expect(receipt).not.toBe(true)
        if (receipt !== true) {
          void receipt.catch(() => undefined)
          receipts.push(receipt)
        }
      }

      const displaced = await countDisplacedSlots(async () => {
        release()
        await blockerCommit
        await Promise.all(receipts)
      })
      expect(displaced).toBeLessThan(1024 * 64)
      expect([...collection.keys()]).toEqual(
        Array.from({ length: 1025 }, (_, id) => id),
      )
    } finally {
      release()
      if (blocker.state === `pending` || blocker.state === `persisting`)
        blocker.rollback()
      await blockerCommit?.catch(() => undefined)
      await Promise.allSettled(receipts)
      await collection.cleanup()
    }
  })

  it(`publishes a large sync transaction in comparator order`, async () => {
    type Row = { id: number; rank: number }
    let sync!: Parameters<SyncConfig<Row, number>[`sync`]>[0]
    const compare = vi.fn((left: Row, right: Row) => left.rank - right.rank)
    const collection = createCollection<Row, number>({
      getKey: (row) => row.id,
      compare,
      startSync: true,
      sync: {
        rowUpdateMode: `full`,
        sync: (actions) => {
          sync = actions
          actions.markReady()
        },
      },
    })
    const model = new Map<number, Row>()
    const expectedKeys = () =>
      [...model.values()]
        .sort((left, right) => left.rank - right.rank || left.id - right.id)
        .map((row) => row.id)
    const published: Array<Array<number>> = []
    const subscription = collection.subscribeChanges(
      () => published.push([...collection.keys()]),
      { includeInitialState: false },
    )
    try {
      const pending = collection.keys()
      sync.begin()
      for (let id = 127; id >= 0; id--) {
        const row = { id, rank: id % 7 }
        model.set(id, row)
        sync.write({ type: `insert`, value: row })
      }
      expect(sync.commit()).toBe(true)
      expect([...pending]).toEqual(expectedKeys())
      expect([...collection.keys()]).toEqual(expectedKeys())
      expect(published.at(-1)).toEqual(expectedKeys())

      sync.begin()
      for (let id = 0; id < 64; id++) {
        const row = { id, rank: -id }
        model.set(id, row)
        sync.write({ type: `update`, value: row })
      }
      for (let id = 64; id < 70; id++) {
        model.delete(id)
        sync.write({ type: `delete`, key: id })
      }
      expect(sync.commit()).toBe(true)
      expect([...collection.keys()]).toEqual(expectedKeys())
      expect(published.at(-1)).toEqual(expectedKeys())

      sync.begin()
      for (let id = 128; id < 10000; id++) {
        const row = { id, rank: id % 7 }
        model.set(id, row)
        sync.write({ type: `insert`, value: row })
      }
      expect(sync.commit()).toBe(true)
      expect([...collection.keys()]).toEqual(expectedKeys())

      // A small update batch in a large Collection should keep using
      // incremental ordering instead of sorting every retained row.
      compare.mockClear()
      sync.begin()
      for (let id = 0; id < 64; id++) {
        const row = { id, rank: -id - 100 }
        model.set(id, row)
        sync.write({ type: `update`, value: row })
      }
      expect(sync.commit()).toBe(true)
      expect(compare.mock.calls.length).toBeLessThan(5000)
      expect([...collection.keys()]).toEqual(expectedKeys())
      expect(published.at(-1)).toEqual(expectedKeys())
    } finally {
      subscription.unsubscribe()
      await collection.cleanup()
    }
  })
  it(`sorts by key by default, even when values have the opposite order`, () => {
    const map = new SortedMap<string, number>()
    map.set(`c`, 1)
    map.set(`a`, 3)
    map.set(`b`, 2)

    const values = Array.from(map.values())
    expect(values).toEqual([3, 2, 1])
  })

  it(`works with custom comparator`, () => {
    // Create a map that sorts numbers in descending order
    const map = new SortedMap<string, number>((a, b) => b - a)
    map.set(`a`, 1)
    map.set(`c`, 3)
    map.set(`b`, 2)

    const values = Array.from(map.values())
    expect(values).toEqual([3, 2, 1])
  })

  it(`correctly handles updates`, () => {
    const map = new SortedMap<string, number>()
    map.set(`a`, 1)
    map.set(`b`, 3)
    map.set(`a`, 2) // update existing key

    expect(map.size).toBe(2)
    expect(map.get(`a`)).toBe(2)
    const values = Array.from(map.values())
    expect(values).toEqual([2, 3])
  })

  it(`correctly handles deletions`, () => {
    const map = new SortedMap<string, number>()
    map.set(`a`, 1)
    map.set(`b`, 2)
    map.set(`c`, 3)

    map.delete(`b`)
    expect(map.size).toBe(2)
    const values = Array.from(map.values())
    expect(values).toEqual([1, 3])
  })

  it(`implements iteration methods correctly`, () => {
    const map = new SortedMap<string, number>()
    map.set(`b`, 2)
    map.set(`a`, 1)
    map.set(`c`, 3)

    // Test entries()
    const entries = Array.from(map.entries())
    expect(entries).toEqual([
      [`a`, 1],
      [`b`, 2],
      [`c`, 3],
    ])

    // Test values()
    const values = Array.from(map.values())
    expect(values).toEqual([1, 2, 3])
  })

  it(`orders string keys when no custom comparator is provided`, () => {
    const map = new SortedMap<string, string>()
    map.set(`c`, `charlie`)
    map.set(`a`, `alpha`)
    map.set(`b`, `bravo`)

    const values = Array.from(map.values())
    expect(values).toEqual([`alpha`, `bravo`, `charlie`])

    // Test with values that would be sorted differently by a custom comparator
    const numericMap = new SortedMap<string, string>()
    numericMap.set(`a`, `10`)
    numericMap.set(`b`, `2`)

    // Default string comparison will put '10' before '2'
    const numericValues = Array.from(numericMap.values())
    expect(numericValues).toEqual([`10`, `2`])
  })

  // Test for keys() method
  it(`provides keys in sorted order`, () => {
    const map = new SortedMap<string, number>()
    map.set(`c`, 3)
    map.set(`a`, 1)
    map.set(`b`, 2)

    const keys = Array.from(map.keys())
    expect(keys).toEqual([`a`, `b`, `c`])
  })

  // Test for Symbol.iterator implementation
  it(`supports direct iteration with for...of`, () => {
    const map = new SortedMap<string, number>()
    map.set(`c`, 3)
    map.set(`a`, 1)
    map.set(`b`, 2)

    const entries: Array<[string, number]> = []
    for (const entry of map) {
      entries.push(entry)
    }

    expect(entries).toEqual([
      [`a`, 1],
      [`b`, 2],
      [`c`, 3],
    ])
  })

  // Test for clear method
  it(`clears all entries`, () => {
    const map = new SortedMap<string, number>()
    map.set(`a`, 1)
    map.set(`b`, 2)

    map.clear()
    expect(map.size).toBe(0)
    expect(Array.from(map.entries())).toEqual([])
  })
})
