import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createCollection } from '@tanstack/db'
import { durableStreamCollectionOptions } from '../src/collection'
import type { DurableStreamResult, RowWithOffset } from '../src/types'

// Test row type
interface TestRow {
  id: string
  name: string
  seq: number
}

// Mock controller for the follow iterator
interface MockFollowController {
  emit: (result: DurableStreamResult<TestRow>) => void
  complete: () => void
  error: (err: Error) => void
}

// Mock the @durable-streams/client module
let mockFollowController: MockFollowController | null = null
const mockFollow = vi.fn()

vi.mock(`@durable-streams/client`, () => {
  return {
    DurableStream: vi.fn().mockImplementation(() => ({
      follow: mockFollow,
    })),
  }
})

// Helper to create an async iterator from a controller
function createMockFollowIterator(): AsyncIterable<DurableStreamResult<TestRow>> {
  const queue: Array<DurableStreamResult<TestRow>> = []
  let resolveNext: ((value: IteratorResult<DurableStreamResult<TestRow>>) => void) | null = null
  let isDone = false
  let error: Error | null = null

  mockFollowController = {
    emit: (result) => {
      if (resolveNext) {
        resolveNext({ value: result, done: false })
        resolveNext = null
      } else {
        queue.push(result)
      }
    },
    complete: () => {
      isDone = true
      if (resolveNext) {
        resolveNext({ value: undefined as any, done: true })
        resolveNext = null
      }
    },
    error: (err) => {
      error = err
      if (resolveNext) {
        // We need to reject the promise, but we can't do that from here
        // So we'll throw on next iteration
      }
    },
  }

  return {
    [Symbol.asyncIterator](): AsyncIterator<DurableStreamResult<TestRow>> {
      return {
        async next() {
          if (error) {
            throw error
          }
          if (queue.length > 0) {
            return { value: queue.shift()!, done: false }
          }
          if (isDone) {
            return { value: undefined as any, done: true }
          }
          return new Promise((resolve) => {
            resolveNext = resolve
          })
        },
      }
    },
  }
}

describe(`durableStreamCollectionOptions`, () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFollowController = null

    // Setup mock follow to return our controlled iterator
    mockFollow.mockImplementation(() => createMockFollowIterator())
  })

  it(`should create a collection with correct id from url`, () => {
    const options = durableStreamCollectionOptions<TestRow>({
      url: `http://example.com/stream/events`,
      getKey: (row) => row.id,
      getDeduplicationKey: (row) => `${row.id}:${row.seq}`,
    })

    expect(options.id).toBe(`durable-stream:http://example.com/stream/events`)
  })

  it(`should use custom id when provided`, () => {
    const options = durableStreamCollectionOptions<TestRow>({
      id: `my-custom-id`,
      url: `http://example.com/stream/events`,
      getKey: (row) => row.id,
      getDeduplicationKey: (row) => `${row.id}:${row.seq}`,
    })

    expect(options.id).toBe(`my-custom-id`)
  })

  it(`should sync data from stream and mark ready after first batch`, async () => {
    const options = durableStreamCollectionOptions<TestRow>({
      url: `http://example.com/stream/events`,
      getKey: (row) => row.id,
      getDeduplicationKey: (row) => `${row.id}:${row.seq}`,
      storageKey: false, // Disable persistence for test
    })

    const collection = createCollection(options)
    collection.startSyncImmediate()

    // Wait for sync to start
    await new Promise((resolve) => setTimeout(resolve, 10))

    // Emit first batch
    mockFollowController?.emit({
      data: [
        { id: `1`, name: `Test 1`, seq: 0 },
        { id: `2`, name: `Test 2`, seq: 0 },
      ],
      offset: `offset-1`,
    })

    // Wait for processing
    await new Promise((resolve) => setTimeout(resolve, 10))

    // Collection should be ready and have data
    expect(collection.isReady()).toBe(true)
    expect(collection.size).toBe(2)
    expect(collection.get(`1`)).toEqual({
      id: `1`,
      name: `Test 1`,
      seq: 0,
      offset: `offset-1`,
    })
    expect(collection.get(`2`)).toEqual({
      id: `2`,
      name: `Test 2`,
      seq: 0,
      offset: `offset-1`,
    })

    await collection.cleanup()
  })

  it(`should attach batch offset to each row`, async () => {
    const options = durableStreamCollectionOptions<TestRow>({
      url: `http://example.com/stream/events`,
      getKey: (row) => row.id,
      getDeduplicationKey: (row) => `${row.id}:${row.seq}`,
      storageKey: false,
    })

    const collection = createCollection(options)
    collection.startSyncImmediate()

    await new Promise((resolve) => setTimeout(resolve, 10))

    // Emit batch with specific offset
    mockFollowController?.emit({
      data: [{ id: `1`, name: `Test`, seq: 0 }],
      offset: `batch-offset-123`,
    })

    await new Promise((resolve) => setTimeout(resolve, 10))

    const row = collection.get(`1`) as RowWithOffset<TestRow>
    expect(row.offset).toBe(`batch-offset-123`)

    await collection.cleanup()
  })

  it(`should deduplicate replayed rows on resume`, async () => {
    const options = durableStreamCollectionOptions<TestRow>({
      url: `http://example.com/stream/events`,
      getKey: (row) => row.id,
      getDeduplicationKey: (row) => `${row.id}:${row.seq}`,
      storageKey: false,
    })

    const collection = createCollection(options)
    collection.startSyncImmediate()

    await new Promise((resolve) => setTimeout(resolve, 10))

    // First batch with seq 0 and 1
    mockFollowController?.emit({
      data: [
        { id: `1`, name: `Test`, seq: 0 },
        { id: `1`, name: `Test`, seq: 1 },
      ],
      offset: `offset-a`,
    })

    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(collection.size).toBe(2)

    // Second batch with seq 1 replayed and seq 2 new
    mockFollowController?.emit({
      data: [
        { id: `1`, name: `Test`, seq: 1 }, // Replayed - should be deduplicated
        { id: `1`, name: `Test`, seq: 2 }, // New
      ],
      offset: `offset-b`,
    })

    await new Promise((resolve) => setTimeout(resolve, 10))

    // Should have 3 items, not 4 (seq 1 deduplicated)
    expect(collection.size).toBe(3)

    await collection.cleanup()
  })

  it(`should handle empty batches without starting transaction`, async () => {
    const options = durableStreamCollectionOptions<TestRow>({
      url: `http://example.com/stream/events`,
      getKey: (row) => row.id,
      getDeduplicationKey: (row) => `${row.id}:${row.seq}`,
      storageKey: false,
    })

    const collection = createCollection(options)
    collection.startSyncImmediate()

    await new Promise((resolve) => setTimeout(resolve, 10))

    // Emit empty batch
    mockFollowController?.emit({
      data: [],
      offset: `offset-empty`,
    })

    await new Promise((resolve) => setTimeout(resolve, 10))

    // Collection should be ready even with empty batch
    expect(collection.isReady()).toBe(true)
    expect(collection.size).toBe(0)

    await collection.cleanup()
  })

  it(`should handle multiple sequential batches`, async () => {
    const options = durableStreamCollectionOptions<TestRow>({
      url: `http://example.com/stream/events`,
      getKey: (row) => row.id,
      getDeduplicationKey: (row) => `${row.id}:${row.seq}`,
      storageKey: false,
    })

    const collection = createCollection(options)
    collection.startSyncImmediate()

    await new Promise((resolve) => setTimeout(resolve, 10))

    // First batch
    mockFollowController?.emit({
      data: [{ id: `1`, name: `Test 1`, seq: 0 }],
      offset: `offset-1`,
    })

    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(collection.size).toBe(1)

    // Second batch
    mockFollowController?.emit({
      data: [{ id: `2`, name: `Test 2`, seq: 0 }],
      offset: `offset-2`,
    })

    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(collection.size).toBe(2)

    // Third batch
    mockFollowController?.emit({
      data: [{ id: `3`, name: `Test 3`, seq: 0 }],
      offset: `offset-3`,
    })

    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(collection.size).toBe(3)

    await collection.cleanup()
  })

  it(`should use getKey function correctly with offset stripped`, async () => {
    const options = durableStreamCollectionOptions<TestRow>({
      url: `http://example.com/stream/events`,
      // getKey should work on the original row type
      getKey: (row) => row.id,
      getDeduplicationKey: (row) => `${row.id}:${row.seq}`,
      storageKey: false,
    })

    const collection = createCollection(options)
    collection.startSyncImmediate()

    await new Promise((resolve) => setTimeout(resolve, 10))

    mockFollowController?.emit({
      data: [{ id: `test-id-123`, name: `Test`, seq: 0 }],
      offset: `offset-1`,
    })

    await new Promise((resolve) => setTimeout(resolve, 10))

    // Should be able to get by the original key
    expect(collection.has(`test-id-123`)).toBe(true)
    expect(collection.get(`test-id-123`)).toBeDefined()

    await collection.cleanup()
  })

  it(`should pass headers to DurableStream client`, () => {
    durableStreamCollectionOptions<TestRow>({
      url: `http://example.com/stream/events`,
      getKey: (row) => row.id,
      getDeduplicationKey: (row) => `${row.id}:${row.seq}`,
      headers: {
        Authorization: `Bearer test-token`,
        'X-Custom-Header': `custom-value`,
      },
      storageKey: false,
    })

    // Check that DurableStream was instantiated with the headers
    const { DurableStream } = require(`@durable-streams/client`)

    // Create collection to trigger the sync
    const options = durableStreamCollectionOptions<TestRow>({
      url: `http://example.com/stream/events`,
      getKey: (row) => row.id,
      getDeduplicationKey: (row) => `${row.id}:${row.seq}`,
      headers: {
        Authorization: `Bearer test-token`,
      },
      storageKey: false,
    })

    const collection = createCollection(options)
    collection.startSyncImmediate()

    expect(DurableStream).toHaveBeenCalledWith({
      url: `http://example.com/stream/events`,
      headers: {
        Authorization: `Bearer test-token`,
      },
    })

    collection.cleanup()
  })
})

describe(`offset-storage`, () => {
  it(`should load offset from storage on start`, async () => {
    const mockStorage = {
      getItem: vi.fn().mockReturnValue(`saved-offset-123`),
      setItem: vi.fn(),
    }

    const options = durableStreamCollectionOptions<TestRow>({
      url: `http://example.com/stream/events`,
      getKey: (row) => row.id,
      getDeduplicationKey: (row) => `${row.id}:${row.seq}`,
      storage: mockStorage,
    })

    const collection = createCollection(options)
    collection.startSyncImmediate()

    // Wait for async storage operations
    await new Promise((resolve) => setTimeout(resolve, 50))

    // Should have loaded from storage
    expect(mockStorage.getItem).toHaveBeenCalledWith(
      `durable-stream:http://example.com/stream/events:offset`,
    )

    // follow should have been called with the saved offset
    expect(mockFollow).toHaveBeenCalledWith({
      offset: `saved-offset-123`,
      live: `long-poll`,
    })

    await collection.cleanup()
  })

  it(`should save offset to storage after each batch`, async () => {
    const mockStorage = {
      getItem: vi.fn().mockReturnValue(null),
      setItem: vi.fn(),
    }

    const options = durableStreamCollectionOptions<TestRow>({
      url: `http://example.com/stream/events`,
      getKey: (row) => row.id,
      getDeduplicationKey: (row) => `${row.id}:${row.seq}`,
      storage: mockStorage,
    })

    const collection = createCollection(options)
    collection.startSyncImmediate()

    await new Promise((resolve) => setTimeout(resolve, 10))

    // Emit batch
    mockFollowController?.emit({
      data: [{ id: `1`, name: `Test`, seq: 0 }],
      offset: `new-offset-456`,
    })

    await new Promise((resolve) => setTimeout(resolve, 50))

    // Should have saved the new offset
    expect(mockStorage.setItem).toHaveBeenCalledWith(
      `durable-stream:http://example.com/stream/events:offset`,
      `new-offset-456`,
    )

    await collection.cleanup()
  })

  it(`should use custom storage key prefix`, async () => {
    const mockStorage = {
      getItem: vi.fn().mockReturnValue(null),
      setItem: vi.fn(),
    }

    const options = durableStreamCollectionOptions<TestRow>({
      url: `http://example.com/stream/events`,
      getKey: (row) => row.id,
      getDeduplicationKey: (row) => `${row.id}:${row.seq}`,
      storage: mockStorage,
      storageKey: `my-app`,
    })

    const collection = createCollection(options)
    collection.startSyncImmediate()

    await new Promise((resolve) => setTimeout(resolve, 10))

    // Should use custom prefix
    expect(mockStorage.getItem).toHaveBeenCalledWith(
      `my-app:http://example.com/stream/events:offset`,
    )

    await collection.cleanup()
  })

  it(`should not persist when storageKey is false`, async () => {
    const mockStorage = {
      getItem: vi.fn().mockReturnValue(null),
      setItem: vi.fn(),
    }

    const options = durableStreamCollectionOptions<TestRow>({
      url: `http://example.com/stream/events`,
      getKey: (row) => row.id,
      getDeduplicationKey: (row) => `${row.id}:${row.seq}`,
      storage: mockStorage,
      storageKey: false,
    })

    const collection = createCollection(options)
    collection.startSyncImmediate()

    await new Promise((resolve) => setTimeout(resolve, 10))

    mockFollowController?.emit({
      data: [{ id: `1`, name: `Test`, seq: 0 }],
      offset: `some-offset`,
    })

    await new Promise((resolve) => setTimeout(resolve, 50))

    // Should not have called storage at all
    expect(mockStorage.getItem).not.toHaveBeenCalled()
    expect(mockStorage.setItem).not.toHaveBeenCalled()

    await collection.cleanup()
  })

  it(`should use initialOffset when no persisted offset exists`, async () => {
    const mockStorage = {
      getItem: vi.fn().mockReturnValue(null),
      setItem: vi.fn(),
    }

    const options = durableStreamCollectionOptions<TestRow>({
      url: `http://example.com/stream/events`,
      getKey: (row) => row.id,
      getDeduplicationKey: (row) => `${row.id}:${row.seq}`,
      storage: mockStorage,
      initialOffset: `custom-initial-offset`,
    })

    const collection = createCollection(options)
    collection.startSyncImmediate()

    await new Promise((resolve) => setTimeout(resolve, 50))

    // follow should have been called with the initial offset
    expect(mockFollow).toHaveBeenCalledWith({
      offset: `custom-initial-offset`,
      live: `long-poll`,
    })

    await collection.cleanup()
  })

  it(`should default to -1 offset when no persisted or initial offset`, async () => {
    const mockStorage = {
      getItem: vi.fn().mockReturnValue(null),
      setItem: vi.fn(),
    }

    const options = durableStreamCollectionOptions<TestRow>({
      url: `http://example.com/stream/events`,
      getKey: (row) => row.id,
      getDeduplicationKey: (row) => `${row.id}:${row.seq}`,
      storage: mockStorage,
    })

    const collection = createCollection(options)
    collection.startSyncImmediate()

    await new Promise((resolve) => setTimeout(resolve, 50))

    // follow should have been called with -1 (default)
    expect(mockFollow).toHaveBeenCalledWith({
      offset: `-1`,
      live: `long-poll`,
    })

    await collection.cleanup()
  })
})

describe(`live mode configuration`, () => {
  it(`should use long-poll mode by default`, async () => {
    const options = durableStreamCollectionOptions<TestRow>({
      url: `http://example.com/stream/events`,
      getKey: (row) => row.id,
      getDeduplicationKey: (row) => `${row.id}:${row.seq}`,
      storageKey: false,
    })

    const collection = createCollection(options)
    collection.startSyncImmediate()

    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(mockFollow).toHaveBeenCalledWith(
      expect.objectContaining({
        live: `long-poll`,
      }),
    )

    await collection.cleanup()
  })

  it(`should use sse mode when configured`, async () => {
    const options = durableStreamCollectionOptions<TestRow>({
      url: `http://example.com/stream/events`,
      getKey: (row) => row.id,
      getDeduplicationKey: (row) => `${row.id}:${row.seq}`,
      liveMode: `sse`,
      storageKey: false,
    })

    const collection = createCollection(options)
    collection.startSyncImmediate()

    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(mockFollow).toHaveBeenCalledWith(
      expect.objectContaining({
        live: `sse`,
      }),
    )

    await collection.cleanup()
  })
})
