import { describe, expect, it } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import { createDeferred } from '../../src/deferred.js'
import {
  createLiveQueryCollection,
  eq,
  toArray,
} from '../../src/query/index.js'
import { BasicIndex } from '../../src/indexes/basic-index.js'
import { evaluateReferenceExpression } from '../reference-expression.js'
import { flushPromises } from '../utils.js'
import type {
  ChangeMessageOrDeleteKeyMessage,
  LoadSubsetOptions,
  SyncConfig,
} from '../../src/types.js'

type Row = { id: string; version: number }
type ObservedRow = { sourceId: string; rowKey: string; version: number }

describe(`loadSubset replay refinement`, () => {
  // A direct subscriber survives source cleanup. A dependent live query enters
  // a terminal error instead; restarting only its source must not revive it.
  it.each(
    ([`direct`, `live`] as const).flatMap((consumer) =>
      ([`resolve`, `reject`] as const).map((outcome) => ({
        consumer,
        outcome,
      })),
    ),
  )(
    `separates direct restart from fatal live source cleanup: %j`,
    async ({ consumer, outcome }) => {
      let operations!: Parameters<SyncConfig<Row, string>[`sync`]>[0]
      let loads = 0
      const pending = createDeferred<void>()
      void pending.promise.catch(() => undefined)
      const initial = [{ id: `row`, version: 1 }]
      const replacement = [{ id: `row`, version: 2 }]
      const source = createCollection<Row, string>({
        getKey: ({ id }) => id,
        syncMode: `on-demand`,
        sync: {
          sync: (next) => {
            operations = next
            next.markReady()
            return {
              loadSubset: () => {
                if (++loads > 1) return pending.promise
                next.begin()
                next.write({ type: `insert`, value: initial[0]! })
                next.commit()
                return true
              },
              unloadSubset: () => {},
            }
          },
        },
      })
      const live =
        consumer === `live`
          ? createLiveQueryCollection((q) => q.from({ row: source }))
          : undefined
      const visible = new Map<string, Row>()
      const rows = (values: ReadonlyArray<Row>) =>
        values.map(({ id, version }) => ({ id, version }))
      const readEvents = () => rows([...visible.values()])
      const read = () => (live ? rows(live.toArray) : readEvents())
      const publications: Array<Array<Row>> = []
      const subscription = (live ?? source).subscribeChanges(
        (changes) => {
          for (const change of changes) {
            if (change.type === `delete`) visible.delete(String(change.key))
            else visible.set(String(change.key), { ...change.value })
          }
          publications.push(readEvents())
        },
        { includeInitialState: consumer === `live` },
      )

      try {
        if (live) await live.preload()
        else subscription.requestSnapshot({})
        await flushPromises()
        expect(loads).toBe(1)
        expect(read()).toEqual(initial)
        expect(readEvents()).toEqual(initial)
        publications.length = 0

        await source.cleanup()
        if (live) expect(live.status).toBe(`error`)
        source.startSyncImmediate()
        await flushPromises()
        expect(loads).toBe(2)
        expect(read()).toEqual(initial)
        // Cleanup may change row metadata without changing the public data.
        for (const publication of publications)
          expect(publication).toEqual(initial)

        operations.begin()
        operations.write({ type: `insert`, value: replacement[0]! })
        await operations.commit()
        await flushPromises()
        expect(rows(source.toArray)).toEqual(replacement)
        expect(read()).toEqual(initial)
        expect(readEvents()).toEqual(initial)
        for (const publication of publications)
          expect(publication).toEqual(initial)
        publications.length = 0

        if (outcome === `resolve`) pending.resolve()
        else pending.reject(new Error(`restart failed`))
        await flushPromises()
        const publishes = consumer === `direct` && outcome === `resolve`
        const expected = publishes ? replacement : initial
        expect(read()).toEqual(expected)
        expect(readEvents()).toEqual(expected)
        expect(publications).toEqual(publishes ? [replacement] : [])
        if (live) expect(live.status).toBe(`error`)
      } finally {
        pending.resolve()
        subscription.unsubscribe()
        await live?.cleanup()
        await source.cleanup()
      }
    },
  )

  it(`publishes a successful sibling after a settled failed include route retires`, async () => {
    type Parent = { id: string; left: number | null; right: number }
    type Child = { id: number; version: number }
    let parentSync!: Parameters<SyncConfig<Parent, string>[`sync`]>[0]
    let childSync!: Parameters<SyncConfig<Child, number>[`sync`]>[0]
    const failed = createDeferred<void>()
    const successful = createDeferred<void>()
    const loads: Array<{ options: LoadSubsetOptions; ids: Array<number> }> = []
    const unloads: Array<LoadSubsetOptions> = []
    const parents = createCollection<Parent, string>({
      id: `settled-peer-parent`,
      getKey: ({ id }) => id,
      sync: {
        sync: (operations) => {
          parentSync = operations
          operations.begin()
          operations.write({
            type: `insert`,
            value: { id: `parent`, left: 1, right: 2 },
          })
          operations.commit()
          operations.markReady()
        },
      },
    })
    const children = createCollection<Child, number>({
      id: `settled-peer-children`,
      getKey: ({ id }) => id,
      syncMode: `on-demand`,
      autoIndex: `eager`,
      defaultIndexType: BasicIndex,
      sync: {
        sync: (operations) => {
          childSync = operations
          operations.markReady()
          return {
            loadSubset: (options) => {
              const rows = [1, 2]
                .map((id) => ({ id, version: loads.length < 2 ? 1 : 2 }))
                .filter(
                  (row) =>
                    !options.where ||
                    evaluateReferenceExpression(options.where, row) === true,
                )
              loads.push({ options, ids: rows.map(({ id }) => id) })
              operations.begin()
              for (const value of rows)
                operations.write({ type: `insert`, value })
              operations.commit()
              if (loads.length <= 2) return true
              return rows.some(({ id }) => id === 1)
                ? failed.promise
                : successful.promise
            },
            unloadSubset: (options) => {
              unloads.push(options)
            },
          }
        },
      },
    })
    const live = createLiveQueryCollection((q) =>
      q.from({ parent: parents }).select(({ parent }) => ({
        id: parent.id,
        left: toArray(
          q
            .from({ leftChild: children })
            .where(({ leftChild }) => eq(leftChild.id, parent.left)),
        ),
        right: toArray(
          q
            .from({ rightChild: children })
            .where(({ rightChild }) => eq(rightChild.id, parent.right)),
        ),
      })),
    )
    const read = () =>
      live.toArray.map(({ id, left, right }) => ({
        id,
        left: left.map(({ id: key, version }) => ({ id: key, version })),
        right: right.map(({ id: key, version }) => ({ id: key, version })),
      }))
    const publications: Array<ReturnType<typeof read>> = []
    const subscription = live.subscribeChanges(
      () => publications.push(read()),
      { includeInitialState: false },
    )
    try {
      await live.preload()
      expect(loads.map(({ ids }) => ids)).toEqual([[1], [2]])
      const initial = [
        {
          id: `parent`,
          left: [{ id: 1, version: 1 }],
          right: [{ id: 2, version: 1 }],
        },
      ]
      expect(read()).toEqual(initial)
      publications.length = 0
      childSync.begin()
      childSync.truncate()
      childSync.commit()
      await flushPromises()
      expect(loads.slice(2).map(({ ids }) => ids)).toEqual([[1], [2]])
      failed.reject(new Error(`left replay failed`))
      successful.resolve()
      await flushPromises()
      expect(read()).toEqual(initial)
      expect(publications).toEqual([])
      parentSync.begin()
      parentSync.write({
        type: `update`,
        value: { id: `parent`, left: null, right: 2 },
      })
      parentSync.commit()
      await flushPromises()
      expect(read()).toEqual([
        { id: `parent`, left: [], right: [{ id: 2, version: 2 }] },
      ])
      expect(publications).toEqual([
        [{ id: `parent`, left: [], right: [{ id: 2, version: 2 }] }],
      ])
      expect(loads).toHaveLength(4)
      expect(unloads).toContain(loads[2]!.options)
      expect(loads[2]!.options.signal?.aborted).toBe(true)
      expect(loads[3]!.options.signal?.aborted).toBe(false)
      childSync.begin()
      childSync.write({ type: `update`, value: { id: 2, version: 3 } })
      childSync.commit()
      await flushPromises()
      expect(read()).toEqual([
        { id: `parent`, left: [], right: [{ id: 2, version: 3 }] },
      ])
      expect(publications).toHaveLength(2)
    } finally {
      failed.resolve()
      successful.resolve()
      subscription.unsubscribe()
      await live.cleanup()
      await Promise.all([parents.cleanup(), children.cleanup()])
    }
    expect(unloads).toHaveLength(loads.length)
    for (const { options } of loads) {
      expect(unloads.filter((unloaded) => unloaded === options)).toHaveLength(1)
    }
  })

  function createHarness(
    sourceId: string,
    initialRows: ReadonlyArray<Row> = [{ id: `row`, version: 1 }],
  ) {
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
                for (const value of initialRows) {
                  write({ type: `insert`, value })
                }
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
    const applyCore = (
      changes: ReadonlyArray<ChangeMessageOrDeleteKeyMessage<Row, string>>,
    ) => {
      begin()
      for (const change of changes) write(change)
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
      applyCore,
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

  it(`publishes a replay replacement before its source reports ready`, async () => {
    const replay = createDeferred<void>()
    let loadCount = 0
    let begin!: () => void
    let write!: (message: ChangeMessageOrDeleteKeyMessage<Row, string>) => void
    let commit!: () => void
    let truncate!: () => void
    let sourceSubscription: LoadSubsetOptions[`subscription`]
    const source = createCollection<Row>({
      id: `replay-ready-publication-source`,
      getKey: ({ id }) => id,
      syncMode: `on-demand`,
      sync: {
        sync: (operations) => {
          begin = operations.begin
          write = operations.write
          commit = operations.commit
          truncate = operations.truncate
          operations.markReady()
          return {
            loadSubset: (options) => {
              sourceSubscription = options.subscription
              loadCount++
              if (loadCount === 1) {
                begin()
                write({ type: `insert`, value: { id: `row`, version: 1 } })
                commit()
                return true
              }
              return replay.promise
            },
            unloadSubset: () => {},
          }
        },
      },
    })
    const live = createLiveQueryCollection((q) =>
      q.from({ row: source }).select(({ row }) => ({
        id: row.id,
        version: row.version,
      })),
    )
    const readVersions = () => live.toArray.map(({ version }) => version)
    const readyReads: Array<Array<number>> = []

    try {
      await live.preload()
      expect(readVersions()).toEqual([1])
      sourceSubscription!.on(`status:ready`, () => {
        readyReads.push(readVersions())
      })

      begin()
      truncate()
      commit()
      await flushPromises()
      begin()
      write({ type: `insert`, value: { id: `row`, version: 2 } })
      commit()

      replay.resolve()
      await flushPromises()

      expect(readyReads).toEqual([[2]])
      expect(readVersions()).toEqual([2])
    } finally {
      replay.resolve()
      await Promise.all([live.cleanup(), source.cleanup()])
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

  it(`replaces a multi-row failed replay only with later authoritative state`, async () => {
    const sourceId = `replay-refinement-multi-row-failure`
    const observed = (id: string, version: number) => ({
      sourceId,
      rowKey: id,
      version,
    })
    const harness = createHarness(sourceId, [
      { id: `a`, version: 1 },
      { id: `b`, version: 1 },
      { id: `c`, version: 1 },
    ])
    const sortedVisible = () =>
      harness
        .visibleRows()
        .sort((left, right) => left.rowKey.localeCompare(right.rowKey))
    const sortedCore = () =>
      harness
        .coreRows()
        .sort((left, right) => left.rowKey.localeCompare(right.rowKey))

    try {
      await harness.downstream.preload()
      expect(sortedVisible()).toEqual([
        observed(`a`, 1),
        observed(`b`, 1),
        observed(`c`, 1),
      ])
      const publishedBatches = harness.batches.length

      await harness.startReplay()
      harness.applyCore([
        { type: `insert`, value: { id: `a`, version: 2 } },
        { type: `insert`, value: { id: `d`, version: 1 } },
      ])
      harness.pending[0]!.deferred.reject(new Error(`partial replay failed`))
      await flushPromises()

      harness.applyCore([
        {
          type: `update`,
          value: { id: `a`, version: 3 },
          previousValue: { id: `a`, version: 2 },
        },
        { type: `delete`, key: `d` },
        { type: `insert`, value: { id: `e`, version: 1 } },
      ])
      await flushPromises()

      expect(sortedCore()).toEqual([observed(`a`, 3), observed(`e`, 1)])
      expect(sortedVisible()).toEqual([
        observed(`a`, 1),
        observed(`b`, 1),
        observed(`c`, 1),
      ])
      expect(harness.batches).toHaveLength(publishedBatches)

      await harness.startReplay()
      harness.applyCore([
        { type: `insert`, value: { id: `a`, version: 4 } },
        { type: `insert`, value: { id: `b`, version: 1 } },
        { type: `insert`, value: { id: `e`, version: 2 } },
      ])
      harness.pending[1]!.deferred.resolve()
      await flushPromises()

      expect(sortedVisible()).toEqual([
        observed(`a`, 4),
        observed(`b`, 1),
        observed(`e`, 2),
      ])
      expect(harness.batches).toHaveLength(publishedBatches + 1)
      expect(harness.batches.at(-1)).toEqual([
        {
          type: `update`,
          row: observed(`a`, 4),
          previousVersion: 1,
        },
        { type: `delete`, row: observed(`c`, 1) },
        { type: `insert`, row: observed(`e`, 2) },
      ])
      expect(
        harness.callbackReads
          .at(-1)
          ?.sort((left, right) => left.rowKey.localeCompare(right.rowKey)),
      ).toEqual([observed(`a`, 4), observed(`b`, 1), observed(`e`, 2)])
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
