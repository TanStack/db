import { describe, expect, it, vi } from "vitest"
import { createCollection } from "@tanstack/db"
import { pocketbaseCollectionOptions } from "../src/pocketbase"
import type { RecordService, RecordSubscription } from "pocketbase"

type Data = {
  id: string
  data: string
  updated?: number
}

type UnsubscribeFunc = () => Promise<void>

class MockRecordService<T extends { id: string }> {
  collectionIdOrName = `test`
  baseCrudPath = `/api/collections/test`
  baseCollectionPath = `/api/collections/test`
  isSuperusers = false

  private records: Map<string, T> = new Map()
  private subscriptions: Map<
    string,
    Array<(data: RecordSubscription<T>) => void>
  > = new Map()

  getFullList = vi.fn(
    (_options?: unknown): Promise<Array<T>> =>
      Promise.resolve(Array.from(this.records.values()))
  )

  subscribe = vi.fn(
    (
      topic: string,
      callback: (data: RecordSubscription<T>) => void,
      _options?: unknown
    ): Promise<UnsubscribeFunc> => {
      let subscription = this.subscriptions.get(topic)
      if (!subscription) {
        subscription = []
        this.subscriptions.set(topic, subscription)
      }
      subscription.push(callback)

      return Promise.resolve(async () => {
        const index = subscription.indexOf(callback)
        if (index > -1) {
          subscription.splice(index, 1)
        }
        if (subscription.length === 0) {
          this.subscriptions.delete(topic)
          await this.unsubscribe(topic)
        }
        return Promise.resolve()
      })
    }
  )

  unsubscribe = vi.fn((_topic?: string): Promise<void> => {
    if (_topic) {
      this.subscriptions.delete(_topic)
    } else {
      this.subscriptions.clear()
    }
    return Promise.resolve()
  })

  create = vi.fn(
    (
      bodyParams?: { [key: string]: any } | FormData,
      _options?: unknown
    ): Promise<T> => {
      const body = bodyParams as { [key: string]: any }
      // For testing: if body doesn't have id, we need to generate one
      // But in real PocketBase, the id is generated server-side
      // For our tests, we'll use a simple approach: generate id if missing
      const id = body.id || `generated-${Date.now()}-${Math.random()}`
      const record = { ...body, id } as T
      this.records.set(id, record)
      this.emitSubscription(`*`, `create`, record)
      return Promise.resolve(record)
    }
  )

  update = vi.fn(
    (
      id: string,
      bodyParams?: { [key: string]: any } | FormData,
      _options?: unknown
    ): Promise<T> => {
      const existing = this.records.get(id)
      if (!existing) {
        throw new Error(`Record not found`)
      }
      const updated = { ...existing, ...bodyParams } as T
      this.records.set(id, updated)
      this.emitSubscription(`*`, `update`, updated)
      this.emitSubscription(id, `update`, updated)
      return Promise.resolve(updated)
    }
  )

  delete = vi.fn((id: string, _options?: unknown): Promise<boolean> => {
    const record = this.records.get(id)
    if (!record) {
      throw new Error(`Record not found`)
    }
    this.records.delete(id)
    this.emitSubscription(`*`, `delete`, record)
    this.emitSubscription(id, `delete`, record)
    return Promise.resolve(true)
  })

  // Helper method to inject events for testing
  emitSubscription(topic: string, action: string, record: T) {
    const callbacks = this.subscriptions.get(topic)
    if (callbacks) {
      callbacks.forEach((callback) => {
        callback({ action, record })
      })
    }
  }

  // Helper method to set initial records
  setInitialRecords(records: Array<T>) {
    this.records.clear()
    records.forEach((record) => {
      this.records.set(record.id, record)
    })
  }

  // Helper method to add a record
  addRecord(record: T) {
    this.records.set(record.id, record)
  }

  // Mock other required methods (not used in tests but required by interface)
  getList = vi.fn()
  getFirstListItem = vi.fn()
  getOne = vi.fn()
  decode = vi.fn()
}

function setUp(recordService: MockRecordService<Data>) {
  const options = pocketbaseCollectionOptions({
    recordService: recordService as unknown as RecordService<Data>,
  })

  return options
}

describe(`PocketBase Integration`, () => {
  it(`should initialize and fetch initial data`, async () => {
    const records: Array<Data> = [
      {
        id: `1`,
        data: `first`,
        updated: 0,
      },
      {
        id: `2`,
        data: `second`,
        updated: 0,
      },
    ]

    const recordService = new MockRecordService<Data>()
    recordService.setInitialRecords(records)

    const options = setUp(recordService)
    const collection = createCollection(options)

    // Wait for initial fetch
    await collection.stateWhenReady()

    expect(recordService.getFullList).toHaveBeenCalledTimes(1)
    expect(collection.size).toBe(records.length)
    expect(collection.get(`1`)).toEqual(records[0])
    expect(collection.get(`2`)).toEqual(records[1])
  })

  it(`should receive create, update and delete events`, async () => {
    const recordService = new MockRecordService<Data>()
    recordService.setInitialRecords([])

    const options = setUp(recordService)
    const collection = createCollection(options)

    // Wait for initial fetch
    await collection.stateWhenReady()
    expect(collection.size).toBe(0)

    // Inject a create event
    const newRecord: Data = {
      id: `1`,
      data: `new`,
      updated: 0,
    }
    recordService.emitSubscription(`*`, `create`, newRecord)

    // Wait for event processing
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(collection.size).toBe(1)
    expect(collection.get(`1`)).toEqual(newRecord)

    // Inject an update event
    const updatedRecord: Data = {
      ...newRecord,
      data: `updated`,
      updated: 1,
    }
    recordService.emitSubscription(`*`, `update`, updatedRecord)

    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(collection.size).toBe(1)
    expect(collection.get(`1`)).toEqual(updatedRecord)

    // Inject a delete event
    recordService.emitSubscription(`*`, `delete`, updatedRecord)

    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(collection.size).toBe(0)
    expect(collection.get(`1`)).toBeUndefined()
  })

  it(`should handle local inserts, updates and deletes`, async () => {
    const recordService = new MockRecordService<Data>()
    recordService.setInitialRecords([])

    const options = setUp(recordService)
    const collection = createCollection(options)

    await collection.stateWhenReady()
    expect(collection.size).toBe(0)

    // Insert
    const data: Data = {
      id: `1`,
      data: `first`,
      updated: 0,
    }

    // Mock the create to return the record with the original id
    recordService.create.mockImplementation(
      (bodyParams?: { [key: string]: any } | FormData) => {
        const body = bodyParams as { [key: string]: any }
        const record = { ...body, id: data.id } as Data
        recordService.setInitialRecords([record])
        recordService.emitSubscription(`*`, `create`, record)
        return Promise.resolve(record)
      }
    )

    const insertTx = collection.insert(data)
    expect(recordService.create).toHaveBeenCalledTimes(1)
    expect(recordService.create).toHaveBeenCalledWith({
      data: data.data,
      updated: data.updated,
    })

    await insertTx.isPersisted.promise
    expect(collection.size).toBe(1)
    expect(collection.get(`1`)).toEqual(data)

    // Update
    const updateTx = collection.update(`1`, (old: Data) => {
      old.data = `updated`
      old.updated = 1
    })

    expect(recordService.update).toHaveBeenCalledTimes(1)
    expect(recordService.update).toHaveBeenCalledWith(`1`, {
      data: `updated`,
      updated: 1,
    })

    await updateTx.isPersisted.promise
    expect(collection.get(`1`)?.data).toBe(`updated`)
    expect(collection.get(`1`)?.updated).toBe(1)

    // Delete
    const deleteTx = collection.delete(`1`)

    expect(recordService.delete).toHaveBeenCalledTimes(1)
    expect(recordService.delete).toHaveBeenCalledWith(`1`)

    await deleteTx.isPersisted.promise
    expect(collection.size).toBe(0)
    expect(collection.get(`1`)).toBeUndefined()
  })

  it(`should unsubscribe when collection is cleaned up`, async () => {
    const recordService = new MockRecordService<Data>()
    recordService.setInitialRecords([])

    const options = setUp(recordService)
    const collection = createCollection(options)

    await collection.stateWhenReady()

    // Verify subscription was set up
    expect(recordService.subscribe).toHaveBeenCalledWith(
      `*`,
      expect.any(Function)
    )

    await collection.cleanup()

    // Verify unsubscribe was called during cleanup
    expect(recordService.unsubscribe).toHaveBeenCalled()
    // The collection should be in cleaned-up state
    expect(collection.status).toBe(`cleaned-up`)
  })

  it(`should handle multiple concurrent inserts`, async () => {
    const recordService = new MockRecordService<Data>()
    recordService.setInitialRecords([])

    const options = setUp(recordService)
    const collection = createCollection(options)

    await collection.stateWhenReady()

    const records: Array<Data> = [
      { id: `1`, data: `first` },
      { id: `2`, data: `second` },
      { id: `3`, data: `third` },
    ]

    // Mock create to return records with their original ids
    recordService.create.mockImplementation(
      (bodyParams?: { [key: string]: any } | FormData) => {
        const body = bodyParams as { [key: string]: any }
        // Find the matching record by data
        const record = records.find((r) => r.data === body.data)
        const id = record?.id || `generated-${Date.now()}-${Math.random()}`
        const result = { ...body, id } as Data
        recordService.addRecord(result)
        recordService.emitSubscription(`*`, `create`, result)
        return Promise.resolve(result)
      }
    )

    const transactions = records.map((record) => collection.insert(record))

    await Promise.all(transactions.map((tx) => tx.isPersisted.promise))

    expect(recordService.create).toHaveBeenCalledTimes(3)
    expect(collection.size).toBe(3)
    expect(collection.get(`1`)).toEqual(records[0])
    expect(collection.get(`2`)).toEqual(records[1])
    expect(collection.get(`3`)).toEqual(records[2])
  })

  it(`should handle empty initial fetch`, async () => {
    const recordService = new MockRecordService<Data>()
    recordService.setInitialRecords([])

    const options = setUp(recordService)
    const collection = createCollection(options)

    await collection.stateWhenReady()

    expect(collection.size).toBe(0)
    expect(recordService.getFullList).toHaveBeenCalledTimes(1)
  })
})
