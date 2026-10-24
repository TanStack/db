import {
  DbClient,
  collectionOptions,
  createCollection,
  withAcceptedReceipt,
} from '@tanstack/db'
import { describe, expect, it, vi } from 'vitest'
import { makeFunctionReference } from 'convex/server'
import { convexCollectionOptions } from '../src/index'
import { controlledClient, query } from './helpers'
import type { Row } from './helpers'

function setup(
  handlers: Partial<
    Pick<
      Parameters<typeof convexCollectionOptions<typeof query>>[0],
      `onInsert` | `onUpdate` | `onDelete` | `onError`
    >
  > = {},
) {
  const transport = controlledClient()
  const options = convexCollectionOptions({
    client: transport.client,
    query,
    queryArgs: { owner: `alice` },
    getKey: (row) => row._id,
    gcTime: 0,
    ...handlers,
  })
  const collection = createCollection(options)
  collection.startSyncImmediate()
  return { transport, collection, options }
}

describe(`Convex collection`, () => {
  it(`rejects concrete options reuse before it can steal cached mutation confirmation`, async () => {
    const { transport, collection, options } = setup({
      onUpdate: () => Promise.resolve(),
    })
    transport.emit([{ _id: `a`, text: `old` }])
    expect(() => createCollection(options)).toThrow(`only one Collection`)
    transport.cache([{ _id: `a`, text: `server` }])
    const transaction = collection.update(`a`, (row) => {
      row.text = `optimistic`
    })
    await transaction.isPersisted.promise
    expect(collection.get(`a`)?.text).toBe(`server`)
    await collection.cleanup()
  })

  it(`waits for a snapshot and accepts an empty initial result`, async () => {
    const { transport, collection } = setup()
    expect(collection.status).toBe(`loading`)
    transport.emit([])
    await collection.preload()
    expect(collection.status).toBe(`ready`)
    expect(collection.size).toBe(0)
    await collection.cleanup()
  })

  it(`replaces full rows and removes rows missing from later snapshots`, async () => {
    const { transport, collection } = setup()
    transport.emit([
      { _id: `a`, text: `old`, optional: `remove` },
      { _id: `b`, text: `gone` },
    ])
    transport.emit([{ _id: `a`, text: `new` }])
    expect(collection.size).toBe(1)
    expect(collection.get(`a`)).toMatchObject({ _id: `a`, text: `new` })
    expect(collection.get(`a`)).not.toHaveProperty(`optional`)
    transport.emit([])
    expect(collection.size).toBe(0)
    await collection.cleanup()
  })

  it(`rejects invalid snapshots before changing rows and recovers on a valid result`, async () => {
    const onError = vi.fn()
    const { transport, collection } = setup({ onError })
    transport.emit([{ _id: `a`, text: `valid` }])
    transport.emit([
      { _id: `b`, text: `one` },
      { _id: `b`, text: `two` },
    ])
    expect(collection.get(`a`)?.text).toBe(`valid`)
    expect(collection.has(`b`)).toBe(false)
    expect(collection.utils.getSyncError()).toBeInstanceOf(Error)
    expect(onError).toHaveBeenCalledOnce()
    transport.emit([{ _id: `b`, text: `recovered` }])
    expect(collection.utils.getSyncError()).toBeUndefined()
    expect(collection.has(`a`)).toBe(false)
    await collection.cleanup()
  })

  it(`rejects preload with the original subscription error`, async () => {
    const { transport, collection } = setup()
    const ready = collection.preload()
    const error = new Error(`permission denied`)
    transport.error(error)
    await expect(ready).rejects.toBe(error)
    transport.emit([])
    expect(collection.status).toBe(`ready`)
    await collection.cleanup()
  })

  it(`invalidates retired callbacks and replaces retained data after restart`, async () => {
    const { transport, collection } = setup()
    transport.emit([{ _id: `a`, text: `old` }])
    await collection.cleanup()
    transport.late([{ _id: `ghost`, text: `late` }])
    expect(collection.has(`ghost`)).toBe(false)
    transport.cache([])
    collection.startSyncImmediate()
    await collection.preload()
    expect(collection.size).toBe(0)
    await collection.cleanup()
    expect(transport.counts()).toEqual({ subscriptions: 2, unsubscriptions: 2 })
  })

  it(`keeps optimistic writes until the cached server result is accepted`, async () => {
    let resolve!: () => void
    const pending = new Promise<void>((done) => {
      resolve = done
    })
    const { transport, collection } = setup({ onUpdate: async () => pending })
    transport.emit([{ _id: `a`, text: `old` }])
    const tx = collection.update(`a`, (row) => {
      row.text = `optimistic`
    })
    expect(collection.get(`a`)?.text).toBe(`optimistic`)
    transport.cache([{ _id: `a`, text: `server` }])
    resolve()
    await tx.isPersisted.promise
    expect(collection.get(`a`)?.text).toBe(`server`)
    await collection.cleanup()
  })

  it(`rolls back failed writes`, async () => {
    const error = new Error(`rejected`)
    const { transport, collection } = setup({
      onDelete: () => Promise.reject(error),
    })
    transport.emit([{ _id: `a`, text: `keep` }])
    const tx = collection.delete(`a`)
    await expect(tx.isPersisted.promise).rejects.toBe(error)
    expect(collection.get(`a`)?.text).toBe(`keep`)
    await collection.cleanup()
  })

  it(`supports typed envelope projections`, () => {
    const transport = controlledClient()
    const envelope = makeFunctionReference<`query`, {}, { rows: Array<Row> }>(
      `tasks:envelope`,
    )
    const options = convexCollectionOptions({
      client: transport.client,
      query: envelope,
      queryArgs: {},
      select: (result) => result.rows,
      getKey: (row) => row._id,
    })
    expect(options.syncMode).toBe(`eager`)
  })

  it(`creates independent adapter state for each DbClient`, async () => {
    const transport = controlledClient()
    transport.cache([{ _id: `a`, text: `cached` }])
    const options = collectionOptions(
      convexCollectionOptions({
        id: `tasks`,
        client: transport.client,
        query,
        queryArgs: { owner: `alice` },
        getKey: (row) => row._id,
        gcTime: 0,
      }),
    )
    const first = new DbClient()
    const second = new DbClient()
    const a = first.collection(options)
    const b = second.collection(options)
    await Promise.all([a.preload(), b.preload()])
    expect(a).not.toBe(b)
    expect(transport.counts().subscriptions).toBe(2)
    await a.cleanup()
    expect(b.get(`a`)?.text).toBe(`cached`)
    await b.cleanup()
  })
})

it(`waits for deferred sync acceptance without waiting for its own visibility`, async () => {
  const transport = controlledClient()
  let delay = false
  let accept!: () => void
  const accepted = new Promise<void>((resolve) => {
    accept = resolve
  })
  const options = convexCollectionOptions({
    client: transport.client,
    query,
    queryArgs: { owner: `alice` },
    getKey: (row) => row._id,
    gcTime: 0,
    onUpdate: () => Promise.resolve(),
  })
  const collection = createCollection({
    ...options,
    sync: {
      ...options.sync,
      sync: (params) =>
        options.sync.sync({
          ...params,
          commit: () => {
            const visible = params.commit()
            return delay
              ? withAcceptedReceipt(
                  Promise.resolve(visible).then(() => undefined),
                  accepted,
                )
              : visible
          },
        }),
    },
  })
  collection.startSyncImmediate()
  transport.emit([{ _id: `a`, text: `old` }])
  delay = true
  const transaction = collection.update(`a`, (row) => {
    row.text = `optimistic`
  })
  transport.emit([{ _id: `a`, text: `server` }])
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(transaction.state).toBe(`persisting`)
  expect(collection.get(`a`)?.text).toBe(`optimistic`)
  accept()
  await transaction.isPersisted.promise
  expect(collection.get(`a`)?.text).toBe(`server`)
  await collection.cleanup()
})

it.each([null, {}, [null], [1], [[`nested`]]])(
  `rejects a malformed query result %j`,
  async (result) => {
    const { collection, transport } = setup()
    const ready = collection.preload()
    transport.emit(result as unknown as Array<Row>)
    await expect(ready).rejects.toBeInstanceOf(TypeError)
    transport.emit([])
    expect(collection.status).toBe(`ready`)
    await collection.cleanup()
  },
)

it.each([NaN, Infinity, -Infinity])(
  `rejects the invalid numeric key %s`,
  async (key) => {
    const transport = controlledClient()
    const collection = createCollection(
      convexCollectionOptions({
        client: transport.client,
        query,
        queryArgs: { owner: `alice` },
        getKey: () => key,
        gcTime: 0,
      }),
    )
    const ready = collection.preload()
    transport.emit([{ _id: `a`, text: `bad key` }])
    await expect(ready).rejects.toThrow(`finite numbers`)
    await collection.cleanup()
  },
)

it(`recovers from a projection failure before opening a sync transaction`, async () => {
  const transport = controlledClient()
  const error = new Error(`bad projection`)
  let broken = true
  const collection = createCollection(
    convexCollectionOptions({
      client: transport.client,
      query,
      queryArgs: { owner: `alice` },
      getKey: (row) => row._id,
      gcTime: 0,
      select: (rows) => {
        if (broken) throw error
        return rows
      },
    }),
  )
  const ready = collection.preload()
  transport.emit([{ _id: `a`, text: `valid` }])
  await expect(ready).rejects.toBe(error)
  broken = false
  transport.emit([{ _id: `a`, text: `valid` }])
  expect(collection.get(`a`)?.text).toBe(`valid`)
  await collection.cleanup()
})

it(`confirms optimistic inserts and deletes from subscription results`, async () => {
  const transport = controlledClient()
  const collection = createCollection(
    convexCollectionOptions({
      client: transport.client,
      query,
      queryArgs: { owner: `alice` },
      getKey: (row) => row._id,
      gcTime: 0,
      onInsert: () => {
        transport.emit([{ _id: `a`, text: `server insert` }])
        return Promise.resolve()
      },
      onDelete: () => {
        transport.emit([])
        return Promise.resolve()
      },
    }),
  )
  collection.startSyncImmediate()
  transport.emit([])
  const inserted = collection.insert({ _id: `a`, text: `optimistic` })
  await inserted.isPersisted.promise
  expect(collection.get(`a`)?.text).toBe(`server insert`)
  const deleted = collection.delete(`a`)
  await deleted.isPersisted.promise
  expect(collection.size).toBe(0)
  await collection.cleanup()
})

it(`reports a cached query error discovered while settling a mutation`, async () => {
  const onError = vi.fn()
  const { transport, collection } = setup({
    onError,
    onUpdate: () => Promise.resolve(),
  })
  transport.emit([{ _id: `a`, text: `old` }])
  const error = new Error(`cached query failed`)
  transport.cacheError(error)
  const transaction = collection.update(`a`, (row) => {
    row.text = `optimistic`
  })
  await expect(transaction.isPersisted.promise).rejects.toBe(error)
  expect(collection.utils.getSyncError()).toBe(error)
  expect(onError).toHaveBeenCalledExactlyOnceWith(error)
  expect(collection.get(`a`)?.text).toBe(`old`)
  await collection.cleanup()
})
