import { describe, expect, it, vi } from 'vitest'
import { createCollection, createTransaction } from '@tanstack/db'
import { trailBaseCollectionOptions } from '../src/trailbase'
import { stripVirtualProps } from '../../db/tests/utils'
import type {
  CreateOperation,
  DeleteOperation,
  Event,
  FilterOrComposite,
  ListOperation,
  ListOpts,
  ListResponse,
  Pagination,
  ReadOperation,
  ReadOpts,
  RecordApi,
  RecordId,
  SubscribeOpts,
  UpdateOperation,
} from 'trailbase'

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

class MockRecordApi<T> implements RecordApi<T> {
  list = vi.fn(
    (_opts?: {
      pagination?: Pagination
      order?: Array<string>
      filters?: Array<FilterOrComposite>
      count?: boolean
      expand?: Array<string>
    }): Promise<ListResponse<T>> => {
      return Promise.resolve({ records: [] })
    },
  )
  listOp = vi.fn((_opts?: ListOpts): ListOperation<T> => {
    throw `listOp`
  })
  listGeoOp = vi.fn((_geometryColumn: string, _opts?: ListOpts) => {
    throw `listGeoOp`
  })

  read = vi.fn(
    (
      _id: string | number,
      _opt?: {
        expand?: Array<string>
      },
    ): Promise<T> => {
      throw `read`
    },
  )
  readOp = vi.fn((_id: RecordId, _opt?: ReadOpts): ReadOperation<T> => {
    throw `readOp`
  })

  create = vi.fn((_record: T): Promise<string | number> => {
    throw `create`
  })
  createBulk = vi.fn((_records: Array<T>): Promise<Array<string | number>> => {
    throw `createBulk`
  })
  createOp = vi.fn((_record: T): CreateOperation<T> => {
    throw `createOp`
  })

  update = vi.fn((_id: string | number, _record: Partial<T>): Promise<void> => {
    throw `update`
  })
  updateOp = vi.fn((_id: RecordId, _record: Partial<T>): UpdateOperation => {
    throw `updateOp`
  })

  delete = vi.fn((_id: string | number): Promise<void> => {
    throw `delete`
  })
  deleteOp = vi.fn((_id: RecordId): DeleteOperation => {
    throw `deleteOp`
  })

  subscribe = vi.fn((_id: string | number): Promise<ReadableStream<Event>> => {
    return Promise.resolve(
      new ReadableStream({
        start: (controller: ReadableStreamDefaultController<Event>) => {
          controller.close()
        },
      }),
    )
  })
  subscribeAll = vi.fn(
    (_opts?: SubscribeOpts): Promise<ReadableStream<Event>> => {
      throw `subscribeAll`
    },
  )
}

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
      if (load instanceof Promise) await load

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
