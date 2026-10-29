import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ShapeStream } from '@electric-sql/client'
import {
  IR,
  createCollection,
  createLiveQueryCollection,
  createTransaction,
  gt,
  withAcceptedReceipt,
} from '@tanstack/db'
import { persistedCollectionOptions } from '../../db-sqlite-persistence-core/src'
import { electricCollectionOptions, isChangeMessage } from '../src/electric'
import { stripVirtualProps } from '../../db/tests/utils'
import { createMockStream } from './electric-stream-mock'
import type { PersistedStorageTarget } from '../../db-sqlite-persistence-core/src'
import type { ElectricCollectionUtils } from '../src/electric'
import type {
  Collection,
  InsertMutationFnParams,
  MutationFnParams,
  PendingMutation,
  SyncMetadataApi,
  Transaction,
} from '@tanstack/db'
import type { Message, Row } from '@electric-sql/client'
import type { StandardSchemaV1 } from '@standard-schema/spec'

const NativeAbortController = globalThis.AbortController

function createDeferred<T>(): {
  promise: Promise<T>
  resolve: (value: T | PromiseLike<T>) => void
} {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

// Mock the ShapeStream module
const mockSubscribe = vi.fn()
const mockRequestSnapshot = vi.fn()
const mockFetchSnapshot = vi.fn()
const mockForceDisconnectAndRefresh = vi.fn()
const mockStream = {
  subscribe: mockSubscribe,
  unsubscribeAll: vi.fn(),
  requestSnapshot: mockRequestSnapshot,
  fetchSnapshot: mockFetchSnapshot,
  forceDisconnectAndRefresh: mockForceDisconnectAndRefresh,
  isUpToDate: false,
  shapeHandle: undefined as string | undefined,
  lastOffset: `-1` as string,
}

vi.mock(`@electric-sql/client`, async () => {
  const actual = await vi.importActual(`@electric-sql/client`)
  return {
    ...actual,
    ShapeStream: vi.fn(function () {
      return createMockStream(mockStream)
    }),
  }
})

describe(`Electric stream mock`, () => {
  beforeEach(() => vi.clearAllMocks())

  it.each([false, true])(
    `retires its mock callback when release occurs during subscribe: %s`,
    (duringSubscribe) => {
      const stream = createMockStream(mockStream)
      const release = vi.fn()
      mockSubscribe.mockImplementationOnce(() => {
        if (duringSubscribe) stream.unsubscribeAll()
        return release
      })
      stream.subscribe(() => {})
      if (!duringSubscribe) stream.unsubscribeAll()
      expect(release).toHaveBeenCalledOnce()
    },
  )
})

describe(`Electric Integration`, () => {
  let collection: Collection<
    Row,
    string | number,
    ElectricCollectionUtils,
    StandardSchemaV1<unknown, unknown>,
    Row
  >
  let subscriber: (messages: Array<Message<Row>>) => void

  const stripCollectionState = (state: Map<string | number, Row>) =>
    new Map(
      Array.from(state.entries(), ([key, value]) => [
        key,
        stripVirtualProps(value),
      ]),
    )

  const createInMemorySyncMetadataApi = (
    seed?: ReadonlyMap<string, unknown>,
  ): {
    api: SyncMetadataApi<string | number>
    collectionMetadata: Map<string, unknown>
  } => {
    const collectionMetadata = new Map(seed)
    return {
      collectionMetadata,
      api: {
        persistence: null,
        row: {
          get: () => undefined,
          set: () => {},
          delete: () => {},
        },
        collection: {
          get: (key) => collectionMetadata.get(key),
          set: (key, value) => {
            collectionMetadata.set(key, value)
          },
          delete: (key) => {
            collectionMetadata.delete(key)
          },
          list: (prefix) =>
            Array.from(collectionMetadata.entries())
              .filter(([key]) => (prefix ? key.startsWith(prefix) : true))
              .map(([key, value]) => ({ key, value })),
        },
      },
    }
  }

  const createPersistedAdapter = (
    collectionMetadata?: Map<string, unknown>,
    rows: Map<string | number, Row> = new Map(),
  ) => ({
    loadSubset: () =>
      Promise.resolve(
        Array.from(rows.entries()).map(([key, value]) => ({ key, value })),
      ),
    loadResumeSnapshot: (
      _target: PersistedStorageTarget,
      options?: { includeRows?: boolean },
    ) =>
      Promise.resolve({
        rows:
          options?.includeRows === false
            ? []
            : Array.from(rows.entries()).map(([key, value]) => ({
                key,
                value,
              })),
        keySet: { status: `consistent` as const },
        collectionMetadata: Array.from(
          (collectionMetadata ?? new Map()).entries(),
          ([key, value]) => ({ key, value }),
        ),
        latestTerm: 0,
        latestSeq: 0,
        latestRowVersion: 0,
        resetEpoch: 0,
      }),
    loadCollectionMetadata: () =>
      Promise.resolve(
        Array.from((collectionMetadata ?? new Map()).entries()).map(
          ([key, value]) => ({
            key,
            value,
          }),
        ),
      ),
    applyCommittedTx: (_target: PersistedStorageTarget, tx: any) => {
      for (const mutation of tx.collectionMetadataMutations ?? []) {
        if (mutation.type === `delete`) {
          collectionMetadata?.delete(mutation.key)
        } else {
          collectionMetadata?.set(mutation.key, mutation.value)
        }
      }
      if (tx.truncate) {
        rows.clear()
      }
      for (const mutation of tx.mutations ?? []) {
        if (mutation.type === `delete`) {
          rows.delete(mutation.key)
        } else {
          rows.set(mutation.key, mutation.value)
        }
      }
      return Promise.resolve()
    },
    ensureIndex: () => Promise.resolve(),
  })

  beforeEach(() => {
    vi.clearAllMocks()

    // Reset mock subscriber
    mockSubscribe.mockImplementation((callback) => {
      subscriber = callback
      return () => {}
    })

    // Reset mock requestSnapshot
    mockRequestSnapshot.mockResolvedValue(undefined)
    mockForceDisconnectAndRefresh.mockResolvedValue(undefined)
    mockStream.isUpToDate = false
    mockStream.shapeHandle = undefined
    mockStream.lastOffset = `-1`

    // Create collection with Electric configuration
    const config = {
      id: `test`,
      shapeOptions: {
        url: `http://test-url`,
        params: {
          table: `test_table`,
        },
      },
      startSync: true,
      getKey: (item: Row) => item.id as number,
    }

    // Get the options with utilities
    const options = electricCollectionOptions(config)

    // Create collection with Electric configuration using the new utility exposure pattern
    collection = createCollection(options) as unknown as Collection<
      Row,
      string | number,
      ElectricCollectionUtils,
      StandardSchemaV1<unknown, unknown>,
      Row
    >
  })

  it(`should commit an empty transaction when there's an up-to-date`, () => {
    expect(collection.status).toEqual(`loading`)
    expect(collection.state).toEqual(new Map([]))

    // Send up-to-date control message to commit transaction
    subscriber([
      {
        headers: { control: `up-to-date` },
      },
    ])
    expect(collection.state).toEqual(new Map([]))
    expect(collection.status).toEqual(`ready`)
  })

  // A reload runs `sync` again while the Collection still shows `error`.
  // The new stream's outcome, not that status, decides the reload.
  it.each([`up-to-date`, `stream error`] as const)(
    `settles a reload after a failed first load: new stream %s`,
    async (outcome) => {
      const loggedError = vi
        .spyOn(console, `error`)
        .mockImplementation(() => {})
      const lastStreamOptions = () =>
        vi.mocked(ShapeStream).mock.calls.at(-1)?.[0] as
          { onError?: (error: unknown) => void } | undefined
      try {
        const preload = collection.preload()
        lastStreamOptions()?.onError?.(new Error(`initial stream failed`))
        await preload.catch(() => undefined)
        expect(collection.status).toBe(`error`)

        const reload = collection.reload().then(
          () => `resolved`,
          () => `rejected`,
        )
        if (outcome === `up-to-date`)
          subscriber([{ headers: { control: `up-to-date` } }])
        else lastStreamOptions()?.onError?.(new Error(`reload stream failed`))
        const settled = await Promise.race([
          reload,
          new Promise((resolve) => setTimeout(() => resolve(`pending`), 200)),
        ])
        expect(settled).toBe(outcome === `up-to-date` ? `resolved` : `rejected`)
        expect(collection.status).toBe(
          outcome === `up-to-date` ? `ready` : `error`,
        )
      } finally {
        loggedError.mockRestore()
      }
    },
  )

  // Receiving witness for the reload law (owner: the source-health oracle).
  // A reload keeps the rows on screen until it completes and then ends with
  // the source's current rows. The new run replaces rows only with a
  // snapshot transaction or its own truncate; every other write applies on
  // the kept rows, and a run that sends no snapshot completes the reload at
  // its markReady (maintainer decision F19, /tmp/unify/snapshot-api.md §2–3).
  //
  // The fake source is the model: a table and a log of its changes. A stream
  // that starts from a stored offset and handle gets the log after that
  // offset, then up-to-date; one that starts without them gets every row,
  // then up-to-date. A must-refetch makes the stream start over with every
  // row. Electric stores the offset and handle of its last up-to-date only
  // when the server sent a handle, so `handle: false` reaches a reload that
  // cannot resume.
  describe(`reload of a ready Collection`, () => {
    type SourceChange = {
      operation: `insert` | `update` | `delete`
      value: Row
    }
    const initialRows: Array<Row> = [
      { id: 1, name: `one` },
      { id: 2, name: `two` },
      { id: 3, name: `three` },
    ]
    const changesDuringReload: Array<SourceChange> = [
      { operation: `update`, value: { id: 1, name: `one, edited` } },
      { operation: `delete`, value: { id: 2 } },
      { operation: `insert`, value: { id: 4, name: `four` } },
    ]

    it.each([
      { stream: `resumes with no changes`, handle: true, changes: [] },
      {
        stream: `resumes with changes`,
        handle: true,
        changes: changesDuringReload,
      },
      {
        stream: `cannot resume and sends every row`,
        handle: false,
        changes: changesDuringReload,
      },
      {
        stream: `resumes and gets a must-refetch`,
        handle: true,
        changes: changesDuringReload,
        mustRefetch: true,
      },
    ])(
      `keeps its rows until it completes and ends with the source's rows: the new stream $stream`,
      async ({ handle, changes, mustRefetch }) => {
        const table = new Map(initialRows.map((row) => [row.id, row]))
        const log: Array<SourceChange> = []
        const changeMessage = ({ operation, value }: SourceChange) => ({
          key: String(value.id),
          value,
          headers: { operation },
        })
        const upToDate = () => {
          mockStream.shapeHandle = handle ? `shape-1` : undefined
          mockStream.lastOffset = `${log.length}_0`
          return { headers: { control: `up-to-date` as const } }
        }
        const sendEveryRow = () =>
          subscriber([
            ...Array.from(table.values(), (value) =>
              changeMessage({ operation: `insert`, value }),
            ),
            upToDate(),
          ])
        const rows = () =>
          new Map(
            Array.from(collection.state.values(), (row) => [
              row.id,
              stripVirtualProps(row),
            ]),
          )
        const streamStart = () =>
          vi.mocked(ShapeStream).mock.calls.at(-1)![0] as unknown as {
            offset?: string
            handle?: string
          }

        sendEveryRow()
        expect(collection.status).toBe(`ready`)
        const shownBeforeReload = rows()
        expect(shownBeforeReload).toEqual(new Map(table))

        for (const change of changes) {
          log.push(change)
          if (change.operation === `delete`) table.delete(change.value.id)
          else table.set(change.value.id, change.value)
        }

        const reload = collection.reload().then(
          () => `resolved`,
          (error: unknown) => error,
        )
        // The reach of this case: the new stream resumes exactly when the
        // retired one stored a handle.
        const start = streamStart()
        expect(start.handle !== undefined).toBe(handle)
        expect(rows()).toEqual(shownBeforeReload)

        if (mustRefetch) {
          subscriber([{ headers: { control: `must-refetch` } }])
          expect(rows()).toEqual(shownBeforeReload)
          sendEveryRow()
        } else if (start.offset !== undefined && start.offset !== `-1`) {
          const after = Number(start.offset.split(`_`)[0])
          subscriber([...log.slice(after).map(changeMessage), upToDate()])
        } else {
          sendEveryRow()
        }

        const settled = await Promise.race([
          reload,
          new Promise((resolve) => setTimeout(() => resolve(`pending`), 200)),
        ])
        expect(settled).toBe(`resolved`)
        expect(collection.status).toBe(`ready`)
        expect(collection.health.reloading).toBe(false)
        expect(rows()).toEqual(new Map(table))
      },
    )
  })

  // The same law for an on-demand Collection, whose rows come from subset
  // snapshots that a subscription's demand requests. The reload's new run
  // sends no snapshot of the whole shape, so it completes at its
  // markReady() and keeps the rows; core then replays the demand, and the
  // replayed subset snapshot's rows apply on the kept rows: Electric writes
  // an update for a key the Collection holds (snapshot-api §8). The fake
  // source answers every subset request with its current rows. A resumed
  // stream delivers its changes after the stored offset; a stream that
  // cannot resume starts at `now` and delivers none of them. Afterwards a
  // row the source holds shows its current value, and an untouched row
  // survives. Core does not sweep after a reload (§8, issue #2269), so a row
  // the source deleted while no stream listened stays in the history that
  // cannot resume: no subset snapshot can say a row is gone.
  it.each([true, false])(
    `an on-demand reload keeps its rows and ends with the source's rows (resumes: %s)`,
    async (handle) => {
      const table = new Map<number, Row>([
        [1, { id: 1, name: `one` }],
        [2, { id: 2, name: `two` }],
        [3, { id: 3, name: `three` }],
      ])
      const log: Array<Message<Row>> = []
      mockRequestSnapshot.mockImplementation(() => {
        subscriber([
          ...Array.from(table.values(), (value) => ({
            key: String(value.id),
            value,
            headers: { operation: `insert` as const },
          })),
          { headers: { control: `subset-end` } } as Message<Row>,
        ])
        return Promise.resolve()
      })
      const upToDate = () => {
        mockStream.shapeHandle = handle ? `shape-1` : undefined
        mockStream.lastOffset = `${log.length}_0`
        return { headers: { control: `up-to-date` as const } }
      }
      const onDemand = createCollection(
        electricCollectionOptions({
          id: `on-demand-reload-of-ready`,
          shapeOptions: { url: `http://test-url`, params: { table: `t` } },
          syncMode: `on-demand`,
          getKey: (item: Row) => item.id as number,
          startSync: true,
        }),
      )
      const rows = () =>
        new Map(
          Array.from(onDemand.state.values(), (row) => [
            row.id,
            stripVirtualProps(row),
          ]),
        )
      const subscription = onDemand.subscribeChanges(() => {}, {
        includeInitialState: true,
      })
      try {
        subscriber([upToDate()])
        await vi.waitFor(() => expect(rows()).toEqual(new Map(table)))
        const before = rows()

        const edited = { id: 1, name: `one, edited` }
        table.set(1, edited)
        log.push({
          key: `1`,
          value: edited,
          headers: { operation: `update` },
        })
        table.delete(2)
        log.push({
          key: `2`,
          value: { id: 2 },
          headers: { operation: `delete` },
        })

        const reload = onDemand.reload().then(
          () => `resolved`,
          (error: unknown) => error,
        )
        expect(rows()).toEqual(before)
        const start = vi
          .mocked(ShapeStream)
          .mock.calls.at(-1)![0] as unknown as {
          offset?: string
          handle?: string
        }
        // The reach of this case: the new stream resumes exactly when the
        // retired one stored a handle.
        expect(start.handle !== undefined).toBe(handle)
        const resumedChanges = handle
          ? log.slice(Number(start.offset!.split(`_`)[0]))
          : []
        subscriber([...resumedChanges, upToDate()])

        expect(await reload).toBe(`resolved`)
        const expected = new Map(handle ? table : [...before, ...table])
        await vi.waitFor(() => expect(rows()).toEqual(expected))
        expect(onDemand.status).toBe(`ready`)
      } finally {
        subscription.unsubscribe()
        await onDemand.cleanup()
      }
    },
  )

  // An abort ends the load (snapshot-api §8): the adapter must stop and
  // write no rows for it. Electric serializes subset requests on one stream
  // cursor, so a load can wait behind another. Here the second load aborts
  // while it waits. Checkpoints: it rejects with `AbortError`, Electric
  // never requests its snapshot, and once the first request settles the
  // Collection holds only the first load's rows. Limit: an abort while a
  // request is in flight cannot stop the rows the SDK already publishes
  // through the stream (ShapeStream.requestSnapshot accepts no signal).
  it(`an aborted load writes no rows and its late result changes nothing`, async () => {
    const first = createDeferred<void>()
    mockRequestSnapshot.mockReturnValueOnce(first.promise)
    const onDemand = createCollection(
      electricCollectionOptions({
        id: `on-demand-aborted-load`,
        shapeOptions: { url: `http://test-url`, params: { table: `t` } },
        syncMode: `on-demand`,
        getKey: (item: Row) => item.id as number,
        startSync: true,
      }),
    )
    try {
      subscriber([{ headers: { control: `up-to-date` } }])
      const firstLoad = Promise.resolve(onDemand._sync.loadSubset({ limit: 1 }))
      const abort = new NativeAbortController()
      const second = Promise.resolve(
        onDemand._sync.loadSubset({ limit: 2, signal: abort.signal }),
      ).then(
        () => `resolved`,
        (error: unknown) => error,
      )
      await vi.waitFor(() => expect(mockRequestSnapshot).toHaveBeenCalledOnce())
      abort.abort()
      expect(await second).toMatchObject({ name: `AbortError` })

      subscriber([
        { key: `1`, value: { id: 1 }, headers: { operation: `insert` } },
        { headers: { control: `subset-end` } },
      ])
      first.resolve()
      await firstLoad
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(mockRequestSnapshot).toHaveBeenCalledOnce()
      expect([...onDemand.keys()]).toEqual([1])
    } finally {
      first.resolve()
      await onDemand.cleanup()
    }
  })

  // The same law for a progressive Collection whose reload cannot resume.
  // Its new stream starts over, so it buffers the full log until its first
  // up-to-date, and only that atomic swap replaces the kept rows. Before the
  // swap, a live query's replayed subset load fetches a subset snapshot,
  // whose rows apply on the kept rows: a kept key takes the source's current
  // value and no kept row vanishes. After the swap the rows equal the
  // source's, the reload has settled, and the live query shows them with no
  // error.
  it(`a progressive reload that cannot resume keeps its rows through a subset load`, async () => {
    const table = new Map<number, Row>([
      [1, { id: 1, name: `one` }],
      [2, { id: 2, name: `two` }],
      [3, { id: 3, name: `three` }],
    ])
    mockFetchSnapshot.mockImplementation(() =>
      Promise.resolve({
        metadata: {},
        data: Array.from(table.values(), (value) => ({
          key: String(value.id),
          value,
          headers: { operation: `insert` },
        })),
      }),
    )
    const sendEveryRow = () => {
      mockStream.shapeHandle = undefined
      mockStream.lastOffset = `1_0`
      subscriber([
        ...Array.from(table.values(), (value) => ({
          key: String(value.id),
          value,
          headers: { operation: `insert` as const },
        })),
        { headers: { control: `up-to-date` } },
      ])
    }
    const progressive = createCollection(
      electricCollectionOptions({
        id: `progressive-reload-of-ready`,
        shapeOptions: { url: `http://test-url`, params: { table: `t` } },
        syncMode: `progressive`,
        getKey: (item: Row) => item.id as number,
        startSync: true,
      }),
    )
    const rowsOf = (collection: { values: () => Iterable<Row> }) =>
      new Map(
        Array.from(collection.values(), (row) => [
          row.id as number,
          stripVirtualProps(row),
        ]),
      )
    const live = createLiveQueryCollection({
      query: (q) =>
        q.from({ row: progressive }).where(({ row }) => gt(row.id, 0)),
    })
    try {
      const preload = live.preload()
      sendEveryRow()
      await preload
      expect(rowsOf(progressive)).toEqual(new Map(table))
      const before = rowsOf(progressive)
      const fetchesBefore = mockFetchSnapshot.mock.calls.length

      table.set(1, { id: 1, name: `one, edited` })
      table.delete(2)
      const reload = progressive.reload().then(
        () => `resolved`,
        (error: unknown) => error,
      )
      const start = vi.mocked(ShapeStream).mock.calls.at(-1)![0] as unknown as {
        handle?: string
      }
      // The reach of this case: the new stream cannot resume, and the live
      // query's replayed demand fetches a subset snapshot while it buffers.
      expect(start.handle).toBeUndefined()
      await vi.waitFor(() =>
        expect(mockFetchSnapshot.mock.calls.length).toBeGreaterThan(
          fetchesBefore,
        ),
      )
      await new Promise((resolve) => setTimeout(resolve, 0))
      const buffering = rowsOf(progressive)
      expect(
        [...before.keys()].filter((key) => !buffering.has(key)),
        `no kept row vanishes before the swap`,
      ).toEqual([])
      expect(live.health.error).toBeNull()
      expect(buffering.get(1)).toEqual(table.get(1))

      sendEveryRow()
      expect(await reload).toBe(`resolved`)
      expect(rowsOf(progressive)).toEqual(new Map(table))
      await vi.waitFor(() => expect(rowsOf(live)).toEqual(new Map(table)))
      expect(live.health.error).toBeNull()
      expect(live.status).toBe(`ready`)
    } finally {
      await live.cleanup()
      await progressive.cleanup()
    }
  })

  // A run's markReady() after its fail() does nothing (maintainer decision
  // F18/F6, /tmp/unify/snapshot-api.md §4). Electric reaches it when the SDK
  // gives up while a ready run's up-to-date commit waits for acceptance by a
  // wrapping sync, as persistence accepts after its durable step: the
  // acceptance then marks the run ready after its fail(). That late ready
  // must change nothing and must not reject.
  it(`a ready after the stream gave up changes nothing`, async () => {
    let giveUpStream!: (error: unknown) => void
    mockSubscribe.mockImplementation((callback, onError) => {
      subscriber = callback
      giveUpStream = onError
      return () => {}
    })
    const acceptance = createDeferred<void>()
    let holdAcceptance = false
    const options = electricCollectionOptions({
      id: `late-ready-after-give-up`,
      shapeOptions: { url: `http://test-url`, params: { table: `t` } },
      getKey: (item: Row) => item.id as number,
    })
    const held = createCollection({
      ...options,
      startSync: true,
      sync: {
        ...options.sync,
        sync: (params: Parameters<typeof options.sync.sync>[0]) =>
          options.sync.sync({
            ...params,
            commit: (signal) => {
              const applied = params.commit(signal)
              if (!holdAcceptance) return applied
              return withAcceptedReceipt(
                applied === true ? Promise.resolve() : applied,
                acceptance.promise,
              )
            },
          }),
      },
    })
    const unhandled: Array<unknown> = []
    const recordUnhandled = (reason: unknown) => unhandled.push(reason)
    process.on(`unhandledRejection`, recordUnhandled)
    try {
      subscriber([
        { key: `1`, value: { id: 1 }, headers: { operation: `insert` } },
        { headers: { control: `up-to-date` } },
      ])
      expect(held.status).toBe(`ready`)

      holdAcceptance = true
      subscriber([
        { key: `3`, value: { id: 3 }, headers: { operation: `insert` } },
        { headers: { control: `up-to-date` } },
      ])

      const gaveUp = new Error(`the SDK gave up`)
      giveUpStream(gaveUp)
      expect(held.health.error?.cause).toBe(gaveUp)
      const changes: Array<string> = []
      held.on(`status:change`, ({ status }) => changes.push(status))
      held.on(`health:change`, () => changes.push(`health`))

      // The reach of this case: the acceptance arrives after the give-up.
      acceptance.resolve()
      await new Promise((resolve) => setTimeout(resolve, 20))

      expect(unhandled).toEqual([])
      expect(changes).toEqual([])
      expect(held.status).toBe(`ready`)
      expect(held.health.error?.cause).toBe(gaveUp)
    } finally {
      process.off(`unhandledRejection`, recordUnhandled)
    }
  })

  it(`reports an initial stream error instead of publishing an empty ready snapshot`, async () => {
    const loggedError = vi.spyOn(console, `error`).mockImplementation(() => {})
    const preload = collection.preload()
    const streamOptions = vi.mocked(ShapeStream).mock.calls.at(-1)?.[0] as
      { onError?: (error: unknown) => void } | undefined
    const initialError = new Error(`initial stream failed`)

    try {
      streamOptions?.onError?.(initialError)

      expect(collection.status).toBe(`error`)
      await expect(preload).rejects.toBe(initialError)
    } finally {
      loggedError.mockRestore()
    }
  })

  it(`should handle incoming insert messages and commit on up-to-date`, () => {
    // Simulate incoming insert message
    subscriber([
      {
        key: `1`,
        value: { id: 1, name: `Test User` },
        headers: { operation: `insert` },
      },
    ])
    expect(collection.state).toEqual(new Map([]))

    // Send up-to-date control message to commit transaction
    subscriber([
      {
        headers: { control: `up-to-date` },
      },
    ])

    expect(stripCollectionState(collection.state)).toEqual(
      new Map([[1, { id: 1, name: `Test User` }]]),
    )
  })

  // Readiness counts accepted rows; they publish when the mutation settles.
  it(`marks the source ready once its initial rows are accepted`, async () => {
    const persistence = createDeferred<void>()
    const transaction = createTransaction({
      mutationFn: () => persistence.promise,
    })
    transaction.mutate(() =>
      collection.insert({ id: 99, name: `Optimistic user` }),
    )

    subscriber([
      {
        key: `1`,
        value: { id: 1, name: `Synced user` },
        headers: { operation: `insert` },
      },
      { headers: { control: `up-to-date` } },
    ])
    await Promise.resolve()

    expect(collection.status).toBe(`ready`)
    expect(collection.get(1)).toBeUndefined()

    persistence.resolve()
    await transaction.when(`settled`)
    await collection.stateWhenReady()

    expect(collection.status).toBe(`ready`)
    expect(collection.get(1)).toEqual(
      expect.objectContaining({ id: 1, name: `Synced user` }),
    )
  })

  it(`should handle multiple changes before committing`, () => {
    // First batch of changes
    subscriber([
      {
        key: `1`,
        value: { id: 1, name: `Test User` },
        headers: { operation: `insert` },
      },
    ])

    // Second batch of changes
    subscriber([
      {
        key: `2`,
        value: { id: 2, name: `Another User` },
        headers: { operation: `insert` },
      },
    ])

    expect(collection.state).toEqual(new Map([]))
    expect(collection.status).toEqual(`loading`)

    // Send up-to-date to commit all changes
    subscriber([
      {
        headers: { control: `up-to-date` },
      },
    ])
    expect(collection.status).toEqual(`ready`)

    expect(stripCollectionState(collection.state)).toEqual(
      new Map([
        [1, { id: 1, name: `Test User` }],
        [2, { id: 2, name: `Another User` }],
      ]),
    )
  })

  it(`should handle updates across multiple messages`, () => {
    // First insert
    subscriber([
      {
        key: `1`,
        value: { id: 1, name: `Test User` },
        headers: { operation: `insert` },
      },
    ])

    // Update in a separate message
    subscriber([
      {
        key: `1`,
        value: { id: 1, name: `Updated User` },
        headers: { operation: `update` },
      },
    ])

    // Commit with up-to-date
    subscriber([
      {
        headers: { control: `up-to-date` },
      },
    ])

    expect(stripCollectionState(collection.state)).toEqual(
      new Map([[1, { id: 1, name: `Updated User` }]]),
    )
  })

  it(`ignores an update for a key that has never been materialized`, () => {
    subscriber([
      {
        key: `2`,
        value: { id: 2, name: `Only changed columns` },
        headers: { operation: `update` },
      },
      { headers: { control: `up-to-date` } },
    ])

    expect(collection.has(2)).toBe(false)
  })

  it(`accepts an update after an insert for the same key in one batch`, () => {
    subscriber([
      {
        key: `2`,
        value: { id: 2, name: `Initial value` },
        headers: { operation: `insert` },
      },
      {
        key: `2`,
        value: { id: 2, name: `Updated value` },
        headers: { operation: `update` },
      },
      { headers: { control: `up-to-date` } },
    ])

    expect(collection.get(2)?.name).toBe(`Updated value`)
  })

  it(`accepts a progressive update after its insert in an earlier callback`, () => {
    let testSubscriber!: (messages: Array<Message<Row>>) => void
    mockSubscribe.mockImplementation((callback) => {
      testSubscriber = callback
      return () => {}
    })

    const testCollection = createCollection(
      electricCollectionOptions({
        id: `progressive-split-insert-update-test`,
        shapeOptions: {
          url: `http://test-url`,
          params: { table: `test_table` },
        },
        syncMode: `progressive`,
        getKey: (item: Row) => item.id as number,
        startSync: true,
      }),
    )

    testSubscriber([
      {
        key: `2`,
        value: { id: 2, name: `Initial value` },
        headers: { operation: `insert` },
      },
    ])
    testSubscriber([
      {
        key: `2`,
        value: { id: 2, name: `Updated value` },
        headers: { operation: `update` },
      },
    ])
    testSubscriber([{ headers: { control: `up-to-date` } }])

    expect(testCollection.get(2)?.name).toBe(`Updated value`)
  })

  it(`should handle delete operations`, () => {
    // Insert and commit
    subscriber([
      {
        key: `1`,
        value: { id: 1, name: `Test User` },
        headers: { operation: `insert` },
      },
      {
        headers: { control: `up-to-date` },
      },
    ])

    // Delete in new transaction
    subscriber([
      {
        key: `1`,
        value: { id: 1 },
        headers: { operation: `delete` },
      },
      {
        headers: { control: `up-to-date` },
      },
    ])

    expect(collection.state).toEqual(new Map())
  })

  it(`should not commit changes without up-to-date message`, () => {
    // Send changes without up-to-date
    subscriber([
      {
        key: `1`,
        value: { id: 1, name: `Test User` },
        headers: { operation: `insert` },
      },
    ])

    // Send must-refetch control message
    subscriber([
      {
        headers: { control: `must-refetch` },
      },
    ])

    // Changes should still be pending until up-to-date is received
    expect(collection.state).toEqual(new Map())
  })

  it(`should handle must-refetch by clearing synced data and re-syncing`, () => {
    // First, populate the collection with some data
    subscriber([
      {
        key: `1`,
        value: { id: 1, name: `Test User` },
        headers: { operation: `insert` },
      },
      {
        key: `2`,
        value: { id: 2, name: `Another User` },
        headers: { operation: `insert` },
      },
      {
        headers: { control: `up-to-date` },
      },
    ])

    // Verify the data is in the collection
    expect(collection.state.size).toBe(2)
    expect(collection.status).toBe(`ready`)

    // Send must-refetch control message
    subscriber([
      {
        headers: { control: `must-refetch` },
      },
    ])

    // The collection should still have old data because truncate is in pending
    // transaction. This is the intended behavior of the collection, you should have
    // the old data until the next up-to-date message.
    expect(collection.state.size).toBe(2)
    expect(collection.status).toBe(`ready`)

    // Send new data after must-refetch
    subscriber([
      {
        key: `3`,
        value: { id: 3, name: `New User` },
        headers: { operation: `insert` },
      },
      {
        headers: { control: `up-to-date` },
      },
    ])

    // The collection should now have the new data
    expect(collection.state.size).toBe(1)
    expect(stripVirtualProps(collection.state.get(3))).toEqual({
      id: 3,
      name: `New User`,
    })
    expect(collection.status).toBe(`ready`)
  })

  // Tests for txid tracking functionality
  describe(`txid tracking`, () => {
    it(`should track txids from incoming messages`, async () => {
      const testTxid = 123

      // Send a message with a txid
      subscriber([
        {
          key: `1`,
          value: { id: 1, name: `Test User` },
          headers: {
            operation: `insert`,
            txids: [testTxid],
          },
        },
        {
          headers: { control: `up-to-date` },
        },
      ])

      // awaitTxId throws if you pass it a string
      await expect(
        // @ts-expect-error
        collection.utils.awaitTxId(`123`),
      ).rejects.toThrowErrorMatchingInlineSnapshot(
        `[ExpectedNumberInAwaitTxIdError: [test] Expected number in awaitTxId, received string]`,
      )

      // The txid should be tracked and awaitTxId should resolve immediately
      await expect(collection.utils.awaitTxId(testTxid)).resolves.toBe(true)
    })

    it(`uses 15-second defaults for txid and message waits`, async () => {
      vi.useFakeTimers()
      let txidError: unknown
      let matchError: unknown

      try {
        void collection.utils.awaitTxId(999_999).catch((error: unknown) => {
          txidError = error
        })
        void collection.utils
          .awaitMatch(() => false)
          .catch((error: unknown) => {
            matchError = error
          })

        await vi.advanceTimersByTimeAsync(14_999)
        expect(txidError).toBeUndefined()
        expect(matchError).toBeUndefined()

        await vi.advanceTimersByTimeAsync(1)
        expect(txidError).toMatchObject({
          message: expect.stringContaining(`999999`),
        })
        expect(matchError).toMatchObject({
          message: expect.stringContaining(
            `Timeout waiting for custom match function`,
          ),
        })
      } finally {
        vi.useRealTimers()
      }
    })

    it(`should track multiple txids`, async () => {
      const txid1 = 100
      const txid2 = 200

      // Send a message with multiple txids
      subscriber([
        {
          key: `1`,
          value: { id: 1, name: `Test User` },
          headers: {
            operation: `insert`,
            txids: [txid1, txid2],
          },
        },
        {
          headers: { control: `up-to-date` },
        },
      ])

      // Both txids should be tracked
      await expect(collection.utils.awaitTxId(txid1)).resolves.not.toThrow()
      await expect(collection.utils.awaitTxId(txid2)).resolves.not.toThrow()
    })

    it(`exports and imports versioned hydration sync metadata`, async () => {
      mockStream.shapeHandle = `shape-handle`
      mockStream.lastOffset = `42_0`

      subscriber([
        {
          key: `1`,
          value: { id: 1, name: `Test User` },
          headers: {
            operation: `insert`,
            txids: [100, 200],
          },
        },
        {
          headers: { control: `up-to-date` },
        },
      ])

      const exported = collection.config.sync.exportSyncMeta?.()
      expect(exported).toMatchObject({
        version: 1,
        resume: {
          kind: `resume`,
          requiresTagState: false,
          offset: `42_0`,
          handle: `shape-handle`,
        },
        seenTxids: [100, 200],
      })

      const resumedOptions = electricCollectionOptions<Row>({
        id: `resumed`,
        shapeOptions: {
          url: `http://test-url`,
          params: {
            table: `test_table`,
          },
        },
        startSync: false,
        getKey: (item) => item.id as number,
      })

      const merged = resumedOptions.sync.mergeSyncMeta?.(
        {
          version: 1,
          seenTxids: [50],
        },
        exported,
      )
      resumedOptions.sync.importSyncMeta?.(merged)

      await expect(resumedOptions.utils.awaitTxId(50)).resolves.toBe(true)
      await expect(resumedOptions.utils.awaitTxId(200)).resolves.toBe(true)

      const resumedCollection = createCollection({
        ...resumedOptions,
        startSync: true,
      })

      expect(vi.mocked(ShapeStream).mock.calls.at(-1)?.[0]).toMatchObject({
        offset: `42_0`,
        handle: `shape-handle`,
      })

      await resumedCollection.cleanup()
    })

    it(`ignores non-finite hydration sync metadata`, () => {
      const options = electricCollectionOptions<Row>({
        id: `invalid-hydration-sync-meta`,
        shapeOptions: {
          url: `http://test-url`,
          params: {
            table: `test_table`,
          },
        },
        startSync: false,
        getKey: (item) => item.id as number,
      })

      options.sync.importSyncMeta?.({
        version: 1,
        resume: {
          kind: `reset`,
          updatedAt: Number.POSITIVE_INFINITY,
        },
        seenTxids: [Number.NaN],
      })

      expect(options.sync.exportSyncMeta?.()).toEqual({
        version: 1,
        seenTxids: [],
      })
    })

    it(`should reject with timeout when waiting for unknown txid`, async () => {
      // Set a short timeout for the test
      const unknownTxid = 0
      const shortTimeout = 100

      // Attempt to await a txid that hasn't been seen with a short timeout
      const promise = collection.utils.awaitTxId(unknownTxid, shortTimeout)

      // The promise should reject with a timeout error
      await expect(promise).rejects.toThrow(
        `Timeout waiting for txId: ${unknownTxid}`,
      )
    })

    it(`should resolve when a txid arrives after awaitTxId is called`, async () => {
      const laterTxid = 1000

      // Start waiting for a txid that hasn't arrived yet
      const promise = collection.utils.awaitTxId(laterTxid, 1000)

      // Send the txid after a short delay
      setTimeout(() => {
        subscriber([
          {
            key: `foo`,
            value: { id: 1, bar: true },
            headers: {
              operation: `insert`,
            },
          },
          {
            headers: {
              control: `up-to-date`,
              txids: [laterTxid],
            },
          },
          {
            headers: {
              control: `up-to-date`,
            },
          },
        ])
      }, 50)

      // The promise should resolve when the txid arrives
      await expect(promise).resolves.not.toThrow()
    })

    // Test the complete flow
    it(`should simulate the complete flow`, async () => {
      // Create a fake backend store to simulate server-side storage
      const fakeBackend = {
        data: new Map<number, { txid: number; value: unknown }>(),
        // Simulates persisting data to a backend and returning a txid
        persist: (mutations: Array<PendingMutation<Row>>): Promise<number> => {
          const txid = Math.floor(Math.random() * 10000)

          // Store the changes with the txid
          mutations.forEach((mutation) => {
            fakeBackend.data.set(mutation.key, {
              value: mutation.changes,
              txid,
            })
          })

          return Promise.resolve(txid)
        },
        // Simulates the server sending sync messages with txids
        simulateSyncMessage: (txid: number) => {
          // Create messages for each item in the store that has this txid
          const messages: Array<Message<Row>> = []

          fakeBackend.data.forEach((value, key) => {
            if (value.txid === txid) {
              messages.push({
                key: key.toString(),
                value: value.value as Row,
                headers: {
                  operation: `insert`,
                  txids: [txid],
                },
              })
            }
          })

          // Add an up-to-date message to complete the sync
          messages.push({
            headers: {
              control: `up-to-date`,
            },
          })

          // Send the messages to the subscriber
          subscriber(messages)
        },
      }

      // Create a test mutation function that uses our fake backend
      const testMutationFn = vi.fn(
        async ({ transaction }: { transaction: Transaction }) => {
          // Persist to fake backend and get txid
          const txid = await fakeBackend.persist(
            transaction.mutations as Array<PendingMutation<Row>>,
          )

          if (!txid) {
            throw new Error(`No txid found`)
          }

          // Start waiting for the txid
          const promise = collection.utils.awaitTxId(txid, 1000)

          // Simulate the server sending sync messages after a delay
          setTimeout(() => {
            fakeBackend.simulateSyncMessage(txid)
          }, 50)

          // Wait for the txid to be seen
          await promise

          return Promise.resolve()
        },
      )

      const tx1 = createTransaction({ mutationFn: testMutationFn })

      let transaction = tx1.mutate(() =>
        collection.insert({ id: 1, name: `Test item 1` }),
      )

      await transaction.when(`settled`)

      transaction = collection._state.transactions.get(transaction.id)!

      // Verify the mutation function was called correctly
      expect(testMutationFn).toHaveBeenCalledTimes(1)

      // Check that the data was added to the collection
      // Note: In a real implementation, the collection would be updated by the sync process
      // This is just verifying our test setup worked correctly
      expect(fakeBackend.data.has(1)).toBe(true)
      expect(collection.has(1)).toBe(true)
    })
  })

  // Tests for direct persistence handlers
  describe(`Direct persistence handlers`, () => {
    it(`should pass through direct persistence handlers to collection options`, () => {
      // Create mock handlers
      const onInsert = vi.fn().mockResolvedValue(undefined)
      const onUpdate = vi.fn().mockResolvedValue(undefined)
      const onDelete = vi.fn().mockResolvedValue(undefined)

      const config = {
        id: `test-handlers`,
        shapeOptions: {
          url: `http://test-url`,
          params: {
            table: `test_table`,
          },
        },
        getKey: (item: Row) => item.id as number,
        onInsert,
        onUpdate,
        onDelete,
      }

      const options = electricCollectionOptions(config)

      // Verify that the handlers were passed to the collection options
      expect(options.onInsert).toBeDefined()
      expect(options.onUpdate).toBeDefined()
      expect(options.onDelete).toBeDefined()
    })

    it(`should simulate complete flow with direct persistence handlers`, async () => {
      // Create a fake backend store to simulate server-side storage
      const fakeBackend = {
        data: new Map<string, { txid: number; value: unknown }>(),
        // Simulates persisting data to a backend and returning a txid
        persist: (mutations: Array<PendingMutation<Row>>): Promise<number> => {
          const txid = Math.floor(Math.random() * 10000)

          // Store the changes with the txid
          mutations.forEach((mutation) => {
            const key = mutation.key
            fakeBackend.data.set(key, { txid, value: mutation.changes })
          })

          return Promise.resolve(txid)
        },
        // Simulates the server sending sync messages with txids
        simulateSyncMessage: (txid: number) => {
          // Create messages for each item in the store that has this txid
          const messages: Array<Message<Row>> = []

          fakeBackend.data.forEach((value, key) => {
            if (value.txid === txid) {
              messages.push({
                key,
                value: value.value as Row,
                headers: {
                  operation: `insert`,
                  txids: [txid],
                },
              })
            }
          })

          // Add up-to-date message
          messages.push({
            headers: { control: `up-to-date` },
          })

          // Send the messages to the subscriber
          subscriber(messages)
        },
      }

      // Create a mutation function for the transaction
      const mutationFn = vi.fn(async (params: MutationFnParams<Row>) => {
        const txid = await fakeBackend.persist(params.transaction.mutations)

        // Simulate server sending sync message after a delay
        setTimeout(() => {
          fakeBackend.simulateSyncMessage(txid)
        }, 50)

        return txid
      })

      const onInsert = vi.fn(
        async (
          params: InsertMutationFnParams<
            Row,
            string | number,
            ElectricCollectionUtils<Row>
          >,
        ) => {
          const txid = await mutationFn(params)
          await params.collection.utils.awaitTxId(txid)
        },
      )

      // Create a test collection with our direct persistence handler
      const config = {
        id: `test-direct-persistence`,
        shapeOptions: {
          url: `http://test-url`,
          params: {
            table: `test_table`,
          },
        },
        startSync: true,
        getKey: (item: Row) => item.id as number,
        onInsert,
      }

      const testCollection = createCollection(electricCollectionOptions(config))

      // Insert data using the transaction
      const tx = testCollection.insert({
        id: 1,
        name: `Direct Persistence User`,
      })

      // The handler is still waiting for awaitTxId at this checkpoint.
      expect(testCollection._state.syncedData.size).toEqual(0)

      // Verify that our onInsert handler was called
      expect(onInsert).toHaveBeenCalled()

      await tx.when(`settled`)

      // Verify that the data was added to the collection via the sync process
      expect(testCollection.has(1)).toBe(true)
      expect(stripVirtualProps(testCollection.get(1))).toEqual({
        id: 1,
        name: `Direct Persistence User`,
      })
      expect(testCollection._state.syncedData.size).toEqual(1)
    })

    it(`ignores a legacy handler return value without waiting for its txid`, async () => {
      const testCollection = createCollection(
        electricCollectionOptions({
          id: `legacy-return-value`,
          shapeOptions: {
            url: `http://test-url`,
            params: { table: `test_table` },
          },
          startSync: true,
          getKey: (item: Row) => item.id as number,
          onInsert: (() =>
            Promise.resolve({ txid: 123 })) as unknown as () => Promise<void>,
        }),
      )

      const transaction = testCollection.insert({ id: 1, name: `pending` })
      await expect(transaction.when(`settled`)).resolves.toBe(transaction)
      expect(testCollection.has(1)).toBe(false)
      await testCollection.cleanup()
    })

    it(`should remove optimistic insert when txid sync confirms a different server-generated key`, async () => {
      const txid = 1234
      const onInsert = vi.fn(
        async ({
          collection,
        }: InsertMutationFnParams<
          Row,
          string | number,
          ElectricCollectionUtils<Row>
        >) => {
          await collection.utils.awaitTxId(txid)
        },
      )

      const testCollection = createCollection(
        electricCollectionOptions({
          id: `test-server-generated-key-txid`,
          shapeOptions: {
            url: `http://test-url`,
            params: { table: `test_table` },
          },
          startSync: true,
          getKey: (item: Row) => item.id as number,
          onInsert,
        }),
      )

      const tx = testCollection.insert({ id: 4733, text: `two` })

      expect(stripVirtualProps(testCollection.get(4733))).toEqual({
        id: 4733,
        text: `two`,
      })

      subscriber([
        {
          key: `24`,
          value: { id: 24, text: `two` },
          headers: { operation: `insert`, txids: [txid] },
        },
        { headers: { control: `up-to-date` } },
      ])

      await tx.when(`settled`)

      expect(testCollection.has(4733)).toBe(false)
      expect(stripVirtualProps(testCollection.get(24))).toEqual({
        id: 24,
        text: `two`,
      })
      expect(Array.from(testCollection.state.keys())).toEqual([24])
    })

    it(`settles immediately when a handler does not wait for sync`, async () => {
      const onInsert = vi.fn().mockResolvedValue(undefined)

      const config = {
        id: `test-void-strategy`,
        shapeOptions: {
          url: `http://test-url`,
          params: { table: `test_table` },
        },
        startSync: true,
        getKey: (item: Row) => item.id as number,
        onInsert,
      }

      const testCollection = createCollection(electricCollectionOptions(config))

      // Insert with void strategy - should complete immediately without waiting
      const tx = testCollection.insert({ id: 1, name: `Void Test` })

      await expect(tx.when(`settled`)).resolves.toBeDefined()
      expect(onInsert).toHaveBeenCalled()
    })

    it(`supports a custom awaitTxId timeout`, async () => {
      const onInsert = vi.fn(
        async ({
          collection,
        }: InsertMutationFnParams<
          Row,
          string | number,
          ElectricCollectionUtils<Row>
        >) => {
          await collection.utils.awaitTxId(999999, 100)
        },
      )

      const config = {
        id: `test-custom-timeout`,
        shapeOptions: {
          url: `http://test-url`,
          params: { table: `test_table` },
        },
        startSync: true,
        getKey: (item: Row) => item.id as number,
        onInsert,
      }

      const testCollection = createCollection(electricCollectionOptions(config))

      // Insert data - should timeout after 100ms
      const tx = testCollection.insert({ id: 1, name: `Timeout Test` })

      // Verify that our onInsert handler was called
      expect(onInsert).toHaveBeenCalled()

      // The transaction should reject due to timeout
      await expect(tx.when(`settled`)).rejects.toThrow(
        `Timeout waiting for txId: 999999`,
      )
    })

    it(`waits for every txid requested by a handler`, async () => {
      // Create a fake backend that returns multiple txids
      const fakeBackend = {
        persist: (
          mutations: Array<PendingMutation<Row>>,
        ): Promise<Array<number>> => {
          // Simulate multiple items being persisted and each getting a txid
          const txids = mutations.map(() => Math.floor(Math.random() * 10000))
          return Promise.resolve(txids)
        },
      }

      // Create handler that waits for each txid
      const onInsert = vi.fn(
        async (
          params: InsertMutationFnParams<
            Row,
            string | number,
            ElectricCollectionUtils<Row>
          >,
        ) => {
          const txids = await fakeBackend.persist(params.transaction.mutations)

          // Simulate server sending sync messages on different ticks
          // In the real world, multiple txids rarely arrive together
          setTimeout(() => {
            subscriber([
              {
                key: `1`,
                value: { id: 1, name: `Item 1` },
                headers: {
                  operation: `insert`,
                  txids: [txids[0]!],
                },
              },
              { headers: { control: `up-to-date` } },
            ])
          }, 1)

          setTimeout(() => {
            subscriber([
              {
                key: `2`,
                value: { id: 2, name: `Item 2` },
                headers: {
                  operation: `insert`,
                  txids: [txids[1]!],
                },
              },
              { headers: { control: `up-to-date` } },
            ])
          }, 2)

          await Promise.all(
            txids.map((txid) => params.collection.utils.awaitTxId(txid)),
          )
        },
      )

      const config = {
        id: `test-array-txids`,
        shapeOptions: {
          url: `http://test-url`,
          params: { table: `test_table` },
        },
        startSync: true,
        getKey: (item: Row) => item.id as number,
        onInsert,
      }

      const testCollection = createCollection(electricCollectionOptions(config))

      // Insert multiple items
      const tx = testCollection.insert([
        { id: 1, name: `Item 1` },
        { id: 2, name: `Item 2` },
      ])

      // This should resolve when all txids are seen
      await expect(tx.when(`settled`)).resolves.toBeDefined()
      expect(onInsert).toHaveBeenCalled()

      // Verify both items were added
      expect(testCollection.has(1)).toBe(true)
      expect(testCollection.has(2)).toBe(true)
    })

    it(`should support custom match function using awaitMatch utility`, async () => {
      let resolveCustomMatch: () => void
      const customMatchPromise = new Promise<void>((resolve) => {
        resolveCustomMatch = resolve
      })

      const onInsert = vi
        .fn()
        .mockImplementation(async ({ transaction, collection: col }) => {
          const item = transaction.mutations[0].modified
          await col.utils.awaitMatch((message: any) => {
            if (
              isChangeMessage(message) &&
              message.headers.operation === `insert` &&
              message.value.name === item.name
            ) {
              resolveCustomMatch()
              return true
            }
            return false
          }, 5000)
        })

      const config = {
        id: `test-custom-match`,
        shapeOptions: {
          url: `http://test-url`,
          params: { table: `test_table` },
        },
        startSync: true,
        getKey: (item: Row) => item.id as number,
        onInsert,
      }

      const testCollection = createCollection(electricCollectionOptions(config))

      // Start insert - will wait for custom match
      const insertPromise = testCollection.insert({
        id: 1,
        name: `Custom Match Test`,
      })

      // Wait a moment then send matching message
      setTimeout(() => {
        subscriber([
          {
            key: `1`,
            value: { id: 1, name: `Custom Match Test` },
            headers: { operation: `insert` },
          },
          { headers: { control: `up-to-date` } },
        ])
      }, 100)

      // Wait for both the custom match and persistence
      await Promise.all([customMatchPromise, insertPromise.when(`settled`)])

      expect(onInsert).toHaveBeenCalled()
      expect(testCollection.has(1)).toBe(true)
    })

    // NOTE: This test has a known issue with unhandled rejection warnings
    // This is a pre-existing issue from main branch (not caused by merge)
    // The test functionality works correctly, but vitest reports unhandled rejections
    it(`should timeout with custom match function when no match found`, async () => {
      vi.useFakeTimers()

      const onInsert = vi
        .fn()
        .mockImplementation(async ({ collection: col }) => {
          await col.utils.awaitMatch(
            () => false, // Never matches
            1, // Short timeout for test
          )
        })

      const config = {
        id: `test-timeout`,
        shapeOptions: {
          url: `http://test-url`,
          params: { table: `test_table` },
        },
        startSync: true,
        getKey: (item: Row) => item.id as number,
        onInsert,
      }

      const testCollection = createCollection(electricCollectionOptions(config))
      const tx = testCollection.insert({ id: 1, name: `Timeout Test` })

      // Capture the rejection promise before advancing timers
      const rejectionPromise = expect(tx.when(`settled`)).rejects.toThrow(
        `Timeout waiting for custom match function`,
      )

      // Advance timers to trigger timeout
      await vi.runOnlyPendingTimersAsync()

      // Should timeout and fail
      await rejectionPromise

      vi.useRealTimers()
    })

    it(`should find matching message in awaitMatch even when called after up-to-date`, async () => {
      // This test verifies the fix for the race condition where:
      // 1. Server receives insert and syncs it via Electric
      // 2. Electric messages (including up-to-date) are processed
      // 3. THEN awaitMatch is called - it should still find the message

      let resolveServerCall: () => void
      const serverCallPromise = new Promise<void>((resolve) => {
        resolveServerCall = resolve
      })

      const onInsert = vi
        .fn()
        .mockImplementation(async ({ transaction, collection: col }) => {
          const item = transaction.mutations[0].modified

          // Simulate waiting for server call to complete
          // During this time, Electric messages will arrive and be processed
          await serverCallPromise

          // Now awaitMatch is called AFTER the messages were processed
          // This should still find the message in the buffer
          await col.utils.awaitMatch((message: any) => {
            return (
              isChangeMessage(message) &&
              message.headers.operation === `insert` &&
              message.value.id === item.id
            )
          }, 5000)
        })

      const config = {
        id: `test-await-match-after-up-to-date`,
        shapeOptions: {
          url: `http://test-url`,
          params: { table: `test_table` },
        },
        startSync: true,
        getKey: (item: Row) => item.id as number,
        onInsert,
      }

      const testCollection = createCollection(electricCollectionOptions(config))

      // Start insert - will call onInsert which waits for serverCallPromise
      const insertPromise = testCollection.insert({
        id: 42,
        name: `Race Condition Test`,
      })

      // Wait for onInsert to start and reach the await serverCallPromise
      await new Promise((resolve) => setTimeout(resolve, 10))

      // Send Electric messages while onInsert is waiting for serverCallPromise
      // This simulates the race condition where messages arrive while API call is in progress
      subscriber([
        {
          key: `42`,
          value: { id: 42, name: `Race Condition Test` },
          headers: { operation: `insert` },
        },
        { headers: { control: `up-to-date` } },
      ])

      // Wait a tick to ensure messages are processed
      await new Promise((resolve) => setTimeout(resolve, 10))

      // Now resolve the server call - awaitMatch will be called AFTER messages were processed
      resolveServerCall!()

      // Should complete successfully - awaitMatch should find the message in the buffer
      await insertPromise.when(`settled`)

      expect(onInsert).toHaveBeenCalled()
      expect(testCollection.has(42)).toBe(true)
    })

    it(`should wait for up-to-date when match found during batch processing`, async () => {
      // This test verifies that if awaitMatch finds a match while the batch
      // is still being processed (before up-to-date), it waits for up-to-date
      // before resolving, ensuring data is committed before returning

      let matchFoundTime: number | undefined
      let resolveTime: number | undefined

      const onInsert = vi
        .fn()
        .mockImplementation(async ({ transaction, collection: col }) => {
          const item = transaction.mutations[0].modified

          await col.utils.awaitMatch((message: any) => {
            if (
              isChangeMessage(message) &&
              message.headers.operation === `insert` &&
              message.value.id === item.id
            ) {
              matchFoundTime = Date.now()
              return true
            }
            return false
          }, 5000)
          resolveTime = Date.now()
        })

      const config = {
        id: `test-wait-for-up-to-date`,
        shapeOptions: {
          url: `http://test-url`,
          params: { table: `test_table` },
        },
        startSync: true,
        getKey: (item: Row) => item.id as number,
        onInsert,
      }

      const testCollection = createCollection(electricCollectionOptions(config))

      const insertPromise = testCollection.insert({
        id: 100,
        name: `Wait Test`,
      })

      // Send insert message first, then up-to-date after a delay
      // This simulates awaitMatch finding the message before up-to-date
      setTimeout(() => {
        subscriber([
          {
            key: `100`,
            value: { id: 100, name: `Wait Test` },
            headers: { operation: `insert` },
          },
        ])
      }, 50)

      // Send up-to-date after another delay
      setTimeout(() => {
        subscriber([{ headers: { control: `up-to-date` } }])
      }, 150)

      await insertPromise.when(`settled`)

      expect(onInsert).toHaveBeenCalled()
      // Match should have been found before resolve (both times should exist)
      expect(matchFoundTime).toBeDefined()
      expect(resolveTime).toBeDefined()
      // Verify that resolve happened AFTER match was found (waited for up-to-date)
      expect(resolveTime).toBeGreaterThanOrEqual(matchFoundTime!)
    })

    it(`should clear buffer on new batch and match new messages`, async () => {
      // Verify that when a new batch arrives, the old buffer is cleared
      // and awaitMatch correctly matches messages from the new batch

      let resolveServerCall: () => void
      const serverCallPromise = new Promise<void>((resolve) => {
        resolveServerCall = resolve
      })

      const onInsert = vi
        .fn()
        .mockImplementation(async ({ transaction, collection: col }) => {
          const item = transaction.mutations[0].modified

          // Simulate API call
          await serverCallPromise

          await col.utils.awaitMatch((message: any) => {
            return (
              isChangeMessage(message) &&
              message.headers.operation === `insert` &&
              message.value.id === item.id
            )
          }, 5000)
        })

      const config = {
        id: `test-buffer-clearing`,
        shapeOptions: {
          url: `http://test-url`,
          params: { table: `test_table` },
        },
        startSync: true,
        getKey: (item: Row) => item.id as number,
        onInsert,
      }

      const testCollection = createCollection(electricCollectionOptions(config))

      // Start insert for item 201
      const insertPromise = testCollection.insert({
        id: 201,
        name: `Second Item`,
      })

      // Wait for onInsert to start
      await new Promise((resolve) => setTimeout(resolve, 10))

      // First batch - insert different item 200 (simulating other sync activity)
      subscriber([
        {
          key: `200`,
          value: { id: 200, name: `First Item` },
          headers: { operation: `insert` },
        },
        { headers: { control: `up-to-date` } },
      ])

      await new Promise((resolve) => setTimeout(resolve, 10))

      // Second batch - insert item 201 (our target)
      subscriber([
        {
          key: `201`,
          value: { id: 201, name: `Second Item` },
          headers: { operation: `insert` },
        },
        { headers: { control: `up-to-date` } },
      ])

      await new Promise((resolve) => setTimeout(resolve, 10))

      // Resolve server call - awaitMatch should find item 201 in the buffer
      // even though item 200 from the first batch is no longer in the buffer
      resolveServerCall!()

      await insertPromise.when(`settled`)

      expect(testCollection.has(201)).toBe(true)
    })

    it(`should timeout when no match in committed batch and no new messages`, async () => {
      // Verify that awaitMatch times out when the message isn't found

      const onInsert = vi
        .fn()
        .mockImplementation(async ({ collection: col }) => {
          // Look for a message that doesn't exist
          await col.utils.awaitMatch(
            (message: any) =>
              isChangeMessage(message) && message.value.id === 999,
            100, // Short timeout
          )
        })

      const config = {
        id: `test-no-match-timeout`,
        shapeOptions: {
          url: `http://test-url`,
          params: { table: `test_table` },
        },
        startSync: true,
        getKey: (item: Row) => item.id as number,
        onInsert,
      }

      const testCollection = createCollection(electricCollectionOptions(config))

      // Send a batch with different items
      subscriber([
        {
          key: `300`,
          value: { id: 300, name: `Wrong Item` },
          headers: { operation: `insert` },
        },
        { headers: { control: `up-to-date` } },
      ])

      await new Promise((resolve) => setTimeout(resolve, 20))

      // Insert looking for id 999 which doesn't exist
      const tx = testCollection.insert({ id: 301, name: `Test` })

      await expect(tx.when(`settled`)).rejects.toThrow(
        `Timeout waiting for custom match function`,
      )
    })

    it(`should resolve multiple awaitMatch calls from same committed batch`, async () => {
      // Verify that multiple concurrent awaitMatch calls can all find their
      // respective messages in the same committed batch

      const matches: Array<number> = []
      const serverCalls: Array<{ resolve: () => void }> = []

      const onInsert = vi
        .fn()
        .mockImplementation(async ({ transaction, collection: col }) => {
          const item = transaction.mutations[0].modified

          // Create a promise for this insert's "API call"
          const serverCallPromise = new Promise<void>((resolve) => {
            serverCalls.push({ resolve })
          })
          await serverCallPromise

          await col.utils.awaitMatch((message: any) => {
            if (
              isChangeMessage(message) &&
              message.headers.operation === `insert` &&
              message.value.id === item.id
            ) {
              matches.push(item.id)
              return true
            }
            return false
          }, 5000)
        })

      const config = {
        id: `test-multiple-matches`,
        shapeOptions: {
          url: `http://test-url`,
          params: { table: `test_table` },
        },
        startSync: true,
        getKey: (item: Row) => item.id as number,
        onInsert,
      }

      const testCollection = createCollection(electricCollectionOptions(config))

      // Start all three inserts concurrently
      const insert1 = testCollection.insert({ id: 400, name: `Item A` })
      const insert2 = testCollection.insert({ id: 401, name: `Item B` })
      const insert3 = testCollection.insert({ id: 402, name: `Item C` })

      // Wait for all onInsert handlers to start
      await new Promise((resolve) => setTimeout(resolve, 20))

      // Send batch with all three items (simulating fast sync from server)
      subscriber([
        {
          key: `400`,
          value: { id: 400, name: `Item A` },
          headers: { operation: `insert` },
        },
        {
          key: `401`,
          value: { id: 401, name: `Item B` },
          headers: { operation: `insert` },
        },
        {
          key: `402`,
          value: { id: 402, name: `Item C` },
          headers: { operation: `insert` },
        },
        { headers: { control: `up-to-date` } },
      ])

      await new Promise((resolve) => setTimeout(resolve, 20))

      // Resolve all server calls - all awaitMatch calls should find their messages
      serverCalls.forEach((call) => call.resolve())

      await Promise.all([
        insert1.when(`settled`),
        insert2.when(`settled`),
        insert3.when(`settled`),
      ])

      expect(matches).toContain(400)
      expect(matches).toContain(401)
      expect(matches).toContain(402)
      expect(testCollection.has(400)).toBe(true)
      expect(testCollection.has(401)).toBe(true)
      expect(testCollection.has(402)).toBe(true)
    })

    it(`should handle awaitMatch across multiple sequential batches`, async () => {
      // Real-world scenario: continuous sync with multiple batches
      // Each insert should find its matching message in the committed buffer

      const serverCalls: Array<{ resolve: () => void; id: number }> = []

      const onInsert = vi
        .fn()
        .mockImplementation(async ({ transaction, collection: col }) => {
          const item = transaction.mutations[0].modified

          // Create a promise for this insert's "API call"
          const serverCallPromise = new Promise<void>((resolve) => {
            serverCalls.push({ resolve, id: item.id })
          })
          await serverCallPromise

          await col.utils.awaitMatch((message: any) => {
            return (
              isChangeMessage(message) &&
              message.headers.operation === `insert` &&
              message.value.id === item.id
            )
          }, 5000)
        })

      const config = {
        id: `test-sequential-batches`,
        shapeOptions: {
          url: `http://test-url`,
          params: { table: `test_table` },
        },
        startSync: true,
        getKey: (item: Row) => item.id as number,
        onInsert,
      }

      const testCollection = createCollection(electricCollectionOptions(config))

      // Insert 1 - starts waiting on server call
      const insert1 = testCollection.insert({ id: 500, name: `Batch 1 Item` })
      await new Promise((resolve) => setTimeout(resolve, 10))

      // Batch 1 arrives with item 500
      subscriber([
        {
          key: `500`,
          value: { id: 500, name: `Batch 1 Item` },
          headers: { operation: `insert` },
        },
        { headers: { control: `up-to-date` } },
      ])
      await new Promise((resolve) => setTimeout(resolve, 10))

      // Resolve server call for insert 1
      const call1 = serverCalls.find((c) => c.id === 500)
      call1?.resolve()
      await insert1.when(`settled`)
      expect(testCollection.has(500)).toBe(true)

      // Insert 2 - starts waiting on server call
      const insert2 = testCollection.insert({ id: 501, name: `Batch 2 Item` })
      await new Promise((resolve) => setTimeout(resolve, 10))

      // Batch 2 arrives (clears batch 1 from buffer)
      subscriber([
        {
          key: `501`,
          value: { id: 501, name: `Batch 2 Item` },
          headers: { operation: `insert` },
        },
        { headers: { control: `up-to-date` } },
      ])
      await new Promise((resolve) => setTimeout(resolve, 10))

      // Resolve server call for insert 2
      const call2 = serverCalls.find((c) => c.id === 501)
      call2?.resolve()
      await insert2.when(`settled`)
      expect(testCollection.has(501)).toBe(true)

      // Insert 3 - starts waiting on server call
      const insert3 = testCollection.insert({ id: 502, name: `Batch 3 Item` })
      await new Promise((resolve) => setTimeout(resolve, 10))

      // Batch 3 arrives
      subscriber([
        {
          key: `502`,
          value: { id: 502, name: `Batch 3 Item` },
          headers: { operation: `insert` },
        },
        { headers: { control: `up-to-date` } },
      ])
      await new Promise((resolve) => setTimeout(resolve, 10))

      // Resolve server call for insert 3
      const call3 = serverCalls.find((c) => c.id === 502)
      call3?.resolve()
      await insert3.when(`settled`)
      expect(testCollection.has(502)).toBe(true)
    })

    it(`should preserve buffer across heartbeat batches until awaitMatch is called`, async () => {
      // This test verifies the fix for the race condition where:
      // 1. Batch 1 arrives with insert message + up-to-date
      // 2. Batch 2 arrives (heartbeat/empty) BEFORE awaitMatch is called
      // 3. awaitMatch is called - should still find the message from Batch 1
      // This was failing before because the buffer was cleared when Batch 2 arrived

      let resolveServerCall: () => void
      const serverCallPromise = new Promise<void>((resolve) => {
        resolveServerCall = resolve
      })

      const onInsert = vi
        .fn()
        .mockImplementation(async ({ transaction, collection: col }) => {
          const item = transaction.mutations[0].modified

          // Simulate a slow API call
          await serverCallPromise

          // awaitMatch is called AFTER multiple batches have arrived
          await col.utils.awaitMatch((message: any) => {
            return (
              isChangeMessage(message) &&
              message.headers.operation === `insert` &&
              message.value.id === item.id
            )
          }, 5000)
        })

      const config = {
        id: `test-buffer-preserved-across-heartbeats`,
        shapeOptions: {
          url: `http://test-url`,
          params: { table: `test_table` },
        },
        startSync: true,
        getKey: (item: Row) => item.id as number,
        onInsert,
      }

      const testCollection = createCollection(electricCollectionOptions(config))

      // Start insert - will call onInsert which waits for serverCallPromise
      const insertPromise = testCollection.insert({
        id: 600,
        name: `Heartbeat Race Test`,
      })

      // Wait for onInsert to start
      await new Promise((resolve) => setTimeout(resolve, 10))

      // Batch 1: insert message + up-to-date
      subscriber([
        {
          key: `600`,
          value: { id: 600, name: `Heartbeat Race Test` },
          headers: { operation: `insert` },
        },
        { headers: { control: `up-to-date` } },
      ])

      await new Promise((resolve) => setTimeout(resolve, 10))

      // Batch 2: heartbeat (just up-to-date, no insert messages)
      // This simulates Electric sending a heartbeat while the API call is still in progress
      // Previously, this would clear the buffer and lose the insert message from Batch 1
      subscriber([{ headers: { control: `up-to-date` } }])

      await new Promise((resolve) => setTimeout(resolve, 10))

      // Batch 3: another heartbeat (to really stress the scenario)
      subscriber([{ headers: { control: `up-to-date` } }])

      await new Promise((resolve) => setTimeout(resolve, 10))

      // Now resolve the server call - awaitMatch should still find the message
      // from Batch 1 despite Batches 2 and 3 arriving
      resolveServerCall!()

      // Should complete successfully
      await insertPromise.when(`settled`)

      expect(onInsert).toHaveBeenCalled()
      expect(testCollection.has(600)).toBe(true)
    })
  })

  // Tests for matching strategies utilities
  describe(`Matching strategies utilities`, () => {
    it(`should export isChangeMessage helper for custom match functions`, () => {
      expect(typeof isChangeMessage).toBe(`function`)

      // Test with a change message
      const changeMessage = {
        key: `1`,
        value: { id: 1, name: `Test` },
        headers: { operation: `insert` as const },
      }
      expect(isChangeMessage(changeMessage)).toBe(true)

      // Test with a control message
      const controlMessage = {
        headers: { control: `up-to-date` as const },
      }
      expect(isChangeMessage(controlMessage)).toBe(false)
    })

    it(`should export isChangeMessage and isControlMessage from package index`, async () => {
      // Verify that the exports are available from the package's public API
      // This tests the fix for the missing exports in index.ts
      const exports = await import(`../src/index`)

      expect(typeof exports.isChangeMessage).toBe(`function`)
      expect(typeof exports.isControlMessage).toBe(`function`)

      // Verify they work correctly
      const changeMessage = {
        key: `1`,
        value: { id: 1, name: `Test` },
        headers: { operation: `insert` as const },
      }
      expect(exports.isChangeMessage(changeMessage)).toBe(true)

      const controlMessage = {
        headers: { control: `up-to-date` as const },
      }
      expect(exports.isControlMessage(controlMessage)).toBe(true)
      expect(exports.isChangeMessage(controlMessage)).toBe(false)
    })

    it(`should provide awaitMatch utility in collection utils`, () => {
      const config = {
        id: `test-await-match`,
        shapeOptions: {
          url: `http://test-url`,
          params: { table: `test_table` },
        },
        getKey: (item: Row) => item.id as number,
      }

      const testCollection = createCollection(electricCollectionOptions(config))
      expect(typeof testCollection.utils.awaitMatch).toBe(`function`)
    })

    it(`passes distinct handlers through to collection options`, () => {
      const onInsert = vi.fn().mockResolvedValue(undefined)
      const onUpdate = vi.fn().mockResolvedValue(undefined)
      const onDelete = vi
        .fn()
        .mockImplementation(async ({ collection: col }) => {
          // Custom match using awaitMatch utility
          await col.utils.awaitMatch(
            (message: any) =>
              isChangeMessage(message) &&
              message.headers.operation === `delete`,
          )
        })

      const config = {
        id: `test-mixed-strategies`,
        shapeOptions: {
          url: `http://test-url`,
          params: { table: `test_table` },
        },
        getKey: (item: Row) => item.id as number,
        onInsert,
        onUpdate,
        onDelete,
      }

      const options = electricCollectionOptions(config)

      // All handlers are present on the resulting options
      expect(options.onInsert).toBeDefined()
      expect(options.onUpdate).toBeDefined()
      expect(options.onDelete).toBeDefined()
    })

    // NOTE: This test has a known issue with unhandled rejection warnings
    // This is a pre-existing issue from main branch (not caused by merge)
    // The test functionality works correctly, but vitest reports unhandled rejections
    it(`should cleanup pending matches on timeout without memory leaks`, async () => {
      vi.useFakeTimers()

      const onInsert = vi
        .fn()
        .mockImplementation(async ({ collection: col }) => {
          await col.utils.awaitMatch(
            () => false, // Never matches
            1, // Short timeout for test
          )
        })

      const config = {
        id: `test-cleanup`,
        shapeOptions: {
          url: `http://test-url`,
          params: { table: `test_table` },
        },
        startSync: true,
        getKey: (item: Row) => item.id as number,
        onInsert,
      }

      const testCollection = createCollection(electricCollectionOptions(config))

      // Start insert that will timeout
      const tx = testCollection.insert({ id: 1, name: `Timeout Test` })

      // Capture the rejection promise before advancing timers
      const rejectionPromise = expect(tx.when(`settled`)).rejects.toThrow(
        `Timeout waiting for custom match function`,
      )

      // Advance timers to trigger timeout
      await vi.runOnlyPendingTimersAsync()

      // Should timeout and fail
      await rejectionPromise

      // Send a message after timeout - should not cause any side effects
      // This verifies that the pending match was properly cleaned up
      expect(() => {
        subscriber([
          {
            key: `1`,
            value: { id: 1, name: `Timeout Test` },
            headers: { operation: `insert` },
          },
          { headers: { control: `up-to-date` } },
        ])
      }).not.toThrow()

      vi.useRealTimers()
    })

    it(`should wait for up-to-date after custom match (commit semantics)`, async () => {
      let matchFound = false
      let persistenceCompleted = false

      const onInsert = vi
        .fn()
        .mockImplementation(async ({ transaction, collection: col }) => {
          const item = transaction.mutations[0].modified
          await col.utils.awaitMatch((message: any) => {
            if (
              isChangeMessage(message) &&
              message.headers.operation === `insert` &&
              message.value.name === item.name
            ) {
              matchFound = true
              return true
            }
            return false
          }, 5000)
        })

      const config = {
        id: `test-commit-semantics`,
        shapeOptions: {
          url: `http://test-url`,
          params: { table: `test_table` },
        },
        startSync: true,
        getKey: (item: Row) => item.id as number,
        onInsert,
      }

      const testCollection = createCollection(electricCollectionOptions(config))

      // Start insert
      const insertPromise = testCollection.insert({
        id: 1,
        name: `Commit Test`,
      })

      // Set up persistence completion tracking
      insertPromise.when(`settled`).then(() => {
        persistenceCompleted = true
      })

      // Give a moment for handler setup
      await new Promise((resolve) => setTimeout(resolve, 50))

      // Send matching message (should match but not complete persistence yet)
      subscriber([
        {
          key: `1`,
          value: { id: 1, name: `Commit Test` },
          headers: { operation: `insert` },
        },
      ])

      // Give time for match to be processed
      await new Promise((resolve) => setTimeout(resolve, 50))

      // Verify match was found but persistence not yet completed
      expect(matchFound).toBe(true)
      expect(persistenceCompleted).toBe(false)

      // Now send up-to-date (should complete persistence)
      subscriber([{ headers: { control: `up-to-date` } }])

      // Wait for persistence to complete
      await insertPromise.when(`settled`)

      // Verify persistence completed after up-to-date
      expect(persistenceCompleted).toBe(true)
      expect(testCollection._state.syncedData.has(1)).toBe(true)
    })

    it(`should support custom timeout using setTimeout`, async () => {
      vi.useFakeTimers()

      const customTimeout = 500 // Custom short timeout

      const onInsert = vi.fn().mockImplementation(async () => {
        // Simple timeout approach
        await new Promise((resolve) => setTimeout(resolve, customTimeout))
      })

      const config = {
        id: `test-void-timeout`,
        shapeOptions: {
          url: `http://test-url`,
          params: { table: `test_table` },
        },
        startSync: true,
        getKey: (item: Row) => item.id as number,
        onInsert,
      }

      const testCollection = createCollection(electricCollectionOptions(config))

      // Insert with custom void timeout
      const tx = testCollection.insert({ id: 1, name: `Custom Timeout Test` })

      // Use runOnlyPendingTimers to execute the timeout
      await vi.runOnlyPendingTimersAsync()

      await expect(tx.when(`settled`)).resolves.toBeDefined()
      expect(onInsert).toHaveBeenCalled()

      vi.useRealTimers()
    })
  })

  // Tests for Electric stream lifecycle management
  describe(`Electric stream lifecycle management`, () => {
    let mockUnsubscribe: ReturnType<typeof vi.fn>
    let mockAbortController: {
      abort: ReturnType<typeof vi.fn>
      signal: AbortSignal
    }

    beforeEach(() => {
      // Clear all mocks before each lifecycle test
      vi.clearAllMocks()

      // Reset mocks before each test
      mockUnsubscribe = vi.fn()
      mockAbortController = {
        abort: vi.fn(),
        signal: new AbortController().signal,
      }

      // Update the mock to return our mock unsubscribe function
      mockSubscribe.mockImplementation((callback) => {
        subscriber = callback
        return mockUnsubscribe
      })

      // Mock AbortController
      global.AbortController = vi.fn().mockImplementation(function () {
        return mockAbortController
      })
    })

    afterEach(() => {
      globalThis.AbortController = NativeAbortController
    })

    it(`should call unsubscribe and abort when collection is cleaned up`, async () => {
      const config = {
        id: `cleanup-test`,
        shapeOptions: {
          url: `http://test-url`,
          params: {
            table: `test_table`,
          },
        },
        getKey: (item: Row) => item.id as number,
        startSync: true,
      }

      const testCollection = createCollection(electricCollectionOptions(config))

      // Verify stream is set up
      expect(mockSubscribe).toHaveBeenCalled()

      // Cleanup the collection
      await testCollection.cleanup()

      // Verify that both unsubscribe and abort were called
      expect(mockUnsubscribe).toHaveBeenCalledTimes(1)
      expect(mockAbortController.abort).toHaveBeenCalledTimes(1)
    })

    it(`should properly cleanup Electric-specific resources`, async () => {
      const config = {
        id: `resource-cleanup-test`,
        shapeOptions: {
          url: `http://test-url`,
          params: {
            table: `test_table`,
          },
        },
        getKey: (item: Row) => item.id as number,
        startSync: true,
      }

      const testCollection = createCollection(electricCollectionOptions(config))

      // Add some txids to track
      subscriber([
        {
          key: `1`,
          value: { id: 1, name: `Test` },
          headers: {
            operation: `insert`,
            txids: [100, 200],
          },
        },
        {
          headers: { control: `up-to-date` },
        },
      ])

      // Verify txids are tracked
      await expect(testCollection.utils.awaitTxId(100)).resolves.toBe(true)

      // Cleanup collection
      await testCollection.cleanup()

      // Verify cleanup was called
      expect(mockUnsubscribe).toHaveBeenCalled()
      expect(mockAbortController.abort).toHaveBeenCalled()
    })

    it(`should handle multiple cleanup calls gracefully`, async () => {
      const config = {
        id: `multiple-cleanup-test`,
        shapeOptions: {
          url: `http://test-url`,
          params: {
            table: `test_table`,
          },
        },
        getKey: (item: Row) => item.id as number,
        startSync: true,
      }

      const testCollection = createCollection(electricCollectionOptions(config))

      // Call cleanup multiple times
      await testCollection.cleanup()
      await testCollection.cleanup()
      await testCollection.cleanup()

      // Should only call unsubscribe once (from the first cleanup)
      expect(mockUnsubscribe).toHaveBeenCalledTimes(1)
      expect(mockAbortController.abort).toHaveBeenCalledTimes(1)
    })

    it(`should restart stream when collection is accessed after cleanup`, async () => {
      const config = {
        id: `restart-stream-test`,
        shapeOptions: {
          url: `http://test-url`,
          params: {
            table: `test_table`,
          },
        },
        getKey: (item: Row) => item.id as number,
        startSync: true,
      }

      const testCollection = createCollection(electricCollectionOptions(config))

      // Initial stream setup
      expect(mockSubscribe).toHaveBeenCalledTimes(1)
      mockStream.shapeHandle = `discarded-handle`
      mockStream.lastOffset = `42_0`
      subscriber([{ headers: { control: `up-to-date` } }])

      // Cleanup
      await testCollection.cleanup()
      expect(testCollection.status).toBe(`cleaned-up`)

      // Access collection data to restart sync
      const subscription = testCollection.subscribeChanges(() => {})

      // Should have started a new stream
      expect(mockSubscribe).toHaveBeenCalledTimes(2)
      expect(testCollection.status).toBe(`loading`)
      expect(vi.mocked(ShapeStream).mock.calls.at(-1)?.[0]).toMatchObject({
        offset: undefined,
        handle: undefined,
      })

      subscription.unsubscribe()
    })

    it(`should handle stream errors gracefully`, () => {
      const config = {
        id: `error-handling-test`,
        shapeOptions: {
          url: `http://test-url`,
          params: {
            table: `test_table`,
          },
        },
        getKey: (item: Row) => item.id as number,
        startSync: true,
      }

      // Mock stream to throw an error
      mockSubscribe.mockImplementation(() => {
        throw new Error(`Stream connection failed`)
      })

      expect(() => {
        createCollection(electricCollectionOptions(config))
      }).toThrow(`Stream connection failed`)
    })

    it(`should handle subscriber function errors without breaking`, () => {
      const config = {
        id: `subscriber-error-test`,
        shapeOptions: {
          url: `http://test-url`,
          params: {
            table: `test_table`,
          },
        },
        getKey: (item: Row) => item.id as number,
        startSync: true,
      }

      const testCollection = createCollection(electricCollectionOptions(config))

      // Mock console.error to capture error logs
      const consoleSpy = vi.spyOn(console, `error`).mockImplementation(() => {})

      // Send messages with invalid data that might cause internal errors
      // but shouldn't break the entire system
      expect(() => {
        subscriber([
          {
            key: `1`,
            value: { id: 1, name: `Valid User` }, // Use valid data
            headers: { operation: `insert` },
          },
        ])
      }).not.toThrow()

      // Should have processed the valid message without issues
      expect(testCollection._state.syncedData.size).toBe(0) // Still pending until up-to-date

      // Send up-to-date to commit
      expect(() => {
        subscriber([
          {
            headers: { control: `up-to-date` },
          },
        ])
      }).not.toThrow()

      // Now the data should be committed
      expect(testCollection.has(1)).toBe(true)

      consoleSpy.mockRestore()
    })

    it(`should properly handle concurrent stream operations`, async () => {
      const config = {
        id: `concurrent-test`,
        shapeOptions: {
          url: `http://test-url`,
          params: {
            table: `test_table`,
          },
        },
        getKey: (item: Row) => item.id as number,
        startSync: true,
      }

      const testCollection = createCollection(electricCollectionOptions(config))

      // Simulate concurrent messages
      const promises = [
        new Promise<void>((resolve) => {
          setTimeout(() => {
            subscriber([
              {
                key: `1`,
                value: { id: 1, name: `User 1` },
                headers: { operation: `insert` },
              },
            ])
            resolve()
          }, 10)
        }),
        new Promise<void>((resolve) => {
          setTimeout(() => {
            subscriber([
              {
                key: `2`,
                value: { id: 2, name: `User 2` },
                headers: { operation: `insert` },
              },
            ])
            resolve()
          }, 20)
        }),
        new Promise<void>((resolve) => {
          setTimeout(() => {
            subscriber([
              {
                headers: { control: `up-to-date` },
              },
            ])
            resolve()
          }, 30)
        }),
      ]

      await Promise.all(promises)

      // Both items should be in the collection
      expect(testCollection.has(1)).toBe(true)
      expect(testCollection.has(2)).toBe(true)
    })

    it(`should handle schema information extraction from messages`, () => {
      const config = {
        id: `schema-test`,
        shapeOptions: {
          url: `http://test-url`,
          params: {
            table: `test_table`,
          },
        },
        getKey: (item: Row) => item.id as number,
        startSync: true,
      }

      const testCollection = createCollection(electricCollectionOptions(config))

      // Send message with schema information
      subscriber([
        {
          key: `1`,
          value: { id: 1, name: `User 1` },
          headers: {
            operation: `insert`,
            schema: `custom_schema`,
          },
        },
        {
          headers: { control: `up-to-date` },
        },
      ])

      // Schema should be stored and used in sync metadata
      // This is internal behavior, but we can verify it doesn't cause errors
      expect(testCollection.has(1)).toBe(true)
    })

    it(`should handle invalid schema information gracefully`, () => {
      const config = {
        id: `invalid-schema-test`,
        shapeOptions: {
          url: `http://test-url`,
          params: {
            table: `test_table`,
          },
        },
        getKey: (item: Row) => item.id as number,
        startSync: true,
      }

      const testCollection = createCollection(electricCollectionOptions(config))

      // Send message with invalid schema information
      expect(() => {
        subscriber([
          {
            key: `1`,
            value: { id: 1, name: `User 1` },
            headers: {
              operation: `insert`,
              schema: 123 as any, // Invalid schema type
            },
          },
          {
            headers: { control: `up-to-date` },
          },
        ])
      }).not.toThrow()

      expect(testCollection.has(1)).toBe(true)
    })

    it(`should handle txids from control messages`, async () => {
      const config = {
        id: `control-txid-test`,
        shapeOptions: {
          url: `http://test-url`,
          params: {
            table: `test_table`,
          },
        },
        getKey: (item: Row) => item.id as number,
        startSync: true,
      }

      const testCollection = createCollection(electricCollectionOptions(config))

      // Send control message with txids (as numbers, per Electric API)
      subscriber([
        {
          headers: {
            control: `up-to-date`,
            txids: [300, 400],
          },
        },
      ])

      // Txids should be tracked (converted to strings internally)
      await expect(testCollection.utils.awaitTxId(300)).resolves.toBe(true)
      await expect(testCollection.utils.awaitTxId(400)).resolves.toBe(true)
    })

    it(`should handle snapshot-end messages and match txids via snapshot metadata`, async () => {
      const config = {
        id: `snapshot-test`,
        shapeOptions: {
          url: `http://test-url`,
          params: {
            table: `test_table`,
          },
        },
        getKey: (item: Row) => item.id as number,
        startSync: true,
      }

      const testCollection = createCollection(electricCollectionOptions(config))

      // Send snapshot-end message with PostgresSnapshot metadata
      // xmin=100, xmax=150, xip_list=[120, 130]
      // Visible: txid < 100 (committed before snapshot) OR (100 <= txid < 150 AND txid NOT IN [120, 130])
      // Not visible: txid >= 150 (not yet assigned) OR txid IN [120, 130] (in-progress)
      subscriber([
        {
          key: `1`,
          value: { id: 1, name: `Test User` },
          headers: { operation: `insert` },
        },
        {
          headers: {
            control: `snapshot-end`,
            xmin: `100`,
            xmax: `150`,
            xip_list: [`120`, `130`],
          },
        },
        {
          headers: { control: `up-to-date` },
        },
      ])

      // Txids that are visible in the snapshot should resolve
      // Txids < xmin are committed and visible
      await expect(testCollection.utils.awaitTxId(50)).resolves.toBe(true)
      await expect(testCollection.utils.awaitTxId(99)).resolves.toBe(true)

      // Txids in range [xmin, xmax) not in xip_list are visible
      await expect(testCollection.utils.awaitTxId(100)).resolves.toBe(true)
      await expect(testCollection.utils.awaitTxId(110)).resolves.toBe(true)
      await expect(testCollection.utils.awaitTxId(121)).resolves.toBe(true)
      await expect(testCollection.utils.awaitTxId(125)).resolves.toBe(true)
      await expect(testCollection.utils.awaitTxId(131)).resolves.toBe(true)
      await expect(testCollection.utils.awaitTxId(149)).resolves.toBe(true)

      // Txids in xip_list (in-progress transactions) should NOT resolve
      await expect(testCollection.utils.awaitTxId(120, 100)).rejects.toThrow(
        `Timeout waiting for txId: 120`,
      )
      await expect(testCollection.utils.awaitTxId(130, 100)).rejects.toThrow(
        `Timeout waiting for txId: 130`,
      )

      // Txids >= xmax should NOT resolve (not yet assigned)
      await expect(testCollection.utils.awaitTxId(150, 100)).rejects.toThrow(
        `Timeout waiting for txId: 150`,
      )
      await expect(testCollection.utils.awaitTxId(200, 100)).rejects.toThrow(
        `Timeout waiting for txId: 200`,
      )
    })

    it(`should await for txid that arrives later via snapshot-end`, async () => {
      const config = {
        id: `snapshot-await-test`,
        shapeOptions: {
          url: `http://test-url`,
          params: {
            table: `test_table`,
          },
        },
        getKey: (item: Row) => item.id as number,
        startSync: true,
      }

      const testCollection = createCollection(electricCollectionOptions(config))

      // Start waiting for a txid before snapshot arrives
      const txidToAwait = 105
      const promise = testCollection.utils.awaitTxId(txidToAwait, 2000)

      // Send snapshot-end message after a delay
      setTimeout(() => {
        subscriber([
          {
            headers: {
              control: `snapshot-end`,
              xmin: `100`,
              xmax: `110`,
              xip_list: [],
            },
          },
          {
            headers: { control: `up-to-date` },
          },
        ])
      }, 50)

      // The promise should resolve when the snapshot arrives
      await expect(promise).resolves.toBe(true)
    })

    it(`should handle multiple snapshots and track all of them`, async () => {
      const config = {
        id: `multiple-snapshots-test`,
        shapeOptions: {
          url: `http://test-url`,
          params: {
            table: `test_table`,
          },
        },
        getKey: (item: Row) => item.id as number,
        startSync: true,
      }

      const testCollection = createCollection(electricCollectionOptions(config))

      // Send first snapshot: visible txids < 110
      subscriber([
        {
          headers: {
            control: `snapshot-end`,
            xmin: `100`,
            xmax: `110`,
            xip_list: [],
          },
        },
        {
          headers: { control: `up-to-date` },
        },
      ])

      // Send second snapshot: visible txids < 210
      subscriber([
        {
          headers: {
            control: `snapshot-end`,
            xmin: `200`,
            xmax: `210`,
            xip_list: [],
          },
        },
        {
          headers: { control: `up-to-date` },
        },
      ])

      // Txids visible in first snapshot
      await expect(testCollection.utils.awaitTxId(105)).resolves.toBe(true)

      // Txids visible in second snapshot
      await expect(testCollection.utils.awaitTxId(205)).resolves.toBe(true)

      // Txid 150 is visible in second snapshot (< xmin=200 means committed)
      await expect(testCollection.utils.awaitTxId(150)).resolves.toBe(true)

      // Txids >= second snapshot's xmax should timeout (not yet assigned)
      await expect(testCollection.utils.awaitTxId(210, 100)).rejects.toThrow(
        `Timeout waiting for txId: 210`,
      )
      await expect(testCollection.utils.awaitTxId(300, 100)).rejects.toThrow(
        `Timeout waiting for txId: 300`,
      )
    })

    it(`should prefer explicit txids over snapshot matching when both are available`, async () => {
      const config = {
        id: `explicit-txid-priority-test`,
        shapeOptions: {
          url: `http://test-url`,
          params: {
            table: `test_table`,
          },
        },
        getKey: (item: Row) => item.id as number,
        startSync: true,
      }

      const testCollection = createCollection(electricCollectionOptions(config))

      // Send message with explicit txid and snapshot
      subscriber([
        {
          key: `1`,
          value: { id: 1, name: `Test User` },
          headers: {
            operation: `insert`,
            txids: [500],
          },
        },
        {
          headers: {
            control: `snapshot-end`,
            xmin: `100`,
            xmax: `110`,
            xip_list: [],
          },
        },
        {
          headers: { control: `up-to-date` },
        },
      ])

      // Explicit txid should resolve
      await expect(testCollection.utils.awaitTxId(500)).resolves.toBe(true)

      // Snapshot txid should also resolve
      await expect(testCollection.utils.awaitTxId(105)).resolves.toBe(true)
    })
  })

  // Tests for syncMode configuration
  describe(`syncMode configuration`, () => {
    const createOnDemandCollection = (id: string) =>
      createCollection(
        electricCollectionOptions({
          id,
          shapeOptions: {
            url: `http://test-url`,
            params: { table: `test_table` },
          },
          syncMode: `on-demand`,
          getKey: (item: Row) => item.id as number,
          startSync: true,
        }),
      )

    it(`removes the external shape abort listener across cleanup and restart`, async () => {
      const externalAbort = new NativeAbortController()
      const addSpy = vi.spyOn(externalAbort.signal, `addEventListener`)
      const removeSpy = vi.spyOn(externalAbort.signal, `removeEventListener`)
      const testCollection = createCollection(
        electricCollectionOptions({
          id: `shape-signal-listener-cleanup-test`,
          shapeOptions: {
            url: `http://test-url`,
            params: { table: `test_table` },
            signal: externalAbort.signal,
          },
          syncMode: `progressive`,
          getKey: (item: Row) => item.id as number,
          startSync: true,
        }),
      )

      await testCollection.cleanup()
      const subscription = testCollection.subscribeChanges(() => {})
      await testCollection.cleanup()
      subscription.unsubscribe()

      const addedListeners = addSpy.mock.calls
        .filter(([type]) => type === `abort`)
        .map(([, listener]) => listener)
      const removedListeners = removeSpy.mock.calls
        .filter(([type]) => type === `abort`)
        .map(([, listener]) => listener)
      expect(addedListeners).toHaveLength(2)
      expect(removedListeners).toEqual(addedListeners)
    })

    it(`should not request snapshots during subscription in eager mode`, () => {
      vi.clearAllMocks()

      const config = {
        id: `eager-no-snapshot-test`,
        shapeOptions: {
          url: `http://test-url`,
          params: {
            table: `test_table`,
          },
        },
        syncMode: `eager` as const,
        getKey: (item: Row) => item.id as number,
        startSync: true,
      }

      const testCollection = createCollection(electricCollectionOptions(config))

      // Subscribe and try to get more data
      const subscription = testCollection.subscribeChanges(() => {})

      // In eager mode, requestSnapshot should not be called
      expect(mockRequestSnapshot).not.toHaveBeenCalled()

      subscription.unsubscribe()
    })

    it(`should request incremental snapshots in on-demand mode when loadSubset is called`, async () => {
      vi.clearAllMocks()

      const config = {
        id: `on-demand-snapshot-test`,
        shapeOptions: {
          url: `http://test-url`,
          params: {
            table: `test_table`,
          },
        },
        syncMode: `on-demand` as const,
        getKey: (item: Row) => item.id as number,
        startSync: true,
      }

      const testCollection = createCollection(electricCollectionOptions(config))

      // Send up-to-date to mark collection as ready
      subscriber([
        {
          headers: { control: `up-to-date` },
        },
      ])

      // In on-demand mode, calling loadSubset should request a snapshot
      await testCollection._sync.loadSubset({ limit: 10 })

      expect(mockForceDisconnectAndRefresh).not.toHaveBeenCalled()
      expect(mockRequestSnapshot).toHaveBeenCalledWith(
        expect.objectContaining({
          limit: 10,
          params: {},
        }),
      )
    })

    it(`retains Electric coverage when the adapter cannot unload it`, async () => {
      const testCollection = createCollection(
        electricCollectionOptions({
          id: `on-demand-unload-coverage-test`,
          shapeOptions: {
            url: `http://test-url`,
            params: { table: `test_table` },
          },
          syncMode: `on-demand`,
          getKey: (item: Row) => item.id as number,
          startSync: true,
        }),
      )
      const options = { limit: 10 }

      try {
        await testCollection._sync.loadSubset(options)
        testCollection._sync.unloadSubset(options)
        await testCollection._sync.loadSubset(options)

        expect(mockRequestSnapshot).toHaveBeenCalledTimes(1)
      } finally {
        await testCollection.cleanup()
      }
    })

    it(`waits for an on-demand commit to become public`, async () => {
      const request = createDeferred<void>()
      mockRequestSnapshot.mockReturnValueOnce(request.promise)
      const testCollection = createOnDemandCollection(
        `on-demand-successful-parked-commit-test`,
      )
      const persistence = createDeferred<void>()
      const transaction = createTransaction({
        mutationFn: () => persistence.promise,
      })

      try {
        transaction.mutate(() =>
          testCollection.insert({ id: 3, name: `Local row` }),
        )
        const load = Promise.resolve(
          testCollection._sync.loadSubset({ limit: 10 }),
        )
        await vi.waitFor(() =>
          expect(mockRequestSnapshot).toHaveBeenCalledOnce(),
        )
        subscriber([
          {
            key: `2`,
            value: { id: 2, name: `Applied parked row` },
            headers: { operation: `insert` },
          },
          { headers: { control: `subset-end` } },
        ])
        request.resolve()

        const nextTurn = new Promise<`next-turn`>((resolve) =>
          setTimeout(() => resolve(`next-turn`), 0),
        )
        await expect(
          Promise.race([load.then(() => `load-settled` as const), nextTurn]),
        ).resolves.toBe(`next-turn`)
        expect(testCollection.has(2)).toBe(false)

        persistence.resolve()
        await transaction.when(`settled`)
        await load
        expect(stripVirtualProps(testCollection.get(2))).toEqual({
          id: 2,
          name: `Applied parked row`,
        })
      } finally {
        request.resolve()
        persistence.resolve()
        await transaction.when(`settled`).catch(() => undefined)
        await testCollection.cleanup()
      }
    })

    it(`serializes and waits for both physical requests of one cursor demand`, async () => {
      const whereCurrent = createDeferred<void>()
      const whereFrom = createDeferred<void>()
      mockRequestSnapshot
        .mockReturnValueOnce(whereCurrent.promise)
        .mockReturnValueOnce(whereFrom.promise)
      const testCollection = createOnDemandCollection(
        `on-demand-cursor-all-requests-test`,
      )
      const id = new IR.PropRef([`id`])

      try {
        const load = Promise.resolve(
          testCollection._sync.loadSubset({
            limit: 10,
            orderBy: [
              {
                expression: id,
                compareOptions: {
                  direction: `asc`,
                  nulls: `last`,
                  stringSort: `lexical`,
                },
              },
            ],
            cursor: {
              whereCurrent: new IR.Func(`eq`, [id, new IR.Value(1)]),
              whereFrom: new IR.Func(`gt`, [id, new IR.Value(1)]),
              lastKey: 1,
            },
          }),
        )
        await vi.waitFor(() =>
          expect(mockRequestSnapshot).toHaveBeenCalledOnce(),
        )

        whereCurrent.resolve()
        await vi.waitFor(() =>
          expect(mockRequestSnapshot).toHaveBeenCalledTimes(2),
        )
        const nextTurn = new Promise<`next-turn`>((resolve) =>
          setTimeout(() => resolve(`next-turn`), 0),
        )
        await expect(
          Promise.race([load.then(() => `load-settled` as const), nextTurn]),
        ).resolves.toBe(`next-turn`)

        whereFrom.resolve()
        await load
      } finally {
        whereCurrent.resolve()
        whereFrom.resolve()
        await testCollection.cleanup()
      }
    })

    it.each([
      { syncMode: `on-demand`, signalSource: `collection` },
      { syncMode: `on-demand`, signalSource: `request` },
      { syncMode: `progressive`, signalSource: `collection` },
      { syncMode: `progressive`, signalSource: `request` },
    ] as const)(
      `starts no $syncMode work for an already-aborted $signalSource signal`,
      async ({ syncMode, signalSource }) => {
        const abortController = new AbortController()
        abortController.abort()
        const testCollection = createCollection(
          electricCollectionOptions({
            id: `${syncMode}-${signalSource}-already-aborted`,
            shapeOptions: {
              url: `http://test-url`,
              params: { table: `test_table` },
              signal:
                signalSource === `collection`
                  ? abortController.signal
                  : undefined,
            },
            syncMode,
            getKey: (item: Row) => item.id as number,
            startSync: true,
          }),
        )

        await expect(
          testCollection._sync.loadSubset({
            limit: 10,
            signal:
              signalSource === `request` ? abortController.signal : undefined,
          }),
        ).rejects.toMatchObject({ name: `AbortError` })
        expect(mockForceDisconnectAndRefresh).not.toHaveBeenCalled()
        expect(mockRequestSnapshot).not.toHaveBeenCalled()
        expect(mockFetchSnapshot).not.toHaveBeenCalled()
        await testCollection.cleanup()
      },
    )

    it(`lets requestSnapshot transition an up-to-date stream to a subset request`, async () => {
      vi.clearAllMocks()

      const config = {
        id: `on-demand-snapshot-up-to-date-test`,
        shapeOptions: {
          url: `http://test-url`,
          params: {
            table: `test_table`,
          },
        },
        syncMode: `on-demand` as const,
        getKey: (item: Row) => item.id as number,
        startSync: true,
      }

      const testCollection = createCollection(electricCollectionOptions(config))

      mockStream.isUpToDate = true

      await testCollection._sync.loadSubset({ limit: 10 })

      expect(mockForceDisconnectAndRefresh).not.toHaveBeenCalled()
      expect(mockRequestSnapshot).toHaveBeenCalledTimes(1)
      await testCollection.cleanup()
    })

    it(`issues one snapshot and no ordinary refresh for each distinct demand`, async () => {
      const testCollection = createOnDemandCollection(
        `on-demand-distinct-snapshot-count-test`,
      )

      try {
        for (let limit = 1; limit <= 10; limit++) {
          await testCollection._sync.loadSubset({ limit })
        }

        expect(mockRequestSnapshot).toHaveBeenCalledTimes(10)
        expect(mockForceDisconnectAndRefresh).not.toHaveBeenCalled()
      } finally {
        await testCollection.cleanup()
      }
    })

    it(`retries a warm snapshot after its previous request rejects`, async () => {
      const failure = new Error(`snapshot failed`)
      mockRequestSnapshot
        .mockRejectedValueOnce(failure)
        .mockResolvedValueOnce(undefined)
      const testCollection = createOnDemandCollection(
        `on-demand-snapshot-retry-test`,
      )

      try {
        await expect(
          Promise.resolve(testCollection._sync.loadSubset({ limit: 10 })),
        ).rejects.toBe(failure)
        await testCollection._sync.loadSubset({ limit: 10 })

        expect(mockRequestSnapshot).toHaveBeenCalledTimes(2)
        expect(mockForceDisconnectAndRefresh).not.toHaveBeenCalled()
      } finally {
        await testCollection.cleanup()
      }
    })

    it(`should fetch snapshots in progressive mode when loadSubset is called before sync completes`, async () => {
      vi.clearAllMocks()

      mockSubscribe.mockImplementation((_callback) => {
        return () => {}
      })
      mockRequestSnapshot.mockResolvedValue(undefined)
      mockFetchSnapshot.mockResolvedValue({
        metadata: {},
        data: [
          {
            key: `2`,
            value: { id: 2, name: `Snapshot User` },
            headers: { operation: `insert` },
          },
        ],
      })

      const config = {
        id: `progressive-snapshot-test`,
        shapeOptions: {
          url: `http://test-url`,
          params: {
            table: `test_table`,
          },
        },
        syncMode: `progressive` as const,
        getKey: (item: Row) => item.id as number,
        startSync: true,
      }

      const testCollection = createCollection(electricCollectionOptions(config))

      expect(testCollection.status).toBe(`loading`) // Not ready yet

      // In progressive mode, calling loadSubset should fetch a snapshot BEFORE full sync completes
      await testCollection._sync.loadSubset({ limit: 20 })

      // Verify fetchSnapshot was called (not requestSnapshot)
      expect(mockFetchSnapshot).toHaveBeenCalledWith(
        expect.objectContaining({
          limit: 20,
          params: {},
        }),
      )
      expect(mockRequestSnapshot).not.toHaveBeenCalled()

      // Verify snapshot data was applied
      expect(testCollection.has(2)).toBe(true)
      expect(stripVirtualProps(testCollection.get(2))).toEqual({
        id: 2,
        name: `Snapshot User`,
      })
    })

    // A caller that aborts sees `AbortError` at every cut: here, after the
    // fetch but before its commit, so the snapshot is discarded.
    it(`discards a progressive snapshot after its subset request is aborted, and rejects the load`, async () => {
      mockFetchSnapshot.mockReset()
      let resolveSnapshot!: (value: {
        metadata: Record<string, never>
        data: Array<{
          key: string
          value: Row
          headers: { operation: `insert` }
        }>
      }) => void
      mockFetchSnapshot.mockReturnValue(
        new Promise((resolve) => {
          resolveSnapshot = resolve
        }),
      )
      mockSubscribe.mockImplementation(() => () => {})
      const testCollection = createCollection(
        electricCollectionOptions({
          id: `progressive-aborted-snapshot-test`,
          shapeOptions: {
            url: `http://test-url`,
            params: { table: `test_table` },
          },
          syncMode: `progressive`,
          getKey: (item: Row) => item.id as number,
          startSync: true,
        }),
      )
      const abortController = new AbortController()

      try {
        expect(mockFetchSnapshot).not.toHaveBeenCalled()
        const load = testCollection._sync.loadSubset({
          limit: 1,
          signal: abortController.signal,
        })
        expect(mockFetchSnapshot).toHaveBeenCalledOnce()
        expect(testCollection.has(2)).toBe(false)
        abortController.abort()
        resolveSnapshot({
          metadata: {},
          data: [
            {
              key: `2`,
              value: { id: 2, name: `Obsolete snapshot` },
              headers: { operation: `insert` },
            },
          ],
        })
        if (load === true) throw new Error(`Expected a pending subset load`)
        await expect(load).rejects.toMatchObject({ name: `AbortError` })

        expect(testCollection.has(2)).toBe(false)
      } finally {
        resolveSnapshot({ metadata: {}, data: [] })
        await testCollection.cleanup()
      }
    })

    it(`rejects a progressive subset load whose fetch fails because it was aborted`, async () => {
      mockFetchSnapshot.mockReset()
      const abortController = new AbortController()
      mockFetchSnapshot.mockImplementation(async () => {
        abortController.abort()
        throw new DOMException(`aborted`, `AbortError`)
      })
      mockSubscribe.mockImplementation(() => () => {})
      const testCollection = createCollection(
        electricCollectionOptions({
          id: `progressive-aborted-fetch-test`,
          shapeOptions: {
            url: `http://test-url`,
            params: { table: `test_table` },
          },
          syncMode: `progressive`,
          getKey: (item: Row) => item.id as number,
          startSync: true,
        }),
      )
      try {
        const load = testCollection._sync.loadSubset({
          limit: 1,
          signal: abortController.signal,
        })
        if (load === true) throw new Error(`Expected a pending subset load`)
        await expect(load).rejects.toMatchObject({ name: `AbortError` })
      } finally {
        await testCollection.cleanup()
      }
    })

    // A commit that core accepted always applies. Aborting the request after
    // its snapshot committed cannot withdraw those rows, but the load rejects.
    it(`publishes an accepted progressive snapshot and rejects its aborted load`, async () => {
      mockFetchSnapshot.mockResolvedValue({
        metadata: {},
        data: [
          {
            key: `2`,
            value: { id: 2, name: `Obsolete snapshot` },
            headers: { operation: `insert` },
          },
        ],
      })
      mockSubscribe.mockImplementation(() => () => {})
      const testCollection = createCollection(
        electricCollectionOptions({
          id: `progressive-parked-abort-test`,
          shapeOptions: {
            url: `http://test-url`,
            params: { table: `test_table` },
          },
          syncMode: `progressive`,
          getKey: (item: Row) => item.id as number,
          startSync: true,
        }),
      )
      const persistence = createDeferred<void>()
      const transaction = createTransaction({
        mutationFn: () => persistence.promise,
      })
      const abortController = new AbortController()

      try {
        transaction.mutate(() =>
          testCollection.insert({ id: 3, name: `Local row` }),
        )
        const load = testCollection._sync.loadSubset({
          limit: 1,
          signal: abortController.signal,
        })
        await vi.waitFor(() => expect(mockFetchSnapshot).toHaveBeenCalledOnce())
        await Promise.resolve()
        await Promise.resolve()

        expect(testCollection.has(2)).toBe(false)
        abortController.abort()
        persistence.resolve()
        await transaction.when(`settled`)
        // The accepted snapshot applies, but the aborted caller sees
        // `AbortError`.
        if (load === true) throw new Error(`Expected a pending subset load`)
        await expect(load).rejects.toMatchObject({ name: `AbortError` })

        expect(testCollection.has(2)).toBe(true)
      } finally {
        abortController.abort()
        persistence.resolve()
        await transaction.when(`settled`).catch(() => undefined)
        await testCollection.cleanup()
      }
    })

    it(`should not request snapshots when loadSubset is called in eager mode`, async () => {
      vi.clearAllMocks()

      const config = {
        id: `eager-no-loadsubset-test`,
        shapeOptions: {
          url: `http://test-url`,
          params: {
            table: `test_table`,
          },
        },
        syncMode: `eager` as const,
        getKey: (item: Row) => item.id as number,
        startSync: true,
      }

      const testCollection = createCollection(electricCollectionOptions(config))

      // Send up-to-date to mark collection as ready
      subscriber([
        {
          headers: { control: `up-to-date` },
        },
      ])

      // In eager mode, loadSubset should do nothing
      await testCollection._sync.loadSubset({ limit: 10 })

      // Verify requestSnapshot was NOT called
      expect(mockRequestSnapshot).not.toHaveBeenCalled()
    })

    it(`should handle progressive mode syncing in background`, async () => {
      vi.clearAllMocks()

      let testSubscriber!: (messages: Array<Message<Row>>) => void
      mockSubscribe.mockImplementation((callback) => {
        testSubscriber = callback
        return () => {}
      })
      mockRequestSnapshot.mockResolvedValue(undefined)
      mockFetchSnapshot.mockResolvedValue({
        metadata: {},
        data: [
          {
            key: `2`,
            value: { id: 2, name: `Snapshot User` },
            headers: { operation: `insert` },
          },
        ],
      })

      const config = {
        id: `progressive-background-sync-test`,
        shapeOptions: {
          url: `http://test-url`,
          params: {
            table: `test_table`,
          },
        },
        syncMode: `progressive` as const,
        getKey: (item: Row) => item.id as number,
        startSync: true,
      }

      const testCollection = createCollection(electricCollectionOptions(config))

      // Send stream data during snapshot phase (should be buffered)
      testSubscriber([
        {
          key: `1`,
          value: { id: 1, name: `Initial User` },
          headers: { operation: `insert` },
        },
      ])

      // Collection should NOT have the buffered data yet
      expect(testCollection.status).toBe(`loading`)
      expect(testCollection.has(1)).toBe(false)

      // Should be able to fetch snapshot data incrementally before full sync completes
      await testCollection._sync.loadSubset({ limit: 10 })
      expect(mockFetchSnapshot).toHaveBeenCalled()
      expect(mockRequestSnapshot).not.toHaveBeenCalled()

      // Snapshot data should be visible
      expect(testCollection.has(2)).toBe(true)

      // Now send up-to-date to complete the sync (triggers atomic swap)
      testSubscriber([
        {
          headers: { control: `up-to-date` },
        },
      ])

      expect(testCollection.status).toBe(`ready`)

      // After atomic swap, buffered data should be visible, snapshot data cleared
      expect(testCollection.has(1)).toBe(true)
      expect(testCollection.has(2)).toBe(false) // Snapshot data truncated
    })

    it(`should stop fetching snapshots in progressive mode after first up-to-date and perform atomic swap`, async () => {
      vi.clearAllMocks()

      let testSubscriber!: (messages: Array<Message<Row>>) => void
      mockSubscribe.mockImplementation((callback) => {
        testSubscriber = callback
        return () => {}
      })
      mockRequestSnapshot.mockResolvedValue(undefined)
      mockFetchSnapshot.mockResolvedValue({
        metadata: {},
        data: [
          {
            key: `2`,
            value: { id: 2, name: `Snapshot User` },
            headers: { operation: `insert` },
          },
        ],
      })

      const config = {
        id: `progressive-stop-after-sync-test`,
        shapeOptions: {
          url: `http://test-url`,
          params: {
            table: `test_table`,
          },
        },
        syncMode: `progressive` as const,
        getKey: (item: Row) => item.id as number,
        startSync: true,
      }

      const testCollection = createCollection(electricCollectionOptions(config))

      expect(testCollection.status).toBe(`loading`) // Not ready yet in progressive

      // Should be able to fetch data before up-to-date (snapshot phase)
      vi.clearAllMocks()
      await testCollection._sync.loadSubset({ limit: 10 })
      expect(mockFetchSnapshot).toHaveBeenCalledTimes(1)
      expect(testCollection.has(2)).toBe(true) // Snapshot data applied

      // Send change messages during snapshot phase (should be buffered)
      testSubscriber([
        {
          key: `1`,
          value: { id: 1, name: `User 1` },
          headers: { operation: `insert` },
        },
      ])

      // Data should NOT be visible yet (buffered)
      expect(testCollection.has(1)).toBe(false)

      // Now send up-to-date to complete the full sync and trigger atomic swap
      testSubscriber([
        {
          headers: { control: `up-to-date` },
        },
      ])

      expect(testCollection.status).toBe(`ready`)

      // After atomic swap, buffered data should be visible
      expect(testCollection.has(1)).toBe(true)
      // Snapshot data should be cleared by truncate, so id:2 should be gone
      expect(testCollection.has(2)).toBe(false)

      // Try to fetch more data - should NOT make a request since full sync is complete
      vi.clearAllMocks()
      await testCollection._sync.loadSubset({ limit: 10 })
      expect(mockFetchSnapshot).not.toHaveBeenCalled()
    })

    it(`should allow snapshots in on-demand mode even after up-to-date`, async () => {
      vi.clearAllMocks()

      const config = {
        id: `on-demand-after-sync-test`,
        shapeOptions: {
          url: `http://test-url`,
          params: {
            table: `test_table`,
          },
        },
        syncMode: `on-demand` as const,
        getKey: (item: Row) => item.id as number,
        startSync: true,
      }

      const testCollection = createCollection(electricCollectionOptions(config))

      // Send initial data with up-to-date
      subscriber([
        {
          key: `1`,
          value: { id: 1, name: `User 1` },
          headers: { operation: `insert` },
        },
        {
          headers: { control: `up-to-date` },
        },
      ])

      expect(testCollection.status).toBe(`ready`)

      // Should STILL be able to request more data in on-demand mode
      vi.clearAllMocks()
      await testCollection._sync.loadSubset({ limit: 10 })
      expect(mockRequestSnapshot).toHaveBeenCalled()
    })

    it(`should ignore snapshot data when fetchSnapshot completes after up-to-date in progressive mode`, async () => {
      vi.clearAllMocks()

      let testSubscriber!: (messages: Array<Message<Row>>) => void
      let resolveFetchSnapshot!: (value: any) => void
      const fetchSnapshotPromise = new Promise((resolve) => {
        resolveFetchSnapshot = resolve as any
      })

      mockSubscribe.mockImplementation((callback) => {
        testSubscriber = callback
        return () => {}
      })
      mockRequestSnapshot.mockResolvedValue(undefined)
      // Mock fetchSnapshot to return a promise we control
      mockFetchSnapshot.mockReturnValue(fetchSnapshotPromise)

      const config = {
        id: `progressive-snapshot-race-test`,
        shapeOptions: {
          url: `http://test-url`,
          params: {
            table: `test_table`,
          },
        },
        syncMode: `progressive` as const,
        getKey: (item: Row) => item.id as number,
        startSync: true,
      }

      const testCollection = createCollection(electricCollectionOptions(config))

      expect(testCollection.status).toBe(`loading`)

      // Start a loadSubset request (should call fetchSnapshot)
      const loadSubsetPromise = testCollection._sync.loadSubset({ limit: 10 })

      // Verify fetchSnapshot was called
      expect(mockFetchSnapshot).toHaveBeenCalled()

      // Before the snapshot completes, send up-to-date to complete the sync
      testSubscriber([
        {
          key: `1`,
          value: { id: 1, name: `Buffered User` },
          headers: { operation: `insert` },
        },
        {
          headers: { control: `up-to-date` },
        },
      ])

      // Sync should be complete now
      expect(testCollection.status).toBe(`ready`)
      expect(testCollection.has(1)).toBe(true)
      expect(testCollection.size).toBe(1)

      // Now resolve the fetchSnapshot with data
      resolveFetchSnapshot({
        metadata: {},
        data: [
          {
            key: `2`,
            value: { id: 2, name: `Late Snapshot User` },
            headers: { operation: `insert` },
          },
        ],
      })

      // Wait for loadSubset to complete
      await loadSubsetPromise

      // The snapshot data should be IGNORED because sync already completed
      expect(testCollection.has(2)).toBe(false)
      expect(testCollection.size).toBe(1) // Still only the buffered user
      expect(stripVirtualProps(testCollection.get(1))).toEqual({
        id: 1,
        name: `Buffered User`,
      })
    })

    it(`should default offset to 'now' in on-demand mode when no offset provided`, async () => {
      vi.clearAllMocks()

      // Import ShapeStream to check constructor calls
      const { ShapeStream } = await import(`@electric-sql/client`)

      const config = {
        id: `on-demand-offset-now-test`,
        shapeOptions: {
          url: `http://test-url`,
          params: {
            table: `test_table`,
          },
          // No offset provided
        },
        syncMode: `on-demand` as const,
        getKey: (item: Row) => item.id as number,
        startSync: true,
      }

      createCollection(electricCollectionOptions(config))

      // Check that ShapeStream was called with offset: 'now'
      expect(ShapeStream).toHaveBeenCalledWith(
        expect.objectContaining({
          offset: `now`,
        }),
      )
    })

    it(`should use undefined offset in eager mode when no offset provided`, async () => {
      vi.clearAllMocks()

      const { ShapeStream } = await import(`@electric-sql/client`)

      const config = {
        id: `eager-offset-undefined-test`,
        shapeOptions: {
          url: `http://test-url`,
          params: {
            table: `test_table`,
          },
          // No offset provided
        },
        syncMode: `eager` as const,
        getKey: (item: Row) => item.id as number,
        startSync: true,
      }

      createCollection(electricCollectionOptions(config))

      // Check that ShapeStream was called with offset: undefined
      expect(ShapeStream).toHaveBeenCalledWith(
        expect.objectContaining({
          offset: undefined,
        }),
      )
    })

    it(`should use undefined offset in progressive mode when no offset provided`, async () => {
      vi.clearAllMocks()

      const { ShapeStream } = await import(`@electric-sql/client`)

      const config = {
        id: `progressive-offset-undefined-test`,
        shapeOptions: {
          url: `http://test-url`,
          params: {
            table: `test_table`,
          },
          // No offset provided
        },
        syncMode: `progressive` as const,
        getKey: (item: Row) => item.id as number,
        startSync: true,
      }

      createCollection(electricCollectionOptions(config))

      // Check that ShapeStream was called with offset: undefined
      expect(ShapeStream).toHaveBeenCalledWith(
        expect.objectContaining({
          offset: undefined,
        }),
      )
    })

    it(`should use explicit offset when provided regardless of syncMode`, async () => {
      vi.clearAllMocks()

      const { ShapeStream } = await import(`@electric-sql/client`)

      const config = {
        id: `explicit-offset-test`,
        shapeOptions: {
          url: `http://test-url`,
          params: {
            table: `test_table`,
          },
          offset: -1 as any, // Explicit offset
        },
        syncMode: `on-demand` as const,
        getKey: (item: Row) => item.id as number,
        startSync: true,
      }

      createCollection(electricCollectionOptions(config))

      // Check that ShapeStream was called with the explicit offset
      expect(ShapeStream).toHaveBeenCalledWith(
        expect.objectContaining({
          offset: -1,
        }),
      )
    })

    it(`uses direct resume metadata when persistence is explicitly null`, async () => {
      vi.clearAllMocks()

      const { ShapeStream } = await import(`@electric-sql/client`)
      const metadataHarness = createInMemorySyncMetadataApi(
        new Map([
          [
            `electric:resume`,
            {
              kind: `resume`,
              requiresTagState: false,
              offset: `10_0`,
              handle: `handle-1`,
              shapeId: `{"params":{"table":"test_table"},"url":"http://test-url"}`,
              updatedAt: 1,
            },
          ],
        ]),
      )

      const baseOptions = electricCollectionOptions({
        id: `persisted-resume-test`,
        shapeOptions: {
          url: `http://test-url`,
          params: {
            table: `test_table`,
          },
        },
        syncMode: `on-demand` as const,
        getKey: (item: Row) => item.id as number,
        startSync: true,
      })

      const originalSync = baseOptions.sync
      expect(metadataHarness.api.persistence).toBeNull()
      createCollection({
        ...baseOptions,
        sync: {
          sync: (params: Parameters<typeof originalSync.sync>[0]) =>
            originalSync.sync({
              ...params,
              metadata: metadataHarness.api,
            }),
        },
      })

      expect(ShapeStream).toHaveBeenCalledWith(
        expect.objectContaining({
          offset: `10_0`,
          handle: `handle-1`,
        }),
      )
    })

    it(`treats omitted optional sync metadata as no persistence`, async () => {
      vi.clearAllMocks()
      const options = electricCollectionOptions<Row>({
        id: `omitted-sync-metadata-test`,
        shapeOptions: {
          url: `http://test-url`,
          params: { table: `test_table` },
        },
        getKey: (item) => item.id as number,
        startSync: false,
      })
      const electricSync = options.sync
      const collectionWithoutMetadata = createCollection({
        ...options,
        sync: {
          sync: (params: Parameters<typeof electricSync.sync>[0]) => {
            const { metadata: _omitted, ...paramsWithoutMetadata } = params
            return electricSync.sync(paramsWithoutMetadata)
          },
        },
      })

      let startError: unknown
      try {
        collectionWithoutMetadata.startSyncImmediate()
      } catch (error) {
        startError = error
      } finally {
        await collectionWithoutMetadata.cleanup()
      }

      expect(startError).toBeUndefined()
      expect(ShapeStream).toHaveBeenCalledWith(
        expect.objectContaining({
          url: `http://test-url`,
        }),
      )
    })

    it(`rejects a sync wrapper that drops the entire persistence field before opening ShapeStream`, async () => {
      vi.clearAllMocks()
      const { ShapeStream } = await import(`@electric-sql/client`)
      const durableResume = {
        kind: `resume`,
        requiresTagState: false,
        offset: `10_0`,
        handle: `handle-1`,
        shapeId: `{"params":{"table":"test_table"},"url":"http://test-url"}`,
        updatedAt: 1,
      }
      const collectionMetadata = new Map<string, unknown>([
        [`electric:resume`, durableResume],
      ])
      const electricOptions = electricCollectionOptions<Row>({
        id: `missing-persisted-wrapper-capability-test`,
        shapeOptions: {
          url: `http://test-url`,
          params: { table: `test_table` },
        },
        getKey: (item) => item.id as number,
        startSync: false,
      })
      const electricSync = electricOptions.sync
      const persistedCollection = createCollection(
        persistedCollectionOptions({
          ...electricOptions,
          sync: {
            ...electricSync,
            sync: (params: Parameters<typeof electricSync.sync>[0]) => {
              const { persistence: _dropped, ...metadataWithoutPersistence } =
                params.metadata!
              return electricSync.sync({
                ...params,
                metadata:
                  metadataWithoutPersistence as unknown as SyncMetadataApi<
                    string | number
                  >,
              })
            },
          },
          persistence: {
            adapter: createPersistedAdapter(collectionMetadata),
          },
        }) as any,
      )

      const preload = persistedCollection.preload()
      await expect(preload).rejects.toThrow(
        /expected null or a complete capability object.*forward metadata\.persistence unchanged/i,
      )

      expect(persistedCollection.status).toBe(`error`)
      expect(ShapeStream).not.toHaveBeenCalled()
      expect(collectionMetadata.get(`electric:resume`)).toEqual(durableResume)
      await persistedCollection.cleanup()
    })

    it(`rejects an incomplete advertised persistence capability before opening ShapeStream`, async () => {
      vi.clearAllMocks()
      const metadataHarness = createInMemorySyncMetadataApi()
      const malformedMetadata = Object.assign(metadataHarness.api, {
        persistence: {
          protocol: `@tanstack/db/sync-persistence`,
          version: 1,
          hydrateBaseline: () => Promise.resolve(),
          reserveCommitTurn: () => {},
          scanPersistedRows: () => Promise.resolve([]),
          resumeSnapshot: {
            certify: () => Promise.resolve(),
            getKeySetEvidence: () => ({ status: `consistent` as const }),
          },
        },
      })
      const options = electricCollectionOptions<Row>({
        id: `incomplete-persistence-capability-test`,
        shapeOptions: {
          url: `http://test-url`,
          params: { table: `test_table` },
        },
        getKey: (item) => item.id as number,
        startSync: false,
      })
      const originalSync = options.sync

      let cleanup: (() => Promise<void>) | undefined
      let configurationError: unknown
      try {
        const malformedCollection = createCollection({
          ...options,
          startSync: true,
          sync: {
            ...originalSync,
            sync: (params: Parameters<typeof originalSync.sync>[0]) =>
              originalSync.sync({ ...params, metadata: malformedMetadata }),
          },
        })
        cleanup = () => malformedCollection.cleanup()
      } catch (error) {
        configurationError = error
      }

      await cleanup?.()

      expect(configurationError).toEqual(
        expect.objectContaining({
          message: expect.stringMatching(
            /persistence.*capability.*expectCurrentCommit/i,
          ),
        }),
      )
      expect(ShapeStream).not.toHaveBeenCalled()
    })

    it(`fails fast when a persistence wrapper drops resume generation ownership`, async () => {
      vi.clearAllMocks()
      const { ShapeStream } = await import(`@electric-sql/client`)
      const durableResume = {
        kind: `resume`,
        requiresTagState: false,
        offset: `10_0`,
        handle: `handle-1`,
        shapeId: `{"params":{"table":"test_table"},"url":"http://test-url"}`,
        updatedAt: 1,
      }
      const collectionMetadata = new Map<string, unknown>([
        [`electric:resume`, durableResume],
      ])
      const electricOptions = electricCollectionOptions<Row>({
        id: `malformed-persisted-wrapper-capability-test`,
        shapeOptions: {
          url: `http://test-url`,
          params: { table: `test_table` },
        },
        getKey: (item) => item.id as number,
        startSync: false,
      })
      const electricSync = electricOptions.sync
      const persistedCollection = createCollection(
        persistedCollectionOptions({
          ...electricOptions,
          sync: {
            ...electricSync,
            sync: (params: Parameters<typeof electricSync.sync>[0]) => {
              const persistence = params.metadata?.persistence
              if (!persistence) {
                throw new Error(`Expected a persistence capability`)
              }
              const { expectCurrentCommit: _dropped, ...resumeSnapshot } =
                persistence.resumeSnapshot
              return electricSync.sync({
                ...params,
                metadata: {
                  ...params.metadata,
                  persistence: {
                    ...persistence,
                    resumeSnapshot,
                  },
                } as unknown as SyncMetadataApi<string | number>,
              })
            },
          },
          persistence: {
            adapter: createPersistedAdapter(collectionMetadata),
          },
        }) as any,
      )

      const preload = persistedCollection.preload()
      await expect(preload).rejects.toThrow(
        /persistence.*capability.*expectCurrentCommit/i,
      )

      expect(persistedCollection.status).toBe(`error`)
      expect(ShapeStream).not.toHaveBeenCalled()
      expect(collectionMetadata.get(`electric:resume`)).toEqual(durableResume)
      await persistedCollection.cleanup()
    })

    it(`prefers newer persisted resume metadata over hydrated metadata`, () => {
      vi.clearAllMocks()
      const metadataHarness = createInMemorySyncMetadataApi(
        new Map([
          [
            `electric:resume`,
            {
              kind: `resume`,
              requiresTagState: false,
              offset: `20_0`,
              handle: `persisted-newer`,
              shapeId: `{"params":{"table":"test_table"},"url":"http://test-url"}`,
              updatedAt: 20,
            },
          ],
        ]),
      )
      const options = electricCollectionOptions<Row>({
        id: `resume-recency-test`,
        shapeOptions: {
          url: `http://test-url`,
          params: { table: `test_table` },
        },
        startSync: false,
        getKey: (item) => item.id as number,
      })
      options.sync.importSyncMeta?.({
        version: 1,
        resume: {
          kind: `resume`,
          requiresTagState: false,
          offset: `10_0`,
          handle: `hydrated-older`,
          shapeId: `{"params":{"table":"test_table"},"url":"http://test-url"}`,
          updatedAt: 10,
        },
        seenTxids: [],
      })
      const originalSync = options.sync

      createCollection({
        ...options,
        startSync: true,
        sync: {
          ...originalSync,
          sync: (params: Parameters<typeof originalSync.sync>[0]) =>
            originalSync.sync({ ...params, metadata: metadataHarness.api }),
        },
      })

      expect(vi.mocked(ShapeStream).mock.calls.at(-1)?.[0]).toMatchObject({
        offset: `20_0`,
        handle: `persisted-newer`,
      })
    })

    it(`should replace reset resume state with a full snapshot`, async () => {
      vi.clearAllMocks()

      const { ShapeStream } = await import(`@electric-sql/client`)
      const metadataHarness = createInMemorySyncMetadataApi(
        new Map([
          [
            `electric:resume`,
            {
              kind: `reset`,
              updatedAt: 1,
            },
          ],
        ]),
      )

      const baseOptions = electricCollectionOptions({
        id: `persisted-reset-test`,
        shapeOptions: {
          url: `http://test-url`,
          params: {
            table: `test_table`,
          },
        },
        syncMode: `on-demand` as const,
        getKey: (item: Row) => item.id as number,
        startSync: true,
      })

      const originalSync = baseOptions.sync
      createCollection({
        ...baseOptions,
        sync: {
          sync: (params: Parameters<typeof originalSync.sync>[0]) =>
            originalSync.sync({
              ...params,
              metadata: metadataHarness.api,
            }),
        },
      })

      expect(ShapeStream).toHaveBeenCalledWith(
        expect.objectContaining({
          offset: undefined,
          log: undefined,
          handle: undefined,
        }),
      )
    })

    it(`uses full-log recovery for unmanaged persisted reset metadata`, async () => {
      vi.clearAllMocks()

      const { ShapeStream } = await import(`@electric-sql/client`)
      const collectionMetadata = new Map<string, unknown>([
        [
          `electric:resume`,
          {
            kind: `reset`,
            updatedAt: 1,
          },
        ],
      ])

      const persistedCollection = createCollection(
        persistedCollectionOptions({
          ...(electricCollectionOptions({
            id: `persisted-wrapper-reset-test`,
            shapeOptions: {
              url: `http://test-url`,
              params: {
                table: `test_table`,
              },
            },
            syncMode: `on-demand` as const,
            getKey: (item: Row) => item.id as number,
            startSync: true,
          }) as any),
          persistence: {
            adapter: createPersistedAdapter(collectionMetadata),
          },
        }) as any,
      )

      persistedCollection.startSyncImmediate()
      await new Promise((resolve) => setTimeout(resolve, 0))

      expect(ShapeStream).toHaveBeenCalledWith(
        expect.objectContaining({
          offset: undefined,
          log: undefined,
          handle: undefined,
        }),
      )
    })

    it(`should preserve hydrated rows and resumed changes received before up-to-date`, async () => {
      vi.clearAllMocks()

      const { ShapeStream } = await import(`@electric-sql/client`)
      mockFetchSnapshot.mockResolvedValue({
        metadata: {},
        data: [],
      })

      const collectionMetadata = new Map<string, unknown>([
        [
          `electric:resume`,
          {
            kind: `resume`,
            requiresTagState: false,
            offset: `10_0`,
            handle: `handle-1`,
            shapeId: `{"params":{"table":"test_table"},"url":"http://test-url"}`,
            updatedAt: 1,
          },
        ],
      ])
      const persistedRows = new Map<string | number, Row>([
        [1, { id: 1, name: `Persisted User` }],
      ])

      const persistedCollection = createCollection(
        persistedCollectionOptions({
          ...(electricCollectionOptions({
            id: `persisted-progressive-resume-test`,
            shapeOptions: {
              url: `http://test-url`,
              params: {
                table: `test_table`,
              },
            },
            syncMode: `progressive` as const,
            getKey: (item: Row) => item.id as number,
            startSync: true,
          }) as any),
          persistence: {
            adapter: createPersistedAdapter(collectionMetadata, persistedRows),
          },
        }) as any,
      )

      persistedCollection.startSyncImmediate()
      await persistedCollection._sync.loadSubset({ limit: 10 })

      expect(ShapeStream).toHaveBeenCalledWith(
        expect.objectContaining({
          offset: `10_0`,
          handle: `handle-1`,
        }),
      )
      expect(stripVirtualProps(persistedCollection.get(1))).toEqual({
        id: 1,
        name: `Persisted User`,
      })

      subscriber([
        {
          key: `2`,
          value: { id: 2, name: `Resumed User` },
          headers: { operation: `insert` },
        },
      ])
      subscriber([
        {
          headers: { control: `up-to-date` },
        },
      ])

      expect(
        [persistedCollection.get(1), persistedCollection.get(2)].map(
          stripVirtualProps,
        ),
      ).toEqual([
        { id: 1, name: `Persisted User` },
        { id: 2, name: `Resumed User` },
      ])
      await vi.waitFor(() => {
        expect(
          [persistedRows.get(1), persistedRows.get(2)].map(stripVirtualProps),
        ).toEqual([
          { id: 1, name: `Persisted User` },
          { id: 2, name: `Resumed User` },
        ])
      })
    })

    it(`should not mix explicit handle with persisted offset`, async () => {
      vi.clearAllMocks()

      const { ShapeStream } = await import(`@electric-sql/client`)
      const metadataHarness = createInMemorySyncMetadataApi(
        new Map([
          [
            `electric:resume`,
            {
              kind: `resume`,
              requiresTagState: false,
              offset: `10_0`,
              handle: `persisted-handle`,
              shapeId: JSON.stringify({
                url: `http://test-url`,
                params: { table: `test_table` },
              }),
              updatedAt: 1,
            },
          ],
        ]),
      )

      const baseOptions = electricCollectionOptions({
        id: `persisted-partial-override-handle-test`,
        shapeOptions: {
          url: `http://test-url`,
          params: {
            table: `test_table`,
          },
          handle: `explicit-handle`,
        },
        syncMode: `on-demand` as const,
        getKey: (item: Row) => item.id as number,
        startSync: true,
      })

      const originalSync = baseOptions.sync
      createCollection({
        ...baseOptions,
        sync: {
          sync: (params: Parameters<typeof originalSync.sync>[0]) =>
            originalSync.sync({
              ...params,
              metadata: metadataHarness.api,
            }),
        },
      })

      expect(ShapeStream).toHaveBeenCalledWith(
        expect.objectContaining({
          offset: `now`,
          handle: `explicit-handle`,
        }),
      )
    })

    it(`should not mix explicit offset with persisted handle`, async () => {
      vi.clearAllMocks()

      const { ShapeStream } = await import(`@electric-sql/client`)
      const metadataHarness = createInMemorySyncMetadataApi(
        new Map([
          [
            `electric:resume`,
            {
              kind: `resume`,
              requiresTagState: false,
              offset: `10_0`,
              handle: `persisted-handle`,
              shapeId: JSON.stringify({
                url: `http://test-url`,
                params: { table: `test_table` },
              }),
              updatedAt: 1,
            },
          ],
        ]),
      )

      const baseOptions = electricCollectionOptions({
        id: `persisted-partial-override-offset-test`,
        shapeOptions: {
          url: `http://test-url`,
          params: {
            table: `test_table`,
          },
          offset: -1 as any,
        },
        syncMode: `on-demand` as const,
        getKey: (item: Row) => item.id as number,
        startSync: true,
      })

      const originalSync = baseOptions.sync
      createCollection({
        ...baseOptions,
        sync: {
          sync: (params: Parameters<typeof originalSync.sync>[0]) =>
            originalSync.sync({
              ...params,
              metadata: metadataHarness.api,
            }),
        },
      })

      expect(ShapeStream).toHaveBeenCalledWith(
        expect.objectContaining({
          offset: -1,
          handle: undefined,
        }),
      )
    })

    it(`uses a full fallback for malformed resume metadata without scoped persistence`, async () => {
      vi.clearAllMocks()

      const { ShapeStream } = await import(`@electric-sql/client`)
      const metadataHarness = createInMemorySyncMetadataApi(
        new Map([
          [
            `electric:resume`,
            {
              kind: `resume`,
              requiresTagState: false,
              offset: 10,
              updatedAt: 1,
            },
          ],
        ]),
      )

      const baseOptions = electricCollectionOptions({
        id: `persisted-malformed-resume-test`,
        shapeOptions: {
          url: `http://test-url`,
          params: {
            table: `test_table`,
          },
        },
        syncMode: `on-demand` as const,
        getKey: (item: Row) => item.id as number,
        startSync: true,
      })

      const originalSync = baseOptions.sync
      createCollection({
        ...baseOptions,
        sync: {
          sync: (params: Parameters<typeof originalSync.sync>[0]) =>
            originalSync.sync({
              ...params,
              metadata: metadataHarness.api,
            }),
        },
      })

      expect(ShapeStream).toHaveBeenCalledWith(
        expect.objectContaining({
          offset: undefined,
          log: undefined,
          handle: undefined,
        }),
      )
      expect(metadataHarness.collectionMetadata.get(`electric:resume`)).toEqual(
        expect.objectContaining({ kind: `reset` }),
      )
    })

    it(`uses a full fallback for incompatible identity without scoped persistence`, async () => {
      vi.clearAllMocks()

      const { ShapeStream } = await import(`@electric-sql/client`)
      const metadataHarness = createInMemorySyncMetadataApi(
        new Map([
          [
            `electric:resume`,
            {
              kind: `resume`,
              requiresTagState: false,
              offset: `10_0`,
              handle: `handle-1`,
              shapeId: `{"url":"http://other-url","params":{"table":"test_table"}}`,
              updatedAt: 1,
            },
          ],
        ]),
      )

      const baseOptions = electricCollectionOptions({
        id: `persisted-incompatible-resume-test`,
        shapeOptions: {
          url: `http://test-url`,
          params: {
            table: `test_table`,
          },
        },
        syncMode: `on-demand` as const,
        getKey: (item: Row) => item.id as number,
        startSync: true,
      })

      const originalSync = baseOptions.sync
      createCollection({
        ...baseOptions,
        sync: {
          sync: (params: Parameters<typeof originalSync.sync>[0]) =>
            originalSync.sync({
              ...params,
              metadata: metadataHarness.api,
            }),
        },
      })

      expect(ShapeStream).toHaveBeenCalledWith(
        expect.objectContaining({
          offset: undefined,
          log: undefined,
          handle: undefined,
        }),
      )
      expect(metadataHarness.collectionMetadata.get(`electric:resume`)).toEqual(
        expect.objectContaining({
          kind: `reset`,
        }),
      )
    })

    it(`should treat persisted resume identity as compatible when params key order differs`, async () => {
      vi.clearAllMocks()

      const { ShapeStream } = await import(`@electric-sql/client`)
      const metadataHarness = createInMemorySyncMetadataApi(
        new Map([
          [
            `electric:resume`,
            {
              kind: `resume`,
              requiresTagState: false,
              offset: `10_0`,
              handle: `handle-1`,
              shapeId: `{"params":{"table":"test_table","where":"room=1"},"url":"http://test-url"}`,
              updatedAt: 1,
            },
          ],
        ]),
      )

      const baseOptions = electricCollectionOptions({
        id: `persisted-ordered-params-resume-test`,
        shapeOptions: {
          url: `http://test-url`,
          params: {
            where: `room=1`,
            table: `test_table`,
          },
        },
        syncMode: `on-demand` as const,
        getKey: (item: Row) => item.id as number,
        startSync: true,
      })

      const originalSync = baseOptions.sync
      createCollection({
        ...baseOptions,
        sync: {
          sync: (params: Parameters<typeof originalSync.sync>[0]) =>
            originalSync.sync({
              ...params,
              metadata: metadataHarness.api,
            }),
        },
      })

      expect(ShapeStream).toHaveBeenCalledWith(
        expect.objectContaining({
          offset: `10_0`,
          handle: `handle-1`,
        }),
      )
    })

    it(`should persist reset resume metadata immediately on must-refetch`, () => {
      const metadataHarness = createInMemorySyncMetadataApi()
      const baseOptions = electricCollectionOptions({
        id: `must-refetch-reset-metadata-test`,
        shapeOptions: {
          url: `http://test-url`,
          params: {
            table: `test_table`,
          },
        },
        getKey: (item: Row) => item.id as number,
        startSync: true,
      })

      const originalSync = baseOptions.sync
      createCollection({
        ...baseOptions,
        sync: {
          sync: (params: Parameters<typeof originalSync.sync>[0]) =>
            originalSync.sync({
              ...params,
              metadata: metadataHarness.api,
            }),
        },
      })

      subscriber([
        {
          headers: { control: `must-refetch` },
        },
      ])

      expect(metadataHarness.collectionMetadata.get(`electric:resume`)).toEqual(
        expect.objectContaining({
          kind: `reset`,
        }),
      )
    })

    it(`should only advance resume metadata when a batch commits`, () => {
      const metadataHarness = createInMemorySyncMetadataApi()
      mockStream.shapeHandle = `shape-1`
      mockStream.lastOffset = `10_0`

      const baseOptions = electricCollectionOptions({
        id: `resume-commit-boundary-test`,
        shapeOptions: {
          url: `http://test-url`,
          params: {
            table: `test_table`,
          },
        },
        getKey: (item: Row) => item.id as number,
        startSync: true,
      })

      const originalSync = baseOptions.sync
      createCollection({
        ...baseOptions,
        sync: {
          sync: (params: Parameters<typeof originalSync.sync>[0]) =>
            originalSync.sync({
              ...params,
              metadata: metadataHarness.api,
            }),
        },
      })

      subscriber([
        {
          key: `1`,
          value: { id: 1, name: `Before commit` },
          headers: { operation: `insert` },
        },
      ])

      expect(metadataHarness.collectionMetadata.has(`electric:resume`)).toBe(
        false,
      )

      subscriber([
        {
          headers: { control: `up-to-date` },
        },
      ])

      expect(metadataHarness.collectionMetadata.get(`electric:resume`)).toEqual(
        expect.objectContaining({
          kind: `resume`,
          requiresTagState: false,
          offset: `10_0`,
          handle: `shape-1`,
        }),
      )
    })

    it(`refuses an update for an unseen key and invalidates persisted resume state`, () => {
      const metadataHarness = createInMemorySyncMetadataApi(
        new Map([
          [
            `electric:resume`,
            {
              kind: `resume`,
              requiresTagState: false,
              offset: `10_0`,
              handle: `shape-1`,
              shapeId: `{"params":{"table":"test_table"},"url":"http://test-url"}`,
              updatedAt: 1,
            },
          ],
        ]),
      )
      mockStream.shapeHandle = `shape-1`
      mockStream.lastOffset = `11_0`

      const baseOptions = electricCollectionOptions<Row>({
        id: `unseen-update-resume-test`,
        shapeOptions: {
          url: `http://test-url`,
          params: { table: `test_table` },
        },
        getKey: (item) => item.id as number,
        startSync: true,
      })
      const originalSync = baseOptions.sync
      const testCollection = createCollection({
        ...baseOptions,
        sync: {
          sync: (params: Parameters<typeof originalSync.sync>[0]) =>
            originalSync.sync({ ...params, metadata: metadataHarness.api }),
        },
      })

      subscriber([
        {
          key: `2`,
          value: { id: 2, name: `Changed without immutable fields` },
          headers: { operation: `update` },
        },
        { headers: { control: `up-to-date` } },
      ])

      expect(testCollection.has(2)).toBe(false)
      expect(metadataHarness.collectionMetadata.get(`electric:resume`)).toEqual(
        expect.objectContaining({ kind: `reset` }),
      )
      expect(testCollection.status).toBe(`error`)
    })

    it(`rejects a resumed batch that updates a key after deleting it`, () => {
      const metadataHarness = createInMemorySyncMetadataApi(
        new Map([
          [
            `electric:resume`,
            {
              kind: `resume`,
              requiresTagState: false,
              offset: `10_0`,
              handle: `shape-1`,
              shapeId: `{"params":{"table":"test_table"},"url":"http://test-url"}`,
              updatedAt: 1,
            },
          ],
        ]),
      )
      const baseOptions = electricCollectionOptions<Row>({
        id: `delete-then-update-resume-test`,
        shapeOptions: {
          url: `http://test-url`,
          params: { table: `test_table` },
        },
        getKey: (item) => item.id as number,
        startSync: true,
      })
      const originalSync = baseOptions.sync
      const testCollection = createCollection({
        ...baseOptions,
        sync: {
          sync: (params: Parameters<typeof originalSync.sync>[0]) =>
            originalSync.sync({ ...params, metadata: metadataHarness.api }),
        },
      })

      subscriber([
        {
          key: `2`,
          value: { id: 2, name: `Complete row` },
          headers: { operation: `insert` },
        },
        { headers: { control: `up-to-date` } },
      ])
      expect(testCollection.has(2)).toBe(true)

      subscriber([
        {
          key: `2`,
          value: { id: 2 },
          headers: { operation: `delete` },
        },
        {
          key: `2`,
          value: { id: 2, name: `Partial replacement` },
          headers: { operation: `update` },
        },
      ])

      expect(testCollection.get(2)?.name).toBe(`Complete row`)
      expect(metadataHarness.collectionMetadata.get(`electric:resume`)).toEqual(
        expect.objectContaining({ kind: `reset` }),
      )
    })
  })

  // Tests for overlapping subset queries with duplicate keys
  describe(`Overlapping subset queries with duplicate keys`, () => {
    it(`should convert duplicate inserts to updates when overlapping subset queries return the same row with different values`, () => {
      // This test reproduces the issue where:
      // 1. Multiple subset queries return the same row (e.g., different WHERE clauses that both match the same record)
      // 2. The server sends `insert` operations for each response
      // 3. If the row's data changed between requests (e.g., timestamp field updated), this caused a DuplicateKeySyncError

      const config = {
        id: `duplicate-insert-test`,
        shapeOptions: {
          url: `http://test-url`,
          params: {
            table: `test_table`,
          },
        },
        getKey: (item: Row) => item.id as number,
        startSync: true,
      }

      const testCollection = createCollection(electricCollectionOptions(config))

      // First subset query returns a row
      subscriber([
        {
          key: `1`,
          value: { id: 1, name: `User 1`, updated_at: `2024-01-01T00:00:00Z` },
          headers: { operation: `insert` },
        },
        {
          headers: { control: `up-to-date` },
        },
      ])

      // Verify initial data is present
      expect(testCollection.has(1)).toBe(true)
      expect(stripVirtualProps(testCollection.get(1))).toEqual({
        id: 1,
        name: `User 1`,
        updated_at: `2024-01-01T00:00:00Z`,
      })

      // Second subset query returns the SAME row but with a different timestamp
      // This would throw DuplicateKeySyncError without the fix because:
      // 1. The key already exists in syncedData
      // 2. The value is different (timestamp changed)
      // 3. Without the Electric adapter converting insert->update, sync.ts throws
      expect(() => {
        subscriber([
          {
            key: `1`,
            value: {
              id: 1,
              name: `User 1`,
              updated_at: `2024-01-01T00:00:01Z`,
            }, // Different timestamp!
            headers: { operation: `insert` },
          },
          {
            headers: { control: `up-to-date` },
          },
        ])
      }).not.toThrow()

      // The row should be updated with the new value
      expect(testCollection.has(1)).toBe(true)
      expect(stripVirtualProps(testCollection.get(1))).toEqual({
        id: 1,
        name: `User 1`,
        updated_at: `2024-01-01T00:00:01Z`,
      })
    })

    it(`should handle multiple duplicate inserts across several batches`, () => {
      const config = {
        id: `multiple-duplicate-inserts-test`,
        shapeOptions: {
          url: `http://test-url`,
          params: {
            table: `test_table`,
          },
        },
        getKey: (item: Row) => item.id as number,
        startSync: true,
      }

      const testCollection = createCollection(electricCollectionOptions(config))

      // First batch - initial inserts
      subscriber([
        {
          key: `1`,
          value: { id: 1, name: `User 1`, version: 1 },
          headers: { operation: `insert` },
        },
        {
          key: `2`,
          value: { id: 2, name: `User 2`, version: 1 },
          headers: { operation: `insert` },
        },
        {
          headers: { control: `up-to-date` },
        },
      ])

      expect(testCollection.size).toBe(2)
      expect(stripVirtualProps(testCollection.get(1))).toEqual({
        id: 1,
        name: `User 1`,
        version: 1,
      })
      expect(stripVirtualProps(testCollection.get(2))).toEqual({
        id: 2,
        name: `User 2`,
        version: 1,
      })

      // Second batch - overlapping subset query returns same rows with different values
      subscriber([
        {
          key: `1`,
          value: { id: 1, name: `User 1`, version: 2 }, // version changed
          headers: { operation: `insert` },
        },
        {
          key: `2`,
          value: { id: 2, name: `User 2`, version: 2 }, // version changed
          headers: { operation: `insert` },
        },
        {
          key: `3`,
          value: { id: 3, name: `User 3`, version: 1 }, // new row
          headers: { operation: `insert` },
        },
        {
          headers: { control: `up-to-date` },
        },
      ])

      // All rows should be present with updated values
      expect(testCollection.size).toBe(3)
      expect(stripVirtualProps(testCollection.get(1))).toEqual({
        id: 1,
        name: `User 1`,
        version: 2,
      })
      expect(stripVirtualProps(testCollection.get(2))).toEqual({
        id: 2,
        name: `User 2`,
        version: 2,
      })
      expect(stripVirtualProps(testCollection.get(3))).toEqual({
        id: 3,
        name: `User 3`,
        version: 1,
      })
    })

    it(`should reset synced keys tracking on must-refetch`, () => {
      const config = {
        id: `must-refetch-reset-test`,
        shapeOptions: {
          url: `http://test-url`,
          params: {
            table: `test_table`,
          },
        },
        getKey: (item: Row) => item.id as number,
        startSync: true,
      }

      const testCollection = createCollection(electricCollectionOptions(config))

      // Initial sync
      subscriber([
        {
          key: `1`,
          value: { id: 1, name: `User 1` },
          headers: { operation: `insert` },
        },
        {
          headers: { control: `up-to-date` },
        },
      ])

      expect(testCollection.has(1)).toBe(true)

      // Trigger must-refetch (clears collection and syncedKeys tracking)
      subscriber([
        {
          headers: { control: `must-refetch` },
        },
      ])

      // After must-refetch, sending the same key as insert should work
      // because syncedKeys tracking was cleared
      subscriber([
        {
          key: `1`,
          value: { id: 1, name: `User 1 After Refetch` },
          headers: { operation: `insert` },
        },
        {
          headers: { control: `up-to-date` },
        },
      ])

      expect(testCollection.has(1)).toBe(true)
      expect(stripVirtualProps(testCollection.get(1))).toEqual({
        id: 1,
        name: `User 1 After Refetch`,
      })
    })

    it(`should handle delete followed by insert of the same key`, () => {
      const config = {
        id: `delete-then-insert-test`,
        shapeOptions: {
          url: `http://test-url`,
          params: {
            table: `test_table`,
          },
        },
        getKey: (item: Row) => item.id as number,
        startSync: true,
      }

      const testCollection = createCollection(electricCollectionOptions(config))

      // Initial insert
      subscriber([
        {
          key: `1`,
          value: { id: 1, name: `User 1` },
          headers: { operation: `insert` },
        },
        {
          headers: { control: `up-to-date` },
        },
      ])

      expect(testCollection.has(1)).toBe(true)

      // Delete the row
      subscriber([
        {
          key: `1`,
          value: { id: 1 },
          headers: { operation: `delete` },
        },
        {
          headers: { control: `up-to-date` },
        },
      ])

      expect(testCollection.has(1)).toBe(false)

      // Re-insert the same key - should work because delete cleared the syncedKeys tracking
      subscriber([
        {
          key: `1`,
          value: { id: 1, name: `User 1 Recreated` },
          headers: { operation: `insert` },
        },
        {
          headers: { control: `up-to-date` },
        },
      ])

      expect(testCollection.has(1)).toBe(true)
      expect(stripVirtualProps(testCollection.get(1))).toEqual({
        id: 1,
        name: `User 1 Recreated`,
      })
    })

    it(`should handle duplicate inserts within the same batch`, () => {
      const config = {
        id: `same-batch-duplicate-test`,
        shapeOptions: {
          url: `http://test-url`,
          params: {
            table: `test_table`,
          },
        },
        getKey: (item: Row) => item.id as number,
        startSync: true,
      }

      const testCollection = createCollection(electricCollectionOptions(config))

      // Single batch with duplicate inserts for the same key
      // This can happen when multiple subset responses are batched together
      subscriber([
        {
          key: `1`,
          value: { id: 1, name: `User 1`, version: 1 },
          headers: { operation: `insert` },
        },
        {
          key: `1`,
          value: { id: 1, name: `User 1`, version: 2 }, // Same key, different value
          headers: { operation: `insert` },
        },
        {
          headers: { control: `up-to-date` },
        },
      ])

      // Should have the latest value
      expect(testCollection.has(1)).toBe(true)
      expect(stripVirtualProps(testCollection.get(1))).toEqual({
        id: 1,
        name: `User 1`,
        version: 2,
      })
    })
  })

  // Tests for commit and ready behavior with snapshot-end and up-to-date messages
  describe(`Commit and ready behavior`, () => {
    it(`should ignore snapshot-end before first up-to-date in progressive mode`, () => {
      vi.clearAllMocks()

      let testSubscriber!: (messages: Array<Message<Row>>) => void
      mockSubscribe.mockImplementation((callback) => {
        testSubscriber = callback
        return () => {}
      })
      mockRequestSnapshot.mockResolvedValue(undefined)
      mockFetchSnapshot.mockResolvedValue({ metadata: {}, data: [] })

      const config = {
        id: `progressive-ignore-snapshot-end-test`,
        shapeOptions: {
          url: `http://test-url`,
          params: { table: `test_table` },
        },
        syncMode: `progressive` as const,
        getKey: (item: Row) => item.id as number,
        startSync: true,
      }

      const testCollection = createCollection(electricCollectionOptions(config))

      // Send data followed by snapshot-end (but no up-to-date)
      // In progressive mode, these messages should be BUFFERED, and snapshot-end
      // should NOT trigger a commit because the snapshot-end in the log could be
      // from a significant period before the stream is actually up to date
      testSubscriber([
        {
          key: `1`,
          value: { id: 1, name: `Test User` },
          headers: { operation: `insert` },
        },
        {
          headers: {
            control: `snapshot-end`,
            xmin: `100`,
            xmax: `110`,
            xip_list: [],
          },
        },
      ])

      // Data should NOT be visible yet (snapshot-end should be ignored before up-to-date)
      expect(testCollection.has(1)).toBe(false)
      expect(testCollection.status).toBe(`loading`)

      // Now send up-to-date (triggers atomic swap)
      testSubscriber([
        {
          headers: { control: `up-to-date` },
        },
      ])

      // Now data should be visible after atomic swap
      expect(testCollection.has(1)).toBe(true)
      expect(stripVirtualProps(testCollection.get(1))).toEqual({
        id: 1,
        name: `Test User`,
      })
      expect(testCollection.status).toBe(`ready`)
    })

    it(`should commit on subset-end in eager mode`, () => {
      const config = {
        id: `eager-subset-end-test`,
        shapeOptions: {
          url: `http://test-url`,
          params: { table: `test_table` },
        },
        syncMode: `eager` as const,
        getKey: (item: Row) => item.id as number,
        startSync: true,
      }

      const testCollection = createCollection(electricCollectionOptions(config))

      // Send data followed by subset-end (marks end of injected subset snapshot)
      // subset-end should trigger a commit
      subscriber([
        {
          key: `1`,
          value: { id: 1, name: `Test User` },
          headers: { operation: `insert` },
        },
        {
          headers: { control: `subset-end` },
        },
      ])

      // Data should be committed and collection ready
      expect(testCollection.has(1)).toBe(true)
      expect(stripVirtualProps(testCollection.get(1))).toEqual({
        id: 1,
        name: `Test User`,
      })
      expect(testCollection.status).toBe(`ready`)
    })

    it(`should NOT commit on snapshot-end (only tracks metadata)`, () => {
      const config = {
        id: `eager-snapshot-end-no-commit-test`,
        shapeOptions: {
          url: `http://test-url`,
          params: { table: `test_table` },
        },
        syncMode: `eager` as const,
        getKey: (item: Row) => item.id as number,
        startSync: true,
      }

      const testCollection = createCollection(electricCollectionOptions(config))

      // Send data followed by snapshot-end
      // snapshot-end should NOT trigger a commit - only up-to-date or subset-end do
      subscriber([
        {
          key: `1`,
          value: { id: 1, name: `Test User` },
          headers: { operation: `insert` },
        },
        {
          headers: {
            control: `snapshot-end`,
            xmin: `100`,
            xmax: `110`,
            xip_list: [],
          },
        },
      ])

      // Data should NOT be committed yet (snapshot-end doesn't trigger commit)
      expect(testCollection.has(1)).toBe(false)
      expect(testCollection.status).toBe(`loading`)

      // Now send up-to-date to commit
      subscriber([
        {
          headers: { control: `up-to-date` },
        },
      ])

      // Now data should be committed
      expect(testCollection.has(1)).toBe(true)
      expect(testCollection.status).toBe(`ready`)
    })

    it(`should commit and mark ready on subset-end in on-demand mode`, () => {
      const config = {
        id: `on-demand-subset-end-test`,
        shapeOptions: {
          url: `http://test-url`,
          params: { table: `test_table` },
        },
        syncMode: `on-demand` as const,
        getKey: (item: Row) => item.id as number,
        startSync: true,
      }

      const testCollection = createCollection(electricCollectionOptions(config))

      // Send data followed by subset-end (marks end of injected subset snapshot)
      subscriber([
        {
          key: `1`,
          value: { id: 1, name: `Test User` },
          headers: { operation: `insert` },
        },
        {
          headers: { control: `subset-end` },
        },
      ])

      // Data should be committed (available in state)
      expect(testCollection.has(1)).toBe(true)
      expect(stripVirtualProps(testCollection.get(1))).toEqual({
        id: 1,
        name: `Test User`,
      })

      // Collection SHOULD be marked as ready in on-demand mode
      expect(testCollection.status).toBe(`ready`)
    })

    it(`should buffer changes during snapshot phase in progressive mode until up-to-date`, () => {
      vi.clearAllMocks()

      let testSubscriber!: (messages: Array<Message<Row>>) => void
      mockSubscribe.mockImplementation((callback) => {
        testSubscriber = callback
        return () => {}
      })
      mockRequestSnapshot.mockResolvedValue(undefined)
      mockFetchSnapshot.mockResolvedValue({ metadata: {}, data: [] })

      const config = {
        id: `progressive-snapshot-end-test`,
        shapeOptions: {
          url: `http://test-url`,
          params: { table: `test_table` },
        },
        syncMode: `progressive` as const,
        getKey: (item: Row) => item.id as number,
        startSync: true,
      }

      const testCollection = createCollection(electricCollectionOptions(config))

      // Send data followed by snapshot-end (but no up-to-date)
      // In progressive mode, these messages should be BUFFERED, not committed
      testSubscriber([
        {
          key: `1`,
          value: { id: 1, name: `Test User` },
          headers: { operation: `insert` },
        },
        {
          headers: {
            control: `snapshot-end`,
            xmin: `100`,
            xmax: `110`,
            xip_list: [],
          },
        },
      ])

      // Data should NOT be visible yet (it's buffered during snapshot phase)
      expect(testCollection.has(1)).toBe(false)

      // Collection should NOT be marked as ready yet in progressive mode
      expect(testCollection.status).toBe(`loading`)

      // Now send up-to-date (triggers atomic swap)
      testSubscriber([
        {
          headers: { control: `up-to-date` },
        },
      ])

      // Now data should be visible after atomic swap
      expect(testCollection.has(1)).toBe(true)
      expect(stripVirtualProps(testCollection.get(1))).toEqual({
        id: 1,
        name: `Test User`,
      })

      // And it should be ready
      expect(testCollection.status).toBe(`ready`)
    })

    it(`should NOT commit multiple snapshot-end messages before up-to-date in eager mode`, () => {
      const config = {
        id: `eager-multiple-snapshots-test`,
        shapeOptions: {
          url: `http://test-url`,
          params: { table: `test_table` },
        },
        syncMode: `eager` as const,
        getKey: (item: Row) => item.id as number,
        startSync: true,
      }

      const testCollection = createCollection(electricCollectionOptions(config))

      // First snapshot with data - snapshot-end should be ignored before up-to-date
      subscriber([
        {
          key: `1`,
          value: { id: 1, name: `User 1` },
          headers: { operation: `insert` },
        },
        {
          headers: {
            control: `snapshot-end`,
            xmin: `100`,
            xmax: `110`,
            xip_list: [],
          },
        },
      ])

      // First data should NOT be committed yet (snapshot-end ignored before up-to-date)
      expect(testCollection.has(1)).toBe(false)
      expect(testCollection.status).toBe(`loading`)

      // Second snapshot with more data - still before up-to-date, so should be ignored
      subscriber([
        {
          key: `2`,
          value: { id: 2, name: `User 2` },
          headers: { operation: `insert` },
        },
        {
          headers: {
            control: `snapshot-end`,
            xmin: `110`,
            xmax: `120`,
            xip_list: [],
          },
        },
      ])

      // Second data should also NOT be committed yet
      expect(testCollection.has(2)).toBe(false)
      expect(testCollection.size).toBe(0)
      expect(testCollection.status).toBe(`loading`)

      // Finally send up-to-date - this commits all the pending data
      subscriber([
        {
          headers: { control: `up-to-date` },
        },
      ])

      // Now all data should be committed and collection ready
      expect(testCollection.has(1)).toBe(true)
      expect(testCollection.has(2)).toBe(true)
      expect(testCollection.size).toBe(2)
      expect(testCollection.status).toBe(`ready`)
    })

    it(`should handle up-to-date without snapshot-end (traditional behavior)`, () => {
      const config = {
        id: `traditional-up-to-date-test`,
        shapeOptions: {
          url: `http://test-url`,
          params: { table: `test_table` },
        },
        syncMode: `eager` as const,
        getKey: (item: Row) => item.id as number,
        startSync: true,
      }

      const testCollection = createCollection(electricCollectionOptions(config))

      // Send data followed by up-to-date (no snapshot-end)
      subscriber([
        {
          key: `1`,
          value: { id: 1, name: `Test User` },
          headers: { operation: `insert` },
        },
        {
          headers: { control: `up-to-date` },
        },
      ])

      // Data should be committed and collection ready
      expect(testCollection.has(1)).toBe(true)
      expect(testCollection.status).toBe(`ready`)
    })

    it(`should handle must-refetch in progressive mode without orphan transactions`, () => {
      vi.clearAllMocks()

      let testSubscriber!: (messages: Array<Message<Row>>) => void
      mockSubscribe.mockImplementation((callback) => {
        testSubscriber = callback
        return () => {}
      })
      mockRequestSnapshot.mockResolvedValue(undefined)
      mockFetchSnapshot.mockResolvedValue({ metadata: {}, data: [] })

      const config = {
        id: `progressive-must-refetch-orphan-test`,
        shapeOptions: {
          url: `http://test-url`,
          params: { table: `test_table` },
        },
        syncMode: `progressive` as const,
        getKey: (item: Row) => item.id as number,
        startSync: true,
      }

      const testCollection = createCollection(electricCollectionOptions(config))

      // Phase 1: Complete the initial sync in progressive mode
      testSubscriber([
        {
          key: `1`,
          value: { id: 1, name: `User 1` },
          headers: { operation: `insert` },
        },
        {
          key: `2`,
          value: { id: 2, name: `User 2` },
          headers: { operation: `insert` },
        },
        {
          headers: { control: `up-to-date` },
        },
      ])

      // After atomic swap, data should be visible
      expect(testCollection.status).toBe(`ready`)
      expect(testCollection.has(1)).toBe(true)
      expect(testCollection.has(2)).toBe(true)
      expect(testCollection.size).toBe(2)

      // No pending uncommitted synced transactions after initial sync
      expect(testCollection._state.pendingSyncedTransactions.length).toBe(0)

      // Phase 2: Receive must-refetch
      // This resets hasReceivedUpToDate to false but starts a transaction
      testSubscriber([
        {
          headers: { control: `must-refetch` },
        },
      ])

      // Old data should still be visible (transaction not committed yet)
      expect(testCollection.status).toBe(`ready`)
      expect(testCollection.size).toBe(2)

      // There should be exactly 1 uncommitted pending transaction from must-refetch
      expect(testCollection._state.pendingSyncedTransactions.length).toBe(1)
      expect(
        testCollection._state.pendingSyncedTransactions[0]?.committed,
      ).toBe(false)

      // Phase 3: Send new data after must-refetch (in separate batch)
      // Without the fix, these would be buffered and cause orphan transaction
      testSubscriber([
        {
          key: `3`,
          value: { id: 3, name: `User 3` },
          headers: { operation: `insert` },
        },
        {
          key: `4`,
          value: { id: 4, name: `User 4` },
          headers: { operation: `insert` },
        },
      ])

      // Data still not committed (no up-to-date yet)
      expect(testCollection.size).toBe(2)

      // Still 1 pending transaction (with the fix, data is written to it, not buffered)
      expect(testCollection._state.pendingSyncedTransactions.length).toBe(1)

      // Phase 4: Send up-to-date (in separate batch)
      // Without the fix: atomic swap would try to start a new transaction,
      // leaving the must-refetch transaction uncommitted (orphan)
      // With the fix: normal commit happens on the existing transaction
      testSubscriber([
        {
          headers: { control: `up-to-date` },
        },
      ])

      // After the fix: old data truncated, new data committed
      expect(testCollection.status).toBe(`ready`)
      expect(testCollection.has(1)).toBe(false) // Truncated by must-refetch
      expect(testCollection.has(2)).toBe(false) // Truncated by must-refetch
      expect(testCollection.has(3)).toBe(true) // New data after must-refetch
      expect(testCollection.has(4)).toBe(true) // New data after must-refetch
      expect(testCollection.size).toBe(2)

      // CRITICAL: No orphan uncommitted transactions should remain
      // Without the fix, there would be 1 uncommitted transaction from must-refetch
      expect(testCollection._state.pendingSyncedTransactions.length).toBe(0)

      // Verify data is correct (not undefined from orphan transaction)
      expect(stripVirtualProps(testCollection.get(3))).toEqual({
        id: 3,
        name: `User 3`,
      })
      expect(stripVirtualProps(testCollection.get(4))).toEqual({
        id: 4,
        name: `User 4`,
      })
    })

    it(`should handle must-refetch in progressive mode with txid tracking`, () => {
      vi.clearAllMocks()

      let testSubscriber!: (messages: Array<Message<Row>>) => void
      mockSubscribe.mockImplementation((callback) => {
        testSubscriber = callback
        return () => {}
      })
      mockRequestSnapshot.mockResolvedValue(undefined)
      mockFetchSnapshot.mockResolvedValue({ metadata: {}, data: [] })

      const config = {
        id: `progressive-must-refetch-txid-test`,
        shapeOptions: {
          url: `http://test-url`,
          params: { table: `test_table` },
        },
        syncMode: `progressive` as const,
        getKey: (item: Row) => item.id as number,
        startSync: true,
      }

      const testCollection = createCollection(electricCollectionOptions(config))

      // Complete initial sync
      testSubscriber([
        {
          key: `1`,
          value: { id: 1, name: `User 1` },
          headers: { operation: `insert`, txids: [100] },
        },
        {
          headers: { control: `up-to-date` },
        },
      ])

      expect(testCollection.status).toBe(`ready`)

      // Must-refetch
      testSubscriber([
        {
          headers: { control: `must-refetch` },
        },
      ])

      // Send data with txids after must-refetch
      // Without the fix, txids would not be tracked because isBufferingInitialSync() returns true
      testSubscriber([
        {
          key: `2`,
          value: { id: 2, name: `User 2` },
          headers: { operation: `insert`, txids: [200] },
        },
        {
          key: `3`,
          value: { id: 3, name: `User 3` },
          headers: { operation: `insert`, txids: [201] },
        },
        {
          headers: { control: `up-to-date` },
        },
      ])

      expect(testCollection.status).toBe(`ready`)
      expect(testCollection.size).toBe(2)
      expect(testCollection.has(2)).toBe(true)
      expect(testCollection.has(3)).toBe(true)
    })

    it(`should handle must-refetch in progressive mode with snapshot-end metadata`, () => {
      vi.clearAllMocks()

      let testSubscriber!: (messages: Array<Message<Row>>) => void
      mockSubscribe.mockImplementation((callback) => {
        testSubscriber = callback
        return () => {}
      })
      mockRequestSnapshot.mockResolvedValue(undefined)
      mockFetchSnapshot.mockResolvedValue({ metadata: {}, data: [] })

      const config = {
        id: `progressive-must-refetch-snapshot-test`,
        shapeOptions: {
          url: `http://test-url`,
          params: { table: `test_table` },
        },
        syncMode: `progressive` as const,
        getKey: (item: Row) => item.id as number,
        startSync: true,
      }

      const testCollection = createCollection(electricCollectionOptions(config))

      // Complete initial sync
      testSubscriber([
        {
          key: `1`,
          value: { id: 1, name: `User 1` },
          headers: { operation: `insert` },
        },
        {
          headers: {
            control: `snapshot-end`,
            xmin: `100`,
            xmax: `110`,
            xip_list: [],
          },
        },
        {
          headers: { control: `up-to-date` },
        },
      ])

      expect(testCollection.status).toBe(`ready`)

      // Must-refetch
      testSubscriber([
        {
          headers: { control: `must-refetch` },
        },
      ])

      // Send data with snapshot-end after must-refetch
      // Without the fix, snapshot-end metadata would not be tracked
      testSubscriber([
        {
          key: `2`,
          value: { id: 2, name: `User 2` },
          headers: { operation: `insert` },
        },
        {
          headers: {
            control: `snapshot-end`,
            xmin: `200`,
            xmax: `210`,
            xip_list: [],
          },
        },
        {
          headers: { control: `up-to-date` },
        },
      ])

      expect(testCollection.status).toBe(`ready`)
      expect(testCollection.size).toBe(1)
      expect(testCollection.has(2)).toBe(true)
      expect(stripVirtualProps(testCollection.get(2))).toEqual({
        id: 2,
        name: `User 2`,
      })
    })

    it(`should handle multiple batches after must-refetch in progressive mode`, () => {
      vi.clearAllMocks()

      let testSubscriber!: (messages: Array<Message<Row>>) => void
      mockSubscribe.mockImplementation((callback) => {
        testSubscriber = callback
        return () => {}
      })
      mockRequestSnapshot.mockResolvedValue(undefined)
      mockFetchSnapshot.mockResolvedValue({ metadata: {}, data: [] })

      const config = {
        id: `progressive-must-refetch-batches-test`,
        shapeOptions: {
          url: `http://test-url`,
          params: { table: `test_table` },
        },
        syncMode: `progressive` as const,
        getKey: (item: Row) => item.id as number,
        startSync: true,
      }

      const testCollection = createCollection(electricCollectionOptions(config))

      // Complete initial sync
      testSubscriber([
        {
          key: `1`,
          value: { id: 1, name: `User 1` },
          headers: { operation: `insert` },
        },
        {
          headers: { control: `up-to-date` },
        },
      ])

      expect(testCollection.status).toBe(`ready`)

      // Must-refetch
      testSubscriber([
        {
          headers: { control: `must-refetch` },
        },
      ])

      // First batch of data after must-refetch
      testSubscriber([
        {
          key: `2`,
          value: { id: 2, name: `User 2` },
          headers: { operation: `insert` },
        },
      ])

      // Second batch of data after must-refetch
      testSubscriber([
        {
          key: `3`,
          value: { id: 3, name: `User 3` },
          headers: { operation: `insert` },
        },
      ])

      // Third batch of data after must-refetch
      testSubscriber([
        {
          key: `4`,
          value: { id: 4, name: `User 4` },
          headers: { operation: `insert` },
        },
      ])

      // Still waiting for up-to-date
      expect(testCollection.size).toBe(1) // Only old data visible

      // Final up-to-date
      testSubscriber([
        {
          headers: { control: `up-to-date` },
        },
      ])

      // All new data should be committed
      expect(testCollection.status).toBe(`ready`)
      expect(testCollection.has(1)).toBe(false) // Truncated
      expect(testCollection.has(2)).toBe(true)
      expect(testCollection.has(3)).toBe(true)
      expect(testCollection.has(4)).toBe(true)
      expect(testCollection.size).toBe(3)
    })
  })

  describe(`syncMode configuration - GC and resync`, () => {
    it(`should resync after garbage collection and new subscription`, async () => {
      // Use fake timers for this test
      vi.useFakeTimers()

      const config = {
        id: `gc-resync-test`,
        shapeOptions: {
          url: `http://test-url`,
          params: {
            table: `test_table`,
          },
        },
        getKey: (item: Row) => item.id as number,
        startSync: true,
        gcTime: 100, // Short GC time for testing
      }

      const testCollection = createCollection(electricCollectionOptions(config))

      // Populate collection with initial data
      subscriber([
        {
          key: `1`,
          value: { id: 1, name: `Initial User` },
          headers: { operation: `insert` },
        },
        {
          key: `2`,
          value: { id: 2, name: `Another User` },
          headers: { operation: `insert` },
        },
        {
          headers: { control: `up-to-date` },
        },
      ])

      // Verify initial data is present
      expect(testCollection.has(1)).toBe(true)
      expect(testCollection.has(2)).toBe(true)
      expect(testCollection.size).toBe(2)

      // Subscribe and then unsubscribe to trigger GC timer
      const subscription = testCollection.subscribeChanges(() => {})
      subscription.unsubscribe()

      // Collection should still be ready before GC timer fires
      expect(testCollection.status).toBe(`ready`)
      expect(testCollection.size).toBe(2)

      // Fast-forward time to trigger GC (past the 100ms gcTime)
      await vi.advanceTimersByTimeAsync(150)

      // Collection should be cleaned up
      expect(testCollection.status).toBe(`cleaned-up`)
      expect(testCollection.size).toBe(0)

      // Reset mock call count for new subscription
      const initialMockCallCount = mockSubscribe.mock.calls.length

      // Subscribe again - this should restart the sync
      const newSubscription = testCollection.subscribeChanges(() => {})

      // Should have created a new stream
      expect(mockSubscribe.mock.calls.length).toBe(initialMockCallCount + 1)
      expect(testCollection.status).toBe(`loading`)

      // Send new data to simulate resync
      subscriber([
        {
          key: `3`,
          value: { id: 3, name: `Resynced User` },
          headers: { operation: `insert` },
        },
        {
          key: `1`,
          value: { id: 1, name: `Updated User` },
          headers: { operation: `insert` },
        },
        {
          headers: { control: `up-to-date` },
        },
      ])

      // Verify the collection has resynced with new data
      expect(testCollection.status).toBe(`ready`)
      expect(testCollection.has(1)).toBe(true)
      expect(testCollection.has(3)).toBe(true)
      expect(stripVirtualProps(testCollection.get(1))).toEqual({
        id: 1,
        name: `Updated User`,
      })
      expect(stripVirtualProps(testCollection.get(3))).toEqual({
        id: 3,
        name: `Resynced User`,
      })
      expect(testCollection.size).toBe(2)

      // Old data should not be present (collection was cleaned)
      expect(testCollection.has(2)).toBe(false)

      newSubscription.unsubscribe()

      // Restore real timers
      vi.useRealTimers()
    })
  })
})
