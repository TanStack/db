// Adapter unit tests for Electric collections: fixed histories with hand-written
// expectations, and the harness self-tests for the cleanup and publication recorders.
// The laws these tests exercise are owned by electric-oracle.property.test.ts.
import { isDeepStrictEqual } from 'node:util'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IR, createCollection, createTransaction } from '@tanstack/db'
import { ShapeStream } from '@electric-sql/client'
import { persistedCollectionOptions } from '../../db-sqlite-persistence-core/src'
import { electricCollectionOptions } from '../src/electric'
import { atCheckpoint, withElectricCleanup } from './electric-oracle-lifecycle'
import { createMockStream } from './electric-stream-mock'
import {
  change,
  createDeferred,
  createMetadata,
  createOracleCollection,
  createPersistedAdapter,
  everyContiguousPartition,
  expectGaveUpAfterReadiness,
  expectPreloadOutcome,
  expectWholePublications,
  mockStream,
  mockSubscribe,
  mustRefetch,
  observePreload,
  observePublications,
  resetElectricOracleMocks,
  resumeState,
  rowsFromCollection,
  rowsFromMap,
  runTrace,
  shapeId,
  subsetEnd,
  upToDate,
} from './electric-adapter-support'
import type { OracleRow } from './electric-adapter-support'
import type { Message, Offset } from '@electric-sql/client'
import type { PersistedTx } from '../../db-sqlite-persistence-core/src'
import type { ElectricCollectionUtils } from '../src/electric'

vi.mock(`@electric-sql/client`, async () => {
  const actual = await vi.importActual(`@electric-sql/client`)
  return {
    ...actual,
    ShapeStream: vi.fn(() => createMockStream(mockStream)),
  }
})

describe(`Electric adapter laws`, () => {
  beforeEach(() => {
    resetElectricOracleMocks()
  })

  it.each([false, true])(
    `cleans direct traces after delivery failure and preserves the primary error (cleanup failure: %s)`,
    async (failCleanup) => {
      const primary = new Error(`delivery sentinel`)
      const secondary = new Error(`cleanup sentinel`)
      const cleanup = vi.fn(async (release: () => Promise<void>) => {
        await release()
        if (failCleanup) throw secondary
      })
      const warning = vi.spyOn(console, `warn`).mockImplementation(() => {})
      try {
        await expect(
          runTrace(`cleanup-${failCleanup}`, `eager`, [[]], [], new Map(), {
            beforeDelivery: () => {
              throw primary
            },
            cleanup,
          }),
        ).rejects.toBe(primary)
        expect(cleanup).toHaveBeenCalledTimes(1)
        const unsubscribe = mockSubscribe.mock.results.at(-1)!.value
        expect(unsubscribe).toHaveBeenCalledTimes(1)
        const streamOptions = vi.mocked(ShapeStream).mock.calls.at(-1)![0] as {
          signal?: AbortSignal
        }
        expect(streamOptions.signal?.aborted).toBe(true)
        if (failCleanup)
          expect(warning).toHaveBeenCalledWith(
            `Electric oracle cleanup failed after a primary error`,
            secondary,
          )
        else expect(warning).not.toHaveBeenCalled()
      } finally {
        warning.mockRestore()
      }
    },
  )
  it(`preserves unexpected preload failures instead of treating observation as success`, async () => {
    const failure = new Error(`test-owned preload failure`)
    const observed = observePreload(Promise.reject(failure))
    const outcome = await observed.outcome
    expect(outcome).toEqual({ status: `rejected`, reason: failure })
    if (outcome.status === `rejected`) expect(outcome.reason).toBe(failure)
    expect(() => expectPreloadOutcome(observed, outcome)).toThrow(failure)
    const success = observePreload(Promise.resolve())
    expectPreloadOutcome(success, await success.outcome)
  })
  it.each([`reset`, `delete`, `move-out`] as const)(
    `keeps $0 removal authoritative across an optimistic write and a new acquisition`,
    async (removal) => {
      const trace = createOracleCollection(
        `parked-presence`,
        `on-demand`,
        createMetadata(new Map()).api,
      )
      const persistence = createDeferred<void>()
      let acquired: Promise<unknown> | undefined
      let transaction: ReturnType<typeof createTransaction> | undefined
      try {
        const inserted = change(`insert`, 1, `complete`)
        trace.subscriber([
          { ...inserted, headers: { ...inserted.headers, tags: [`left`] } },
          upToDate,
        ])
        transaction = createTransaction({
          mutationFn: () => persistence.promise,
        })
        transaction.mutate(() =>
          trace.collection.insert({
            id: 99,
            name: `optimistic`,
            stable: `stable-99`,
          }),
        )
        const removed: Message<OracleRow> =
          removal === `reset`
            ? mustRefetch
            : removal === `delete`
              ? change(`delete`, 1, `complete`)
              : {
                  headers: {
                    event: `move-out`,
                    patterns: [{ pos: 0, value: `left` }],
                  },
                }
        trace.subscriber([removed, subsetEnd])
        // Truncation drains immediately; ordinary removals remain parked.
        expect(trace.collection.has(1)).toBe(removal !== `reset`)
        acquired = Promise.resolve(
          trace.collection._sync.loadSubset({
            where: new IR.Func(`eq`, [new IR.PropRef([`id`]), new IR.Value(2)]),
          }),
        )
        void acquired.catch(() => {})
        trace.subscriber([change(`update`, 1, `partial`), upToDate])
        persistence.resolve()
        await transaction.when('settled')
        await acquired
        expect(trace.collection.has(1)).toBe(false)
      } finally {
        persistence.resolve()
        await transaction?.when('settled')
        await trace.collection.cleanup()
        await acquired
      }
    },
  )
  it(`publishes later Electric callbacks while an earlier durability turn is held`, async () => {
    let subscriber: ((messages: Array<Message<OracleRow>>) => void) | undefined
    mockSubscribe.mockImplementationOnce((callback) => {
      subscriber = callback
      return vi.fn()
    })
    const firstPersistenceEntered = createDeferred<void>()
    const releaseFirstPersistence = createDeferred<void>()
    const persistedMetadata = new Map<string, unknown>()
    const persistedRows = new Map<string | number, OracleRow>()
    const adapter = createPersistedAdapter(persistedMetadata, persistedRows)
    const applyCommittedTx = adapter.applyCommittedTx.bind(adapter)
    let heldFirstRow = false
    let durabilityCalls = 0
    adapter.applyCommittedTx = async (...args) => {
      durabilityCalls++
      if (
        !heldFirstRow &&
        args[1].mutations.some((mutation) => mutation.key === 1)
      ) {
        heldFirstRow = true
        firstPersistenceEntered.resolve()
        await releaseFirstPersistence.promise
      }
      await applyCommittedTx(...args)
    }
    const collection = createCollection(
      persistedCollectionOptions<
        OracleRow,
        string | number,
        never,
        ElectricCollectionUtils<OracleRow>
      >({
        ...electricCollectionOptions<OracleRow>({
          id: `queued-persisted-presence`,
          shapeOptions: {
            url: `http://test-url`,
            params: { table: `test_table` },
          },
          syncMode: `progressive`,
          getKey: (row) => row.id,
          startSync: true,
        }),
        persistence: { adapter },
      }),
    )
    const publications = observePublications(collection)

    await withElectricCleanup(async () => {
      await vi.waitFor(() => expect(subscriber).toBeTypeOf(`function`), {
        interval: 1,
        timeout: 250,
      })
      mockStream.lastOffset = `90_0`
      subscriber!([upToDate])
      await vi.waitFor(() => expect(collection.status).toBe(`ready`), {
        interval: 1,
        timeout: 250,
      })

      const first = change(`insert`, 1, `holds persistence`)
      first.value = { id: 1, name: `holds persistence`, stable: `stable-1` }
      mockStream.lastOffset = `91_0`
      subscriber!([first, upToDate])
      await atCheckpoint(
        firstPersistenceEntered.promise,
        `first Electric persistence entered`,
      )
      const durabilityCallsAtHold = durabilityCalls

      const queued = change(`insert`, 2, `queued insert`)
      queued.value = { id: 2, name: `queued insert`, stable: `stable-2` }
      mockStream.lastOffset = `92_0`
      subscriber!([queued, upToDate])

      const laterUpdate = change(`update`, 2, `later update`)
      laterUpdate.value = { id: 2, name: `later update`, stable: `stable-2` }
      mockStream.lastOffset = `93_0`
      subscriber!([laterUpdate, upToDate])

      const expected = rowsFromMap(
        new Map([
          [1, first.value],
          [2, laterUpdate.value],
        ]),
      )
      expect({
        publicRows: rowsFromCollection(collection),
        durableRows: rowsFromMap(persistedRows),
        noLaterDurabilityStarted: durabilityCalls === durabilityCallsAtHold,
        published: publications.entries.some(
          ({ cut, rows }) =>
            cut === `event` && isDeepStrictEqual(rows, expected),
        ),
      }).toEqual({
        publicRows: rowsFromMap(new Map([[1, first.value]])),
        durableRows: [],
        noLaterDurabilityStarted: true,
        published: false,
      })

      releaseFirstPersistence.resolve()
      await vi.waitFor(
        () =>
          expect(rowsFromMap(persistedRows)).toEqual(
            rowsFromMap(
              new Map([
                [1, first.value],
                [2, laterUpdate.value],
              ]),
            ),
          ),
        { interval: 1, timeout: 250 },
      )
      expect(rowsFromCollection(collection)).toEqual(
        rowsFromMap(
          new Map([
            [1, first.value],
            [2, laterUpdate.value],
          ]),
        ),
      )
      expect(collection.status).toBe(`ready`)
    }, [
      () => releaseFirstPersistence.resolve(),
      () => publications.stop(),
      () => collection.cleanup(),
    ])
  })
  it(`keeps pending row presence across callbacks until one persisted subset commit`, async () => {
    let subscriber!: (messages: Array<Message<OracleRow>>) => void
    mockSubscribe.mockImplementationOnce((callback) => {
      subscriber = callback
      return vi.fn()
    })
    const persistedRows = new Map<string | number, OracleRow>()
    const persistedMetadata = new Map<string, unknown>()
    const adapter = createPersistedAdapter(persistedMetadata, persistedRows)
    const applyCommittedTx = adapter.applyCommittedTx.bind(adapter)
    const durabilityEntered = createDeferred<void>()
    const releaseDurability = createDeferred<void>()
    const durabilitySettled = createDeferred<void>()
    let persistedTx: PersistedTx | undefined
    adapter.applyCommittedTx = async (...args) => {
      persistedTx = structuredClone(args[1])
      durabilityEntered.resolve()
      await releaseDurability.promise
      await applyCommittedTx(...args)
      durabilitySettled.resolve()
    }
    const collection = createCollection(
      persistedCollectionOptions<
        OracleRow,
        string | number,
        never,
        ElectricCollectionUtils<OracleRow>
      >({
        ...electricCollectionOptions<OracleRow>({
          id: `persisted-cross-callback-presence`,
          shapeOptions: {
            url: `http://test-url`,
            params: { table: `test_table` },
          },
          syncMode: `eager`,
          getKey: (row) => row.id,
          startSync: true,
        }),
        persistence: { adapter },
      }),
    )

    collection.startSyncImmediate()
    await withElectricCleanup(async () => {
      await vi.waitFor(() => expect(subscriber).toBeTypeOf(`function`))

      subscriber([change(`insert`, 1, ``)])
      subscriber([change(`update`, 1, `updated across callbacks`)])
      subscriber([subsetEnd])
      await atCheckpoint(
        durabilityEntered.promise,
        `cross-callback durability entered`,
      )

      expect({
        publicRows: rowsFromCollection(collection),
        durableRows: rowsFromMap(persistedRows),
        persistedMutations: persistedTx?.mutations.map((mutation) => ({
          type: mutation.type,
          key: mutation.key,
          value: mutation.type === `delete` ? undefined : mutation.value,
        })),
      }).toEqual({
        publicRows: [[1, `updated across callbacks`, `stable-1`]],
        durableRows: [],
        // The source's insert is persisted as an insert, which replaces any
        // cached row (decision C1 of 2026-10-23); its update merges.
        persistedMutations: [
          {
            type: `insert`,
            key: 1,
            value: {
              id: 1,
              name: ``,
              stable: `stable-1`,
            },
          },
          {
            type: `update`,
            key: 1,
            value: {
              id: 1,
              name: `updated across callbacks`,
            },
          },
        ],
      })

      releaseDurability.resolve()
      await atCheckpoint(
        durabilitySettled.promise,
        `cross-callback durability settled`,
      )
      expect(rowsFromMap(persistedRows)).toEqual([
        [1, `updated across callbacks`, `stable-1`],
      ])
    }, [
      async () => {
        releaseDurability.resolve()
        await collection.cleanup()
      },
    ])
  })
  it(`retains a wrong intermediate publication even when the final read repairs it`, async () => {
    const trace = createOracleCollection(
      `publication-recorder-control`,
      `eager`,
      createMetadata(new Map()).api,
    )
    trace.subscriber([change(`insert`, 1, `old`), upToDate])
    const observed = observePublications(trace.collection)
    try {
      observed.record(`before`)
      trace.subscriber([change(`update`, 1, `wrong`), upToDate])
      trace.subscriber([change(`update`, 1, `correct`), upToDate])
      observed.record(`final`)
      expect(rowsFromCollection(trace.collection)).toEqual([
        [1, `correct`, `stable-1`],
      ])
      expect(observed.entries[0]!.rows).toEqual([[1, `old`, `stable-1`]])
      expect(
        observed.entries.some(
          ({ cut, rows }) => cut === `event` && rows[0]?.[1] === `wrong`,
        ),
      ).toBe(true)
      expect(() =>
        expectWholePublications(observed.entries, [
          [[1, `old`, `stable-1`]],
          [[1, `correct`, `stable-1`]],
        ]),
      ).toThrow()
      expectWholePublications(observed.entries, [
        [[1, `old`, `stable-1`]],
        [[1, `wrong`, `stable-1`]],
        [[1, `correct`, `stable-1`]],
      ])
    } finally {
      observed.stop()
      await trace.collection.cleanup()
    }
  })
  for (const syncMode of [`eager`, `progressive`] as const) {
    it(`rejects unseen resumed updates and recovers on the next ${syncMode} lifecycle`, async () => {
      const metadata = createMetadata(resumeState())
      const old = createOracleCollection(
        `invalid-${syncMode}-resume`,
        syncMode,
        metadata.api,
      )

      old.subscriber([change(`update`, 1, `partial`)])
      expect(old.collection.status).toBe(`error`)
      expect(old.collection.has(1)).toBe(false)
      expect(old.unsubscribe).toHaveBeenCalledOnce()
      expect(metadata.state.get(`electric:resume`)).toEqual(
        expect.objectContaining({ kind: `reset` }),
      )

      old.subscriber([change(`insert`, 1, `old generation`), upToDate])
      expect(old.collection.has(1)).toBe(false)
      expect(metadata.state.get(`electric:resume`)).toEqual(
        expect.objectContaining({ kind: `reset` }),
      )
      await old.collection.cleanup()

      const fresh = createOracleCollection(
        `fresh-${syncMode}-snapshot`,
        syncMode,
        metadata.api,
      )
      fresh.subscriber([change(`insert`, 1, `complete snapshot`), upToDate])

      expect(fresh.collection.status).toBe(`ready`)
      expect(fresh.collection.get(1)?.name).toBe(`complete snapshot`)
      expect(metadata.state.get(`electric:resume`)).toEqual(
        expect.objectContaining({ kind: `resume`, offset: `20_0` }),
      )
      await fresh.collection.cleanup()
    })

    it(`treats delete then update as an invalid ${syncMode} resume`, async () => {
      const metadata = createMetadata(resumeState())
      const trace = createOracleCollection(
        `delete-update-${syncMode}-resume`,
        syncMode,
        metadata.api,
      )

      trace.subscriber([
        change(`insert`, 1, `seen`),
        change(`delete`, 1, `seen`),
        change(`update`, 1, `partial`),
      ])

      expect(trace.collection.status).toBe(`error`)
      expect(trace.collection.has(1)).toBe(false)
      expect(metadata.state.get(`electric:resume`)).toEqual(
        expect.objectContaining({ kind: `reset` }),
      )
      await trace.collection.cleanup()
    })

    it(`rejects delete then update across every ${syncMode} resume partition`, async () => {
      const messages = [
        change(`delete`, 1, `complete`),
        change(`update`, 1, `partial`),
        upToDate,
      ]

      for (const [partitionId, partition] of everyContiguousPartition(
        messages,
      ).entries()) {
        const metadata = createMetadata(resumeState())
        const trace = createOracleCollection(
          `invalid-partition-${syncMode}-${partitionId}`,
          syncMode,
          metadata.api,
        )
        trace.subscriber([change(`insert`, 1, `complete`), upToDate])
        for (const batch of partition) trace.subscriber(batch)

        expectGaveUpAfterReadiness(trace.collection)
        expect(trace.collection.get(1)).toEqual(
          expect.objectContaining({ stable: `stable-1` }),
        )
        expect(metadata.state.get(`electric:resume`)).toEqual(
          expect.objectContaining({ kind: `reset` }),
        )
        await trace.collection.cleanup()
      }
    })
  }
  it(`keeps stream cleanup and stale callbacks scoped to their lifecycle`, async () => {
    const subscribers: Array<(messages: Array<Message<OracleRow>>) => void> = []
    const unsubscribes = [vi.fn(), vi.fn()]
    mockSubscribe.mockImplementation((callback) => {
      const index = subscribers.length
      subscribers.push(callback)
      return unsubscribes[index]!
    })
    const options = electricCollectionOptions<OracleRow>({
      id: `reused-sync-config`,
      shapeOptions: {
        url: `http://test-url`,
        params: { table: `test_table` },
      },
      getKey: (row) => row.id,
      startSync: true,
    })
    const createLifecycle = (id: string) => {
      const metadata = createMetadata(resumeState())
      const lifecycleSync = options.sync
      return createCollection({
        ...options,
        id,
        sync: {
          ...lifecycleSync,
          sync: (params: Parameters<typeof lifecycleSync.sync>[0]) =>
            lifecycleSync.sync({ ...params, metadata: metadata.api }),
        },
      })
    }

    const oldCollection = createLifecycle(`old-sync-lifecycle`)
    const currentCollection = createLifecycle(`current-sync-lifecycle`)

    subscribers[0]!([change(`insert`, 1, `first row`), upToDate])
    subscribers[1]!([change(`insert`, 2, `second row`), upToDate])
    expect(oldCollection.get(1)?.name).toBe(`first row`)
    expect(currentCollection.get(2)?.name).toBe(`second row`)
    subscribers[0]!([change(`update`, 1, `first row updated`), upToDate])
    const currentMatch = currentCollection.utils.awaitMatch(
      (message) => `value` in message && message.value.id === 3,
      100,
    )
    const currentTxid = currentCollection.utils.awaitTxId(42, 100)
    const currentSnapshotTxid = currentCollection.utils.awaitTxId(50, 100)
    let currentMatchResolved = false
    let currentTxidResolved = false
    let currentSnapshotTxidResolved = false
    void currentMatch.then(() => {
      currentMatchResolved = true
    })
    void currentTxid.then(() => {
      currentTxidResolved = true
    })
    void currentSnapshotTxid.then(() => {
      currentSnapshotTxidResolved = true
    })
    subscribers[0]!([
      change(`insert`, 3, `wrong lifecycle`),
      {
        headers: {
          control: `snapshot-end`,
          xmin: `100`,
          xmax: `150`,
          xip_list: [],
        },
      },
      { headers: { control: `up-to-date`, txids: [42] } },
    ])
    await Promise.resolve()
    expect(currentMatchResolved).toBe(false)
    expect(currentTxidResolved).toBe(false)
    expect(currentSnapshotTxidResolved).toBe(false)

    await oldCollection.cleanup()

    expect(unsubscribes[0]).toHaveBeenCalledOnce()
    expect(unsubscribes[1]).not.toHaveBeenCalled()

    subscribers[0]!([change(`update`, 1, `stale`)])
    expect(unsubscribes[1]).not.toHaveBeenCalled()
    subscribers[1]!([
      change(`insert`, 3, `still live`),
      {
        headers: {
          control: `snapshot-end`,
          xmin: `100`,
          xmax: `150`,
          xip_list: [],
        },
      },
      { headers: { control: `up-to-date`, txids: [42] } },
    ])
    await expect(currentMatch).resolves.toBe(true)
    await expect(currentTxid).resolves.toBe(true)
    await expect(currentSnapshotTxid).resolves.toBe(true)
    expect(currentCollection.get(3)?.name).toBe(`still live`)
    await currentCollection.cleanup()
    expect(unsubscribes[1]).toHaveBeenCalledOnce()
  })
  it(`binds sync metadata import and export to the receiving collection`, async () => {
    const subscribers: Array<(messages: Array<Message<OracleRow>>) => void> = []
    mockSubscribe.mockImplementation((callback) => {
      subscribers.push(callback)
      return vi.fn()
    })
    const options = electricCollectionOptions<OracleRow>({
      id: `shared-metadata-config`,
      shapeOptions: {
        url: `http://test-url`,
        params: { table: `test_table` },
      },
      getKey: (row) => row.id,
      startSync: true,
    })
    const first = createCollection({ ...options, id: `metadata-first` })
    const second = createCollection({ ...options, id: `metadata-second` })

    subscribers[0]!([{ headers: { control: `up-to-date`, txids: [11] } }])
    subscribers[1]!([{ headers: { control: `up-to-date`, txids: [22] } }])

    expect(first.config.sync.exportSyncMeta?.()).toMatchObject({
      version: 1,
      seenTxids: [11],
    })
    expect(second.config.sync.exportSyncMeta?.()).toMatchObject({
      version: 1,
      seenTxids: [22],
    })

    const importedResume = {
      kind: `resume` as const,
      requiresTagState: false,
      offset: `7_0` as const,
      handle: `shape-7`,
      shapeId,
      updatedAt: 7,
    }
    first.config.sync.importSyncMeta?.({
      version: 1,
      resume: importedResume,
      seenTxids: [99],
    })

    await expect(first.utils.awaitTxId(99, 50)).resolves.toBe(true)
    await expect(second.utils.awaitTxId(99, 10)).rejects.toThrow()
    expect(first.config.sync.exportSyncMeta?.()).toEqual({
      version: 1,
      resume: importedResume,
      seenTxids: [99],
    })
    expect(second.config.sync.exportSyncMeta?.()).toMatchObject({
      version: 1,
      seenTxids: [22],
    })
    expect(second.config.sync.exportSyncMeta?.()).not.toMatchObject({
      resume: importedResume,
    })

    const third = createCollection({ ...options, id: `metadata-third` })
    await expect(third.utils.awaitTxId(99, 10)).rejects.toThrow()
    expect(third.config.sync.exportSyncMeta?.()).not.toMatchObject({
      resume: importedResume,
    })

    await first.cleanup()
    await second.cleanup()
    await third.cleanup()
  })
  it(`consumes raw sync metadata when the next collection is materialized`, async () => {
    mockSubscribe.mockImplementation(() => vi.fn())
    const options = electricCollectionOptions<OracleRow>({
      id: `seeded-metadata-config`,
      shapeOptions: {
        url: `http://test-url`,
        params: { table: `test_table` },
      },
      getKey: (row) => row.id,
      startSync: true,
    })
    const importedResume = {
      kind: `resume` as const,
      requiresTagState: false,
      offset: `8_0` as const,
      handle: `shape-8`,
      shapeId,
      updatedAt: 8,
    }
    options.sync.importSyncMeta?.({
      version: 1,
      resume: importedResume,
      seenTxids: [55],
    })

    const seeded = createCollection({ ...options, id: `metadata-seeded` })
    await expect(seeded.utils.awaitTxId(55, 50)).resolves.toBe(true)
    expect(seeded.config.sync.exportSyncMeta?.()).toMatchObject({
      resume: importedResume,
      seenTxids: [55],
    })

    const unseeded = createCollection({ ...options, id: `metadata-unseeded` })
    await expect(unseeded.utils.awaitTxId(55, 10)).rejects.toThrow()
    expect(unseeded.config.sync.exportSyncMeta?.()).toEqual({
      version: 1,
      seenTxids: [],
    })

    await seeded.cleanup()
    await unseeded.cleanup()
  })
  it(`binds imported evidence and pending matches before lazy sync starts`, async () => {
    let subscriber!: (messages: Array<Message<OracleRow>>) => void
    mockSubscribe.mockImplementation((callback) => {
      subscriber = callback
      return vi.fn()
    })
    const options = electricCollectionOptions<OracleRow>({
      id: `lazy-bound-evidence`,
      shapeOptions: {
        url: `http://test-url`,
        params: { table: `test_table` },
      },
      getKey: (row) => row.id,
      startSync: false,
    })
    const collection = createCollection(options)
    const importedResume = {
      kind: `resume` as const,
      requiresTagState: false,
      offset: `9_0` as const,
      handle: `shape-9`,
      shapeId,
      updatedAt: 9,
    }
    collection.config.sync.importSyncMeta?.({
      version: 1,
      resume: importedResume,
      seenTxids: [33],
    })

    await expect(collection.utils.awaitTxId(33, 20)).resolves.toBe(true)
    const pendingMatch = collection.utils.awaitMatch(
      (message) => `value` in message && message.value.id === 5,
      100,
    )
    const pendingTxid = collection.utils.awaitTxId(34, 100)
    const preload = collection.preload()
    expect(vi.mocked(ShapeStream).mock.calls.at(-1)?.[0]).toMatchObject({
      offset: `9_0`,
      handle: `shape-9`,
    })
    const evidenceChange = change(`insert`, 5, `matched after start`)
    subscriber([
      {
        ...evidenceChange,
        headers: { operation: `insert`, txids: [34] },
      },
      upToDate,
    ])

    await expect(pendingMatch).resolves.toBe(true)
    await expect(pendingTxid).resolves.toBe(true)
    await preload
    expect(collection.get(5)?.name).toBe(`matched after start`)
    await collection.cleanup()
  })
  it(`keeps descriptor utilities captured before collection startup live`, async () => {
    let subscriber!: (messages: Array<Message<OracleRow>>) => void
    mockSubscribe.mockImplementation((callback) => {
      subscriber = callback
      return vi.fn()
    })
    const options = electricCollectionOptions<OracleRow>({
      id: `captured-descriptor-utilities`,
      shapeOptions: {
        url: `http://test-url`,
        params: { table: `test_table` },
      },
      getKey: (row) => row.id,
      startSync: false,
    })
    const { awaitMatch, awaitTxId } = options.utils
    const collection = createCollection(options)
    const pendingMatch = awaitMatch(
      (message) => `value` in message && message.value.id === 77,
      100,
    )
    const pendingTxid = awaitTxId(77, 100)

    const preload = collection.preload()
    const evidenceChange = change(`insert`, 77, `captured utilities`)
    subscriber([
      {
        ...evidenceChange,
        headers: { operation: `insert`, txids: [77] },
      },
      upToDate,
    ])

    await expect(pendingMatch).resolves.toBe(true)
    await expect(pendingTxid).resolves.toBe(true)
    await preload
    await collection.cleanup()
  })
  it(`retires a pending pre-start match when a lazy collection is cleaned up`, async () => {
    mockSubscribe.mockImplementation(() => vi.fn())
    const collection = createCollection(
      electricCollectionOptions<OracleRow>({
        id: `lazy-pre-start-cleanup`,
        shapeOptions: {
          url: `http://test-url`,
          params: { table: `test_table` },
        },
        getKey: (row) => row.id,
        startSync: false,
      }),
    )
    const pendingMatch = collection.utils.awaitMatch(() => false, 100)

    await collection.cleanup()

    await expect(pendingMatch).rejects.toThrow(/aborted/i)
    expect(mockSubscribe).not.toHaveBeenCalled()
  })
  it(`retires pre-start waiters when persisted metadata startup is interrupted`, async () => {
    const metadataStarted = createDeferred<void>()
    const metadataGate = createDeferred<void>()
    const adapter = createPersistedAdapter(new Map(), new Map())
    const loadResumeSnapshot = adapter.loadResumeSnapshot
    adapter.loadResumeSnapshot = async (...args) => {
      metadataStarted.resolve()
      await metadataGate.promise
      return loadResumeSnapshot(args[0], args[1])
    }
    const collection = createCollection(
      persistedCollectionOptions<
        OracleRow,
        string | number,
        never,
        ElectricCollectionUtils<OracleRow>
      >({
        ...electricCollectionOptions<OracleRow>({
          id: `persisted-startup-waiter-cleanup`,
          shapeOptions: {
            url: `http://test-url`,
            params: { table: `test_table` },
          },
          getKey: (row) => row.id,
          startSync: false,
        }),
        persistence: { adapter },
      }),
    )
    const pendingMatch = collection.utils.awaitMatch(() => false, 100)
    const pendingTxid = collection.utils.awaitTxId(702, 100)
    const preload = expect(collection.preload()).rejects.toMatchObject({
      name: `AbortError`,
    })
    await metadataStarted.promise
    const matchOutcome = expect(pendingMatch).rejects.toThrow(/aborted/i)
    const txidOutcome = expect(pendingTxid).rejects.toThrow(/aborted/i)

    await collection.cleanup()

    await matchOutcome
    await txidOutcome
    expect(mockSubscribe).not.toHaveBeenCalled()
    metadataGate.resolve()
    await preload
  })
  it(`retires pre-start waiters through automatic collection GC`, async () => {
    const metadataGate = createDeferred<void>()
    const adapter = createPersistedAdapter(new Map(), new Map())
    const loadResumeSnapshot = adapter.loadResumeSnapshot
    adapter.loadResumeSnapshot = vi.fn(async (...args) => {
      await metadataGate.promise
      return loadResumeSnapshot(args[0], args[1])
    })
    const collection = createCollection(
      persistedCollectionOptions<
        OracleRow,
        string | number,
        never,
        ElectricCollectionUtils<OracleRow>
      >({
        ...electricCollectionOptions<OracleRow>({
          id: `persisted-gc-waiter-cleanup`,
          shapeOptions: {
            url: `http://test-url`,
            params: { table: `test_table` },
          },
          getKey: (row) => row.id,
          startSync: false,
          gcTime: 10,
        }),
        persistence: { adapter },
      }),
    )
    const pendingMatch = collection.utils.awaitMatch(() => false, 5000)
    const pendingTxid = collection.utils.awaitTxId(703, 5000)
    // A pending preload owns retention; exercise unowned sync for automatic GC.
    collection.startSyncImmediate()
    await vi.waitFor(
      () => expect(adapter.loadResumeSnapshot).toHaveBeenCalledOnce(),
      { interval: 1, timeout: 250 },
    )
    const subscription = collection.subscribeChanges(() => {})
    const matchOutcome = pendingMatch.catch((error: unknown) => error)
    const txidOutcome = pendingTxid.catch((error: unknown) => error)

    subscription.unsubscribe()
    await vi.waitFor(() => expect(collection.status).toBe(`cleaned-up`), {
      interval: 10,
      timeout: 1500,
    })
    const pendingSentinel = Symbol(`pending`)
    const matchResult = await Promise.race([
      matchOutcome,
      new Promise((resolve) => setTimeout(() => resolve(pendingSentinel), 50)),
    ])
    const txidResult = await Promise.race([
      txidOutcome,
      new Promise((resolve) => setTimeout(() => resolve(pendingSentinel), 50)),
    ])

    expect(matchResult).toEqual(
      expect.objectContaining({
        message: expect.stringMatching(/aborted/i),
      }),
    )
    expect(txidResult).toEqual(
      expect.objectContaining({
        message: expect.stringMatching(/aborted/i),
      }),
    )
    expect(mockSubscribe).not.toHaveBeenCalled()
    metadataGate.resolve()
  })
  it(`retires every pending waiter when its collection lifecycle is cleaned up`, async () => {
    mockSubscribe.mockImplementation(() => vi.fn())
    const lazy = createCollection(
      electricCollectionOptions<OracleRow>({
        id: `lazy-waiter-cleanup`,
        shapeOptions: {
          url: `http://test-url`,
          params: { table: `test_table` },
        },
        getKey: (row) => row.id,
        startSync: false,
      }),
    )
    const lazyTxid = lazy.utils.awaitTxId(700, 100)
    await lazy.cleanup()
    await expect(lazyTxid).rejects.toThrow(/aborted/i)

    const active = createOracleCollection(
      `active-waiter-cleanup`,
      `eager`,
      createMetadata(new Map()).api,
    )
    const activeMatch = active.collection.utils.awaitMatch(() => false, 100)
    const activeTxid = active.collection.utils.awaitTxId(701, 100)
    await active.collection.cleanup()

    await expect(activeMatch).rejects.toThrow(/aborted/i)
    await expect(activeTxid).rejects.toThrow(/aborted/i)
  })
  it(`settles waiters according to whether evidence or cleanup wins`, async () => {
    for (const cleanupWins of [true, false]) {
      const trace = createOracleCollection(
        `waiter-race-${cleanupWins}`,
        `eager`,
        createMetadata(new Map()).api,
      )
      const pendingMatch = trace.collection.utils.awaitMatch(
        (message) => `value` in message && message.value.id === 91,
        100,
      )
      const pendingTxid = trace.collection.utils.awaitTxId(91, 100)
      const evidenceChange = change(`insert`, 91, `race winner`)
      const evidence: Array<Message<OracleRow>> = [
        {
          ...evidenceChange,
          headers: { operation: `insert`, txids: [91] },
        },
        upToDate,
      ]

      if (cleanupWins) {
        await trace.collection.cleanup()
        trace.subscriber(evidence)
        await expect(pendingMatch).rejects.toThrow(/aborted/i)
        await expect(pendingTxid).rejects.toThrow(/aborted/i)
        expect(trace.collection.get(91)).toBeUndefined()
      } else {
        trace.subscriber(evidence)
        await trace.collection.cleanup()
        await expect(pendingMatch).resolves.toBe(true)
        await expect(pendingTxid).resolves.toBe(true)
      }
    }
  })
  it(`keeps committed match evidence across newer writer batches`, async () => {
    const metadata = createMetadata(new Map())
    const trace = createOracleCollection(
      `await-match-batch-generation`,
      `eager`,
      metadata.api,
    )

    trace.subscriber([change(`insert`, 1, `old batch`), upToDate])
    trace.subscriber([change(`insert`, 2, `current batch`), upToDate])

    await expect(
      trace.collection.utils.awaitMatch(
        (message) => `value` in message && message.value.name === `old batch`,
        20,
      ),
    ).resolves.toBe(true)
    await trace.collection.cleanup()
  })
  it(`keeps committed match evidence across callbacks with no new data`, async () => {
    const trace = createOracleCollection(
      `await-match-neutral-callback`,
      `eager`,
      createMetadata(new Map()).api,
    )

    trace.subscriber([change(`insert`, 1, `committed`), upToDate])
    trace.subscriber([
      {
        headers: {
          control: `snapshot-end`,
          xmin: `100`,
          xmax: `150`,
          xip_list: [],
        },
      },
    ])
    trace.subscriber([])

    await expect(
      trace.collection.utils.awaitMatch(
        (message) => `value` in message && message.value.id === 1,
        20,
      ),
    ).resolves.toBe(true)
    await trace.collection.cleanup()
  })
  it(`clears committed match evidence when the stream must refetch`, async () => {
    const trace = createOracleCollection(
      `await-match-reset-generation`,
      `eager`,
      createMetadata(new Map()).api,
    )

    trace.subscriber([change(`insert`, 1, `old generation`), upToDate])
    trace.subscriber([mustRefetch, upToDate])

    await expect(
      trace.collection.utils.awaitMatch(
        (message) =>
          `value` in message && message.value.name === `old generation`,
        20,
      ),
    ).rejects.toThrow(/Timeout waiting for custom match function/)
    await trace.collection.cleanup()
  })
  it(`does not let a committed message satisfy awaitMatch after restart`, async () => {
    const subscribers: Array<(messages: Array<Message<OracleRow>>) => void> = []
    mockSubscribe.mockImplementation((callback) => {
      subscribers.push(callback)
      return vi.fn()
    })
    const collection = createCollection(
      electricCollectionOptions<OracleRow>({
        id: `await-match-lifecycle-generation`,
        shapeOptions: {
          url: `http://test-url`,
          params: { table: `test_table` },
        },
        getKey: (row) => row.id,
        startSync: true,
      }),
    )

    subscribers[0]!([change(`insert`, 1, `old lifecycle`), upToDate])
    await collection.cleanup()
    collection.startSyncImmediate()
    await vi.waitFor(() => expect(subscribers).toHaveLength(2))

    await expect(
      collection.utils.awaitMatch(
        (message) =>
          `value` in message && message.value.name === `old lifecycle`,
        20,
      ),
    ).rejects.toThrow(/Timeout waiting for custom match function/)
    await collection.cleanup()
  })
  for (const syncMode of [`eager`, `on-demand`, `progressive`] as const) {
    it(`does not apply an unseen ${syncMode} update after must-refetch`, async () => {
      const metadata = createMetadata(new Map())
      const trace = createOracleCollection(
        `must-refetch-unseen-${syncMode}`,
        syncMode,
        metadata.api,
      )
      trace.subscriber([change(`insert`, 1, `complete`), upToDate])

      trace.subscriber([mustRefetch, change(`update`, 1, `partial`), upToDate])

      expect(trace.collection.status).toBe(`ready`)
      expect(trace.collection.has(1)).toBe(false)
      await trace.collection.cleanup()
    })

    it(`keeps the ${syncMode} reset marker until the replacement snapshot is complete`, async () => {
      const metadata = createMetadata(resumeState())
      const trace = createOracleCollection(
        `durable-reset-${syncMode}`,
        syncMode,
        metadata.api,
      )

      trace.subscriber([mustRefetch])
      expect(metadata.state.get(`electric:resume`)).toEqual(
        expect.objectContaining({ kind: `reset` }),
      )

      trace.subscriber([change(`insert`, 1, `partial snapshot`), subsetEnd])
      expect(metadata.state.get(`electric:resume`)).toEqual(
        expect.objectContaining({ kind: `reset` }),
      )

      trace.subscriber([
        change(`update`, 2, `unseen`),
        change(`update`, 1, `complete snapshot`),
        upToDate,
      ])
      expect(trace.collection.status).toBe(`ready`)
      expect(trace.collection.get(1)).toEqual(
        expect.objectContaining({
          id: 1,
          name: `complete snapshot`,
          stable: `stable-1`,
        }),
      )
      expect(trace.collection.has(2)).toBe(false)
      expect(metadata.state.get(`electric:resume`)).toEqual(
        expect.objectContaining({ kind: `resume`, offset: `20_0` }),
      )
      await trace.collection.cleanup()
    })
  }
  it(`does not let an older applied receipt finish a newer reset`, async () => {
    const metadata = createMetadata(resumeState())
    const trace = createOracleCollection(
      `overlapping-reset-generations`,
      `eager`,
      metadata.api,
    )
    const persistence = createDeferred<void>()
    const transaction = createTransaction({
      mutationFn: () => persistence.promise,
    })

    trace.subscriber([
      mustRefetch,
      change(`insert`, 1, `first replacement`),
      subsetEnd,
    ])
    transaction.mutate(() =>
      trace.collection.insert({
        id: 99,
        name: `optimistic`,
        stable: `stable-99`,
      }),
    )
    trace.subscriber([upToDate])
    trace.subscriber([mustRefetch])
    await Promise.resolve()

    trace.subscriber([change(`update`, 2, `unseen`), upToDate])

    expect(trace.collection.status).not.toBe(`error`)
    expect(trace.collection.has(2)).toBe(false)

    persistence.resolve()
    await transaction.when('settled')
    await trace.collection.cleanup()
  })
  // Readiness counts accepted rows; they publish when the mutation settles.
  it(`publishes readiness once a held receipt is accepted`, async () => {
    const metadata = createMetadata(new Map())
    const trace = createOracleCollection(
      `deferred-applied-receipt`,
      `eager`,
      metadata.api,
    )
    const persistence = createDeferred<void>()
    const transaction = createTransaction({
      mutationFn: () => persistence.promise,
    })
    transaction.mutate(() =>
      trace.collection.insert({
        id: 99,
        name: `optimistic`,
        stable: `stable-99`,
      }),
    )

    trace.subscriber([change(`insert`, 1, `synced`), upToDate])
    await Promise.resolve()

    expect(trace.collection.status).toBe(`ready`)
    expect(trace.collection.has(1)).toBe(false)

    persistence.resolve()
    await transaction.when('settled')
    await trace.collection.stateWhenReady()

    expect(trace.collection.status).toBe(`ready`)
    expect(trace.collection.get(1)).toEqual(
      expect.objectContaining({ stable: `stable-1` }),
    )
    await trace.collection.cleanup()
  })
  /**
   * Full-mode recovery can accept its complete source snapshot while an
   * optimistic transaction still withholds application. Collection readiness
   * is allowed at acceptance; LoadSubsetFn success must await the applied
   * receipt. The independent obligation is simply pending until the held
   * transaction releases, then exact source-row visibility at settlement.
   *
   * Demand before and after readiness distinguishes an initial-ready gate
   * from the stronger applied-settlement law, including receipts created
   * before the acquisition's own commit cursor. The transaction promise
   * controls application; yielding a turn only drains already queued work.
   */
  it.each([`before-ready`, `after-ready`] as const)(
    `full recovery subset waits for application when acquired %s`,
    async (acquireAt) => {
      const trace = createOracleCollection(
        `full-recovery-applied-${acquireAt}`,
        `on-demand`,
        createMetadata(
          new Map([[`electric:resume`, { kind: `reset`, updatedAt: 1 }]]),
        ).api,
      )
      const persistence = createDeferred<void>()
      const transaction = createTransaction({
        mutationFn: () => persistence.promise,
      })
      transaction.mutate(() =>
        trace.collection.insert({
          id: 99,
          name: `optimistic`,
          stable: `stable-99`,
        }),
      )
      let outcome: `pending` | `fulfilled` | `rejected` = `pending`
      const acquire = () =>
        Promise.resolve(trace.collection._sync.loadSubset({ limit: 1 })).then(
          () => {
            outcome = `fulfilled`
          },
          (error: unknown) => {
            outcome = `rejected`
            throw error
          },
        )
      let loading: Promise<void> | undefined
      await withElectricCleanup(async () => {
        if (acquireAt === `before-ready`) loading = acquire()
        trace.subscriber([change(`insert`, 1, `replacement`), upToDate])
        expect(trace.collection.status).toBe(`ready`)
        if (acquireAt === `after-ready`) loading = acquire()
        void loading!.catch(() => undefined)
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
        expect(trace.collection.has(1), `application is still held`).toBe(false)
        expect(outcome, `ready does not establish subset application`).toBe(
          `pending`,
        )
        persistence.resolve()
        await transaction.when('settled')
        await atCheckpoint(loading!, `full recovery applied settlement`)
        expect(outcome).toBe(`fulfilled`)
        expect(trace.collection.get(1)).toMatchObject({
          id: 1,
          name: `replacement`,
          stable: `stable-1`,
        })
      }, [() => persistence.resolve(), () => trace.collection.cleanup()])
    },
  )
  // A full stream keeps its capability across a same-run must-refetch. Its
  // previous applied snapshot cannot establish newly requested replacement
  // coverage. This continuation rejects a permanently fulfilled startup gate.
  it(`full recovery demand waits again after a same-run reset`, async () => {
    const trace = createOracleCollection(
      `full-recovery-reset`,
      `on-demand`,
      createMetadata(
        new Map([[`electric:resume`, { kind: `reset`, updatedAt: 1 }]]),
      ).api,
    )
    await withElectricCleanup(async () => {
      trace.subscriber([change(`insert`, 1, `first`), upToDate])
      await trace.collection._sync.loadSubset({ limit: 1 })
      trace.subscriber([mustRefetch])
      let outcome = `pending`
      const loading = Promise.resolve(
        trace.collection._sync.loadSubset({ limit: 2 }),
      ).then(
        () => {
          outcome = `fulfilled`
        },
        (error: unknown) => {
          outcome = `rejected`
          throw error
        },
      )
      void loading.catch(() => undefined)
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
      expect(outcome, `prior readiness is not replacement coverage`).toBe(
        `pending`,
      )
      trace.subscriber([change(`insert`, 2, `second`), upToDate])
      await atCheckpoint(loading, `same-run replacement applied`)
      expect(outcome).toBe(`fulfilled`)
      expect(rowsFromCollection(trace.collection)).toEqual([
        [2, `second`, `stable-2`],
      ])
    }, [() => trace.collection.cleanup()])
  })
  /**
   * A scoped source snapshot owes applied settlement at subset-end, even
   * when must-refetch opened a truncate replay. The independent model knows
   * one inserted source row and no other rows; it predicts that a successful
   * demand observes that row. This driver acquires through the real persisted
   * wrapper before reset, delivers a subset-end without up-to-date, and checks
   * public visibility at demand settlement. Full-mode replay's distinct
   * up-to-date obligation is checked by neighboring laws.
   */
  it(`applies a scoped reset subset before its demand succeeds`, async () => {
    let subscriber: ((messages: Array<Message<OracleRow>>) => void) | undefined
    mockSubscribe.mockImplementation((callback) => {
      subscriber = callback
      return vi.fn()
    })
    const adapter = createPersistedAdapter(
      new Map([[`electric:resume`, { kind: `reset`, updatedAt: 1 }]]),
      new Map(),
    )
    // This fixture abstracts physical cache IDs because the law here concerns
    // source settlement. The SQLite generation oracle owns physical isolation.
    let generation = 0
    const claim = (id: string) => ({
      storageCollectionId: `${id}:generation-${generation}`,
      claimId: `claim-${generation}`,
    })
    adapter.claimCacheGeneration = async (id) => claim(id)
    adapter.rotateCacheGeneration = async (id) => {
      generation++
      return claim(id)
    }
    adapter.renewCacheGenerationClaim = async () => Date.now() + 60_000
    adapter.releaseCacheGenerationClaim = async () => {}
    const options = electricCollectionOptions<OracleRow>({
      id: `scoped-reset-applied-settlement`,
      shapeOptions: {
        url: `http://test-url`,
        params: { table: `test_table` },
      },
      syncMode: `on-demand`,
      getKey: (row) => row.id,
      startSync: true,
    })
    const collection = createCollection(
      persistedCollectionOptions<
        OracleRow,
        string | number,
        never,
        ElectricCollectionUtils<OracleRow>
      >({ ...options, persistence: { adapter } }),
    )
    const snapshot = createDeferred<void>()
    mockStream.requestSnapshot.mockReturnValueOnce(snapshot.promise)

    await withElectricCleanup(async () => {
      collection.startSyncImmediate()
      await vi.waitFor(() => expect(subscriber).toBeTypeOf(`function`))
      const demand = Promise.resolve(collection._sync.loadSubset({ limit: 1 }))
      void demand.catch(() => undefined)
      await vi.waitFor(() =>
        expect(mockStream.requestSnapshot).toHaveBeenCalledOnce(),
      )
      subscriber!([mustRefetch])
      subscriber!([change(`insert`, 1, `scoped replacement`), subsetEnd])
      snapshot.resolve()
      await atCheckpoint(demand, `scoped reset applied settlement`)
      expect(collection.get(1)).toMatchObject({
        id: 1,
        name: `scoped replacement`,
        stable: `stable-1`,
      })
    }, [() => snapshot.resolve(), () => collection.cleanup()])
  })
  // Initial failure rejects all current waiters with the original error.
  // Cleanup quietly settles adapter loads and invalidates later callbacks.
  // A provider error alone does not make its future callbacks obsolete;
  // retry semantics are checked by the neighboring recovery laws.
  it.each([`failure`, `cleanup`] as const)(
    `full recovery retires concurrent demand on %s`,
    async (terminal) => {
      const loggedError = vi
        .spyOn(console, `error`)
        .mockImplementation(() => {})
      const trace = createOracleCollection(
        `full-recovery-${terminal}`,
        `on-demand`,
        createMetadata(
          new Map([[`electric:resume`, { kind: `reset`, updatedAt: 1 }]]),
        ).api,
      )
      const sentinel = new Error(`initial full sync failed`)
      const outcomes = [1, 2].map((limit) =>
        Promise.resolve(trace.collection._sync.loadSubset({ limit })).then(
          () => ({ kind: `fulfilled` as const }),
          (error: unknown) => ({ kind: `rejected` as const, error }),
        ),
      )
      await withElectricCleanup(async () => {
        if (terminal === `failure`) {
          const options = vi.mocked(ShapeStream).mock.calls.at(-1)?.[0] as
            | {
                onError?: (error: unknown) => void
              }
            | undefined
          expect(options?.onError).toBeTypeOf(`function`)
          options?.onError?.(sentinel)
        } else await trace.collection.cleanup()
        const results = await atCheckpoint(
          Promise.all(outcomes),
          `terminal full recovery settlement`,
        )
        if (terminal === `failure`) {
          expect(results).toEqual([
            { kind: `rejected`, error: sentinel },
            { kind: `rejected`, error: sentinel },
          ])
          expect(trace.collection.status).toBe(`error`)
        } else {
          expect(results).toEqual([
            { kind: `fulfilled` },
            { kind: `fulfilled` },
          ])
          expect(trace.collection.status).toBe(`cleaned-up`)
          trace.subscriber([change(`insert`, 1, `abandoned`), upToDate])
          expect(trace.collection.has(1)).toBe(false)
        }
      }, [() => trace.collection.cleanup(), () => loggedError.mockRestore()])
    },
  )
  // Each demand owns its cancellation even while full-log source evidence is
  // shared. Aborting one demand ends that load before up-to-date; its sibling
  // and a replacement of the canceled demand still wait for the source
  // snapshot and succeed after the row applies.
  it(`cancels one full recovery demand without settling its sibling`, async () => {
    const trace = createOracleCollection(
      `full-recovery-one-abort`,
      `on-demand`,
      createMetadata(
        new Map([[`electric:resume`, { kind: `reset`, updatedAt: 1 }]]),
      ).api,
    )
    const controller = new AbortController()
    const canceled = Promise.resolve(
      trace.collection._sync.loadSubset({
        limit: 1,
        signal: controller.signal,
      }),
    )
    void canceled.catch(() => undefined)
    let siblingOutcome = `pending`
    const sibling = Promise.resolve(
      trace.collection._sync.loadSubset({ limit: 2 }),
    ).then(
      () => {
        siblingOutcome = `fulfilled`
      },
      () => {
        siblingOutcome = `rejected`
      },
    )

    await withElectricCleanup(async () => {
      controller.abort()
      await expect(
        atCheckpoint(canceled, `canceled full recovery demand`),
      ).rejects.toMatchObject({ name: `AbortError` })
      expect(siblingOutcome).toBe(`pending`)

      // Cancellation cannot mark this predicate complete or poison a later
      // acquisition of the same demand key.
      const replacement = Promise.resolve(
        trace.collection._sync.loadSubset({ limit: 1 }),
      )
      let replacementOutcome = `pending`
      const observedReplacement = replacement.then(
        () => {
          replacementOutcome = `fulfilled`
        },
        () => {
          replacementOutcome = `rejected`
        },
      )
      await Promise.resolve()
      expect(replacementOutcome).toBe(`pending`)

      trace.subscriber([change(`insert`, 1, `source row`), upToDate])
      await atCheckpoint(
        Promise.all([sibling, observedReplacement]),
        `remaining full recovery demands`,
      )
      expect(siblingOutcome).toBe(`fulfilled`)
      expect(replacementOutcome).toBe(`fulfilled`)
      expect(trace.collection.get(1)).toMatchObject({ name: `source row` })
    }, [() => trace.collection.cleanup()])
  })
  // An external ShapeStream abort is a provider failure, not Collection
  // cleanup. It cannot fulfill an in-flight demand or certify its key as
  // loaded when no source snapshot arrived. A second identical demand must
  // therefore remain a failing acquisition rather than deduplicated success.
  it(`does not certify a full recovery demand after external stream abort`, async () => {
    const external = new AbortController()
    const trace = createOracleCollection(
      `full-recovery-external-abort`,
      `on-demand`,
      createMetadata(
        new Map([[`electric:resume`, { kind: `reset`, updatedAt: 1 }]]),
      ).api,
      { signal: external.signal },
    )
    const first = Promise.resolve(
      trace.collection._sync.loadSubset({ limit: 1 }),
    )
    void first.catch(() => undefined)

    await withElectricCleanup(async () => {
      external.abort()
      await expect(
        atCheckpoint(first, `externally aborted full recovery demand`),
      ).rejects.toMatchObject({ name: `StreamAbortedError` })
      const second = trace.collection._sync.loadSubset({ limit: 1 })
      expect(second).not.toBe(true)
      await expect(Promise.resolve(second)).rejects.toMatchObject({
        name: `AbortError`,
      })
      expect(trace.collection.size).toBe(0)
    }, [() => trace.collection.cleanup()])
  })
  // A subset transport may return after the shared stream retires. Its
  // messages cannot apply to that lifecycle, so transport settlement alone
  // cannot certify the demand or its deduplication key.
  it(`does not certify a subset snapshot after external stream abort`, async () => {
    const external = new AbortController()
    const trace = createOracleCollection(
      `subset-external-abort`,
      `on-demand`,
      createMetadata(new Map()).api,
      { signal: external.signal },
    )
    const snapshot = createDeferred<void>()
    mockStream.requestSnapshot.mockReturnValueOnce(snapshot.promise)
    const first = Promise.resolve(
      trace.collection._sync.loadSubset({ limit: 1 }),
    )
    void first.catch(() => undefined)

    await withElectricCleanup(async () => {
      await vi.waitFor(() =>
        expect(mockStream.requestSnapshot).toHaveBeenCalledOnce(),
      )
      external.abort()
      snapshot.resolve()
      await expect(
        atCheckpoint(first, `externally aborted subset snapshot`),
      ).rejects.toMatchObject({ name: `AbortError` })
      const second = trace.collection._sync.loadSubset({ limit: 1 })
      expect(second).not.toBe(true)
      await expect(Promise.resolve(second)).rejects.toMatchObject({
        name: `AbortError`,
      })
      expect(trace.collection.size).toBe(0)
    }, [() => snapshot.resolve(), () => trace.collection.cleanup()])
  })
  // Even a completed transport cannot certify a demand while its accepted
  // source commit is waiting for application. Retiring the stream during that
  // wait leaves no visible source row, so the demand must fail when the held
  // applied receipt finally settles.
  it(`does not certify an externally aborted subset during applied settlement`, async () => {
    const external = new AbortController()
    const trace = createOracleCollection(
      `subset-held-external-abort`,
      `on-demand`,
      createMetadata(new Map()).api,
      { signal: external.signal },
    )
    const persistence = createDeferred<void>()
    const transaction = createTransaction({
      mutationFn: () => persistence.promise,
    })
    transaction.mutate(() =>
      trace.collection.insert({
        id: 99,
        name: `optimistic`,
        stable: `stable-99`,
      }),
    )
    const snapshot = createDeferred<void>()
    mockStream.requestSnapshot.mockReturnValueOnce(snapshot.promise)
    const first = Promise.resolve(
      trace.collection._sync.loadSubset({ limit: 1 }),
    )
    void first.catch(() => undefined)

    await withElectricCleanup(async () => {
      await vi.waitFor(() =>
        expect(mockStream.requestSnapshot).toHaveBeenCalledOnce(),
      )
      trace.subscriber([change(`insert`, 1, `source row`), subsetEnd])
      snapshot.resolve()
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
      expect(trace.collection.has(1), `applied receipt is held`).toBe(false)
      external.abort()
      persistence.resolve()
      await transaction.when('settled')
      await expect(
        atCheckpoint(first, `externally aborted held subset`),
      ).rejects.toMatchObject({ name: `AbortError` })
      const second = trace.collection._sync.loadSubset({ limit: 1 })
      expect(second).not.toBe(true)
      await expect(Promise.resolve(second)).rejects.toMatchObject({
        name: `AbortError`,
      })
      expect(mockStream.requestSnapshot).toHaveBeenCalledOnce()
    }, [
      () => snapshot.resolve(),
      () => persistence.resolve(),
      () => trace.collection.cleanup(),
    ])
  })
  // Application can outlive the SDK request. A caller that releases its
  // demand during that interval must reject promptly, while the source
  // receipt remains held and a later acquisition can still wait for it.
  it(`cancels a subset demand while its source receipt is held`, async () => {
    const trace = createOracleCollection(
      `subset-held-demand-abort`,
      `on-demand`,
      createMetadata(new Map()).api,
    )
    const persistence = createDeferred<void>()
    const transaction = createTransaction({
      mutationFn: () => persistence.promise,
    })
    transaction.mutate(() =>
      trace.collection.insert({
        id: 99,
        name: `optimistic`,
        stable: `stable-99`,
      }),
    )
    const snapshot = createDeferred<void>()
    mockStream.requestSnapshot.mockReturnValueOnce(snapshot.promise)
    const controller = new AbortController()
    const first = Promise.resolve(
      trace.collection._sync.loadSubset({
        limit: 1,
        signal: controller.signal,
      }),
    )
    let firstOutcome: `pending` | `fulfilled` | `rejected` = `pending`
    let firstError: unknown
    const observedFirst = first.then(
      () => {
        firstOutcome = `fulfilled`
      },
      (error: unknown) => {
        firstOutcome = `rejected`
        firstError = error
      },
    )

    await withElectricCleanup(async () => {
      await vi.waitFor(() =>
        expect(mockStream.requestSnapshot).toHaveBeenCalledOnce(),
      )
      trace.subscriber([change(`insert`, 1, `source row`), subsetEnd])
      snapshot.resolve()
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
      expect(trace.collection.has(1)).toBe(false)
      controller.abort()
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
      expect(firstOutcome).toBe(`rejected`)
      expect(firstError).toMatchObject({ name: `AbortError` })
      persistence.resolve()
      await transaction.when('settled')
      await observedFirst
      expect(trace.collection.has(1)).toBe(true)
    }, [
      () => snapshot.resolve(),
      () => persistence.resolve(),
      () => trace.collection.cleanup(),
    ])
  })
  // A demand canceled before its subset transport settles has no successful
  // acquisition, whether that transport later resolves or rejects. The source
  // may still apply a late SDK response, but this caller observes AbortError and
  // an identical later demand remains eligible for a new acquisition.
  it.each([`resolve`, `reject`] as const)(
    `rejects a canceled subset demand when its transport later %ss`,
    async (transportOutcome) => {
      const trace = createOracleCollection(
        `subset-demand-abort-${transportOutcome}`,
        `on-demand`,
        createMetadata(new Map()).api,
      )
      const controller = new AbortController()
      const snapshot = createDeferred<void>()
      mockStream.requestSnapshot.mockReturnValueOnce(snapshot.promise)
      const first = Promise.resolve(
        trace.collection._sync.loadSubset({
          limit: 1,
          signal: controller.signal,
        }),
      )
      void first.catch(() => undefined)

      await withElectricCleanup(async () => {
        await vi.waitFor(() =>
          expect(mockStream.requestSnapshot).toHaveBeenCalledOnce(),
        )
        controller.abort()
        if (transportOutcome === `resolve`) snapshot.resolve()
        else snapshot.reject(new Error(`late provider failure`))
        await expect(
          atCheckpoint(first, `canceled subset ${transportOutcome}`),
        ).rejects.toMatchObject({ name: `AbortError` })
        const second = trace.collection._sync.loadSubset({ limit: 1 })
        expect(second).not.toBe(true)
        await expect(
          atCheckpoint(
            Promise.resolve(second).then(() => undefined),
            `fresh subset after ${transportOutcome} and caller abort`,
          ),
        ).resolves.toBeUndefined()
        expect(mockStream.requestSnapshot).toHaveBeenCalledTimes(2)
      }, [() => snapshot.resolve(), () => trace.collection.cleanup()])
    },
  )
  // Snapshot responses share one SDK cursor, but a queued demand owns its
  // cancellation independently of the request ahead of it. At the next task
  // boundary after abort, this caller must have rejected without invoking a
  // second SDK request; the first demand remains pending until its response.
  it(`cancels a queued subset demand while an earlier snapshot is held`, async () => {
    const trace = createOracleCollection(
      `queued-subset-abort`,
      `on-demand`,
      createMetadata(new Map()).api,
    )
    const held = createDeferred<void>()
    mockStream.requestSnapshot.mockReturnValueOnce(held.promise)
    const first = Promise.resolve(
      trace.collection._sync.loadSubset({ limit: 1 }),
    )
    const controller = new AbortController()
    let secondOutcome: `pending` | `fulfilled` | `rejected` = `pending`
    let secondError: unknown
    const second = Promise.resolve(
      trace.collection._sync.loadSubset({
        limit: 2,
        signal: controller.signal,
      }),
    ).then(
      () => {
        secondOutcome = `fulfilled`
      },
      (error: unknown) => {
        secondOutcome = `rejected`
        secondError = error
      },
    )

    await withElectricCleanup(async () => {
      await vi.waitFor(() =>
        expect(mockStream.requestSnapshot).toHaveBeenCalledOnce(),
      )
      controller.abort()
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
      expect(secondOutcome).toBe(`rejected`)
      expect(secondError).toMatchObject({ name: `AbortError` })
      expect(mockStream.requestSnapshot).toHaveBeenCalledOnce()
      held.resolve()
      await atCheckpoint(Promise.all([first, second]), `queued abort drain`)
    }, [() => held.resolve(), () => trace.collection.cleanup()])
  })
  it(`drops a held receipt's rows when cleanup abandons it`, async () => {
    const metadata = createMetadata(new Map())
    const trace = createOracleCollection(
      `rejected-applied-receipt`,
      `eager`,
      metadata.api,
    )
    const persistence = createDeferred<void>()
    const transaction = createTransaction({
      mutationFn: () => persistence.promise,
    })
    transaction.mutate(() =>
      trace.collection.insert({
        id: 99,
        name: `optimistic`,
        stable: `stable-99`,
      }),
    )
    trace.subscriber([change(`insert`, 1, `synced`), upToDate])
    await Promise.resolve()
    expect(trace.collection.status).toBe(`ready`)

    await trace.collection.cleanup()
    persistence.resolve()
    await transaction.when('settled')
    await Promise.resolve()

    expect(trace.collection.status).toBe(`cleaned-up`)
    expect(trace.collection._lifecycle.getSyncError()).toBeUndefined()
    expect(trace.collection.has(1)).toBe(false)
  })
  it(`accepts partial resumed updates for rows restored by persistence`, async () => {
    let subscriber!: (messages: Array<Message<OracleRow>>) => void
    mockSubscribe.mockImplementationOnce((callback) => {
      subscriber = callback
      return vi.fn()
    })
    const collectionMetadata = new Map(resumeState())
    const persistedRows = new Map<string | number, OracleRow>([
      [
        1,
        {
          id: 1,
          name: `persisted`,
          stable: `stable-1`,
        },
      ],
    ])
    const electricOptions = electricCollectionOptions<OracleRow>({
      id: `persisted-resume-oracle`,
      shapeOptions: {
        url: `http://test-url`,
        params: { table: `test_table` },
      },
      syncMode: `progressive`,
      getKey: (row) => row.id,
      startSync: true,
    })
    const collection = createCollection(
      persistedCollectionOptions<
        OracleRow,
        string | number,
        never,
        ElectricCollectionUtils<OracleRow>
      >({
        ...electricOptions,
        persistence: {
          adapter: createPersistedAdapter(collectionMetadata, persistedRows),
        },
      }),
    )

    collection.startSyncImmediate()
    await collection._sync.loadSubset({ limit: 10 })
    expect(collection.get(1)).toEqual(
      expect.objectContaining({ name: `persisted`, stable: `stable-1` }),
    )
    expect(vi.mocked(ShapeStream).mock.calls.at(-1)?.[0]).toMatchObject({
      offset: `10_0`,
      handle: `shape-1`,
    })

    subscriber([change(`update`, 1, `resumed update`), upToDate])
    await vi.waitFor(() => expect(collection.status).toBe(`ready`))

    expect(collection.get(1)).toEqual(
      expect.objectContaining({
        name: `resumed update`,
        stable: `stable-1`,
      }),
    )
    await vi.waitFor(() => {
      expect(persistedRows.get(1)).toEqual(
        expect.objectContaining({
          name: `resumed update`,
          stable: `stable-1`,
        }),
      )
    })
    await collection.cleanup()
  })
  it(`buffers resumed updates that arrive while persisted rows are hydrating`, async () => {
    let subscriber: ((messages: Array<Message<OracleRow>>) => void) | undefined
    mockSubscribe.mockImplementationOnce((callback) => {
      subscriber = callback
      return vi.fn()
    })
    const hydration = createDeferred<void>()
    const collectionMetadata = new Map(resumeState())
    const persistedRows = new Map<string | number, OracleRow>([
      [
        1,
        {
          id: 1,
          name: `persisted`,
          stable: `stable-1`,
        },
      ],
    ])
    const electricOptions = electricCollectionOptions<OracleRow>({
      id: `concurrent-persisted-resume-oracle`,
      shapeOptions: {
        url: `http://test-url`,
        params: { table: `test_table` },
      },
      syncMode: `progressive`,
      getKey: (row) => row.id,
      startSync: true,
    })
    const collection = createCollection(
      persistedCollectionOptions<
        OracleRow,
        string | number,
        never,
        ElectricCollectionUtils<OracleRow>
      >({
        ...electricOptions,
        persistence: {
          adapter: createPersistedAdapter(
            collectionMetadata,
            persistedRows,
            hydration.promise,
          ),
        },
      }),
    )

    collection.startSyncImmediate()
    await vi.waitFor(() => expect(subscriber).toBeTypeOf(`function`))
    expect(collection.status).not.toBe(`error`)
    subscriber!([change(`update`, 1, `concurrent update`), upToDate])

    expect(collection.status).not.toBe(`error`)
    hydration.resolve()
    await vi.waitFor(() => expect(collection.status).toBe(`ready`))
    expect(collection.get(1)).toEqual(
      expect.objectContaining({
        name: `concurrent update`,
        stable: `stable-1`,
      }),
    )
    await collection.cleanup()
  })
  it(`rehydrates persisted rows and resume metadata after cleanup and restart`, async () => {
    const subscribers: Array<(messages: Array<Message<OracleRow>>) => void> = []
    mockSubscribe.mockImplementation((callback) => {
      subscribers.push(callback)
      return vi.fn()
    })
    const collectionMetadata = new Map(resumeState())
    const persistedRows = new Map<string | number, OracleRow>([
      [1, { id: 1, name: `persisted`, stable: `stable-1` }],
    ])
    const collection = createCollection(
      persistedCollectionOptions<
        OracleRow,
        string | number,
        never,
        ElectricCollectionUtils<OracleRow>
      >({
        ...electricCollectionOptions<OracleRow>({
          id: `persisted-restart-oracle`,
          shapeOptions: {
            url: `http://test-url`,
            params: { table: `test_table` },
          },
          syncMode: `progressive`,
          getKey: (row) => row.id,
          startSync: true,
        }),
        persistence: {
          adapter: createPersistedAdapter(collectionMetadata, persistedRows),
        },
      }),
    )

    collection.startSyncImmediate()
    await vi.waitFor(() => expect(collection.get(1)?.name).toBe(`persisted`))
    await vi.waitFor(() => expect(subscribers).toHaveLength(1))
    subscribers[0]!([upToDate])
    await collection.stateWhenReady()

    await collection.cleanup()
    collection.startSyncImmediate()
    await vi.waitFor(() => expect(subscribers).toHaveLength(2))
    await vi.waitFor(() => expect(collection.get(1)?.name).toBe(`persisted`))
    expect(collectionMetadata.get(`electric:resume`)).toEqual(
      expect.objectContaining({ kind: `resume` }),
    )
    await collection.cleanup()
  })
  it(`does not let hydration from a cleaned-up lifecycle poison restart`, async () => {
    const subscribers: Array<(messages: Array<Message<OracleRow>>) => void> = []
    mockSubscribe.mockImplementation((callback) => {
      subscribers.push(callback)
      return vi.fn()
    })
    const firstHydration = createDeferred<void>()
    const collectionMetadata = new Map(resumeState())
    const persistedRows = new Map<string | number, OracleRow>([
      [1, { id: 1, name: `current`, stable: `stable-1` }],
    ])
    const adapter = createPersistedAdapter(collectionMetadata, persistedRows)
    const loadResumeSnapshot = adapter.loadResumeSnapshot
    let hydrationCall = 0
    adapter.loadResumeSnapshot = vi.fn(async (collectionId, ctx) => {
      const snapshot = await loadResumeSnapshot(collectionId, ctx)
      if (ctx?.includeRows === false) return snapshot
      hydrationCall++
      if (hydrationCall === 1) {
        await firstHydration.promise
        return {
          ...snapshot,
          rows: [
            {
              key: 1,
              value: { id: 1, name: `stale`, stable: `stable-1` },
            },
          ],
        }
      }
      return snapshot
    })
    const collection = createCollection(
      persistedCollectionOptions<
        OracleRow,
        string | number,
        never,
        ElectricCollectionUtils<OracleRow>
      >({
        ...electricCollectionOptions<OracleRow>({
          id: `persisted-stale-hydration-oracle`,
          shapeOptions: {
            url: `http://test-url`,
            params: { table: `test_table` },
          },
          syncMode: `progressive`,
          getKey: (row) => row.id,
          startSync: true,
        }),
        persistence: { adapter },
      }),
    )

    collection.startSyncImmediate()
    await vi.waitFor(() => expect(hydrationCall).toBe(1))
    await collection.cleanup()
    collection.startSyncImmediate()
    await vi.waitFor(() => expect(subscribers).toHaveLength(2))

    firstHydration.resolve()
    await vi.waitFor(() => expect(hydrationCall).toBe(2))
    await vi.waitFor(() => expect(collection.get(1)?.name).toBe(`current`))
    subscribers[1]!([upToDate])
    await collection.stateWhenReady()
    await collection.cleanup()
  })
  it(`does not hydrate persisted on-demand rows before subset demand`, async () => {
    let subscriber: ((messages: Array<Message<OracleRow>>) => void) | undefined
    mockSubscribe.mockImplementationOnce((callback) => {
      subscriber = callback
      return vi.fn()
    })
    const collectionMetadata = new Map<string, unknown>()
    const persistedRows = new Map<string | number, OracleRow>([
      [1, { id: 1, name: `persisted`, stable: `stable-1` }],
    ])
    const adapter = createPersistedAdapter(collectionMetadata, persistedRows)
    const loadSubset = vi.fn(adapter.loadSubset)
    adapter.loadSubset = loadSubset
    const electricOptions = electricCollectionOptions<OracleRow>({
      id: `persisted-on-demand-oracle`,
      shapeOptions: {
        url: `http://test-url`,
        params: { table: `test_table` },
      },
      syncMode: `on-demand`,
      getKey: (row) => row.id,
      startSync: true,
    })
    const collection = createCollection(
      persistedCollectionOptions<
        OracleRow,
        string | number,
        never,
        ElectricCollectionUtils<OracleRow>
      >({
        ...electricOptions,
        persistence: { adapter },
      }),
    )

    collection.startSyncImmediate()
    await vi.waitFor(() => expect(subscriber).toBeTypeOf(`function`))
    subscriber!([upToDate])
    await vi.waitFor(() => expect(collection.status).toBe(`ready`))

    expect(loadSubset).not.toHaveBeenCalled()
    expect(collection.has(1)).toBe(false)
    await collection.cleanup()
  })
  it.each(
    [`reset`, `delete`, `move-out`].flatMap((removal) =>
      [`none`, `before-commit`, `after-commit`].map((acquire) => ({
        removal,
        acquire,
      })),
    ),
  )(
    `keeps removed rows unknown across $removal and subset acquisition $acquire`,
    async ({ removal, acquire }) => {
      const trace = createOracleCollection(
        `presence-${removal}-${acquire}`,
        `on-demand`,
        createMetadata(new Map()).api,
      )
      const snapshot = createDeferred<void>()
      mockStream.requestSnapshot.mockReturnValueOnce(snapshot.promise)
      let acquired: Promise<unknown> | undefined
      const request = () => {
        acquired = Promise.resolve(
          trace.collection._sync.loadSubset({
            where: new IR.Func(`eq`, [new IR.PropRef([`id`]), new IR.Value(2)]),
          }),
        )
        expect(mockStream.requestSnapshot).toHaveBeenCalledOnce()
      }
      try {
        const inserted = change(`insert`, 1, `complete`)
        trace.subscriber([
          { ...inserted, headers: { ...inserted.headers, tags: [`left`] } },
          upToDate,
        ])
        expect(trace.collection.get(1)?.stable).toBe(`stable-1`)
        const removed: Message<OracleRow> =
          removal === `reset`
            ? mustRefetch
            : removal === `delete`
              ? change(`delete`, 1, `complete`)
              : ({
                  headers: {
                    event: `move-out`,
                    patterns: [{ pos: 0, value: `left` }],
                  },
                } as Message<OracleRow>)
        trace.subscriber([removed])
        if (acquire === `before-commit`) request()
        trace.subscriber([subsetEnd])
        expect(trace.collection.has(1)).toBe(false)
        if (acquire === `after-commit`) request()
        snapshot.resolve()
        await acquired
        trace.subscriber([change(`update`, 1, `partial`), upToDate])
        expect(trace.collection.has(1)).toBe(false)
      } finally {
        snapshot.resolve()
        await trace.collection.cleanup()
        await acquired
      }
    },
  )
  it(`applies on-demand catch-up updates to hydrated persisted rows`, async () => {
    let subscriber!: (messages: Array<Message<OracleRow>>) => void
    mockSubscribe.mockImplementationOnce((callback) => {
      subscriber = callback
      return vi.fn()
    })
    const collectionMetadata = new Map(resumeState())
    const persistedRows = new Map<string | number, OracleRow>([
      [1, { id: 1, name: `persisted`, stable: `stable-1` }],
    ])
    const collection = createCollection(
      persistedCollectionOptions<
        OracleRow,
        string | number,
        never,
        ElectricCollectionUtils<OracleRow>
      >({
        ...electricCollectionOptions<OracleRow>({
          id: `on-demand-persisted-catch-up`,
          shapeOptions: {
            url: `http://test-url`,
            params: { table: `test_table` },
          },
          syncMode: `on-demand`,
          getKey: (row) => row.id,
          startSync: true,
        }),
        persistence: {
          adapter: createPersistedAdapter(collectionMetadata, persistedRows),
        },
      }),
    )

    collection.startSyncImmediate()
    await vi.waitFor(() => expect(subscriber).toBeTypeOf(`function`))
    await collection._sync.loadSubset({})
    subscriber([change(`update`, 1, `caught up`), upToDate])
    await vi.waitFor(() => expect(collection.status).toBe(`ready`))

    expect(collection.get(1)).toEqual(
      expect.objectContaining({ name: `caught up`, stable: `stable-1` }),
    )
    expect(collectionMetadata.get(`electric:resume`)).toEqual(
      expect.objectContaining({ kind: `resume`, offset: `20_0` }),
    )
    await collection.cleanup()
  })
  it.each([
    {
      name: `malformed`,
      seed: new Map<string, unknown>([
        [
          `electric:resume`,
          {
            kind: `resume`,
            requiresTagState: false,
            offset: 10,
            handle: `shape-1`,
            shapeId,
            updatedAt: 1,
          },
        ],
      ]),
    },
    {
      name: `reset`,
      seed: new Map<string, unknown>([
        [`electric:resume`, { kind: `reset`, updatedAt: 1 }],
      ]),
    },
    {
      name: `incompatible`,
      seed: new Map<string, unknown>([
        [
          `electric:resume`,
          {
            kind: `resume`,
            requiresTagState: false,
            offset: `10_0`,
            handle: `shape-1`,
            shapeId: `different-shape`,
            updatedAt: 1,
          },
        ],
      ]),
    },
  ])(`starts a full snapshot for $name resume metadata`, async ({ seed }) => {
    const metadata = createMetadata(seed)
    const trace = createOracleCollection(
      `non-resumable-metadata`,
      `eager`,
      metadata.api,
    )

    expect(vi.mocked(ShapeStream).mock.calls.at(-1)?.[0]).toMatchObject({
      offset: undefined,
      handle: undefined,
    })
    trace.subscriber([change(`insert`, 1, `full snapshot`), upToDate])

    expect(trace.collection.status).toBe(`ready`)
    expect(trace.collection.get(1)).toEqual(
      expect.objectContaining({ stable: `stable-1` }),
    )
    expect(metadata.state.get(`electric:resume`)).toEqual(
      expect.objectContaining({ kind: `resume`, offset: `20_0` }),
    )
    await trace.collection.cleanup()
  })
  it(`does not mix an explicit resume option with persisted metadata`, async () => {
    const metadata = createMetadata(resumeState())
    const trace = createOracleCollection(
      `explicit-resume`,
      `on-demand`,
      metadata.api,
      { handle: `explicit-handle` },
    )

    expect(vi.mocked(ShapeStream).mock.calls.at(-1)?.[0]).toMatchObject({
      offset: `now`,
      handle: `explicit-handle`,
    })
    trace.subscriber([upToDate])
    expect(trace.collection.status).toBe(`ready`)
    await trace.collection.cleanup()
  })
  // An explicit source cursor owns this run's resume decision. A malformed
  // durable record is still invalid for a later implicit run, but it cannot
  // authorize this run to write a reset before any source evidence arrives.
  // The metadata Map observes that side effect at startup, before up-to-date
  // can legitimately stage a fresh resume record.
  it.each([
    { name: `offset`, options: { offset: `10_0` as Offset } },
    { name: `handle`, options: { handle: `explicit-handle` } },
  ])(
    `leaves malformed durable resume untouched with explicit $name`,
    async ({ options }) => {
      const malformed = { kind: `resume`, offset: 10, handle: `stale` }
      const metadata = createMetadata(new Map([[`electric:resume`, malformed]]))
      const trace = createOracleCollection(
        `explicit-malformed-${options}`,
        `on-demand`,
        metadata.api,
        options,
      )
      try {
        expect(metadata.state.get(`electric:resume`)).toBe(malformed)
      } finally {
        await trace.collection.cleanup()
      }
    },
  )
  it(`lets an equal-timestamp reset dominate a stale hydrated resume`, async () => {
    let subscriber!: (messages: Array<Message<OracleRow>>) => void
    mockSubscribe.mockImplementationOnce((callback) => {
      subscriber = callback
      return vi.fn()
    })
    const options = electricCollectionOptions<OracleRow>({
      id: `equal-timestamp-reset`,
      shapeOptions: {
        url: `http://test-url`,
        params: { table: `test_table` },
      },
      getKey: (row) => row.id,
      startSync: true,
    })
    options.sync.importSyncMeta?.({
      version: 1,
      resume: {
        kind: `resume`,
        requiresTagState: false,
        offset: `10_0`,
        handle: `stale-handle`,
        shapeId,
        updatedAt: 1,
      },
      seenTxids: [],
    })
    const originalSync = options.sync
    const metadata = createMetadata(
      new Map([[`electric:resume`, { kind: `reset`, updatedAt: 1 }]]),
    )
    const collection = createCollection({
      ...options,
      sync: {
        ...originalSync,
        sync: (params: Parameters<typeof originalSync.sync>[0]) =>
          originalSync.sync({ ...params, metadata: metadata.api }),
      },
    })

    expect(vi.mocked(ShapeStream).mock.calls.at(-1)?.[0]).toMatchObject({
      offset: undefined,
      handle: undefined,
    })
    subscriber([change(`insert`, 1, `full snapshot`), upToDate])
    expect(collection.status).toBe(`ready`)
    await collection.cleanup()
  })
  it(`retains the selected tag requirement when timestamps establish an order`, () => {
    const merge = electricCollectionOptions<OracleRow>({
      shapeOptions: {
        url: `http://test-url`,
        params: { table: `test_table` },
      },
      getKey: (row) => row.id,
    }).sync.mergeSyncMeta!
    for (const olderTag of [undefined, false, true]) {
      for (const newerTag of [undefined, false, true]) {
        const state = (updatedAt: number, tag: boolean | undefined) => ({
          version: 1,
          seenTxids: [updatedAt],
          resume: {
            kind: `resume`,
            offset: `10_0`,
            handle: `shape-1`,
            shapeId,
            updatedAt,
            ...(tag === undefined ? {} : { requiresTagState: tag }),
          },
        })
        const older = state(1, olderTag)
        const newer = state(2, newerTag)
        const expected = { ...newer, seenTxids: [1, 2] }
        expect(merge(older, newer)).toEqual(expected)
        expect(merge(newer, older)).toEqual(expected)
      }
    }
  })
  it(`rejects an unseen partial update from an explicit eager resume`, async () => {
    const metadata = createMetadata(resumeState())
    const trace = createOracleCollection(
      `explicit-eager-resume`,
      `eager`,
      metadata.api,
      { offset: `10_0` as Offset, handle: `explicit-handle` },
    )

    trace.subscriber([change(`update`, 1, `partial`), upToDate])

    expect(trace.collection.status).toBe(`error`)
    expect(trace.collection.has(1)).toBe(false)
    expect(metadata.state.get(`electric:resume`)).toEqual(
      expect.objectContaining({ kind: `reset` }),
    )
    await trace.collection.cleanup()
  })
  it(`accepts complete replica updates from an explicit eager resume`, async () => {
    let subscriber!: (messages: Array<Message<OracleRow>>) => void
    mockSubscribe.mockImplementationOnce((callback) => {
      subscriber = callback
      return vi.fn()
    })
    const collection = createCollection(
      electricCollectionOptions<OracleRow>({
        id: `explicit-full-replica-resume`,
        shapeOptions: {
          url: `http://test-url`,
          params: { table: `test_table`, replica: `full` },
          offset: `10_0` as Offset,
          handle: `explicit-handle`,
        },
        syncMode: `eager`,
        getKey: (row) => row.id,
        startSync: true,
      }),
    )

    subscriber([
      {
        key: `1`,
        value: { id: 1, name: `complete update`, stable: `stable-1` },
        headers: { operation: `update` },
      },
      upToDate,
    ])

    expect(collection.status).toBe(`ready`)
    expect(collection.get(1)).toEqual(
      expect.objectContaining({
        name: `complete update`,
        stable: `stable-1`,
      }),
    )
    await collection.cleanup()
  })
  it.each([10, 100])(
    `subset acquisition avoids scanning the applied baseline with %s rows`,
    async (size) => {
      const trace = createOracleCollection(
        `acquisition-work`,
        `on-demand`,
        createMetadata(new Map()).api,
      )
      try {
        trace.subscriber([
          ...Array.from({ length: size }, (_, id) =>
            change(`insert`, id, `row`),
          ),
          upToDate,
        ])
        await trace.collection._sync.loadSubset({})
        const keys = vi.spyOn(trace.collection._state.syncedData, `keys`)
        try {
          for (let i = 0; i < 3; i++)
            await trace.collection._sync.loadSubset({})
          expect(keys).not.toHaveBeenCalled()
          for (let i = 0; i < 3; i++)
            await trace.collection._sync.loadSubset({
              where: new IR.Func(`eq`, [
                new IR.PropRef([`id`]),
                new IR.Value(size + i),
              ]),
            })
          expect(keys).not.toHaveBeenCalled()
          expect(mockStream.requestSnapshot).toHaveBeenCalledTimes(4)
        } finally {
          keys.mockRestore()
        }
      } finally {
        await trace.collection.cleanup()
      }
    },
  )
  it(`ignores an unseen on-demand update without blocking readiness`, async () => {
    const metadata = createMetadata(resumeState())
    const trace = createOracleCollection(
      `on-demand-unseen-update`,
      `on-demand`,
      metadata.api,
    )

    trace.subscriber([change(`update`, 1, `partial`), upToDate])

    expect(trace.collection.status).toBe(`ready`)
    expect(trace.collection.has(1)).toBe(false)
    expect(metadata.state.get(`electric:resume`)).toEqual(
      expect.objectContaining({ kind: `resume`, offset: `20_0` }),
    )
    await trace.collection.cleanup()
  })
  it(`records match and txid evidence for an ignored on-demand update`, async () => {
    const trace = createOracleCollection(
      `on-demand-ignored-update-evidence`,
      `on-demand`,
      createMetadata(resumeState()).api,
    )
    trace.subscriber([upToDate])

    const pendingMatch = trace.collection.utils.awaitMatch(
      (message) => `value` in message && message.value.id === 808,
      100,
    )
    const pendingTxid = trace.collection.utils.awaitTxId(808, 100)
    const update = change(`update`, 808, `ignored`)
    update.headers.txids = [808]

    trace.subscriber([update, upToDate])

    await Promise.all([
      expect(pendingMatch).resolves.toBe(true),
      expect(pendingTxid).resolves.toBe(true),
    ])
    expect(trace.collection.has(808)).toBe(false)
    await trace.collection.cleanup()
  })
})
