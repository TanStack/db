import { D2, MultiSet } from '@tanstack/db-ivm'
import { describe, expect, it, vi } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import { createLiveQueryCollection } from '../../src/query/live-query-collection.js'
import { eq } from '../../src/query/builder/functions.js'
import { BucketFacadeAdapter } from '../../src/query/live/bucket-facade-adapter.js'
import { CollectionConfigBuilder } from '../../src/query/live/collection-config-builder.js'
import { BUCKET_FACADE_REF } from '../../src/query/live/materialized-pipeline.js'
import { mockSyncCollectionOptions, stripVirtualProps } from '../utils.js'
import type { Collection } from '../../src/collection/index.js'
import type { SyncConfig } from '../../src/types.js'
import type {
  BucketFacadeRef,
  BucketRow,
} from '../../src/query/live/materialized-pipeline.js'
import type { Context } from '../../src/query/builder/types.js'

type FacadeSync = Parameters<SyncConfig<Record<string, unknown>>[`sync`]>[0]

describe(`BucketFacadeAdapter`, () => {
  it(`restores facade state when a flush fails after writing`, async () => {
    const graph = new D2()
    const rows = graph.newInput<[string, BucketRow]>()
    const activeBuckets = graph.newInput<[string, true]>()
    const adapter = new BucketFacadeAdapter(
      `facade-rollback-parent`,
      [{ edgeId: `children`, rows, activeBuckets, hasOrderBy: false }],
      () => {},
    )
    graph.finalize()

    const bucketKey = `group-1`
    const original = { id: 1, value: `original` }
    activeBuckets.sendData(new MultiSet([[[bucketKey, true], 1]]))
    rows.sendData(
      new MultiSet([
        [
          [
            bucketKey,
            { publicKey: original.id, value: original, order: undefined },
          ],
          1,
        ],
      ]),
    )
    graph.run()
    adapter.flush().publish()

    const facadeRef: BucketFacadeRef = {
      [BUCKET_FACADE_REF]: { edgeId: `children`, bucketKey },
    }
    const facade = adapter.resolve(facadeRef) as unknown as Collection<
      typeof original,
      number
    >
    expect(facade.toArray.map(stripVirtualProps)).toEqual([original])
    const publications: Array<unknown> = []
    const subscription = facade.subscribeChanges((changes) => {
      publications.push(changes)
    })

    const entries = (
      adapter as unknown as {
        entries: Map<string, Map<string, { sync: FacadeSync | undefined }>>
      }
    ).entries
    const sync = entries.get(`children`)?.get(bucketKey)?.sync
    if (!sync) throw new Error(`Missing facade sync`)
    const commit = sync.commit
    let shouldThrow = true
    sync.commit = () => {
      const applied = commit()
      if (shouldThrow) {
        shouldThrow = false
        throw new Error(`facade flush failed`)
      }
      return applied
    }

    const replacement = { id: 1, value: `replacement` }
    rows.sendData(
      new MultiSet([
        [
          [
            bucketKey,
            { publicKey: original.id, value: original, order: undefined },
          ],
          -1,
        ],
        [
          [
            bucketKey,
            {
              publicKey: replacement.id,
              value: replacement,
              order: undefined,
            },
          ],
          1,
        ],
      ]),
    )
    graph.run()

    expect(() => adapter.flush()).toThrow(`facade flush failed`)
    expect(facade.toArray.map(stripVirtualProps)).toEqual([original])
    expect(publications).toEqual([])

    subscription.unsubscribe()
    await adapter.cleanup()
  })

  it(`drops pending parent changes when facade flushing fails`, async () => {
    type Parent = { id: number; groupId: number }
    type Child = { id: number; groupId: number }
    const parents = createCollection(
      mockSyncCollectionOptions<Parent>({
        id: `facade-failure-parents`,
        getKey: (row) => row.id,
        initialData: [{ id: 1, groupId: 1 }],
      }),
    )
    const children = createCollection(
      mockSyncCollectionOptions<Child>({
        id: `facade-failure-children`,
        getKey: (row) => row.id,
        initialData: [{ id: 10, groupId: 1 }],
        autoIndex: `eager`,
      }),
    )
    const originalGetConfig = CollectionConfigBuilder.prototype.getConfig
    let builder:
      | CollectionConfigBuilder<Context, Record<string, unknown>>
      | undefined
    CollectionConfigBuilder.prototype.getConfig = function () {
      builder = this as unknown as CollectionConfigBuilder<
        Context,
        Record<string, unknown>
      >
      return originalGetConfig.call(this)
    }
    const live = createLiveQueryCollection((q) =>
      q.from({ parent: parents }).select(({ parent }) => ({
        id: parent.id,
        children: q
          .from({ child: children })
          .where(({ child }) => eq(child.groupId, parent.groupId)),
      })),
    )

    try {
      await live.preload()
      const flush = vi
        .spyOn(BucketFacadeAdapter.prototype, `flush`)
        .mockImplementationOnce(() => {
          throw new Error(`facade flush failed`)
        })

      parents.utils.begin()
      parents.utils.write({
        type: `insert`,
        value: { id: 2, groupId: 2 },
      })
      expect(() => parents.utils.commit()).toThrow(`facade flush failed`)
      flush.mockRestore()

      const syncState = builder?.currentSyncState
      if (!syncState?.flushPendingChanges) {
        throw new Error(`Missing live query sync state`)
      }
      syncState.flushPendingChanges()
      expect(live.has(2)).toBe(false)
    } finally {
      CollectionConfigBuilder.prototype.getConfig = originalGetConfig
      vi.restoreAllMocks()
      await live.cleanup()
      await Promise.all([parents.cleanup(), children.cleanup()])
    }
  })
})
