import { D2, MultiSet } from '@tanstack/db-ivm'
import { describe, expect, it, vi } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import { createLiveQueryCollection } from '../../src/query/live-query-collection.js'
import { eq } from '../../src/query/builder/functions.js'
import { BasicIndex } from '../../src/indexes/basic-index.js'
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

class ThrowingBuildIndex extends BasicIndex<number> {
  throwBeforeBuild = false
  throwOnBuild = false

  override build(entries: Iterable<[number, unknown]>): void {
    if (this.throwBeforeBuild) {
      throw new Error(`facade index rebuild failed`)
    }
    super.build(entries)
    if (this.throwOnBuild) {
      throw new Error(`facade index rebuild failed`)
    }
  }
}

describe(`BucketFacadeAdapter`, () => {
  it(`moves a row when the graph reuses its object for a new order`, async () => {
    const graph = new D2()
    const rows = graph.newInput<[string, BucketRow]>()
    const activeBuckets = graph.newInput<[string, true]>()
    const adapter = new BucketFacadeAdapter(
      `facade-order-parent`,
      [{ edgeId: `children`, rows, activeBuckets, hasOrderBy: true }],
      () => {},
    )
    graph.finalize()

    const bucketKey = `group-1`
    const moving = { id: 1, value: `moving` }
    const fixed = { id: 2, value: `fixed` }
    activeBuckets.sendData(new MultiSet([[[bucketKey, true], 1]]))
    rows.sendData(
      new MultiSet([
        [[bucketKey, { publicKey: moving.id, value: moving, order: `0` }], 1],
        [[bucketKey, { publicKey: fixed.id, value: fixed, order: `1` }], 1],
      ]),
    )
    graph.run()
    adapter.flush().publish()

    const facadeRef: BucketFacadeRef = {
      [BUCKET_FACADE_REF]: { edgeId: `children`, bucketKey },
    }
    const facade = adapter.resolve(facadeRef) as unknown as Collection<
      typeof moving,
      number
    >
    expect(facade.toArray.map(({ id }) => id)).toEqual([1, 2])

    rows.sendData(
      new MultiSet([
        [[bucketKey, { publicKey: moving.id, value: moving, order: `0` }], -1],
        [[bucketKey, { publicKey: moving.id, value: moving, order: `2` }], 1],
      ]),
    )
    graph.run()
    adapter.flush().publish()

    expect(facade.toArray.map(({ id }) => id)).toEqual([2, 1])
    await adapter.cleanup()
  })

  it(`restores facade state without public effects when a flush fails`, async () => {
    const graph = new D2()
    const rows = graph.newInput<[string, BucketRow]>()
    const activeBuckets = graph.newInput<[string, true]>()
    const adapter = new BucketFacadeAdapter(
      `facade-rollback-parent`,
      [{ edgeId: `children`, rows, activeBuckets, hasOrderBy: true }],
      () => {},
    )
    graph.finalize()

    const bucketKey = `group-1`
    const original = { id: 1, value: `original` }
    const fixed = { id: 3, value: `fixed` }
    activeBuckets.sendData(new MultiSet([[[bucketKey, true], 1]]))
    rows.sendData(
      new MultiSet([
        [
          [bucketKey, { publicKey: original.id, value: original, order: `0` }],
          1,
        ],
        [[bucketKey, { publicKey: fixed.id, value: fixed, order: `1` }], 1],
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
    expect(facade.toArray.map(stripVirtualProps)).toEqual([original, fixed])
    const publications: Array<unknown> = []
    const subscription = facade.subscribeChanges((changes) => {
      publications.push(changes)
    })
    let layoutPublications = 0
    const unsubscribeLayout = facade._subscribeLayoutChanges(() => {
      layoutPublications++
    })
    let statusChanges = 0
    const unsubscribeStatus = facade.on(`status:change`, () => {
      statusChanges++
    })
    let truncates = 0
    const unsubscribeTruncate = facade.on(`truncate`, () => {
      truncates++
    })
    const stateRevision = facade._stateRevision
    const layoutRevision = facade._layoutRevision

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
    const added = { id: 2, value: `added` }
    rows.sendData(
      new MultiSet([
        [
          [bucketKey, { publicKey: original.id, value: original, order: `0` }],
          -1,
        ],
        [
          [
            bucketKey,
            {
              publicKey: replacement.id,
              value: replacement,
              order: `2`,
            },
          ],
          1,
        ],
        [[bucketKey, { publicKey: added.id, value: added, order: `3` }], 1],
      ]),
    )
    graph.run()

    expect(() => adapter.flush()).toThrow(`facade flush failed`)
    expect(facade.toArray.map(stripVirtualProps)).toEqual([original, fixed])
    expect([
      ...(
        entries.get(`children`)?.get(bucketKey) as unknown as {
          currentOrder: Map<number, string | undefined>
        }
      ).currentOrder,
    ]).toEqual([
      [original.id, `0`],
      [fixed.id, `1`],
    ])
    expect(publications).toEqual([])
    expect(layoutPublications).toBe(0)
    expect(statusChanges).toBe(0)
    expect(truncates).toBe(0)
    expect(facade._stateRevision).toBe(stateRevision)
    expect(facade._layoutRevision).toBe(layoutRevision)
    expect(facade.status).toBe(`ready`)

    const restoredOriginal = facade.get(original.id)
    const restoredFixed = facade.get(fixed.id)
    if (!restoredOriginal || !restoredFixed) {
      throw new Error(`Missing restored facade rows`)
    }
    expect(facade.getKeyFromItem(restoredOriginal)).toBe(original.id)
    expect(facade.getKeyFromItem(restoredFixed)).toBe(fixed.id)

    adapter.flush().publish()

    expect(facade.toArray.map(stripVirtualProps)).toEqual([
      fixed,
      replacement,
      added,
    ])
    expect(layoutPublications).toBe(0)
    expect(publications).toHaveLength(1)
    expect(publications[0]).toHaveLength(2)
    expect(statusChanges).toBe(0)
    expect(truncates).toBe(0)
    expect(facade._stateRevision).toBe(stateRevision + 1)
    expect(facade._layoutRevision).toBe(layoutRevision + 1)
    expect(facade.toArray.map((row) => facade.getKeyFromItem(row))).toEqual([
      fixed.id,
      replacement.id,
      added.id,
    ])
    expect([
      ...(
        entries.get(`children`)?.get(bucketKey) as unknown as {
          currentOrder: Map<number, string | undefined>
        }
      ).currentOrder,
    ]).toEqual([
      [original.id, `2`],
      [fixed.id, `1`],
      [added.id, `3`],
    ])

    rows.sendData(
      new MultiSet([
        [
          [
            bucketKey,
            {
              publicKey: replacement.id,
              value: replacement,
              order: `2`,
            },
          ],
          -1,
        ],
        [
          [
            bucketKey,
            {
              publicKey: replacement.id,
              value: replacement,
              order: `0`,
            },
          ],
          1,
        ],
      ]),
    )
    graph.run()
    adapter.flush().publish()

    expect(facade.toArray.map(stripVirtualProps)).toEqual([
      replacement,
      fixed,
      added,
    ])
    expect(layoutPublications).toBe(1)
    expect(publications).toHaveLength(2)
    expect(publications[1]).toEqual([])
    expect(facade._stateRevision).toBe(stateRevision + 1)
    expect(facade._layoutRevision).toBe(layoutRevision + 2)

    unsubscribeTruncate()
    unsubscribeStatus()
    unsubscribeLayout()
    subscription.unsubscribe()
    await adapter.cleanup()
  })

  it(`publishes fresh facade readiness only after every install succeeds`, async () => {
    const graph = new D2()
    const firstRows = graph.newInput<[string, BucketRow]>()
    const firstActiveBuckets = graph.newInput<[string, true]>()
    const secondRows = graph.newInput<[string, BucketRow]>()
    const secondActiveBuckets = graph.newInput<[string, true]>()
    const adapter = new BucketFacadeAdapter(
      `facade-ready-parent`,
      [
        {
          edgeId: `first`,
          rows: firstRows,
          activeBuckets: firstActiveBuckets,
          hasOrderBy: false,
        },
        {
          edgeId: `second`,
          rows: secondRows,
          activeBuckets: secondActiveBuckets,
          hasOrderBy: false,
        },
      ],
      () => {},
    )
    graph.finalize()

    const bucketKey = `group-1`
    const firstFacade = adapter.resolve({
      [BUCKET_FACADE_REF]: { edgeId: `first`, bucketKey },
    } satisfies BucketFacadeRef) as unknown as Collection<
      { id: number; value: string },
      number
    >
    const secondFacade = adapter.resolve({
      [BUCKET_FACADE_REF]: { edgeId: `second`, bucketKey },
    } satisfies BucketFacadeRef) as unknown as Collection<
      { id: number; value: string },
      number
    >
    const firstStatuses: Array<string> = []
    const secondStatuses: Array<string> = []
    const unsubscribeFirst = firstFacade.on(`status:change`, ({ status }) => {
      firstStatuses.push(status)
    })
    const unsubscribeSecond = secondFacade.on(`status:change`, ({ status }) => {
      secondStatuses.push(status)
    })

    const first = { id: 1, value: `first` }
    const second = { id: 2, value: `second` }
    firstActiveBuckets.sendData(new MultiSet([[[bucketKey, true], 1]]))
    secondActiveBuckets.sendData(new MultiSet([[[bucketKey, true], 1]]))
    firstRows.sendData(
      new MultiSet([
        [
          [bucketKey, { publicKey: first.id, value: first, order: undefined }],
          1,
        ],
      ]),
    )
    secondRows.sendData(
      new MultiSet([
        [
          [
            bucketKey,
            { publicKey: second.id, value: second, order: undefined },
          ],
          1,
        ],
      ]),
    )
    graph.run()

    const entries = (
      adapter as unknown as {
        entries: Map<string, Map<string, { sync: FacadeSync | undefined }>>
      }
    ).entries
    const secondSync = entries.get(`second`)?.get(bucketKey)?.sync
    if (!secondSync) throw new Error(`Missing second facade sync`)
    const commit = secondSync.commit
    let shouldThrow = true
    secondSync.commit = () => {
      const applied = commit()
      if (shouldThrow) {
        shouldThrow = false
        throw new Error(`second facade failed`)
      }
      return applied
    }

    expect(() => adapter.flush()).toThrow(`second facade failed`)
    expect(firstFacade.status).toBe(`loading`)
    expect(secondFacade.status).toBe(`loading`)
    expect(firstStatuses).toEqual([])
    expect(secondStatuses).toEqual([])
    expect(firstFacade.toArray).toEqual([])
    expect(secondFacade.toArray).toEqual([])

    const retry = adapter.flush()
    expect(firstFacade.status).toBe(`loading`)
    expect(secondFacade.status).toBe(`loading`)
    retry.prepare()
    expect(firstFacade.status).toBe(`ready`)
    expect(secondFacade.status).toBe(`ready`)
    retry.publish()
    expect(firstFacade.toArray.map(stripVirtualProps)).toEqual([first])
    expect(secondFacade.toArray.map(stripVirtualProps)).toEqual([second])
    expect(firstStatuses).toEqual([`ready`])
    expect(secondStatuses).toEqual([`ready`])

    unsubscribeFirst()
    unsubscribeSecond()
    await adapter.cleanup()
  })

  it(`closes publication state when facade index restore fails`, async () => {
    const graph = new D2()
    const rows = graph.newInput<[string, BucketRow]>()
    const activeBuckets = graph.newInput<[string, true]>()
    const adapter = new BucketFacadeAdapter(
      `facade-index-rollback-parent`,
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

    const facade = adapter.resolve({
      [BUCKET_FACADE_REF]: { edgeId: `children`, bucketKey },
    } satisfies BucketFacadeRef) as unknown as Collection<
      typeof original,
      number
    >
    const index = facade.createIndex((row) => row.value, {
      indexType: ThrowingBuildIndex,
    }) as ThrowingBuildIndex
    const publications: Array<unknown> = []
    const subscription = facade.subscribeChanges(
      (changes) => {
        publications.push(changes)
      },
      { includeInitialState: false },
    )
    const revision = facade._stateRevision

    const entry = (
      adapter as unknown as {
        entries: Map<string, Map<string, { sync: FacadeSync | undefined }>>
      }
    ).entries
      .get(`children`)
      ?.get(bucketKey)
    const sync = entry?.sync
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
    index.throwBeforeBuild = true
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
    expect(facade.status).toBe(`error`)
    expect(facade._state.syncedData.get(original.id)).toMatchObject(original)
    expect(publications).toEqual([])
    expect(facade._stateRevision).toBe(revision)

    const final = { id: 1, value: `final` }
    rows.sendData(
      new MultiSet([
        [
          [
            bucketKey,
            {
              publicKey: replacement.id,
              value: replacement,
              order: undefined,
            },
          ],
          -1,
        ],
        [
          [bucketKey, { publicKey: final.id, value: final, order: undefined }],
          1,
        ],
      ]),
    )
    graph.run()
    expect(() => adapter.flush()).toThrow(`facade index rebuild failed`)
    expect(facade.status).toBe(`error`)
    expect(facade._state.syncedData.get(original.id)).toMatchObject(original)
    expect(publications).toEqual([])

    index.throwBeforeBuild = false
    adapter.flush().publish()
    expect(facade.status).toBe(`ready`)
    expect(facade.toArray.map(stripVirtualProps)).toEqual([final])
    expect(publications).toHaveLength(2)
    expect(publications[0]).toEqual([])
    expect(publications[1]).toHaveLength(1)
    expect(facade._stateRevision).toBe(revision + 1)
    expect(index.lookup(`eq`, `original`)).toEqual(new Set())
    expect(index.lookup(`eq`, `replacement`)).toEqual(new Set())
    expect(index.lookup(`eq`, `final`)).toEqual(new Set([original.id]))

    subscription.unsubscribe()
    await adapter.cleanup()
  })

  it(`retries pending parent changes when facade flushing fails`, async () => {
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
      expect(live.has(2)).toBe(true)
    } finally {
      CollectionConfigBuilder.prototype.getConfig = originalGetConfig
      vi.restoreAllMocks()
      await live.cleanup()
      await Promise.all([parents.cleanup(), children.cleanup()])
    }
  })
})
