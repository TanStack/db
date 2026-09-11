import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createCollection } from '../src/collection/index.js'
import { createDeferred } from '../src/deferred.js'
import { createLiveQueryCollection } from '../src/query/index.js'
import { createTransaction } from '../src/transactions.js'
import { stripVirtualProps } from './utils.js'
import type { SyncConfig } from '../src/types.js'

type Row = { id: number; a: string; b: string; c: string }
const initial: Row = { id: 1, a: `a0`, b: `b0`, c: `c0` }
const orders = [
  [0, 1, 2],
  [0, 2, 1],
  [1, 0, 2],
  [1, 2, 0],
  [2, 0, 1],
  [2, 1, 0],
]

function source(onUpdate = () => Promise.resolve()) {
  let sync!: Parameters<SyncConfig<Row>[`sync`]>[0]
  const collection = createCollection<Row>({
    getKey: (row) => row.id,
    onUpdate,
    sync: {
      sync: (params) => {
        sync = params
        params.begin()
        params.write({ type: `insert`, value: initial })
        params.commit()
        params.markReady()
      },
    },
  })
  return {
    collection,
    get sync() {
      return sync
    },
  }
}

function pendingTransaction() {
  const done = createDeferred<void>()
  const tx = createTransaction({
    autoCommit: false,
    mutationFn: () => done.promise,
  })
  const settled = tx.isPersisted.promise.catch((error: unknown) => error)
  return { tx, done, settled }
}

const cases = orders.flatMap((order) =>
  ([`pending`, `persisting`] as const).flatMap((phase) =>
    [0, 1, 2].flatMap((removed) =>
      ([`disjoint`, `overlapping`] as const).map((fields) => ({
        order,
        phase,
        removed,
        fields,
      })),
    ),
  ),
)

describe(`optimistic field composition`, () => {
  it.each([false, true])(
    `settles a rebased update with queued confirmation=%s`,
    async (confirm) => {
      const done = createDeferred<void>()
      const fixture = source(() => done.promise)
      const downstream = createLiveQueryCollection({
        query: (q) => q.from({ row: fixture.collection }),
      })
      await downstream.preload()
      const replica = new Map<string | number, Row>([[1, initial]])
      const subscription = fixture.collection.subscribeChanges((changes) => {
        for (const change of changes) {
          if (change.type === `delete`) replica.delete(change.key)
          else replica.set(change.key, stripVirtualProps(change.value))
        }
      })
      const check = (expected: Row) => {
        expect(stripVirtualProps(fixture.collection.get(1))).toEqual(expected)
        expect(replica.get(1)).toEqual(expected)
        expect(stripVirtualProps(downstream.get(1))).toEqual(expected)
      }
      try {
        const tx = fixture.collection.update(1, (row) => {
          row.a = `a1`
        })
        check({ ...initial, a: `a1` })
        fixture.sync.begin({ immediate: true })
        fixture.sync.write({ type: `update`, value: { ...initial, b: `b1` } })
        expect(fixture.sync.commit()).toBe(true)
        check({ ...initial, a: `a1`, b: `b1` })
        let applied: true | Promise<void> = true
        if (confirm) {
          fixture.sync.begin()
          fixture.sync.write({ type: `update`, value: { ...initial, a: `a1` } })
          applied = fixture.sync.commit()
          expect(applied).not.toBe(true)
        }
        done.resolve()
        await tx.isPersisted.promise
        await applied
        check({ ...initial, a: `a1`, b: confirm ? `b0` : `b1` })
      } finally {
        done.resolve()
        subscription.unsubscribe()
        await downstream.cleanup()
        await fixture.collection.cleanup()
      }
    },
  )

  it.each(orders)(
    `retains disjoint direct fields across settlement order %j`,
    async (...order) => {
      const done = [
        createDeferred<void>(),
        createDeferred<void>(),
        createDeferred<void>(),
      ]
      let calls = 0
      const fixture = source(() => done[calls++]!.promise)
      const downstream = createLiveQueryCollection({
        query: (q) => q.from({ row: fixture.collection }),
      })
      await downstream.preload()
      const replica = new Map<string | number, Row>([[1, initial]])
      const subscription = fixture.collection.subscribeChanges((changes) => {
        for (const change of changes) {
          if (change.type === `delete`) replica.delete(change.key)
          else replica.set(change.key, stripVirtualProps(change.value))
        }
      })
      try {
        const patches = [{ a: `a1` }, { b: `b2` }, { c: `c3` }]
        const transactions = patches.map((patch) =>
          fixture.collection.update(1, (row) => {
            Object.assign(row, patch)
          }),
        )
        const expected = { ...initial, a: `a1`, b: `b2`, c: `c3` }
        for (const index of order) {
          done[index]!.resolve()
          await transactions[index]!.isPersisted.promise
          expect(stripVirtualProps(fixture.collection.get(1))).toEqual(expected)
          expect(replica.get(1)).toEqual(expected)
          expect(stripVirtualProps(downstream.get(1))).toEqual(expected)
        }
      } finally {
        for (const pending of done) pending.resolve()
        subscription.unsubscribe()
        await downstream.cleanup()
        await fixture.collection.cleanup()
      }
    },
  )

  it.each([`before`, `after`] as const)(
    `retains only a direct survivor's fields when it completes %s sibling rollback`,
    async (completion) => {
      const done = [createDeferred<void>(), createDeferred<void>()]
      let calls = 0
      const fixture = source(() => done[calls++]!.promise)
      const downstream = createLiveQueryCollection({
        query: (q) => q.from({ row: fixture.collection }),
      })
      await downstream.preload()
      const replica = new Map<string | number, Row>([[1, initial]])
      const subscription = fixture.collection.subscribeChanges((changes) => {
        for (const change of changes) {
          if (change.type === `delete`) replica.delete(change.key)
          else replica.set(change.key, stripVirtualProps(change.value))
        }
      })
      const check = (expected: Row) => {
        expect(stripVirtualProps(fixture.collection.get(1))).toEqual(expected)
        expect(replica.get(1)).toEqual(expected)
        expect(stripVirtualProps(downstream.get(1))).toEqual(expected)
      }
      try {
        const first = fixture.collection.update(1, (row) => {
          row.a = `a1`
        })
        const firstSettled = first.isPersisted.promise.catch(() => {})
        const second = fixture.collection.update(1, (row) => {
          row.b = `b2`
        })
        check({ ...initial, a: `a1`, b: `b2` })
        if (completion === `before`) {
          done[1]!.resolve()
          await second.isPersisted.promise
          check({ ...initial, a: `a1`, b: `b2` })
        }
        done[0]!.reject(new Error(`first update failed`))
        await firstSettled
        check({ ...initial, b: `b2` })
        if (completion === `after`) {
          done[1]!.resolve()
          await second.isPersisted.promise
          check({ ...initial, b: `b2` })
        }
        fixture.sync.begin()
        fixture.sync.write({ type: `update`, value: { ...initial, b: `b2` } })
        await fixture.sync.commit()
        check({ ...initial, b: `b2` })
      } finally {
        for (const pending of done) pending.resolve()
        subscription.unsubscribe()
        await downstream.cleanup()
        await fixture.collection.cleanup()
      }
    },
  )

  it.each(cases)(
    `$order / $phase / rollback $removed / $fields`,
    async ({ order, phase, removed, fields }) => {
      const fixture = source()
      const pending = [
        pendingTransaction(),
        pendingTransaction(),
        pendingTransaction(),
      ]
      const patches: Array<Partial<Row>> =
        fields === `disjoint`
          ? [{ a: `a1` }, { b: `b2` }, { c: `c3` }]
          : [{ a: `a1` }, { a: `a2`, b: `b2` }, { c: `c3` }]
      const expected = (excluded = -1) =>
        Object.assign(
          {},
          initial,
          ...patches.filter((_, index) => index !== excluded),
        )
      try {
        await fixture.collection.preload()
        for (const index of order) {
          pending[index]!.tx.mutate(() =>
            fixture.collection.update(1, (row) => {
              Object.assign(row, patches[index])
            }),
          )
        }
        if (phase === `persisting`) {
          for (const entry of pending) void entry.tx.commit().catch(() => {})
        }
        expect(stripVirtualProps(fixture.collection.get(1))).toEqual(expected())
        // Isolate one rollback's projection; conflict-cascade policy is unchanged.
        pending[removed]!.tx.rollback({ isSecondaryRollback: true })
        expect(stripVirtualProps(fixture.collection.get(1))).toEqual(
          expected(removed),
        )
      } finally {
        for (const entry of pending) {
          entry.tx.rollback({ isSecondaryRollback: true })
          entry.done.resolve()
        }
        await Promise.all(pending.map((entry) => entry.settled))
        await fixture.collection.cleanup()
      }
    },
  )

  it.each([`pending`, `persisting`] as const)(
    `preserves untouched synced fields during $phase work`,
    async (phase) => {
      const fixture = source()
      const entry = pendingTransaction()
      try {
        await fixture.collection.preload()
        entry.tx.mutate(() =>
          fixture.collection.update(1, (row) => {
            row.a = `local`
          }),
        )
        if (phase === `persisting`) void entry.tx.commit().catch(() => {})
        // Exercise the existing explicit immediate path, not a new queue policy.
        fixture.sync.begin({ immediate: phase === `persisting` })
        fixture.sync.write({
          type: `update`,
          value: { ...initial, b: `remote` },
        })
        expect(fixture.sync.commit()).toBe(true)
        expect(stripVirtualProps(fixture.collection.get(1))).toEqual({
          ...initial,
          a: `local`,
          b: `remote`,
        })
      } finally {
        entry.tx.rollback()
        entry.done.resolve()
        await entry.settled
        await fixture.collection.cleanup()
      }
    },
  )

  it(`keeps a settled direct update beneath an older pending update`, async () => {
    const fixture = source()
    const entry = pendingTransaction()
    try {
      await fixture.collection.preload()
      entry.tx.mutate(() =>
        fixture.collection.update(1, (row) => {
          row.a = `local`
        }),
      )
      void entry.tx.commit().catch(() => {})
      const settled = fixture.collection.update(1, (row) => {
        row.b = `settled`
      })
      await settled.isPersisted.promise
      fixture.sync.begin()
      fixture.sync.write({ type: `insert`, value: { ...initial, id: 2 } })
      expect(fixture.sync.commit()).not.toBe(true)
      expect(stripVirtualProps(fixture.collection.get(1))).toEqual({
        ...initial,
        a: `local`,
        b: `settled`,
      })
    } finally {
      entry.tx.rollback()
      entry.done.resolve()
      await entry.settled
      await fixture.collection.cleanup()
    }
  })

  it(`preserves insert defaults and suppresses unchanged overlay publications`, async () => {
    const collection = createCollection({
      schema: z.object({
        id: z.number(),
        title: z.string(),
        priority: z.number().default(3),
      }),
      getKey: (row) => row.id,
      sync: {
        sync: ({ begin, commit, markReady }) => {
          begin()
          commit()
          markReady()
        },
      },
    })
    const entries = [
      pendingTransaction(),
      pendingTransaction(),
      pendingTransaction(),
    ]
    try {
      await collection.preload()
      entries[0]!.tx.mutate(() => collection.insert({ id: 1, title: `first` }))
      entries[1]!.tx.mutate(() =>
        collection.update(1, (row) => {
          row.title = `second`
        }),
      )
      expect(stripVirtualProps(collection.get(1))).toEqual({
        id: 1,
        title: `second`,
        priority: 3,
      })
      const before = collection.get(1)
      const seen: Array<unknown> = []
      const subscription = collection.subscribeChanges((changes) => {
        seen.push(...changes.filter((change) => change.key === 1))
      })
      try {
        entries[2]!.tx.mutate(() =>
          collection.insert({ id: 2, title: `unrelated` }),
        )
        expect(collection.get(1)).toBe(before)
        expect(seen).toEqual([])
      } finally {
        subscription.unsubscribe()
      }
    } finally {
      for (const entry of entries) {
        entry.tx.rollback({ isSecondaryRollback: true })
        entry.done.resolve()
      }
      await Promise.all(entries.map((entry) => entry.settled))
      await collection.cleanup()
    }
  })
})
