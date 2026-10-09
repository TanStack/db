/**
 * # A Svelte query releases independent descriptor sources
 *
 * A failed source start must not prevent a later source of the same query from
 * starting. A query that fails while resolving descriptors may leave a source
 * deferred, but a later direct reader owns fresh demand and can preload it.
 *
 * The model has two independent source start counts. Both are zero while the
 * hook is built. In the first history, the first start throws after the Svelte
 * effect asks for rows; the second count must still become one and the failed
 * effect must release its subscription. In the second
 * history, the second factory throws during preparation. The first count stays
 * zero until a direct reader preloads that source, then becomes one. The
 * checkpoints are the public hook error and the source Collection's start
 * count and ready status. The grammar covers two eager union sources with
 * synchronous starts; it does not model asynchronous source failures or
 * reactive replacement of the query.
 */
import { describe, expect, it } from 'vitest'
import { DbClient, Query, collectionOptions } from '@tanstack/db'
import { flushSync } from 'svelte'
import { useLiveQuery } from '../src/useLiveQuery.svelte.js'

type Row = { id: string }

describe(`Svelte descriptor source release`, () => {
  it(`releases the second union source after the first start throws`, async () => {
    const failure = new Error(`first source failed`)
    let firstStarts = 0
    let secondStarts = 0
    const first = collectionOptions(`svelte-release-first`, () => ({
      id: `svelte-release-first`,
      getKey: (row: Row) => row.id,
      startSync: true,
      sync: {
        sync: () => {
          firstStarts++
          throw failure
        },
      },
    }))
    const second = collectionOptions(`svelte-release-second`, () => ({
      id: `svelte-release-second`,
      getKey: (row: Row) => row.id,
      startSync: true,
      sync: {
        sync: ({ markReady }) => {
          secondStarts++
          markReady()
        },
      },
    }))
    const query = new Query().unionAll(
      new Query().from({ first }).select(({ first: row }) => ({ id: row.id })),
      new Query()
        .from({ second })
        .select(({ second: row }) => ({ id: row.id })),
    )
    const client = new DbClient()
    let dispose: (() => void) | undefined
    let querySubscriberCount: (() => number) | undefined
    let cleanupQuery: (() => Promise<void>) | undefined

    try {
      dispose = $effect.root(() => {
        const result = useLiveQuery({ client, query })
        querySubscriberCount = () => result.collection.subscriberCount
        cleanupQuery = () => result.collection.cleanup()
      })
      expect(firstStarts).toBe(0)
      expect(secondStarts).toBe(0)
      expect(() => flushSync()).toThrow(failure)
      expect(firstStarts).toBe(1)
      expect(secondStarts).toBe(1)
      expect(querySubscriberCount?.()).toBe(0)
      const healthy = client.collection(second)
      await healthy.preload()
      expect(healthy.status).toBe(`ready`)
    } finally {
      dispose?.()
      await cleanupQuery?.()
      await client.cleanup()
    }
  })

  it(`lets a direct reader start a source after preparation fails`, async () => {
    const failure = new Error(`second factory failed`)
    let firstStarts = 0
    const first = collectionOptions(`svelte-prepare-first`, () => ({
      id: `svelte-prepare-first`,
      getKey: (row: Row) => row.id,
      startSync: true,
      sync: {
        sync: ({ markReady }) => {
          firstStarts++
          markReady()
        },
      },
    }))
    const second = collectionOptions(
      `svelte-prepare-second`,
      (): {
        id: string
        getKey: (row: Row) => string
        sync: { sync: () => void }
      } => {
        throw failure
      },
    )
    const query = new Query().unionAll(
      new Query().from({ first }).select(({ first: row }) => ({ id: row.id })),
      new Query()
        .from({ second })
        .select(({ second: row }) => ({ id: row.id })),
    )
    const client = new DbClient()

    try {
      expect(() =>
        $effect.root(() => {
          useLiveQuery({ client, query })
        }),
      ).toThrow(failure)
      expect(firstStarts).toBe(0)
      const direct = client.collection(first)
      const read = direct.preload()
      expect(firstStarts).toBe(1)
      await read
      expect(direct.status).toBe(`ready`)
    } finally {
      await client.cleanup()
    }
  })
})
