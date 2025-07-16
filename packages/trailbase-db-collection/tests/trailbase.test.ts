import { describe, expect, it, vi } from "vitest"
import { createCollection } from "@tanstack/db"
import { trailBaseCollectionOptions } from "../src/trailbase"
import type {
  Event,
  FilterOrComposite,
  ListResponse,
  Pagination,
  RecordApi,
} from "trailbase"

type Data = {
  id: number | null
  updated: number | null
  data: string
}

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
    }
  )

  read = vi.fn(
    (
      _id: string | number,
      _opt?: {
        expand?: Array<string>
      }
    ): Promise<T> => {
      throw `read`
    }
  )

  create = vi.fn((_record: T): Promise<string | number> => {
    throw `create`
  })
  createBulk = vi.fn((_records: Array<T>): Promise<Array<string | number>> => {
    throw `createBulk`
  })

  update = vi.fn((_id: string | number, _record: Partial<T>): Promise<void> => {
    throw `update`
  })
  delete = vi.fn((_id: string | number): Promise<void> => {
    throw `delete`
  })
  subscribe = vi.fn((_id: string | number): Promise<ReadableStream<Event>> => {
    return Promise.resolve(
      new ReadableStream({
        start: (controller: ReadableStreamDefaultController<Event>) => {
          controller.close()
        },
      })
    )
  })
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

describe(`TrailBase Integration`, () => {
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
    expect(collection.state).toEqual(new Map(records.map((d) => [d.id, d])))

    // Inject an update event and assert state.
    const updatedRecord: Data = {
      ...records[0]!,
      updated: 1,
    }

    await injectEvent({ Update: updatedRecord })

    expect(collection.state).toEqual(
      new Map([updatedRecord].map((d) => [d.id, d]))
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
    expect(collection.state).toEqual(new Map([]))

    // Inject an update event and assert state.
    const data: Data = {
      id: 0,
      updated: 0,
      data: `first`,
    }

    await injectEvent({
      Insert: data,
    })

    expect(collection.state).toEqual(new Map([data].map((d) => [d.id, d])))

    await injectEvent({
      Delete: data,
    })

    expect(collection.state).toEqual(new Map([]))

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
      }
    )

    const options = setUp(recordApi)
    const collection = createCollection(options)

    // Await initial fetch and assert state.
    expect(collection.state).toEqual(new Map([]))

    const data: Data = {
      id: 42,
      updated: 0,
      data: `first`,
    }

    collection.insert(data)

    expect(createBulkMock).toHaveBeenCalledOnce()

    expect(collection.state).toEqual(new Map([[data.id, data]]))

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
      }
    )

    collection.update(data.id, (old: Data) => {
      old.updated = updatedData.updated
    })

    expect(updateMock).toHaveBeenCalledOnce()

    expect(collection.state).toEqual(new Map([[updatedData.id, updatedData]]))

    const deleteMock = recordApi.delete.mockImplementation(
      (_id: string | number) => {
        const writer = stream.writable.getWriter()
        writer.write({
          Delete: updatedData,
        })
        writer.releaseLock()
        return Promise.resolve()
      }
    )

    collection.delete(updatedData.id!)

    expect(deleteMock).toHaveBeenCalledOnce()

    expect(collection.state).toEqual(new Map([]))
  })
})
