import { describe, expect, it, vi } from 'vitest'
import { createCollection, createTransaction } from '@tanstack/db'
import { trailBaseCollectionOptions } from '../src/trailbase'
import { stripVirtualProps } from '../../db/tests/utils'
import { MockRecordApi } from './mock-record-api'
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
    const collection = createCollection(setUp(recordApi))
    const transaction = createTransaction({
      mutationFn: () => persistence,
    })
    const preload = collection.preload()

    try {
      await vi.waitFor(() => expect(recordApi.list).toHaveBeenCalledOnce())
      transaction.mutate(() =>
        collection.insert({ id: 2, updated: 0, data: `local` }),
      )
      expect(transaction.state).toBe(`persisting`)

      resolveList({
        records: [{ id: 1, updated: 0, data: `server` }],
      })
      await Promise.resolve()
      await Promise.resolve()

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
      await Promise.resolve()
      await Promise.resolve()

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
    let listResolver: (value: boolean) => void
    const listPromise = new Promise<boolean>((res) => {
      listResolver = res
    })
    recordApi.list.mockImplementation((_opts) => {
      setInterval(() => listResolver(true), 1)
      return Promise.resolve({
        records,
      })
    })

    const stream = new TransformStream<Event>()
    const injectEvent = async (event: Event) => {
      const writer = stream.writable.getWriter()
      await writer.write(event)
      writer.releaseLock()
    }
    recordApi.subscribe.mockResolvedValue(stream.readable)

    const options = setUp(recordApi)
    const collection = createCollection(options)

    // Await initial fetch and assert state.
    await listPromise
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

    await stream.readable.getReader().closed

    // Check that double cancellation is fine.
    options.utils.cancel()
  })

  it(`receive inserts and delete updates`, async () => {
    // Prepare mock API.
    const recordApi = new MockRecordApi<Data>()

    const stream = new TransformStream<Event>()
    const injectEvent = async (event: Event) => {
      const writer = stream.writable.getWriter()
      await writer.write(event)
      writer.releaseLock()
    }
    recordApi.subscribe.mockResolvedValue(stream.readable)

    const options = setUp(recordApi)
    const collection = createCollection(options)

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

    stream.writable.close()
  })

  it(`local inserts, updates and deletes`, () => {
    // Prepare mock API.
    const recordApi = new MockRecordApi<Data>()

    const stream = new TransformStream<Event>()
    recordApi.subscribe.mockResolvedValue(stream.readable)

    const createBulkMock = recordApi.createBulk.mockImplementation(
      (records: Array<Data>): Promise<Array<string | number>> => {
        setTimeout(() => {
          const writer = stream.writable.getWriter()
          for (const record of records) {
            writer.write({
              Insert: record,
            })
          }
          writer.releaseLock()
        }, 1)

        return Promise.resolve(records.map((r) => r.id ?? 0))
      },
    )

    const options = setUp(recordApi)
    const collection = createCollection(options)

    // Await initial fetch and assert state.
    expect(stripState(collection.state)).toEqual(new Map([]))

    const data: Data = {
      id: 42,
      updated: 0,
      data: `first`,
    }

    collection.insert(data)

    expect(createBulkMock).toHaveBeenCalledOnce()

    expect(stripState(collection.state)).toEqual(new Map([[data.id, data]]))

    const updatedData: Data = {
      ...data,
      updated: 1,
    }

    const updateMock = recordApi.update.mockImplementation(
      (_id: string | number, record: Partial<Data>) => {
        expect(record).toEqual({ updated: updatedData.updated })
        const writer = stream.writable.getWriter()
        writer.write({
          Update: record,
        })
        writer.releaseLock()
        return Promise.resolve()
      },
    )

    collection.update(data.id, (old: Data) => {
      old.updated = updatedData.updated
    })

    expect(updateMock).toHaveBeenCalledOnce()

    expect(stripState(collection.state)).toEqual(
      new Map([[updatedData.id, updatedData]]),
    )

    const deleteMock = recordApi.delete.mockImplementation(
      (_id: string | number) => {
        const writer = stream.writable.getWriter()
        writer.write({
          Delete: updatedData,
        })
        writer.releaseLock()
        return Promise.resolve()
      },
    )

    collection.delete(updatedData.id!)

    expect(deleteMock).toHaveBeenCalledOnce()

    expect(stripState(collection.state)).toEqual(new Map([]))
  })
})
