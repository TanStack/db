import { describe, expect, it, vi } from 'vitest'
import { createCollection, createTransaction } from '@tanstack/db'
import { trailBaseCollectionOptions } from '../src/trailbase'
import { stripVirtualProps } from '../../db/tests/utils'
import { createDeferred } from '../../db/src/deferred'
import { MockRecordApi } from './mock-record-api'
import type { SyncAppliedReceipt } from '@tanstack/db'
import type { Event, ListResponse } from 'trailbase'

type Data = {
  id: number | null
  updated: number | null
  data: string
}

const stripState = (state: Map<number | string | null, Data>) =>
  new Map(
    Array.from(state.entries(), ([key, value]) => [
      key,
      stripVirtualProps(value),
    ]),
  )

function setUp(recordApi: MockRecordApi<Data>) {
  // Get the options with utilities
  const options = trailBaseCollectionOptions({
    recordApi,
    getKey: (item: Data): number | number =>
      item.id ?? Math.round(Math.random() * 100000),
    startSync: true,
    parse: {},
    serialize: {},
  })

  return options
}

function observeAppliedCommits(options: ReturnType<typeof setUp>) {
  const attempted = createDeferred<void>()
  const receipts: Array<{
    receipt: SyncAppliedReceipt
    result: `pending` | `fulfilled` | `rejected`
  }> = []
  const sync = options.sync
  return {
    attempted: attempted.promise,
    receipts,
    options: {
      ...options,
      sync: {
        ...sync,
        sync: (params: Parameters<typeof sync.sync>[0]) =>
          sync.sync({
            ...params,
            commit: (signal) => {
              const receipt = params.commit(signal)
              const observation: (typeof receipts)[number] = {
                receipt,
                result: receipt === true ? `fulfilled` : `pending`,
              }
              receipts.push(observation)
              if (receipt !== true)
                void receipt.then(
                  () => {
                    observation.result = `fulfilled`
                  },
                  () => {
                    observation.result = `rejected`
                  },
                )
              // Resolve only an entry gate, never assimilate the applied promise.
              attempted.resolve()
              return receipt
            },
          }),
      },
    },
  }
}

type ListPublication = {
  rows: Array<Data>
  events: Array<{ type: string; key: string | number; value: Data }>
}

async function observeAtomicList(): Promise<Array<ListPublication>> {
  const recordApi = new MockRecordApi<Data>()
  const response = createDeferred<ListResponse<Data>>()
  recordApi.list.mockReturnValue(response.promise)
  const stream = new ReadableStream<Event>()
  recordApi.subscribe.mockResolvedValue(stream)
  const collection = createCollection(setUp(recordApi))
  const publications: Array<ListPublication> = []
  const copyRow = ({ id, updated, data }: Data): Data => ({ id, updated, data })
  const subscription = collection.subscribeChanges((changes) => {
    publications.push({
      rows: collection.toArray.map(copyRow),
      events: changes.map(({ type, key, value }) => ({
        type,
        key,
        value: copyRow(value),
      })),
    })
  })
  const preload = collection.preload()
  void preload.catch(() => undefined)
  try {
    await vi.waitFor(() => expect(recordApi.list).toHaveBeenCalledOnce())
    expect(collection.status).toBe(`loading`)
    expect(publications).toEqual([])
    response.resolve({
      records: [
        { id: 2, updated: 22, data: `second` },
        { id: 1, updated: 11, data: `first` },
      ],
    })
    await preload
    expect(collection.status).toBe(`ready`)
    return publications
  } finally {
    response.resolve({ records: [] })
    subscription.unsubscribe()
    await collection.cleanup()
    await Promise.allSettled([preload])
    expect(stream.locked).toBe(false)
  }
}

function expectAtomicList(publications: Array<ListPublication>): void {
  expect(publications.length).toBeGreaterThan(0)
  const expectedEvents = [
    { type: `insert`, key: 1, value: { id: 1, updated: 11, data: `first` } },
    { type: `insert`, key: 2, value: { id: 2, updated: 22, data: `second` } },
  ]
  for (const publication of publications) {
    expect([...publication.rows].sort((a, b) => a.id! - b.id!)).toEqual([
      { id: 1, updated: 11, data: `first` },
      { id: 2, updated: 22, data: `second` },
    ])
    // Core may emit an empty source batch. Its public rows remain observable;
    // only the event-batch assertion is conditional, not the row assertion.
    if (publication.events.length > 0)
      expect(
        [...publication.events].sort((a, b) => Number(a.key) - Number(b.key)),
      ).toEqual(expectedEvents)
  }
  expect(
    publications
      .flatMap((publication) => publication.events)
      .sort((a, b) => Number(a.key) - Number(b.key)),
  ).toEqual(expectedEvents)
}

async function expectWildcardFailureSettlesPreload(): Promise<void> {
  const failure = new Error(`wildcard subscription denied`)
  const recordApi = new MockRecordApi<Data>()
  recordApi.subscribe.mockRejectedValue(failure)

  const collection = createCollection(setUp(recordApi))
  const preload = collection.preload()

  try {
    await expect(preload).rejects.toBe(failure)
    expect(collection.status).toBe(`error`)
  } finally {
    await collection.cleanup()
    await Promise.allSettled([preload])
  }
}

async function writeEvent(stream: TransformStream<Event>, event: Event) {
  const writer = stream.writable.getWriter()
  try {
    await writer.write(event)
  } finally {
    writer.releaseLock()
  }
}

describe(`TrailBase Integration`, () => {
  it.each(
    ([`loading`, `ready`] as const).flatMap((phase) =>
      ([`close`, `error`] as const).map((ending) => ({ phase, ending })),
    ),
  )(
    `handles same-turn $ending and cleanup while $phase`,
    async ({ phase, ending }) => {
      const recordApi = new MockRecordApi<Data>()
      const row: Data = { id: 1, updated: 0, data: `loaded` }
      let resolveList!: (response: ListResponse<Data>) => void
      recordApi.list.mockReturnValue(
        new Promise((resolve) => {
          resolveList = resolve
        }),
      )
      let controller!: ReadableStreamDefaultController<Event>
      const stream = new ReadableStream<Event>({
        start(value) {
          controller = value
        },
      })
      recordApi.subscribe.mockResolvedValue(stream)
      const errors: Array<unknown> = []
      const recordUnhandled = (error: unknown) => errors.push(error)
      process.on(`unhandledRejection`, recordUnhandled)
      const collection = createCollection(setUp(recordApi))
      const preload = collection.preload().then(
        () => `ready`,
        (error: unknown) => error,
      )
      try {
        await vi.waitFor(() => expect(recordApi.list).toHaveBeenCalledOnce())
        if (phase === `ready`) {
          resolveList({ records: [row] })
          expect(await preload).toBe(`ready`)
          expect(collection.get(1)).toMatchObject(row)
        }
        if (ending === `error`) controller.error(new Error(`connection lost`))
        else controller.close()
        // No microtask between stream termination and cleanup.
        await collection.cleanup()
        resolveList({ records: [row] })
        if (phase === `loading`)
          expect(await preload).toMatchObject({ name: `AbortError` })
        await new Promise((resolve) => setTimeout(resolve, 0))
        expect(errors).toEqual([])
        expect(stream.locked).toBe(false)
        expect(collection.status).toBe(`cleaned-up`)
        expect(collection.size).toBe(0)
        expect(recordApi.subscribe).toHaveBeenCalledOnce()
        expect(recordApi.list).toHaveBeenCalledOnce()
      } finally {
        resolveList({ records: [] })
        await collection.cleanup()
        await preload
        await new Promise((resolve) => setTimeout(resolve, 0))
        process.off(`unhandledRejection`, recordUnhandled)
      }
    },
  )

  it(`cancels an open stream when processing an event fails`, async () => {
    const recordApi = new MockRecordApi<Data>()
    let controller!: ReadableStreamDefaultController<Event>
    const cancel = vi.fn()
    const stream = new ReadableStream<Event>({
      start(value) {
        controller = value
      },
      cancel,
    })
    recordApi.subscribe.mockResolvedValue(stream)
    const failure = new Error(`parse rejected row`)
    const reported = vi.spyOn(console, `error`).mockImplementation(() => {})
    const collection = createCollection(
      trailBaseCollectionOptions({
        recordApi,
        getKey: (row: Data) => row.id!,
        parse: {
          id: () => {
            throw failure
          },
        },
        serialize: {},
      }),
    )
    try {
      await collection.preload()
      controller.enqueue({ Insert: { id: 1, updated: 0, data: `invalid` } })
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(reported).toHaveBeenCalledExactlyOnceWith(
        `TrailBase subscription failed`,
        failure,
      )
      expect(cancel).toHaveBeenCalledOnce()
      expect(stream.locked).toBe(false)
      await collection.cleanup()
      expect(cancel).toHaveBeenCalledOnce()
    } finally {
      await collection.cleanup()
      reported.mockRestore()
    }
  })

  it.each([`close`, `buffered-close`, `error`] as const)(
    `releases a settled stream without unhandled rejection after %s`,
    async (ending) => {
      const recordApi = new MockRecordApi<Data>()
      const row: Data = { id: 1, updated: 0, data: `retained` }
      recordApi.list.mockResolvedValue({ records: [row] })
      let controller!: ReadableStreamDefaultController<Event>
      const stream = new ReadableStream<Event>({
        start(value) {
          controller = value
        },
      })
      recordApi.subscribe.mockResolvedValue(stream)
      const failure = new Error(`connection lost`)
      const errors: Array<unknown> = []
      const recordUnhandled = (error: unknown) => errors.push(error)
      const reported = vi.spyOn(console, `error`).mockImplementation(() => {})
      const intervals = vi.spyOn(globalThis, `setInterval`)
      const clear = vi.spyOn(globalThis, `clearInterval`)
      process.on(`unhandledRejection`, recordUnhandled)
      const collection = createCollection(setUp(recordApi))

      try {
        await collection.preload()
        const timer = intervals.mock.results.at(-1)?.value
        expect(timer).toBeDefined()
        const expectedRows = new Map([[1, row]])
        if (ending === `buffered-close`) {
          for (const id of [2, 3]) {
            const value: Data = { id, updated: 0, data: `buffered-${id}` }
            expectedRows.set(id, value)
            controller.enqueue({ Insert: value })
          }
        }
        if (ending === `error`) controller.error(failure)
        else controller.close()
        await new Promise((resolve) => setTimeout(resolve, 0))

        expect(errors).toEqual([])
        expect(clear).toHaveBeenCalledWith(timer)
        expect(stream.locked).toBe(false)
        expect(collection.status).toBe(`ready`)
        expect(stripState(collection.state)).toEqual(expectedRows)
        expect(recordApi.subscribe).toHaveBeenCalledOnce()
        expect(recordApi.list).toHaveBeenCalledOnce()
        if (ending === `error`) {
          expect(reported).toHaveBeenCalledExactlyOnceWith(
            `TrailBase subscription failed`,
            failure,
          )
        } else expect(reported).not.toHaveBeenCalled()

        await collection.cleanup()
        await new Promise((resolve) => setTimeout(resolve, 0))
        expect(errors).toEqual([])
      } finally {
        await collection.cleanup()
        await new Promise((resolve) => setTimeout(resolve, 0))
        process.off(`unhandledRejection`, recordUnhandled)
        reported.mockRestore()
        intervals.mockRestore()
        clear.mockRestore()
      }
    },
  )

  it(`marks initial sync ready only after its rows are applied`, async () => {
    const recordApi = new MockRecordApi<Data>()
    let resolveList!: (response: ListResponse<Data>) => void
    recordApi.list.mockReturnValue(
      new Promise<ListResponse<Data>>((resolve) => {
        resolveList = resolve
      }),
    )
    recordApi.subscribe.mockResolvedValue(new TransformStream<Event>().readable)

    let resolvePersistence!: () => void
    const persistence = new Promise<void>((resolve) => {
      resolvePersistence = resolve
    })
    const commits = observeAppliedCommits(setUp(recordApi))
    const collection = createCollection(commits.options)
    const transaction = createTransaction({
      mutationFn: () => persistence,
    })
    const preload = collection.preload()
    let preloadSettled = false
    void preload.then(
      () => {
        preloadSettled = true
      },
      () => {
        preloadSettled = true
      },
    )

    try {
      await vi.waitFor(() => expect(recordApi.list).toHaveBeenCalledOnce())
      transaction.mutate(() =>
        collection.insert({ id: 2, updated: 0, data: `local` }),
      )
      expect(transaction.state).toBe(`persisting`)

      resolveList({
        records: [{ id: 1, updated: 0, data: `server` }],
      })
      await commits.attempted
      expect(commits.receipts).toHaveLength(1)
      expect(commits.receipts[0]!.receipt).not.toBe(true)
      expect(commits.receipts[0]!.result).toBe(`pending`)
      expect(preloadSettled).toBe(false)

      expect(collection.status).toBe(`loading`)
      expect(collection.get(1)).toBeUndefined()

      resolvePersistence()
      await transaction.isPersisted.promise
      await preload

      expect(collection.status).toBe(`ready`)
      expect(collection.get(1)).toEqual(
        expect.objectContaining({
          id: 1,
          updated: 0,
          data: `server`,
        }),
      )
    } finally {
      resolveList({ records: [] })
      resolvePersistence()
      await transaction.isPersisted.promise.catch(() => undefined)
      await collection.cleanup()
      await Promise.allSettled([preload])
    }
  })

  it(`settles preload when wildcard subscription startup fails`, async () => {
    await expectWildcardFailureSettlesPreload()
  })

  it(`cancels its event subscription when the collection is cleaned up`, async () => {
    const recordApi = new MockRecordApi<Data>()
    const cancel = vi.fn()
    recordApi.subscribe.mockResolvedValue(new ReadableStream<Event>({ cancel }))
    const collection = createCollection(setUp(recordApi))

    await vi.waitFor(() => expect(recordApi.subscribe).toHaveBeenCalledOnce())
    await collection.cleanup()

    await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce())
  })

  it(`ignores an initial fetch that resolves after cleanup`, async () => {
    const recordApi = new MockRecordApi<Data>()
    let resolveList!: (response: ListResponse<Data>) => void
    recordApi.list.mockReturnValue(
      new Promise<ListResponse<Data>>((resolve) => {
        resolveList = resolve
      }),
    )
    recordApi.subscribe.mockResolvedValue(new TransformStream<Event>().readable)
    const options = setUp(recordApi)
    const collection = createCollection(options)

    await vi.waitFor(() => expect(recordApi.list).toHaveBeenCalledOnce())
    await collection.cleanup()
    resolveList({
      records: [{ id: 1, updated: 0, data: `late` }],
    })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(stripState(collection.state)).toEqual(new Map())
    expect(options.sync.getSyncMetadata?.()).toMatchObject({
      fullSyncComplete: false,
    })
  })

  it(`ignores a subset page that resolves after its request is aborted`, async () => {
    const recordApi = new MockRecordApi<Data>()
    let resolveList!: (response: ListResponse<Data>) => void
    recordApi.list.mockReturnValue(
      new Promise<ListResponse<Data>>((resolve) => {
        resolveList = resolve
      }),
    )
    recordApi.subscribe.mockResolvedValue(new TransformStream<Event>().readable)
    const collection = createCollection(
      trailBaseCollectionOptions({
        recordApi,
        getKey: (item: Data) => item.id ?? -1,
        startSync: true,
        syncMode: `on-demand`,
        parse: {},
        serialize: {},
      }),
    )
    const abortController = new AbortController()

    try {
      await vi.waitFor(() => expect(collection.status).toBe(`ready`))
      const load = collection._sync.loadSubset({
        signal: abortController.signal,
      })
      expect(recordApi.list).toHaveBeenCalledOnce()
      abortController.abort()
      resolveList({
        records: [{ id: 1, updated: 0, data: `obsolete` }],
      })
      if (load instanceof Promise) await load

      expect(stripState(collection.state)).toEqual(new Map())
    } finally {
      resolveList({ records: [] })
      await collection.cleanup()
    }
  })

  it(`does not publish a parked subset page after its request is aborted`, async () => {
    const recordApi = new MockRecordApi<Data>()
    recordApi.list.mockResolvedValue({
      records: [{ id: 1, updated: 0, data: `obsolete` }],
    })
    recordApi.subscribe.mockResolvedValue(new TransformStream<Event>().readable)
    const commits = observeAppliedCommits(
      trailBaseCollectionOptions({
        recordApi,
        getKey: (item: Data) => item.id ?? -1,
        startSync: true,
        syncMode: `on-demand`,
        parse: {},
        serialize: {},
      }),
    )
    const collection = createCollection(commits.options)
    let resolvePersistence!: () => void
    const persistence = new Promise<void>((resolve) => {
      resolvePersistence = resolve
    })
    const transaction = createTransaction({
      mutationFn: () => persistence,
    })
    const abortController = new AbortController()

    try {
      await vi.waitFor(() => expect(collection.status).toBe(`ready`))
      transaction.mutate(() =>
        collection.insert({ id: 2, updated: 0, data: `local` }),
      )
      const load = collection._sync.loadSubset({
        signal: abortController.signal,
      })
      await vi.waitFor(() => expect(recordApi.list).toHaveBeenCalledOnce())
      let loadSettled = false
      void Promise.resolve(load).then(
        () => {
          loadSettled = true
        },
        () => {
          loadSettled = true
        },
      )
      await commits.attempted
      expect(commits.receipts).toHaveLength(1)
      expect(commits.receipts[0]!.receipt).not.toBe(true)
      expect(commits.receipts[0]!.result).toBe(`pending`)
      expect(loadSettled).toBe(false)

      expect(collection.get(1)).toBeUndefined()
      abortController.abort()
      resolvePersistence()
      await transaction.isPersisted.promise
      if (load === true) {
        throw new Error(`Expected a pending applied receipt`)
      }
      await expect(load).rejects.toMatchObject({ name: `AbortError` })

      expect(collection.get(1)).toBeUndefined()
      expect(recordApi.list).toHaveBeenCalledOnce()
    } finally {
      abortController.abort()
      resolvePersistence()
      await transaction.isPersisted.promise.catch(() => undefined)
      await collection.cleanup()
    }
  })

  it(`fetches later subset pages while earlier pages wait to apply`, async () => {
    const recordApi = new MockRecordApi<Data>()
    recordApi.list.mockImplementation(async () => {
      const start = recordApi.list.mock.calls.length === 1 ? 1 : 257
      const count = start === 1 ? 256 : 1
      return {
        records: Array.from({ length: count }, (_, index) => ({
          id: start + index,
          updated: 0,
          data: `remote`,
        })),
        cursor: `page-${start}`,
      }
    })
    recordApi.subscribe.mockResolvedValue(new TransformStream<Event>().readable)
    const collection = createCollection(
      trailBaseCollectionOptions({
        recordApi,
        getKey: (item: Data) => item.id ?? -1,
        startSync: true,
        syncMode: `on-demand`,
        parse: {},
        serialize: {},
      }),
    )
    let resolvePersistence!: () => void
    const persistence = new Promise<void>((resolve) => {
      resolvePersistence = resolve
    })
    const transaction = createTransaction({ mutationFn: () => persistence })

    try {
      await vi.waitFor(() => expect(collection.status).toBe(`ready`))
      transaction.mutate(() =>
        collection.insert({ id: 999, updated: 0, data: `local` }),
      )
      const load = collection._sync.loadSubset({ limit: 257 })

      await vi.waitFor(() => expect(recordApi.list).toHaveBeenCalledTimes(2))
      expect(collection.get(1)).toBeUndefined()

      resolvePersistence()
      await transaction.isPersisted.promise
      if (load instanceof Promise) await load

      expect(collection.get(1)?.data).toBe(`remote`)
      expect(collection.get(257)?.data).toBe(`remote`)
    } finally {
      resolvePersistence()
      await transaction.isPersisted.promise.catch(() => undefined)
      await collection.cleanup()
    }
  })

  it(`publishes a complete two-row list at every change callback`, async () => {
    expectAtomicList(await observeAtomicList())
  })

  it(`rejects a partial list callback even when the final callback is complete`, async () => {
    const publications = await observeAtomicList()
    expectAtomicList(publications)
    const first = publications[0]!
    expect(() =>
      expectAtomicList([
        { rows: first.rows.slice(0, 1), events: first.events.slice(0, 1) },
        ...publications,
      ]),
    ).toThrow()
  })

  it(`initial fetch, receive update and cancel`, async () => {
    const records: Array<Data> = [
      {
        id: 0,
        updated: 0,
        data: `first`,
      },
    ]

    // Prepare mock API.
    const recordApi = new MockRecordApi<Data>()
    recordApi.list.mockResolvedValue({ records })

    const stream = new TransformStream<Event>()
    const injectEvent = (event: Event) => writeEvent(stream, event)
    recordApi.subscribe.mockResolvedValue(stream.readable)

    const options = setUp(recordApi)
    const collection = createCollection(options)

    // Await initial fetch and assert state.
    try {
      await collection.preload()
      expect(stripState(collection.state)).toEqual(
        new Map(records.map((d) => [d.id, d])),
      )

      // Inject an update event and assert state.
      const updatedRecord: Data = {
        ...records[0]!,
        updated: 1,
      }

      await injectEvent({ Update: updatedRecord })

      expect(stripState(collection.state)).toEqual(
        new Map([updatedRecord].map((d) => [d.id, d])),
      )

      // Await cancellation.
      options.utils.cancel()

      const reader = stream.readable.getReader()
      try {
        await reader.closed
      } finally {
        reader.releaseLock()
      }

      // Check that double cancellation is fine.
      options.utils.cancel()
    } finally {
      await collection.cleanup()
      expect(stream.readable.locked).toBe(false)
      expect(stream.writable.locked).toBe(false)
    }
  })

  it(`receive inserts and delete updates`, async () => {
    // Prepare mock API.
    const recordApi = new MockRecordApi<Data>()

    const stream = new TransformStream<Event>()
    const injectEvent = (event: Event) => writeEvent(stream, event)
    recordApi.subscribe.mockResolvedValue(stream.readable)

    const options = setUp(recordApi)
    const collection = createCollection(options)

    try {
      await collection.preload()
      // Await initial fetch and assert state.
      expect(stripState(collection.state)).toEqual(new Map([]))

      // Inject an update event and assert state.
      const data: Data = {
        id: 0,
        updated: 0,
        data: `first`,
      }

      await injectEvent({
        Insert: data,
      })

      expect(stripState(collection.state)).toEqual(
        new Map([data].map((d) => [d.id, d])),
      )

      await injectEvent({
        Delete: data,
      })

      expect(stripState(collection.state)).toEqual(new Map([]))

      await stream.writable.close()
    } finally {
      await collection.cleanup()
      expect(stream.readable.locked).toBe(false)
      expect(stream.writable.locked).toBe(false)
    }
  })

  it(`local inserts, updates and deletes`, async () => {
    // Prepare mock API.
    const recordApi = new MockRecordApi<Data>()

    const stream = new TransformStream<Event>()
    recordApi.subscribe.mockResolvedValue(stream.readable)

    const createBulkMock = recordApi.createBulk.mockImplementation(
      async (records: Array<Data>): Promise<Array<string | number>> => {
        for (const record of records)
          await writeEvent(stream, { Insert: record })
        return records.map((r) => r.id ?? 0)
      },
    )

    const options = setUp(recordApi)
    const collection = createCollection(options)
    const outcomes: Array<Promise<unknown>> = []
    try {
      await collection.preload()

      // Await initial fetch and assert state.
      expect(stripState(collection.state)).toEqual(new Map([]))

      const data: Data = {
        id: 42,
        updated: 0,
        data: `first`,
      }

      const inserted = collection.insert(data)
      outcomes.push(inserted.isPersisted.promise)

      expect(createBulkMock).toHaveBeenCalledOnce()

      expect(stripState(collection.state)).toEqual(new Map([[data.id, data]]))
      await inserted.isPersisted.promise

      const updatedData: Data = {
        ...data,
        updated: 1,
      }

      const updateMock = recordApi.update.mockImplementation(
        async (_id: string | number, record: Partial<Data>) => {
          expect(record).toEqual({ updated: updatedData.updated })
          await writeEvent(stream, { Update: { ...data, ...record } })
        },
      )

      const updated = collection.update(data.id, (old: Data) => {
        old.updated = updatedData.updated
      })
      outcomes.push(updated.isPersisted.promise)

      expect(updateMock).toHaveBeenCalledOnce()

      expect(stripState(collection.state)).toEqual(
        new Map([[updatedData.id, updatedData]]),
      )
      await updated.isPersisted.promise

      const deleteMock = recordApi.delete.mockImplementation(
        async (_id: string | number) => {
          await writeEvent(stream, { Delete: updatedData })
        },
      )

      const deleted = collection.delete(updatedData.id!)
      outcomes.push(deleted.isPersisted.promise)

      expect(deleteMock).toHaveBeenCalledOnce()

      expect(stripState(collection.state)).toEqual(new Map([]))
      await deleted.isPersisted.promise
    } finally {
      await collection.cleanup()
      await Promise.allSettled(outcomes)
      expect(stream.readable.locked).toBe(false)
      expect(stream.writable.locked).toBe(false)
    }
  })

  it(`waits for a fresh insert acknowledgement and recovers after a rejected insert with converted fields`, async () => {
    type Stored = { id: number; updated: number; data: string }
    type Item = { id: number; updated: Date; data: string }
    const recordApi = new MockRecordApi<Stored>()
    recordApi.list.mockResolvedValue({
      records: [{ id: 1, updated: 2, data: `peer` }],
    })
    let controller!: ReadableStreamDefaultController<Event>
    const stream = new ReadableStream<Event>({
      start(value) {
        controller = value
      },
    })
    recordApi.subscribe.mockResolvedValue(stream)
    const apiGate = createDeferred<Array<string | number>>()
    const apiEntered = createDeferred<void>()
    const apiReturned = createDeferred<void>()
    const denied = new Error(`fresh insert rejected`)
    const sent: Array<Array<Stored>> = []
    recordApi.createBulk.mockImplementation((records) => {
      sent.push(records.map((row) => ({ ...row })))
      if (records[0]?.id === 2) {
        apiEntered.resolve()
        return apiGate.promise.then((ids) => {
          apiReturned.resolve()
          return ids
        })
      }
      if (records[0]?.id === 3) return Promise.reject(denied)
      if (records[0]?.id === 4) return Promise.resolve([4])
      throw new Error(`unexpected test insert`)
    })
    const collection = createCollection(
      trailBaseCollectionOptions<Item, Stored, number>({
        recordApi,
        getKey: (item) => item.id,
        startSync: true,
        parse: { updated: (seconds) => new Date(seconds * 1000) },
        serialize: { updated: (date) => date.getTime() / 1000 },
      }),
    )
    const observations: Array<{
      status: `pending` | `fulfilled` | `rejected`
      error?: unknown
    }> = []
    const outcomes: Array<Promise<void>> = []
    const observe = (promise: Promise<unknown>) => {
      const result: (typeof observations)[number] = { status: `pending` }
      observations.push(result)
      const outcome = promise.then(
        () => {
          result.status = `fulfilled`
        },
        (error: unknown) => {
          result.status = `rejected`
          result.error = error
        },
      )
      outcomes.push(outcome)
      return { result, outcome }
    }
    const rows = () =>
      collection.toArray
        .map(({ id, updated, data }) => ({
          id,
          updated: updated.getTime(),
          data,
        }))
        .sort((a, b) => a.id - b.id)
    const history: Array<ReturnType<typeof rows>> = []
    const errors: Array<unknown> = []
    const recordUnhandled = (error: unknown) => errors.push(error)
    process.on(`unhandledRejection`, recordUnhandled)
    try {
      await collection.preload()
      expect(rows()).toEqual([{ id: 1, updated: 2000, data: `peer` }])
      const first = observe(
        collection.insert({ id: 2, updated: new Date(7000), data: `local` })
          .isPersisted.promise,
      )
      await apiEntered.promise
      expect(first.result).toEqual({ status: `pending` })
      expect(sent).toEqual([[{ id: 2, updated: 7, data: `local` }]])
      history.push(rows())
      apiGate.resolve([2])
      await apiReturned.promise
      // API settlement is not the fresh-key stream acknowledgement.
      // Drain promise continuations while no stream acknowledgement exists.
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(first.result).toEqual({ status: `pending` })
      controller.enqueue({
        Insert: { id: 2, updated: 8, data: `acknowledged` },
      })
      await first.outcome
      expect(first.result).toEqual({ status: `fulfilled` })
      expect(rows()).toEqual([
        { id: 1, updated: 2000, data: `peer` },
        { id: 2, updated: 8000, data: `acknowledged` },
      ])
      const rejected = observe(
        collection.insert({ id: 3, updated: new Date(9000), data: `rejected` })
          .isPersisted.promise,
      )
      expect(rows()).toContainEqual({ id: 3, updated: 9000, data: `rejected` })
      await rejected.outcome
      expect(rejected.result).toEqual({ status: `rejected`, error: denied })
      expect(rows()).toEqual([
        { id: 1, updated: 2000, data: `peer` },
        { id: 2, updated: 8000, data: `acknowledged` },
      ])
      const next = observe(
        collection.insert({ id: 4, updated: new Date(11000), data: `next` })
          .isPersisted.promise,
      )
      await vi.waitFor(() =>
        expect(recordApi.createBulk).toHaveBeenCalledTimes(3),
      )
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(next.result).toEqual({ status: `pending` })
      controller.enqueue({
        Insert: { id: 4, updated: 12, data: `next acknowledged` },
      })
      await next.outcome
      expect(next.result).toEqual({ status: `fulfilled` })
      expect(rows()).toEqual([
        { id: 1, updated: 2000, data: `peer` },
        { id: 2, updated: 8000, data: `acknowledged` },
        { id: 4, updated: 12000, data: `next acknowledged` },
      ])
      expect(sent).toEqual([
        [{ id: 2, updated: 7, data: `local` }],
        [{ id: 3, updated: 9, data: `rejected` }],
        [{ id: 4, updated: 11, data: `next` }],
      ])
      expect(history).toEqual([
        [
          { id: 1, updated: 2000, data: `peer` },
          { id: 2, updated: 7000, data: `local` },
        ],
      ])
    } finally {
      // Drain real handler gates before retiring the reader, even after an assertion fails.
      apiGate.resolve([2])
      controller.enqueue({
        Insert: { id: 2, updated: 8, data: `acknowledged` },
      })
      controller.enqueue({
        Insert: { id: 4, updated: 12, data: `next acknowledged` },
      })
      await Promise.all(outcomes)
      await collection.cleanup()
      await new Promise((resolve) => setTimeout(resolve, 0))
      process.off(`unhandledRejection`, recordUnhandled)
      expect(errors).toEqual([])
      expect(stream.locked).toBe(false)
    }
  })
})
