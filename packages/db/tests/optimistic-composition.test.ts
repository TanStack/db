import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createCollection } from '../src/collection/index.js'
import { createDeferred } from '../src/deferred.js'
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

function source() {
  let sync!: Parameters<SyncConfig<Row>[`sync`]>[0]
  const collection = createCollection<Row>({
    getKey: (row) => row.id,
    onUpdate: () => Promise.resolve(),
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
