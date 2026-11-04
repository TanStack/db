import { vi } from 'vitest'
import type {
  Client,
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

export class MockRecordApi<T> implements RecordApi<T> {
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
  createOp = vi.fn(
    (record: T): CreateOperation<T> =>
      ({ kind: `create`, record }) as unknown as CreateOperation<T>,
  )

  update = vi.fn((_id: string | number, _record: Partial<T>): Promise<void> => {
    throw `update`
  })
  updateOp = vi.fn(
    (id: RecordId, record: Partial<T>): UpdateOperation =>
      ({ kind: `update`, id, record }) as unknown as UpdateOperation,
  )

  delete = vi.fn((_id: string | number): Promise<void> => {
    throw `delete`
  })
  deleteOp = vi.fn(
    (id: RecordId): DeleteOperation =>
      ({ kind: `delete`, id }) as unknown as DeleteOperation,
  )

  /**
   * A client whose `execute` runs this API's operations through its
   * `createBulk`, `update`, and `delete`, so a test mocks those calls.
   */
  readonly client = {
    execute: vi.fn(async (operations: Array<unknown>) => {
      const ops = operations as Array<
        | { kind: `create`; record: T }
        | { kind: `update`; id: RecordId; record: Partial<T> }
        | { kind: `delete`; id: RecordId }
      >
      const records = ops.flatMap((op) =>
        op.kind === `create` ? [op.record] : [],
      )
      if (records.length > 0) return this.createBulk(records)
      for (const op of ops)
        if (op.kind === `update`) await this.update(op.id, op.record)
        else if (op.kind === `delete`) await this.delete(op.id)
      return []
    }),
  } as unknown as Client

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
