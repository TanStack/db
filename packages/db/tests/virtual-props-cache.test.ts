import { describe, expect, it, vi } from 'vitest'
import { createCollection } from '../src/collection/index.js'
import { localOnlyCollectionOptions } from '../src/local-only.js'
import { mockSyncCollectionOptions, withExpectedRejection } from './utils.js'

/**
 * A row read with virtual props is a copy, cached so repeated reads and
 * publications share one object. These laws pin what that cache must keep:
 * the value a change publishes is the row later reads return, for every
 * subscriber, and a key that leaves the collection leaves the cache. A sync
 * source that reuses a row object and changes it in place still reads its new
 * value: the update it publishes enriches the row again.
 */
type Row = { id: string; a: number }
const cacheSize = (collection: unknown) =>
  (collection as { _state: { virtualPropsCache: Map<unknown, unknown> } })
    ._state.virtualPropsCache.size

describe(`virtual props cache`, () => {
  it(`publishes the row that later reads return, to every subscriber`, async () => {
    const collection = createCollection(
      mockSyncCollectionOptions<Row>({
        id: `virtual-props-cache-sync`,
        getKey: (row) => row.id,
        initialData: [{ id: `x`, a: 0 }],
      }),
    )
    await collection.stateWhenReady()
    const first: Array<unknown> = []
    const second: Array<unknown> = []
    collection.subscribeChanges((changes) =>
      first.push(...changes.map((c) => c.value)),
    )
    collection.subscribeChanges((changes) =>
      second.push(...changes.map((c) => c.value)),
    )
    for (const a of [1, 2]) {
      collection.utils.begin()
      collection.utils.write({ type: `update`, value: { id: `x`, a } })
      collection.utils.commit()
      expect(first.at(-1)).toBe(collection.get(`x`))
      expect(second.at(-1)).toBe(first.at(-1))
      expect(collection.toArray[0]).toBe(first.at(-1))
    }
  })

  it(`publishes the row that later reads return after local writes`, () => {
    const collection = createCollection(
      localOnlyCollectionOptions<Row>({
        id: `virtual-props-cache-local`,
        getKey: (row) => row.id,
        initialData: [{ id: `x`, a: 0 }],
      }),
    )
    const published: Array<unknown> = []
    collection.subscribeChanges((changes) =>
      published.push(...changes.map((c) => c.value)),
    )
    for (const a of [1, 2]) {
      collection.update(`x`, (draft) => {
        draft.a = a
      })
      expect(published.at(-1)).toBe(collection.get(`x`))
    }
  })

  it(`drops a key's entry when the key is deleted or rolled back`, async () => {
    const collection = createCollection(
      mockSyncCollectionOptions<Row>({
        id: `virtual-props-cache-delete`,
        getKey: (row) => row.id,
        initialData: [{ id: `x`, a: 0 }],
      }),
    )
    await collection.stateWhenReady()
    collection.subscribeChanges(() => {})
    collection.get(`x`)
    collection.utils.begin()
    collection.utils.write({ type: `delete`, value: { id: `x`, a: 0 } })
    collection.utils.commit()
    expect(cacheSize(collection)).toBe(0)

    await withExpectedRejection(`rolled back`, async () => {
      const transaction = collection.insert({ id: `y`, a: 1 })
      collection.get(`y`)
      collection.utils.rejectSync(new Error(`rolled back`))
      await transaction.isPersisted.promise.catch(() => undefined)
    })
    expect(collection.has(`y`)).toBe(false)
    expect(cacheSize(collection)).toBe(0)
  })

  it.each([
    { subscribed: false, batched: false },
    { subscribed: true, batched: false },
    { subscribed: true, batched: true },
  ])(
    `reads the new value of a reused row object after its update: %o`,
    async ({ subscribed, batched }) => {
      type Live = { id: number; a: number }
      let sync!: Parameters<
        NonNullable<
          Parameters<typeof createCollection<Live, number>>[0]
        >[`sync`][`sync`]
      >[0]
      let release!: () => void
      const collection = createCollection<Live, number>({
        id: `virtual-props-cache-reused-${subscribed}-${batched}`,
        getKey: (row) => row.id,
        startSync: true,
        sync: {
          rowUpdateMode: `full`,
          sync: (ops) => {
            sync = ops
            ops.markReady()
          },
        },
        onUpdate: () => new Promise<void>((resolve) => (release = resolve)),
      })
      await collection.stateWhenReady()
      const row: Live = { id: 1, a: 1 }
      sync.begin()
      sync.write({ type: `insert`, value: row })
      sync.write({ type: `insert`, value: { id: 2, a: 0 } })
      sync.commit()
      const published: Array<number> = []
      const subscription = subscribed
        ? collection.subscribeChanges((changes) =>
            published.push(
              ...changes.filter((c) => c.key === 1).map((c) => c.value.a),
            ),
          )
        : undefined
      expect(collection.get(1)?.a).toBe(1)
      const blocker = batched
        ? collection.update(2, (draft) => {
            draft.a = 9
          })
        : undefined
      row.a = 2
      sync.begin()
      sync.write({ type: `update`, value: row, previousValue: { id: 1, a: 1 } })
      const receipt = sync.commit()
      if (blocker) {
        release()
        await blocker.isPersisted.promise
      }
      await receipt
      expect(collection.get(1)?.a).toBe(2)
      expect([...collection.values()].find((r) => r.id === 1)?.a).toBe(2)
      if (subscribed) expect(published.at(-1)).toBe(2)
      subscription?.unsubscribe()
    },
  )

  // Production skips the reused-row check, so a source may write a changed
  // row object again without previousValue. The commit then sees no change
  // and publishes nothing, so only the commit can drop the stale cached copy.
  // A deferred publication also enriches late, so reads before it publish
  // must not see the old copy either.
  it.each([`production write without previousValue`, `deferred publication`])(
    `reads the new value of a reused row object: %s`,
    async (shape) => {
      type Live = { id: number; a: number }
      let sync!: Parameters<
        NonNullable<
          Parameters<typeof createCollection<Live, number>>[0]
        >[`sync`][`sync`]
      >[0]
      const collection = createCollection<Live, number>({
        id: `virtual-props-cache-reused-${shape}`,
        getKey: (row) => row.id,
        startSync: true,
        sync: {
          rowUpdateMode: `full`,
          sync: (ops) => {
            sync = ops
            ops.markReady()
          },
        },
      })
      await collection.stateWhenReady()
      const row: Live = { id: 1, a: 1 }
      sync.begin()
      sync.write({ type: `insert`, value: row })
      sync.commit()
      expect(collection.get(1)?.a).toBe(1)
      row.a = 2
      if (shape === `production write without previousValue`) {
        vi.stubEnv(`NODE_ENV`, `production`)
        try {
          sync.begin()
          sync.write({ type: `update`, value: row })
          sync.commit()
        } finally {
          vi.unstubAllEnvs()
        }
        expect(collection.get(1)?.a).toBe(2)
      } else {
        const publication = collection._deferPublication()
        try {
          sync.begin()
          sync.write({
            type: `update`,
            value: row,
            previousValue: { id: 1, a: 1 },
          })
          sync.commit()
          expect(collection.get(1)?.a).toBe(2)
        } finally {
          publication.publish()
        }
        expect(collection.get(1)?.a).toBe(2)
      }
    },
  )
})
