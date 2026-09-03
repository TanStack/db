import { describe, expect, it } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import { createDeferred } from '../../src/deferred.js'
import { createLiveQueryCollection, eq } from '../../src/query/index.js'
import { flushPromises } from '../utils.js'
import type {
  ChangeMessageOrDeleteKeyMessage,
  LoadSubsetOptions,
} from '../../src/types.js'

type Row = { id: string; version: number }
type ObservedRow = { sourceId: string; rowKey: string; version: number }

describe(`loadSubset replay refinement`, () => {
  function createHarness(sourceId: string) {
    let begin!: () => void
    let write!: (message: ChangeMessageOrDeleteKeyMessage<Row, string>) => void
    let commit!: () => void
    let truncate!: () => void
    let loadCount = 0
    const pending: Array<{
      options: LoadSubsetOptions
      deferred: ReturnType<typeof createDeferred<void>>
    }> = []
    const batches: Array<
      Array<{
        type: `insert` | `update` | `delete`
        row: { sourceId: string; rowKey: string; version: number }
        previousVersion?: number
      }>
    > = []
    const source = createCollection<Row>({
      id: sourceId,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      sync: {
        sync: (params) => {
          begin = params.begin
          write = params.write
          commit = params.commit
          truncate = params.truncate
          params.markReady()
          return {
            loadSubset: (options) => {
              loadCount++
              if (loadCount === 1) {
                begin()
                write({ type: `insert`, value: { id: `row`, version: 1 } })
                commit()
                return true
              }
              const deferred = createDeferred<void>()
              pending.push({ options, deferred })
              return deferred.promise
            },
            unloadSubset: () => {},
          }
        },
      },
    })
    const downstream = createLiveQueryCollection({
      id: `${sourceId}-downstream`,
      query: (q) =>
        q.from({ row: source }).select(({ row }) => ({
          id: row.id,
          version: row.version,
        })),
      startSync: true,
    })
    const callbackReads: Array<Array<ObservedRow>> = []
    const subscription = downstream.subscribeChanges(
      (changes) => {
        const batch = changes.map((change) => ({
          type: change.type,
          row: {
            sourceId,
            rowKey: String(change.key),
            version: change.value.version,
          },
          ...(change.previousValue === undefined
            ? {}
            : { previousVersion: change.previousValue.version }),
        }))
        if (batch.length > 0) {
          batches.push(batch)
          callbackReads.push(
            downstream.toArray.map(({ id, version }) => ({
              sourceId,
              rowKey: id,
              version,
            })),
          )
        }
      },
      { includeInitialState: true },
    )

    const replaceCore = (version: number) => {
      begin()
      write({ type: `insert`, value: { id: `row`, version } })
      commit()
    }
    const updateCore = (previousVersion: number, version: number) => {
      begin()
      write({
        type: `update`,
        value: { id: `row`, version },
        previousValue: { id: `row`, version: previousVersion },
      })
      commit()
    }
    const startReplay = async () => {
      begin()
      truncate()
      commit()
      await flushPromises()
    }
    const coreRows = () =>
      source.toArray.map(({ id, version }) => ({
        sourceId,
        rowKey: id,
        version,
      }))
    const visibleRows = () =>
      downstream.toArray.map(({ id, version }) => ({
        sourceId,
        rowKey: id,
        version,
      }))

    return {
      source,
      downstream,
      subscription,
      pending,
      batches,
      callbackReads,
      replaceCore,
      updateCore,
      startReplay,
      coreRows,
      visibleRows,
    }
  }

  it(`retains the last complete publication when replay fails after writing`, async () => {
    const sourceId = `replay-refinement-failure`
    const row = (version: number) => ({
      sourceId,
      rowKey: `row`,
      version,
    })
    const harness = createHarness(sourceId)

    try {
      await harness.downstream.preload()
      await harness.startReplay()

      harness.replaceCore(2)
      harness.pending[0]?.deferred.reject(new Error(`replay failed`))
      await flushPromises()

      expect(harness.coreRows()).toEqual([row(2)])
      expect(harness.visibleRows()).toEqual([row(1)])
      expect(harness.batches).toEqual([[{ type: `insert`, row: row(1) }]])
      expect(harness.callbackReads).toEqual([[row(1)]])
    } finally {
      harness.subscription.unsubscribe()
      await Promise.all([
        harness.downstream.cleanup(),
        harness.source.cleanup(),
      ])
    }
  })

  it(`keeps a failed replay private until a later authoritative replay`, async () => {
    const sourceId = `replay-refinement-failure-liveness`
    const row = (version: number) => ({ sourceId, rowKey: `row`, version })
    const harness = createHarness(sourceId)

    try {
      await harness.downstream.preload()
      expect(harness.visibleRows().map(({ version }) => version)).toEqual([1])

      await harness.startReplay()
      harness.replaceCore(2)
      harness.pending[0]!.deferred.reject(new Error(`replay failed`))
      await flushPromises()

      expect(harness.visibleRows()).toEqual([row(1)])
      expect(harness.downstream.status).toBe(`ready`)
      expect(harness.batches).toEqual([[{ type: `insert`, row: row(1) }]])

      harness.updateCore(2, 3)
      await flushPromises()

      expect(harness.visibleRows()).toEqual([row(1)])
      expect(harness.batches).toEqual([[{ type: `insert`, row: row(1) }]])
      expect(harness.callbackReads).toEqual([[row(1)]])

      await harness.startReplay()
      harness.replaceCore(4)
      harness.pending[1]!.deferred.resolve()
      await flushPromises()

      expect(harness.visibleRows()).toEqual([row(4)])
      expect(harness.batches).toEqual([
        [{ type: `insert`, row: row(1) }],
        [{ type: `update`, row: row(4), previousVersion: 1 }],
      ])
      expect(harness.callbackReads).toEqual([[row(1)], [row(4)]])
    } finally {
      for (const replay of harness.pending) replay.deferred.resolve()
      harness.subscription.unsubscribe()
      await Promise.all([
        harness.downstream.cleanup(),
        harness.source.cleanup(),
      ])
    }
  })

  it(`waits for every overlapping replay before publishing the newest success`, async () => {
    const sourceId = `replay-refinement-overlap`
    const row = (version: number) => ({
      sourceId,
      rowKey: `row`,
      version,
    })
    const harness = createHarness(sourceId)

    try {
      await harness.downstream.preload()
      await harness.startReplay()
      await harness.startReplay()

      expect(harness.pending[0]?.options.signal?.aborted).toBe(true)
      harness.replaceCore(3)
      harness.pending[1]?.deferred.resolve()
      await flushPromises()

      expect(harness.visibleRows()).toEqual([row(1)])
      expect(harness.batches).toEqual([[{ type: `insert`, row: row(1) }]])
      expect(harness.callbackReads).toEqual([[row(1)]])

      harness.pending[0]?.deferred.reject(
        new DOMException(`obsolete`, `AbortError`),
      )
      await flushPromises()

      expect(harness.coreRows()).toEqual([row(3)])
      expect(harness.visibleRows()).toEqual([row(3)])
      expect(harness.batches).toEqual([
        [{ type: `insert`, row: row(1) }],
        [{ type: `update`, row: row(3), previousVersion: 1 }],
      ])
      expect(harness.callbackReads).toEqual([[row(1)], [row(3)]])
    } finally {
      for (const replay of harness.pending) replay.deferred.resolve()
      harness.subscription.unsubscribe()
      await Promise.all([
        harness.downstream.cleanup(),
        harness.source.cleanup(),
      ])
    }
  })

  it(`waits for every recovering source before publishing a joined replacement`, async () => {
    type Primary = { id: string; joinKey: string; version: number }
    type Secondary = { id: string; joinKey: string; version: number }

    const createSource = <T extends { id: string }>(id: string) => {
      let begin!: () => void
      let write!: (message: { type: `insert`; value: T }) => void
      let commit!: () => true | Promise<void>
      let truncate!: () => void
      const pending: Array<ReturnType<typeof createDeferred<void>>> = []
      const collection = createCollection<T>({
        id,
        getKey: ({ id: key }) => key,
        syncMode: `on-demand`,
        sync: {
          sync: (operations) => {
            begin = operations.begin
            write = operations.write
            commit = operations.commit
            truncate = operations.truncate
            operations.markReady()
            return {
              loadSubset: () => {
                const request = createDeferred<void>()
                pending.push(request)
                return request.promise
              },
              unloadSubset: () => {},
            }
          },
        },
      })
      return {
        collection,
        pending,
        async apply(row: T) {
          begin()
          write({ type: `insert`, value: row })
          const receipt = commit()
          if (receipt !== true) await receipt
        },
        replay() {
          begin()
          truncate()
          return commit()
        },
      }
    }

    const primary = createSource<Primary>(`joined-replay-primary`)
    const secondary = createSource<Secondary>(`joined-replay-secondary`)
    const live = createLiveQueryCollection((q) =>
      q
        .from({ primary: primary.collection })
        .innerJoin(
          { secondary: secondary.collection },
          ({ primary: left, secondary: right }) =>
            eq(left.joinKey, right.joinKey),
        )
        .orderBy(({ primary: row }) => row.version)
        .limit(1)
        .select(({ primary: left, secondary: right }) => ({
          id: left.id,
          secondaryId: right.id,
          primaryVersion: left.version,
          secondaryVersion: right.version,
        })),
    )
    const read = () =>
      live.toArray.map(
        ({ id, secondaryId, primaryVersion, secondaryVersion }) => ({
          id,
          secondaryId,
          primaryVersion,
          secondaryVersion,
        }),
      )
    const publications: Array<ReturnType<typeof read>> = []
    let subscription: ReturnType<typeof live.subscribeChanges> | undefined
    let primaryReplay: true | Promise<void> = true
    let secondaryReplay: true | Promise<void> = true

    try {
      const preload = live.preload()
      await flushPromises()
      expect(primary.pending).toHaveLength(1)
      await primary.apply({ id: `p`, joinKey: `shared`, version: 1 })
      primary.pending[0]!.resolve()
      await flushPromises()
      expect(secondary.pending).toHaveLength(1)
      await secondary.apply({ id: `s`, joinKey: `shared`, version: 1 })
      secondary.pending[0]!.resolve()
      await flushPromises()
      for (const request of primary.pending.slice(1)) request.resolve()
      await preload
      expect(read()).toEqual([
        {
          id: `p`,
          secondaryId: `s`,
          primaryVersion: 1,
          secondaryVersion: 1,
        },
      ])

      subscription = live.subscribeChanges(() => publications.push(read()), {
        includeInitialState: false,
      })
      const initialPrimaryLoads = primary.pending.length
      const initialSecondaryLoads = secondary.pending.length
      primaryReplay = primary.replay()
      secondaryReplay = secondary.replay()
      await flushPromises()
      expect(primary.pending.length).toBeGreaterThan(initialPrimaryLoads)
      expect(secondary.pending.length).toBeGreaterThan(initialSecondaryLoads)

      await primary.apply({ id: `p`, joinKey: `shared`, version: 2 })
      await secondary.apply({ id: `s`, joinKey: `shared`, version: 2 })
      for (const request of primary.pending.slice(initialPrimaryLoads)) {
        request.resolve()
      }
      await flushPromises()

      expect(read()).toEqual([
        {
          id: `p`,
          secondaryId: `s`,
          primaryVersion: 1,
          secondaryVersion: 1,
        },
      ])
      expect(publications).toEqual([])

      for (const request of secondary.pending.slice(initialSecondaryLoads)) {
        request.resolve()
      }
      await Promise.all([primaryReplay, secondaryReplay])
      await flushPromises()

      expect(read()).toEqual([
        {
          id: `p`,
          secondaryId: `s`,
          primaryVersion: 2,
          secondaryVersion: 2,
        },
      ])
      expect(publications).toEqual([
        [
          {
            id: `p`,
            secondaryId: `s`,
            primaryVersion: 2,
            secondaryVersion: 2,
          },
        ],
      ])
    } finally {
      for (const request of [...primary.pending, ...secondary.pending]) {
        request.resolve()
      }
      subscription?.unsubscribe()
      await Promise.all([
        Promise.resolve(primaryReplay).catch(() => undefined),
        Promise.resolve(secondaryReplay).catch(() => undefined),
        live.cleanup(),
        primary.collection.cleanup(),
        secondary.collection.cleanup(),
      ])
    }
  })
})
