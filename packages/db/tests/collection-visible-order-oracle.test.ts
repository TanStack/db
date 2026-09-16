import { describe, expect, it } from 'vitest'
import { createCollection } from '../src/collection/index.js'
import { createDeferred } from '../src/deferred.js'
import type { Collection } from '../src/collection/index.js'
import type { SyncConfig } from '../src/types.js'

type RankedRow = { id: string; rank: string }
type RankedCollection = Collection<RankedRow, string>
type RankedSync = Parameters<SyncConfig<RankedRow, string>[`sync`]>[0]

const compareByRank = (left: RankedRow, right: RankedRow): number =>
  left.rank.localeCompare(right.rank)

const orderedIds = (rows: ReadonlyArray<RankedRow>): Array<string> =>
  [...rows]
    .sort(
      (left, right) =>
        left.rank.localeCompare(right.rank) || left.id.localeCompare(right.id),
    )
    .map(({ id }) => id)

const visibleOrders = (collection: RankedCollection) => ({
  keys: [...collection.keys()],
  values: [...collection.values()].map(({ id }) => id),
  entries: [...collection.entries()].map(([key]) => key),
  iterator: [...collection].map(([key]) => key),
  state: [...collection.state.keys()],
  toArray: collection.toArray.map(({ id }) => id),
  changes: collection.currentStateAsChanges()!.map(({ key }) => key),
})

const expectedVisibleOrders = (expected: ReadonlyArray<string>) => ({
  keys: expected,
  values: expected,
  entries: expected,
  iterator: expected,
  state: expected,
  toArray: expected,
  changes: expected,
})

const expectVisibleOrder = (
  collection: RankedCollection,
  expected: ReadonlyArray<string>,
) => {
  expect(visibleOrders(collection)).toEqual(expectedVisibleOrders(expected))
}

let collectionId = 0

const setupCollection = async (
  rows: ReadonlyArray<RankedRow>,
  compare?: (left: RankedRow, right: RankedRow) => number,
) => {
  let sync!: RankedSync
  const persistence = createDeferred<void>()
  const collection = createCollection<RankedRow, string>({
    id: `visible-order-oracle-${collectionId++}`,
    getKey: (row) => row.id,
    compare,
    startSync: true,
    sync: {
      sync: (actions) => {
        sync = actions
        actions.begin()
        for (const row of rows)
          actions.write({ type: `insert`, value: { ...row } })
        actions.commit()
        actions.markReady()
      },
    },
    onInsert: () => persistence.promise,
    onUpdate: () => persistence.promise,
    onDelete: () => persistence.promise,
  })
  await collection.preload()
  return { collection, persistence, sync }
}

const confirm = async (
  fixture: Awaited<ReturnType<typeof setupCollection>>,
  transaction: ReturnType<RankedCollection[`insert`]>,
  change: { type: `insert` | `update` | `delete`; value: RankedRow },
) => {
  fixture.sync.begin()
  fixture.sync.write(change)
  const authoritative = fixture.sync.commit()
  expect(
    authoritative,
    `authoritative row waits for the pending transaction`,
  ).toBeInstanceOf(Promise)
  fixture.persistence.resolve()
  await transaction.isPersisted.promise
  await authoritative
}

describe(`Collection visible ordering`, () => {
  it(`distinguishes declared order from append-after-authoritative order`, () => {
    const rows = [
      { id: `a`, rank: `a1` },
      { id: `c`, rank: `a3` },
      { id: `b`, rank: `a2` },
    ]

    expect(rows.map(({ id }) => id)).toEqual([`a`, `c`, `b`])
    expect(orderedIds(rows)).toEqual([`a`, `b`, `c`])
  })

  it(`orders a pending optimistic insert on every public iteration surface`, async () => {
    const fixture = await setupCollection(
      [
        { id: `a`, rank: `a1` },
        { id: `c`, rank: `a3` },
      ],
      compareByRank,
    )
    const callbackOrders: Array<ReturnType<typeof visibleOrders>> = []
    const subscription = fixture.collection.subscribeChanges(
      () => callbackOrders.push(visibleOrders(fixture.collection)),
      { includeInitialState: false },
    )
    const transaction = fixture.collection.insert({ id: `b`, rank: `a2` })

    try {
      expect(fixture.collection.get(`b`)?.$synced, `optimistic path`).toBe(
        false,
      )
      expectVisibleOrder(fixture.collection, [`a`, `b`, `c`])
      expect(callbackOrders, `one complete callback-time view`).toEqual([
        expectedVisibleOrders([`a`, `b`, `c`]),
      ])

      await confirm(fixture, transaction, {
        type: `insert`,
        value: { id: `b`, rank: `a2` },
      })
      expectVisibleOrder(fixture.collection, [`a`, `b`, `c`])
    } finally {
      fixture.persistence.resolve()
      await transaction.isPersisted.promise.catch(() => undefined)
      subscription.unsubscribe()
      await fixture.collection.cleanup()
    }
  })

  it(`moves an optimistically updated row using its visible value`, async () => {
    const fixture = await setupCollection(
      [
        { id: `a`, rank: `a1` },
        { id: `b`, rank: `a2` },
        { id: `c`, rank: `a3` },
      ],
      compareByRank,
    )
    const transaction = fixture.collection.update(`c`, (draft) => {
      draft.rank = `a0`
    })

    try {
      expectVisibleOrder(fixture.collection, [`c`, `a`, `b`])
      await confirm(fixture, transaction, {
        type: `update`,
        value: { id: `c`, rank: `a0` },
      })
      expectVisibleOrder(fixture.collection, [`c`, `a`, `b`])
    } finally {
      fixture.persistence.resolve()
      await transaction.isPersisted.promise.catch(() => undefined)
      await fixture.collection.cleanup()
    }
  })

  it.each([`rollback`, `reject`] as const)(
    `restores ordered public surfaces after optimistic update %s`,
    async (outcome) => {
      const fixture = await setupCollection(
        [
          { id: `a`, rank: `a1` },
          { id: `b`, rank: `a2` },
          { id: `c`, rank: `a3` },
        ],
        compareByRank,
      )
      const callbackOrders: Array<ReturnType<typeof visibleOrders>> = []
      const subscription = fixture.collection.subscribeChanges(
        () => callbackOrders.push(visibleOrders(fixture.collection)),
        { includeInitialState: false },
      )
      const transaction = fixture.collection.update(`c`, (draft) => {
        draft.rank = `a0`
      })

      try {
        expectVisibleOrder(fixture.collection, [`c`, `a`, `b`])
        if (outcome === `rollback`) {
          transaction.rollback()
          fixture.persistence.resolve()
        } else {
          fixture.persistence.reject(new Error(`rejected update`))
        }
        await transaction.isPersisted.promise.catch(() => undefined)

        expectVisibleOrder(fixture.collection, [`a`, `b`, `c`])
        expect(
          callbackOrders,
          `optimistic and restored callback views`,
        ).toEqual([
          expectedVisibleOrders([`c`, `a`, `b`]),
          expectedVisibleOrders([`a`, `b`, `c`]),
        ])
      } finally {
        fixture.persistence.resolve()
        await transaction.isPersisted.promise.catch(() => undefined)
        subscription.unsubscribe()
        await fixture.collection.cleanup()
      }
    },
  )

  it(`omits an optimistically deleted row from the ordered overlay`, async () => {
    const fixture = await setupCollection(
      [
        { id: `a`, rank: `a1` },
        { id: `b`, rank: `a2` },
        { id: `c`, rank: `a3` },
      ],
      compareByRank,
    )
    const transaction = fixture.collection.delete(`b`)

    try {
      expectVisibleOrder(fixture.collection, [`a`, `c`])
      await confirm(fixture, transaction, {
        type: `delete`,
        value: { id: `b`, rank: `a2` },
      })
      expectVisibleOrder(fixture.collection, [`a`, `c`])
    } finally {
      fixture.persistence.resolve()
      await transaction.isPersisted.promise.catch(() => undefined)
      await fixture.collection.cleanup()
    }
  })

  it(`preserves negative and positive comparator results before key ties`, async () => {
    const observed = new Set<number>()
    const compare = (left: RankedRow, right: RankedRow) => {
      const comparison =
        left.rank < right.rank ? -7 : left.rank > right.rank ? 11 : 0
      observed.add(comparison)
      return comparison
    }
    const fixture = await setupCollection([{ id: `m`, rank: `b` }], compare)
    const transactions = [
      fixture.collection.insert({ id: `z`, rank: `a` }),
      fixture.collection.insert({ id: `a`, rank: `c` }),
    ]

    try {
      // Both keys conflict with their value order, so falling back to the key
      // comparator for either non-zero result would reverse the visible rows.
      expectVisibleOrder(fixture.collection, [`z`, `m`, `a`])
      expect(observed.has(-7), `negative comparator result`).toBe(true)
      expect(observed.has(11), `positive comparator result`).toBe(true)
    } finally {
      fixture.persistence.resolve()
      await Promise.all(
        transactions.map((transaction) =>
          transaction.isPersisted.promise.catch(() => undefined),
        ),
      )
      await fixture.collection.cleanup()
    }
  })

  it.each([0, -0, Number.NaN])(
    `uses the existing key tie-break for comparator result %s`,
    async (comparison) => {
      const fixture = await setupCollection(
        [
          { id: `a`, rank: `same` },
          { id: `c`, rank: `same` },
        ],
        () => comparison,
      )
      const transaction = fixture.collection.insert({ id: `b`, rank: `same` })

      try {
        expectVisibleOrder(fixture.collection, [`a`, `b`, `c`])
        await confirm(fixture, transaction, {
          type: `insert`,
          value: { id: `b`, rank: `same` },
        })
      } finally {
        fixture.persistence.resolve()
        await transaction.isPersisted.promise.catch(() => undefined)
        await fixture.collection.cleanup()
      }
    },
  )

  it(`preserves append-after-authoritative order without a comparator`, async () => {
    const fixture = await setupCollection([
      { id: `a`, rank: `a1` },
      { id: `c`, rank: `a3` },
    ])
    const transaction = fixture.collection.insert({ id: `b`, rank: `a2` })

    try {
      expectVisibleOrder(fixture.collection, [`a`, `c`, `b`])
      await confirm(fixture, transaction, {
        type: `insert`,
        value: { id: `b`, rank: `a2` },
      })
    } finally {
      fixture.persistence.resolve()
      await transaction.isPersisted.promise.catch(() => undefined)
      await fixture.collection.cleanup()
    }
  })

  it(`keeps one optimistic upsert within linear comparison work`, async () => {
    let comparisons = 0
    const compare = (left: RankedRow, right: RankedRow) => {
      comparisons++
      return left.rank.localeCompare(right.rank)
    }
    const rows = Array.from({ length: 128 }, (_, index) => ({
      id: `base-${index.toString().padStart(3, `0`)}`,
      rank: index.toString().padStart(3, `0`),
    }))
    const fixture = await setupCollection(rows, compare)
    const transaction = fixture.collection.insert({
      id: `optimistic`,
      rank: `064.5`,
    })

    try {
      comparisons = 0
      const keys = [...fixture.collection.keys()]
      expect(keys.indexOf(`optimistic`), `visible merged position`).toBe(65)
      expect(comparisons, `linear merge comparison bound`).toBeLessThanOrEqual(
        rows.length + 1,
      )
    } finally {
      fixture.persistence.resolve()
      await transaction.isPersisted.promise.catch(() => undefined)
      await fixture.collection.cleanup()
    }
  })

  it(`sorts multiple optimistic upserts without quadratic comparison work`, async () => {
    let comparisons = 0
    const compare = (left: RankedRow, right: RankedRow) => {
      comparisons++
      return left.rank.localeCompare(right.rank)
    }
    const rows = Array.from({ length: 128 }, (_, index) => ({
      id: `base-${index.toString().padStart(3, `0`)}`,
      rank: (index * 2).toString().padStart(3, `0`),
    }))
    const optimisticRows = Array.from({ length: 16 }, (_, index) => ({
      id: `optimistic-${index.toString().padStart(2, `0`)}`,
      rank: (31 - index * 2).toString().padStart(3, `0`),
    }))
    const fixture = await setupCollection(rows, compare)
    const transactions = optimisticRows.map((row) =>
      fixture.collection.insert(row),
    )

    try {
      comparisons = 0
      expect([...fixture.collection.keys()]).toEqual(
        orderedIds([...rows, ...optimisticRows]),
      )
      expect(
        comparisons,
        `optimistic-side comparison bound`,
      ).toBeLessThanOrEqual(64)
    } finally {
      fixture.persistence.resolve()
      await Promise.all(
        transactions.map((transaction) =>
          transaction.isPersisted.promise.catch(() => undefined),
        ),
      )
      await fixture.collection.cleanup()
    }
  })
})
