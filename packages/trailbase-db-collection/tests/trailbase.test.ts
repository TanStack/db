import { describe, it, vi } from 'vitest'
import { createCollection } from '@tanstack/db'
import { trailBaseCollectionOptions } from '../src/trailbase'
import type {
  Event,
  FilterOrComposite,
  ListResponse,
  Pagination,
  RecordApi,
} from 'trailbase'

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
    },
  )

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
      }),
    )
  })
}

function setUp(recordApi: MockRecordApi<Data>) {
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
  it(`cancellation closes stream and double cancel is safe`, async () => {
    const records: Array<Data> = [
      {
        id: 0,
        updated: 0,
        data: `first`,
      },
    ]

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
    recordApi.subscribe.mockResolvedValue(stream.readable)

    const options = setUp(recordApi)
    createCollection(options)

    // Wait for initial fetch to complete
    await listPromise

    // Cancel and verify stream closes
    options.utils.cancel()
    await stream.readable.getReader().closed

    // Verify double cancellation is safe
    options.utils.cancel()
  })
})
