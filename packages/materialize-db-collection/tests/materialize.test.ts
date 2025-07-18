import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createCollection } from "@tanstack/db"
import { materializeCollectionOptions } from "../src/materialize"
import type {
  MaterializeCollectionUtils,
  MaterializeProxyMessage,
} from "../src/materialize"
import type { Collection } from "@tanstack/db"
import type { StandardSchemaV1 } from "@standard-schema/spec"

// Import after mocking

// Mock WebSocket at the top level
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

    // Simulate immediate connection
    setTimeout(() => {
      const openHandler = this.handlers.get(`open`)
      if (openHandler) openHandler()
    }, 0)
  }

  // Helper method to simulate receiving messages
  simulateMessage(message: MaterializeProxyMessage) {
    const messageHandler = this.handlers.get(`message`)
    if (messageHandler) {
      messageHandler(Buffer.from(JSON.stringify(message)))
    }
  }

  // Helper method to simulate connection close
  simulateClose() {
    const closeHandler = this.handlers.get(`close`)
    if (closeHandler) closeHandler()
  }

  // Helper method to simulate error
  simulateError(error: Error) {
    const errorHandler = this.handlers.get(`error`)
    if (errorHandler) errorHandler(error)
  }

  // Helper method to simulate connection open
  simulateOpen() {
    const openHandler = this.handlers.get(`open`)
    if (openHandler) openHandler()
  }
}

// Track the last created WebSocket instance
let lastWebSocketInstance: MockWebSocket | undefined

// Mock the ws module at the top level - use factory function to avoid hoisting issues
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

      simulateClose() {
        const closeHandler = handlers.get(`close`)
        if (closeHandler) closeHandler()
      },

      simulateError(error: Error) {
        const errorHandler = handlers.get(`error`)
        if (errorHandler) errorHandler(error)
      },

      simulateOpen() {
        const openHandler = handlers.get(`open`)
        if (openHandler) openHandler()
      },
    }

    // Setup mock on method to store handlers
    mockOn.mockImplementation((event: string, handler) => {
      handlers.set(event, handler)
    })

    // Don't auto-trigger connection in tests - let tests control this
    // setTimeout(() => {
    //   const openHandler = handlers.get('open')
    //   if (openHandler) openHandler()
    // }, 0)

    lastWebSocketInstance = instance as MockWebSocket
    return instance
  })

  return {
    default: MockWebSocketClass,
  }
})

describe(`Materialize Integration`, () => {
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
    title: string
    completed: boolean
  }

  beforeEach(async () => {
    // Clear all mock calls but don't reset implementations
    mockSend.mockClear()
    mockClose.mockClear()
    mockOn.mockClear()

    // Reset the lastWebSocketInstance
    lastWebSocketInstance = undefined

    // Create collection with Materialize configuration
    const config = {
      id: `test`,
      websocketUrl: `ws://localhost:3000/api/todos-ws`,
      getKey: (item: TestItem) => item.id,
      startSync: true,
    }

    // Get the options with utilities
    const options = materializeCollectionOptions<TestItem>(config)

    // Create collection with Materialize configuration
    collection = createCollection(options)

    // Wait a bit for the WebSocket to be created
    await new Promise((resolve) => setTimeout(resolve, 20))

    // Get reference to the mock WebSocket instance
    mockWebSocket = lastWebSocketInstance
  })

  afterEach(async () => {
    // Clean up collection
    await collection.cleanup()

    // Reset instance reference
    lastWebSocketInstance = undefined
    mockWebSocket = undefined
  })

  it(`should initialize with loading status`, () => {
    expect(collection.status).toEqual(`loading`)
    expect(collection.state).toEqual(new Map([]))
  })

  it(`should handle incoming data messages and update collection state`, async () => {
    // Manually trigger connection
    mockWebSocket?.simulateOpen()

    // Wait for connection to be processed
    await new Promise((resolve) => setTimeout(resolve, 10))

    // Simulate incoming data message
    mockWebSocket?.simulateMessage({
      type: `data`,
      mz_timestamp: 1000,
      mz_progressed: false,
      mz_diff: 1, // insert
      row: { id: 1, title: `Test Todo`, completed: false },
    })

    expect(collection.state).toEqual(
      new Map([[1, { id: 1, title: `Test Todo`, completed: false }]])
    )
  })

  it(`should handle LSN updates and track current LSN`, async () => {
    // Wait for connection to be established
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(collection.utils.getCurrentLSN()).toBeNull()

    // Simulate LSN message
    mockWebSocket!.simulateMessage({
      type: `lsn`,
      value: `1234567890`,
    })

    expect(collection.utils.getCurrentLSN()).toBe(`1234567890`)
  })

  it(`should handle multiple data operations (insert, update, delete)`, async () => {
    // Wait for connection to be established
    await new Promise((resolve) => setTimeout(resolve, 10))

    // Insert
    mockWebSocket!.simulateMessage({
      type: `data`,
      mz_diff: 1,
      row: { id: 1, title: `Test Todo`, completed: false },
    })

    expect(collection.state.get(1)).toEqual({
      id: 1,
      title: `Test Todo`,
      completed: false,
    })

    // Update
    mockWebSocket!.simulateMessage({
      type: `data`,
      mz_diff: 0,
      row: { id: 1, title: `Updated Todo`, completed: true },
    })

    expect(collection.state.get(1)).toEqual({
      id: 1,
      title: `Updated Todo`,
      completed: true,
    })

    // Delete
    mockWebSocket!.simulateMessage({
      type: `data`,
      mz_diff: -1,
      row: { id: 1, title: `Updated Todo`, completed: true },
    })

    expect(collection.state.has(1)).toBe(false)
  })

  it(`should handle multiple items in sequence`, async () => {
    // Wait for connection to be established
    await new Promise((resolve) => setTimeout(resolve, 10))

    // Insert multiple items
    mockWebSocket!.simulateMessage({
      type: `data`,
      mz_diff: 1,
      row: { id: 1, title: `First Todo`, completed: false },
    })

    mockWebSocket!.simulateMessage({
      type: `data`,
      mz_diff: 1,
      row: { id: 2, title: `Second Todo`, completed: true },
    })

    expect(collection.state).toEqual(
      new Map([
        [1, { id: 1, title: `First Todo`, completed: false }],
        [2, { id: 2, title: `Second Todo`, completed: true }],
      ])
    )
  })

  it(`should track connection state`, async () => {
    expect(collection.utils.isConnected()).toBe(false)

    // Wait for connection to be established
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(collection.utils.isConnected()).toBe(true)
  })

  it(`should handle connection errors`, async () => {
    // Wait for connection attempt
    await new Promise((resolve) => setTimeout(resolve, 10))

    // Simulate error
    const testError = new Error(`Connection failed`)
    mockWebSocket!.simulateError(testError)

    expect(collection.utils.isConnected()).toBe(false)
  })

  it(`should handle disconnection and cleanup`, async () => {
    // Wait for connection
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(collection.utils.isConnected()).toBe(true)

    // Simulate close
    mockWebSocket!.simulateClose()

    expect(collection.utils.isConnected()).toBe(false)
  })

  it(`should allow manual disconnection`, async () => {
    // Wait for connection
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(collection.utils.isConnected()).toBe(true)

    collection.utils.disconnect()

    expect(mockClose).toHaveBeenCalled()
    expect(collection.utils.isConnected()).toBe(false)
  })

  describe(`LSN Sync Tracking`, () => {
    it(`should track LSN progression and resolve sync promises`, async () => {
      // Wait for connection
      await new Promise((resolve) => setTimeout(resolve, 10))

      const beforeLSN = `1000`
      const afterLSN = `1005`

      // Start awaiting sync
      const syncPromise = collection.utils.awaitSync(beforeLSN, afterLSN, 2000)

      // Simulate LSN that's greater than beforeLSN
      mockWebSocket!.simulateMessage({
        type: `lsn`,
        value: `1002`,
      })

      // Wait a bit for the 1000ms delay in the sync logic
      await new Promise((resolve) => setTimeout(resolve, 100))

      // Send afterLSN
      mockWebSocket!.simulateMessage({
        type: `lsn`,
        value: `1006`,
      })

      // Wait for sync completion
      await new Promise((resolve) => setTimeout(resolve, 1100))

      const result = await syncPromise
      expect(result).toBe(true)
    })

    it(`should timeout when LSN sync takes too long`, async () => {
      // Wait for connection
      await new Promise((resolve) => setTimeout(resolve, 10))

      const beforeLSN = `1000`
      const afterLSN = `1005`

      // Start awaiting sync with short timeout
      const syncPromise = collection.utils.awaitSync(beforeLSN, afterLSN, 100)

      // Don't send any LSN updates

      await expect(syncPromise).rejects.toThrow(
        `Timeout waiting for sync confirmation`
      )
    })

    it(`should handle immediate sync when current LSN is already ahead`, async () => {
      // Wait for connection
      await new Promise((resolve) => setTimeout(resolve, 10))

      // Set current LSN ahead of what we're checking
      mockWebSocket!.simulateMessage({
        type: `lsn`,
        value: `2000`,
      })

      const beforeLSN = `1000`
      const afterLSN = `1005`

      // Should resolve immediately since current LSN > beforeLSN
      const syncPromise = collection.utils.awaitSync(beforeLSN, afterLSN, 1000)

      // Wait for the internal 1000ms delay
      await new Promise((resolve) => setTimeout(resolve, 1100))

      const result = await syncPromise
      expect(result).toBe(true)
    })
  })

  describe(`Mutation Handlers`, () => {
    it(`should handle onInsert with LSN tracking`, async () => {
      const mockInsertHandler = vi.fn().mockResolvedValue({
        beforeLSN: `1000`,
        afterLSN: `1005`,
      })

      // Create collection with insert handler
      const config = {
        id: `test-insert`,
        websocketUrl: `ws://localhost:3000/api/todos-ws`,
        getKey: (item: TestItem) => item.id,
        onInsert: mockInsertHandler,
      }

      const options = materializeCollectionOptions<TestItem>(config)
      const testCollection = createCollection(options)

      // Wait for connection
      await new Promise((resolve) => setTimeout(resolve, 10))

      // Perform insert
      const transaction = testCollection.insert({
        id: 1,
        title: `New Todo`,
        completed: false,
      })

      expect(mockInsertHandler).toHaveBeenCalled()

      // Simulate LSN progression
      mockWebSocket!.simulateMessage({ type: `lsn`, value: `1002` })

      await new Promise((resolve) => setTimeout(resolve, 100))

      mockWebSocket!.simulateMessage({ type: `lsn`, value: `1006` })

      await transaction.isPersisted.promise
    })

    it(`should handle onUpdate with LSN tracking`, async () => {
      const mockUpdateHandler = vi.fn().mockResolvedValue({
        beforeLSN: `2000`,
        afterLSN: `2005`,
      })

      // Create collection with update handler
      const config = {
        id: `test-update`,
        websocketUrl: `ws://localhost:3000/api/todos-ws`,
        getKey: (item: TestItem) => item.id,
        onUpdate: mockUpdateHandler,
      }

      const options = materializeCollectionOptions<TestItem>(config)
      const testCollection = createCollection(options)

      // Wait for connection and add initial data
      await new Promise((resolve) => setTimeout(resolve, 10))

      mockWebSocket!.simulateMessage({
        type: `data`,
        mz_diff: 1,
        row: { id: 1, title: `Original Todo`, completed: false },
      })

      // Perform update
      const transaction = testCollection.update(
        1,
        (draft) => (draft.title = `Updated Todo`)
      )

      expect(mockUpdateHandler).toHaveBeenCalled()

      await transaction.isPersisted.promise
    })

    it(`should handle onDelete with LSN tracking`, async () => {
      const mockDeleteHandler = vi.fn().mockResolvedValue({
        beforeLSN: `3000`,
        afterLSN: `3005`,
      })

      // Create collection with delete handler
      const config = {
        id: `test-delete`,
        websocketUrl: `ws://localhost:3000/api/todos-ws`,
        getKey: (item: TestItem) => item.id,
        onDelete: mockDeleteHandler,
      }

      const options = materializeCollectionOptions<TestItem>(config)
      const testCollection = createCollection(options)

      // Wait for connection and add initial data
      await new Promise((resolve) => setTimeout(resolve, 10))

      mockWebSocket!.simulateMessage({
        type: `data`,
        mz_diff: 1,
        row: { id: 1, title: `Todo to Delete`, completed: false },
      })

      // Perform delete
      const transaction = testCollection.delete(1)

      expect(mockDeleteHandler).toHaveBeenCalled()

      await transaction.isPersisted.promise
    })
  })

  describe(`Error Handling`, () => {
    it(`should handle malformed messages gracefully`, async () => {
      // Wait for connection
      await new Promise((resolve) => setTimeout(resolve, 10))

      // Simulate malformed message
      const messageHandler = mockWebSocket!.handlers.get(`message`)
      if (messageHandler) {
        messageHandler(Buffer.from(`invalid json`))
      }

      // Collection should still be connected and functional
      expect(collection.utils.isConnected()).toBe(true)
    })

    it(`should continue optimistically when sync timeout occurs`, async () => {
      const mockInsertHandler = vi.fn().mockResolvedValue({
        beforeLSN: `1000`,
        afterLSN: `1005`,
      })

      const config = {
        id: `test-timeout`,
        websocketUrl: `ws://localhost:3000/api/todos-ws`,
        getKey: (item: TestItem) => item.id,
        onInsert: mockInsertHandler,
      }

      const options = materializeCollectionOptions<TestItem>(config)
      const testCollection = createCollection(options)

      // Wait for connection
      await new Promise((resolve) => setTimeout(resolve, 10))

      // Perform insert - should complete even if sync times out
      const transaction = testCollection.insert({
        id: 1,
        title: `New Todo`,
        completed: false,
      })

      // Don't send LSN updates, let it timeout
      await expect(transaction.isPersisted.promise).resolves.toBeDefined()
    })
  })
})
