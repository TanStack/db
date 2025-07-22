import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createCollection } from "@tanstack/db"
import debug from "debug"
import { materializeCollectionOptions } from "../src/materialize"
import type {
  MaterializeCollectionUtils,
  MaterializeProxyMessage,
} from "../src/materialize"
import type { Collection } from "@tanstack/db"
import type { StandardSchemaV1 } from "@standard-schema/spec"

// Enable debug logging for tests
debug.enable(`tanstack:materialize-db-collection`)

// Mock WebSocket
const mockSend = vi.fn()
const mockClose = vi.fn()
const mockOn = vi.fn()

class MockWebSocket {
  readyState = 1 // OPEN
  send = mockSend
  close = mockClose
  on = mockOn
  public handlers = new Map()

  constructor() {
    // Setup mock on method to store handlers
    mockOn.mockImplementation((event: string, handler: any) => {
      this.handlers.set(event, handler)
    })
  }

  // Helper method to simulate receiving messages
  simulateMessage(message: MaterializeProxyMessage) {
    const messageHandler = this.handlers.get(`message`)
    if (messageHandler) {
      messageHandler(Buffer.from(JSON.stringify(message)))
    }
  }

  // Helper method to simulate connection open
  simulateOpen() {
    const openHandler = this.handlers.get(`open`)
    if (openHandler) openHandler()
  }

  // Helper method to simulate connection close
  simulateClose() {
    const closeHandler = this.handlers.get(`close`)
    if (closeHandler) closeHandler()
  }
}

// Track the last created WebSocket instance
let lastWebSocketInstance: MockWebSocket | undefined

// Mock the ws module
vi.mock(`ws`, () => {
  const MockWebSocketClass = vi.fn().mockImplementation(() => {
    const handlers = new Map()

    const instance = {
      readyState: 1, // OPEN
      send: mockSend,
      close: mockClose,
      on: mockOn,
      handlers,

      // Helper methods for testing
      simulateMessage(message: MaterializeProxyMessage) {
        const messageHandler = handlers.get(`message`)
        if (messageHandler) {
          messageHandler(Buffer.from(JSON.stringify(message)))
        }
      },

      simulateOpen() {
        const openHandler = handlers.get(`open`)
        if (openHandler) openHandler()
      },

      simulateClose() {
        const closeHandler = handlers.get(`close`)
        if (closeHandler) closeHandler()
      },
    }

    // Setup mock on method to store handlers
    mockOn.mockImplementation((event: string, handler) => {
      handlers.set(event, handler)
    })

    lastWebSocketInstance = instance as MockWebSocket
    return instance
  })

  return {
    default: MockWebSocketClass,
  }
})

describe(`Differential Dataflow Merging`, () => {
  let collection: Collection<
    TestItem,
    string | number,
    MaterializeCollectionUtils,
    StandardSchemaV1<unknown, unknown>,
    TestItem
  >
  let mockWebSocket: MockWebSocket | undefined

  type TestItem = {
    id: number
    text: string
    completed: boolean
  }

  beforeEach(async () => {
    writtenOperations = []

    // Clear all mock calls
    mockSend.mockClear()
    mockClose.mockClear()
    mockOn.mockClear()

    // Reset the lastWebSocketInstance
    lastWebSocketInstance = undefined

    // Create collection with Materialize configuration
    const config = {
      id: `test`,
      websocketUrl: `ws://localhost:5173/test`,
      getKey: (item: TestItem) => item.id,
      // eslint-disable-next-line
      onInsert: async () => ({ beforeLSN: '0/1', afterLSN: '0/2' }),
      // eslint-disable-next-line
      onUpdate: async () => ({ beforeLSN: `0/1`, afterLSN: `0/2` }),
      // eslint-disable-next-line
      onDelete: async () => ({ beforeLSN: `0/1`, afterLSN: `0/2` }),
    }

    const options = materializeCollectionOptions<TestItem>(config)
    collection = createCollection(options)

    // Wait for WebSocket to be created
    await new Promise((resolve) => setTimeout(resolve, 20))

    // Get reference to the mock WebSocket instance
    mockWebSocket = lastWebSocketInstance

    // Simulate connection open
    mockWebSocket?.simulateOpen()
    await new Promise((resolve) => setTimeout(resolve, 10))
  })

  afterEach(async () => {
    await collection.cleanup()
    lastWebSocketInstance = undefined
    mockWebSocket = undefined
  })

  const sendMessages = (messages: Array<MaterializeProxyMessage>) => {
    console.log(`Sending messages:`, messages.length)
    messages.forEach((msg) => {
      console.log(`Sending message:`, msg)
      mockWebSocket?.simulateMessage(msg)
    })
  }

  const waitForProcessing = async (delay = 100) => {
    await new Promise((resolve) => setTimeout(resolve, delay))
  }

  it(`should handle simple insert`, async () => {
    sendMessages([
      {
        type: `data`,
        row: { id: 1, text: `Test todo`, completed: false },
        mz_timestamp: 1000,
        mz_diff: `1`,
      },
    ])

    await waitForProcessing()

    expect(collection.state.get(1)).toEqual({
      id: 1,
      text: `Test todo`,
      completed: false,
    })
  })

  it(`should handle simple update (delete + insert with same timestamp)`, async () => {
    // First insert the item
    sendMessages([
      {
        type: `data`,
        row: { id: 1, text: `Original`, completed: false },
        mz_timestamp: 1000,
        mz_diff: `1`,
      },
    ])

    await waitForProcessing()

    // Send update as delete + insert
    sendMessages([
      {
        type: `data`,
        row: { id: 1, text: `Original`, completed: false },
        mz_timestamp: 2000,
        mz_diff: `-1`,
      },
      {
        type: `data`,
        row: { id: 1, text: `Updated`, completed: false },
        mz_timestamp: 2000,
        mz_diff: `1`,
      },
    ])

    await waitForProcessing()

    expect(collection.state.get(1)).toEqual({
      id: 1,
      text: `Updated`,
      completed: false,
    })
  })

  it(`should handle the unchecking todo scenario with duplicate operations`, async () => {
    // Setup: todo is initially checked
    sendMessages([
      {
        type: `data`,
        row: { id: 1, text: `Test todo`, completed: true },
        mz_timestamp: 1000,
        mz_diff: `1`,
      },
    ])

    await waitForProcessing()

    // Send the problematic pattern: multiple updates and deletes
    sendMessages([
      // First update attempt
      {
        type: `data`,
        row: { id: 1, text: `Test todo`, completed: false },
        mz_timestamp: 3000,
        mz_diff: `1`,
      },
      {
        type: `data`,
        row: { id: 1, text: `Test todo`, completed: true },
        mz_timestamp: 3000,
        mz_diff: `-1`,
      },
      // Duplicate delete
      {
        type: `data`,
        row: { id: 1, text: `Test todo`, completed: true },
        mz_timestamp: 3000,
        mz_diff: `-1`,
      },
      // Second update attempt
      {
        type: `data`,
        row: { id: 1, text: `Test todo`, completed: false },
        mz_timestamp: 3000,
        mz_diff: `1`,
      },
      // Another duplicate delete
      {
        type: `data`,
        row: { id: 1, text: `Test todo`, completed: true },
        mz_timestamp: 3000,
        mz_diff: `-1`,
      },
      {
        type: `data`,
        row: { id: 1, text: `Test todo`, completed: true },
        mz_timestamp: 3000,
        mz_diff: `-1`,
      },
    ])

    await waitForProcessing()

    // Should result in the todo being updated with completed: false, not deleted
    expect(collection.state.has(1)).toBe(true)
    expect(collection.state.get(1)).toEqual({
      id: 1,
      text: `Test todo`,
      completed: false,
    })
  })

  it(`should cancel out operations that sum to zero`, async () => {
    // Insert and delete cancel out
    sendMessages([
      {
        type: `data`,
        row: { id: 1, text: `Test`, completed: false },
        mz_timestamp: 4000,
        mz_diff: `1`,
      },
      {
        type: `data`,
        row: { id: 1, text: `Test`, completed: false },
        mz_timestamp: 4000,
        mz_diff: `-1`,
      },
    ])

    await waitForProcessing()

    // Should result in no change to collection
    expect(collection.state.has(1)).toBe(false)
  })

  it(`should handle multiple items in same timestamp batch`, async () => {
    // Setup initial data
    sendMessages([
      {
        type: `data`,
        row: { id: 1, text: `Item 1`, completed: false },
        mz_timestamp: 1000,
        mz_diff: `1`,
      },
      {
        type: `data`,
        row: { id: 2, text: `Item 2`, completed: false },
        mz_timestamp: 1000,
        mz_diff: `1`,
      },
    ])

    await waitForProcessing()

    // Send batch of operations at same timestamp
    sendMessages([
      // Update item 1
      {
        type: `data`,
        row: { id: 1, text: `Item 1`, completed: false },
        mz_timestamp: 5000,
        mz_diff: `-1`,
      },
      {
        type: `data`,
        row: { id: 1, text: `Item 1 Updated`, completed: true },
        mz_timestamp: 5000,
        mz_diff: `1`,
      },
      // Delete item 2
      {
        type: `data`,
        row: { id: 2, text: `Item 2`, completed: false },
        mz_timestamp: 5000,
        mz_diff: `-1`,
      },
      // Insert item 3
      {
        type: `data`,
        row: { id: 3, text: `Item 3`, completed: false },
        mz_timestamp: 5000,
        mz_diff: `1`,
      },
    ])

    await waitForProcessing()

    // Check results
    expect(collection.state.get(1)).toEqual({
      id: 1,
      text: `Item 1 Updated`,
      completed: true,
    })

    expect(collection.state.has(2)).toBe(false)

    expect(collection.state.get(3)).toEqual({
      id: 3,
      text: `Item 3`,
      completed: false,
    })
  })

  it(`should handle net negative diff correctly`, async () => {
    // Setup initial item
    sendMessages([
      {
        type: `data`,
        row: { id: 1, text: `Test`, completed: false },
        mz_timestamp: 1000,
        mz_diff: `1`,
      },
    ])

    await waitForProcessing()

    // More deletes than inserts
    sendMessages([
      {
        type: `data`,
        row: { id: 1, text: `Test`, completed: false },
        mz_timestamp: 6000,
        mz_diff: `-1`,
      },
      {
        type: `data`,
        row: { id: 1, text: `Test`, completed: false },
        mz_timestamp: 6000,
        mz_diff: `-1`,
      },
      {
        type: `data`,
        row: { id: 1, text: `Test Updated`, completed: true },
        mz_timestamp: 6000,
        mz_diff: `1`,
      },
    ])

    await waitForProcessing()

    // Net diff is -1, should delete
    expect(collection.state.has(1)).toBe(false)
  })

  it(`should process messages with different timestamps separately`, async () => {
    sendMessages([
      {
        type: `data`,
        row: { id: 1, text: `Test 1`, completed: false },
        mz_timestamp: 7000,
        mz_diff: `1`,
      },
      {
        type: `data`,
        row: { id: 2, text: `Test 2`, completed: false },
        mz_timestamp: 7001,
        mz_diff: `1`,
      },
    ])

    await waitForProcessing()

    // Should have both items
    expect(collection.state.get(1)).toEqual({
      id: 1,
      text: `Test 1`,
      completed: false,
    })
    expect(collection.state.get(2)).toEqual({
      id: 2,
      text: `Test 2`,
      completed: false,
    })
  })

  it(`should handle operations with different rows but same key`, async () => {
    // This simulates the actual unchecking scenario where rows have different data
    sendMessages([
      {
        type: `data`,
        row: { id: 1, text: `Todo`, completed: true },
        mz_timestamp: 1000,
        mz_diff: `1`,
      },
    ])

    await waitForProcessing()

    // Send multiple operations for the same key with different row data
    sendMessages([
      // New version (unchecked)
      {
        type: `data`,
        row: { id: 1, text: `Todo`, completed: false },
        mz_timestamp: 2000,
        mz_diff: `1`,
      },
      // Old version deleted
      {
        type: `data`,
        row: { id: 1, text: `Todo`, completed: true },
        mz_timestamp: 2000,
        mz_diff: `-1`,
      },
      // Duplicate operations
      {
        type: `data`,
        row: { id: 1, text: `Todo`, completed: false },
        mz_timestamp: 2000,
        mz_diff: `1`,
      },
      {
        type: `data`,
        row: { id: 1, text: `Todo`, completed: true },
        mz_timestamp: 2000,
        mz_diff: `-1`,
      },
    ])

    await waitForProcessing()

    // Should use the latest insert (completed: false)
    expect(collection.state.get(1)).toEqual({
      id: 1,
      text: `Todo`,
      completed: false,
    })
  })
})
