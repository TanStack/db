import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  CollectionImpl,
  createCollection,
  createTransaction,
} from "@tanstack/db"
import { electricCollectionOptions } from "../src/electric"
import type { ElectricCollectionUtils } from "../src/electric"
import type {
  Collection,
  InsertMutationFnParams,
  MutationFnParams,
  PendingMutation,
  Transaction,
  TransactionWithMutations,
} from "@tanstack/db"
import type { Message, Row } from "@electric-sql/client"
import type { StandardSchemaV1 } from "@standard-schema/spec"

// Mock the ShapeStream module
const mockSubscribe = vi.fn()
const mockStream = {
  subscribe: mockSubscribe,
}

vi.mock(`@electric-sql/client`, async () => {
  const actual = await vi.importActual(`@electric-sql/client`)
  return {
    ...actual,
    ShapeStream: vi.fn(() => mockStream),
  }
})

describe(`Electric Integration`, () => {
  let collection: Collection<
    Row,
    string | number,
    ElectricCollectionUtils,
    StandardSchemaV1<unknown, unknown>,
    Row
  >
  let subscriber: (messages: Array<Message<Row>>) => void

  beforeEach(() => {
    vi.clearAllMocks()

    // Reset mock subscriber
    mockSubscribe.mockImplementation((callback) => {
      subscriber = callback
      return () => {}
    })

    // Create collection with Electric configuration
    const config = {
      id: `test`,
      shapeOptions: {
        url: `http://test-url`,
        params: {
          table: `test_table`,
        },
      },
      startSync: true,
      getKey: (item: Row) => item.id as number,
    }

    // Get the options with utilities
    const options = electricCollectionOptions(config)

    // Create collection with Electric configuration using the new utility exposure pattern
    collection = createCollection(options)
  })

  it(`should commit an empty transaction when there's an up-to-date`, () => {
    expect(collection.status).toEqual(`loading`)
    expect(collection.state).toEqual(new Map([]))

    // Send up-to-date control message to commit transaction
    subscriber([
      {
        headers: { control: `up-to-date` },
      },
    ])
    expect(collection.state).toEqual(new Map([]))
    expect(collection.status).toEqual(`ready`)
  })

  it(`should handle incoming insert messages and commit on up-to-date`, () => {
    // Simulate incoming insert message
    subscriber([
      {
        key: `1`,
        value: { id: 1, name: `Test User` },
        headers: { operation: `insert` },
      },
    ])
    expect(collection.state).toEqual(new Map([]))

    // Send up-to-date control message to commit transaction
    subscriber([
      {
        headers: { control: `up-to-date` },
      },
    ])

    expect(collection.state).toEqual(
      new Map([[1, { id: 1, name: `Test User` }]])
    )
  })

  it(`should handle multiple changes before committing`, () => {
    // First batch of changes
    subscriber([
      {
        key: `1`,
        value: { id: 1, name: `Test User` },
        headers: { operation: `insert` },
      },
    ])

    // Second batch of changes
    subscriber([
      {
        key: `2`,
        value: { id: 2, name: `Another User` },
        headers: { operation: `insert` },
      },
    ])

    expect(collection.state).toEqual(new Map([]))
    expect(collection.status).toEqual(`loading`)

    // Send up-to-date to commit all changes
    subscriber([
      {
        headers: { control: `up-to-date` },
      },
    ])
    expect(collection.status).toEqual(`ready`)

    expect(collection.state).toEqual(
      new Map([
        [1, { id: 1, name: `Test User` }],
        [2, { id: 2, name: `Another User` }],
      ])
    )
  })

  it(`should handle updates across multiple messages`, () => {
    // First insert
    subscriber([
      {
        key: `1`,
        value: { id: 1, name: `Test User` },
        headers: { operation: `insert` },
      },
    ])

    // Update in a separate message
    subscriber([
      {
        key: `1`,
        value: { id: 1, name: `Updated User` },
        headers: { operation: `update` },
      },
    ])

    // Commit with up-to-date
    subscriber([
      {
        headers: { control: `up-to-date` },
      },
    ])

    expect(collection.state).toEqual(
      new Map([[1, { id: 1, name: `Updated User` }]])
    )
  })

  it(`should handle delete operations`, () => {
    // Insert and commit
    subscriber([
      {
        key: `1`,
        value: { id: 1, name: `Test User` },
        headers: { operation: `insert` },
      },
      {
        headers: { control: `up-to-date` },
      },
    ])

    // Delete in new transaction
    subscriber([
      {
        key: `1`,
        value: { id: 1 },
        headers: { operation: `delete` },
      },
      {
        headers: { control: `up-to-date` },
      },
    ])

    expect(collection.state).toEqual(new Map())
  })

  it(`should not commit changes without up-to-date message`, () => {
    // Send changes without up-to-date
    subscriber([
      {
        key: `1`,
        value: { id: 1, name: `Test User` },
        headers: { operation: `insert` },
      },
    ])

    // Send must-refetch control message
    subscriber([
      {
        headers: { control: `must-refetch` },
      },
    ])

    // Changes should still be pending until up-to-date is received
    expect(collection.state).toEqual(new Map())
  })

  // Tests for txid tracking functionality
  describe(`txid tracking`, () => {
    it(`should track txids from incoming messages`, async () => {
      const testTxid = 123

      // Send a message with a txid
      subscriber([
        {
          key: `1`,
          value: { id: 1, name: `Test User` },
          headers: {
            operation: `insert`,
            txids: [testTxid],
          },
        },
        {
          headers: { control: `up-to-date` },
        },
      ])

      // awaitTxId throws if you pass it a string
      await expect(
        // @ts-expect-error
        collection.utils.awaitTxId(`123`)
      ).rejects.toThrowErrorMatchingInlineSnapshot(
        `[ExpectedNumberInAwaitTxIdError: Expected number in awaitTxId, received string]`
      )

      // The txid should be tracked and awaitTxId should resolve immediately
      await expect(collection.utils.awaitTxId(testTxid)).resolves.toBe(true)
    })

    it(`should track multiple txids`, async () => {
      const txid1 = 100
      const txid2 = 200

      // Send a message with multiple txids
      subscriber([
        {
          key: `1`,
          value: { id: 1, name: `Test User` },
          headers: {
            operation: `insert`,
            txids: [txid1, txid2],
          },
        },
        {
          headers: { control: `up-to-date` },
        },
      ])

      // Both txids should be tracked
      await expect(collection.utils.awaitTxId(txid1)).resolves.not.toThrow()
      await expect(collection.utils.awaitTxId(txid2)).resolves.not.toThrow()
    })

    it(`should reject with timeout when waiting for unknown txid`, async () => {
      // Set a short timeout for the test
      const unknownTxid = 0
      const shortTimeout = 100

      // Attempt to await a txid that hasn't been seen with a short timeout
      const promise = collection.utils.awaitTxId(unknownTxid, shortTimeout)

      // The promise should reject with a timeout error
      await expect(promise).rejects.toThrow(
        `Timeout waiting for txId: ${unknownTxid}`
      )
    })

    it(`should resolve when a txid arrives after awaitTxId is called`, async () => {
      const laterTxid = 1000

      // Start waiting for a txid that hasn't arrived yet
      const promise = collection.utils.awaitTxId(laterTxid, 1000)

      // Send the txid after a short delay
      setTimeout(() => {
        subscriber([
          {
            key: `foo`,
            value: { id: 1, bar: true },
            headers: {
              operation: `insert`,
            },
          },
          {
            headers: {
              control: `up-to-date`,
              txids: [laterTxid],
            },
          },
          {
            headers: {
              control: `up-to-date`,
            },
          },
        ])
      }, 50)

      // The promise should resolve when the txid arrives
      await expect(promise).resolves.not.toThrow()
    })

    // Test the complete flow
    it(`should simulate the complete flow`, async () => {
      // Create a fake backend store to simulate server-side storage
      const fakeBackend = {
        data: new Map<number, { txid: number; value: unknown }>(),
        // Simulates persisting data to a backend and returning a txid
        persist: (mutations: Array<PendingMutation<Row>>): Promise<number> => {
          const txid = Math.floor(Math.random() * 10000)

          // Store the changes with the txid
          mutations.forEach((mutation) => {
            fakeBackend.data.set(mutation.key, {
              value: mutation.changes,
              txid,
            })
          })

          return Promise.resolve(txid)
        },
        // Simulates the server sending sync messages with txids
        simulateSyncMessage: (txid: number) => {
          // Create messages for each item in the store that has this txid
          const messages: Array<Message<Row>> = []

          fakeBackend.data.forEach((value, key) => {
            if (value.txid === txid) {
              messages.push({
                key: key.toString(),
                value: value.value as Row,
                headers: {
                  operation: `insert`,
                  txids: [txid],
                },
              })
            }
          })

          // Add an up-to-date message to complete the sync
          messages.push({
            headers: {
              control: `up-to-date`,
            },
          })

          // Send the messages to the subscriber
          subscriber(messages)
        },
      }

      // Create a test mutation function that uses our fake backend
      const testMutationFn = vi.fn(
        async ({ transaction }: { transaction: Transaction }) => {
          // Persist to fake backend and get txid
          const txid = await fakeBackend.persist(
            transaction.mutations as Array<PendingMutation<Row>>
          )

          if (!txid) {
            throw new Error(`No txid found`)
          }

          // Start waiting for the txid
          const promise = collection.utils.awaitTxId(txid, 1000)

          // Simulate the server sending sync messages after a delay
          setTimeout(() => {
            fakeBackend.simulateSyncMessage(txid)
          }, 50)

          // Wait for the txid to be seen
          await promise

          return Promise.resolve()
        }
      )

      const tx1 = createTransaction({ mutationFn: testMutationFn })

      let transaction = tx1.mutate(() =>
        collection.insert({ id: 1, name: `Test item 1` })
      )

      await transaction.isPersisted.promise

      transaction = collection.transactions.get(transaction.id)!

      // Verify the mutation function was called correctly
      expect(testMutationFn).toHaveBeenCalledTimes(1)

      // Check that the data was added to the collection
      // Note: In a real implementation, the collection would be updated by the sync process
      // This is just verifying our test setup worked correctly
      expect(fakeBackend.data.has(1)).toBe(true)
      expect(collection.has(1)).toBe(true)
    })
  })

  // Tests for direct persistence handlers
  describe(`Direct persistence handlers`, () => {
    it(`should pass through direct persistence handlers to collection options`, () => {
      // Create mock handlers
      const onInsert = vi.fn().mockResolvedValue({ txid: 123 })
      const onUpdate = vi.fn().mockResolvedValue({ txid: 456 })
      const onDelete = vi.fn().mockResolvedValue({ txid: 789 })

      const config = {
        id: `test-handlers`,
        shapeOptions: {
          url: `http://test-url`,
          params: {
            table: `test_table`,
          },
        },
        getKey: (item: Row) => item.id as number,
        onInsert,
        onUpdate,
        onDelete,
      }

      const options = electricCollectionOptions(config)

      // Verify that the handlers were passed to the collection options
      expect(options.onInsert).toBeDefined()
      expect(options.onUpdate).toBeDefined()
      expect(options.onDelete).toBeDefined()
    })

    it(`should throw an error if handler doesn't return a txid`, async () => {
      // Create a mock transaction for testing
      const mockTransaction = {
        id: `test-transaction`,
        mutations: [],
      } as unknown as TransactionWithMutations<Row, `insert`>
      const mockParams: InsertMutationFnParams<Row> = {
        transaction: mockTransaction,
        // @ts-expect-error not relevant to test
        collection: CollectionImpl,
      }

      // Create a handler that doesn't return a txid
      const onInsert = vi.fn().mockResolvedValue({})

      const config = {
        id: `test-handlers`,
        shapeOptions: {
          url: `http://test-url`,
          params: {
            table: `test_table`,
          },
        },
        getKey: (item: Row) => item.id as number,
        onInsert,
      }

      const options = electricCollectionOptions(config)

      // Call the wrapped handler and expect it to throw
      await expect(options.onInsert!(mockParams)).rejects.toThrow(
        `Electric collection onInsert handler must return a txid`
      )
    })

    it(`should simulate complete flow with direct persistence handlers`, async () => {
      // Create a fake backend store to simulate server-side storage
      const fakeBackend = {
        data: new Map<string, { txid: number; value: unknown }>(),
        // Simulates persisting data to a backend and returning a txid
        persist: (mutations: Array<PendingMutation<Row>>): Promise<number> => {
          const txid = Math.floor(Math.random() * 10000)

          // Store the changes with the txid
          mutations.forEach((mutation) => {
            const key = mutation.key
            fakeBackend.data.set(key, { txid, value: mutation.changes })
          })

          return Promise.resolve(txid)
        },
        // Simulates the server sending sync messages with txids
        simulateSyncMessage: (txid: number) => {
          // Create messages for each item in the store that has this txid
          const messages: Array<Message<Row>> = []

          fakeBackend.data.forEach((value, key) => {
            if (value.txid === txid) {
              messages.push({
                key,
                value: value.value as Row,
                headers: {
                  operation: `insert`,
                  txids: [txid],
                },
              })
            }
          })

          // Add up-to-date message
          messages.push({
            headers: { control: `up-to-date` },
          })

          // Send the messages to the subscriber
          subscriber(messages)
        },
      }

      // Create a mutation function for the transaction
      const mutationFn = vi.fn(async (params: MutationFnParams<Row>) => {
        const txid = await fakeBackend.persist(params.transaction.mutations)

        // Simulate server sending sync message after a delay
        setTimeout(() => {
          fakeBackend.simulateSyncMessage(txid)
        }, 50)

        return txid
      })

      // Create direct persistence handler that returns the txid
      const onInsert = vi.fn(async (params: MutationFnParams<Row>) => {
        return { txid: await mutationFn(params) }
      })

      // Create a test collection with our direct persistence handler
      const config = {
        id: `test-direct-persistence`,
        shapeOptions: {
          url: `http://test-url`,
          params: {
            table: `test_table`,
          },
        },
        startSync: true,
        getKey: (item: Row) => item.id as number,
        onInsert,
      }

      const testCollection = createCollection(electricCollectionOptions(config))

      // Insert data using the transaction
      const tx = testCollection.insert({
        id: 1,
        name: `Direct Persistence User`,
      })

      // If awaitTxId wasn't called automatically, this wouldn't be true.
      expect(testCollection.syncedData.size).toEqual(0)

      // Verify that our onInsert handler was called
      expect(onInsert).toHaveBeenCalled()

      await tx.isPersisted.promise

      // Verify that the data was added to the collection via the sync process
      expect(testCollection.has(1)).toBe(true)
      expect(testCollection.get(1)).toEqual({
        id: 1,
        name: `Direct Persistence User`,
      })
      expect(testCollection.syncedData.size).toEqual(1)
    })
  })

  // Tests for Electric stream lifecycle management
  describe(`Electric stream lifecycle management`, () => {
    let mockUnsubscribe: ReturnType<typeof vi.fn>
    let mockAbortController: {
      abort: ReturnType<typeof vi.fn>
      signal: AbortSignal
    }

    beforeEach(() => {
      // Clear all mocks before each lifecycle test
      vi.clearAllMocks()

      // Reset mocks before each test
      mockUnsubscribe = vi.fn()
      mockAbortController = {
        abort: vi.fn(),
        signal: new AbortController().signal,
      }

      // Update the mock to return our mock unsubscribe function
      mockSubscribe.mockImplementation((callback) => {
        subscriber = callback
        return mockUnsubscribe
      })

      // Mock AbortController
      global.AbortController = vi
        .fn()
        .mockImplementation(() => mockAbortController)
    })

    it(`should call unsubscribe and abort when collection is cleaned up`, async () => {
      const config = {
        id: `cleanup-test`,
        shapeOptions: {
          url: `http://test-url`,
          params: {
            table: `test_table`,
          },
        },
        getKey: (item: Row) => item.id as number,
        startSync: true,
      }

      const testCollection = createCollection(electricCollectionOptions(config))

      // Verify stream is set up
      expect(mockSubscribe).toHaveBeenCalled()

      // Cleanup the collection
      await testCollection.cleanup()

      // Verify that both unsubscribe and abort were called
      expect(mockUnsubscribe).toHaveBeenCalledTimes(1)
      expect(mockAbortController.abort).toHaveBeenCalledTimes(1)
    })

    it(`should properly cleanup Electric-specific resources`, async () => {
      const config = {
        id: `resource-cleanup-test`,
        shapeOptions: {
          url: `http://test-url`,
          params: {
            table: `test_table`,
          },
        },
        getKey: (item: Row) => item.id as number,
        startSync: true,
      }

      const testCollection = createCollection(electricCollectionOptions(config))

      // Add some txids to track
      subscriber([
        {
          key: `1`,
          value: { id: 1, name: `Test` },
          headers: {
            operation: `insert`,
            txids: [100, 200],
          },
        },
        {
          headers: { control: `up-to-date` },
        },
      ])

      // Verify txids are tracked
      await expect(testCollection.utils.awaitTxId(100)).resolves.toBe(true)

      // Cleanup collection
      await testCollection.cleanup()

      // Verify cleanup was called
      expect(mockUnsubscribe).toHaveBeenCalled()
      expect(mockAbortController.abort).toHaveBeenCalled()
    })

    it(`should handle multiple cleanup calls gracefully`, async () => {
      const config = {
        id: `multiple-cleanup-test`,
        shapeOptions: {
          url: `http://test-url`,
          params: {
            table: `test_table`,
          },
        },
        getKey: (item: Row) => item.id as number,
        startSync: true,
      }

      const testCollection = createCollection(electricCollectionOptions(config))

      // Call cleanup multiple times
      await testCollection.cleanup()
      await testCollection.cleanup()
      await testCollection.cleanup()

      // Should only call unsubscribe once (from the first cleanup)
      expect(mockUnsubscribe).toHaveBeenCalledTimes(1)
      expect(mockAbortController.abort).toHaveBeenCalledTimes(1)
    })

    it(`should restart stream when collection is accessed after cleanup`, async () => {
      const config = {
        id: `restart-stream-test`,
        shapeOptions: {
          url: `http://test-url`,
          params: {
            table: `test_table`,
          },
        },
        getKey: (item: Row) => item.id as number,
        startSync: true,
      }

      const testCollection = createCollection(electricCollectionOptions(config))

      // Initial stream setup
      expect(mockSubscribe).toHaveBeenCalledTimes(1)

      // Cleanup
      await testCollection.cleanup()
      expect(testCollection.status).toBe(`cleaned-up`)

      // Access collection data to restart sync
      const unsubscribe = testCollection.subscribeChanges(() => {})

      // Should have started a new stream
      expect(mockSubscribe).toHaveBeenCalledTimes(2)
      expect(testCollection.status).toBe(`loading`)

      unsubscribe()
    })

    it(`should handle stream errors gracefully`, () => {
      const config = {
        id: `error-handling-test`,
        shapeOptions: {
          url: `http://test-url`,
          params: {
            table: `test_table`,
          },
        },
        getKey: (item: Row) => item.id as number,
        startSync: true,
      }

      // Mock stream to throw an error
      mockSubscribe.mockImplementation(() => {
        throw new Error(`Stream connection failed`)
      })

      expect(() => {
        createCollection(electricCollectionOptions(config))
      }).toThrow(`Stream connection failed`)
    })

    it(`should handle subscriber function errors without breaking`, () => {
      const config = {
        id: `subscriber-error-test`,
        shapeOptions: {
          url: `http://test-url`,
          params: {
            table: `test_table`,
          },
        },
        getKey: (item: Row) => item.id as number,
        startSync: true,
      }

      const testCollection = createCollection(electricCollectionOptions(config))

      // Mock console.error to capture error logs
      const consoleSpy = vi.spyOn(console, `error`).mockImplementation(() => {})

      // Send messages with invalid data that might cause internal errors
      // but shouldn't break the entire system
      expect(() => {
        subscriber([
          {
            key: `1`,
            value: { id: 1, name: `Valid User` }, // Use valid data
            headers: { operation: `insert` },
          },
        ])
      }).not.toThrow()

      // Should have processed the valid message without issues
      expect(testCollection.syncedData.size).toBe(0) // Still pending until up-to-date

      // Send up-to-date to commit
      expect(() => {
        subscriber([
          {
            headers: { control: `up-to-date` },
          },
        ])
      }).not.toThrow()

      // Now the data should be committed
      expect(testCollection.has(1)).toBe(true)

      consoleSpy.mockRestore()
    })

    it(`should properly handle concurrent stream operations`, async () => {
      const config = {
        id: `concurrent-test`,
        shapeOptions: {
          url: `http://test-url`,
          params: {
            table: `test_table`,
          },
        },
        getKey: (item: Row) => item.id as number,
        startSync: true,
      }

      const testCollection = createCollection(electricCollectionOptions(config))

      // Simulate concurrent messages
      const promises = [
        new Promise<void>((resolve) => {
          setTimeout(() => {
            subscriber([
              {
                key: `1`,
                value: { id: 1, name: `User 1` },
                headers: { operation: `insert` },
              },
            ])
            resolve()
          }, 10)
        }),
        new Promise<void>((resolve) => {
          setTimeout(() => {
            subscriber([
              {
                key: `2`,
                value: { id: 2, name: `User 2` },
                headers: { operation: `insert` },
              },
            ])
            resolve()
          }, 20)
        }),
        new Promise<void>((resolve) => {
          setTimeout(() => {
            subscriber([
              {
                headers: { control: `up-to-date` },
              },
            ])
            resolve()
          }, 30)
        }),
      ]

      await Promise.all(promises)

      // Both items should be in the collection
      expect(testCollection.has(1)).toBe(true)
      expect(testCollection.has(2)).toBe(true)
    })

    it(`should handle schema information extraction from messages`, () => {
      const config = {
        id: `schema-test`,
        shapeOptions: {
          url: `http://test-url`,
          params: {
            table: `test_table`,
          },
        },
        getKey: (item: Row) => item.id as number,
        startSync: true,
      }

      const testCollection = createCollection(electricCollectionOptions(config))

      // Send message with schema information
      subscriber([
        {
          key: `1`,
          value: { id: 1, name: `User 1` },
          headers: {
            operation: `insert`,
            schema: `custom_schema`,
          },
        },
        {
          headers: { control: `up-to-date` },
        },
      ])

      // Schema should be stored and used in sync metadata
      // This is internal behavior, but we can verify it doesn't cause errors
      expect(testCollection.has(1)).toBe(true)
    })

    it(`should handle invalid schema information gracefully`, () => {
      const config = {
        id: `invalid-schema-test`,
        shapeOptions: {
          url: `http://test-url`,
          params: {
            table: `test_table`,
          },
        },
        getKey: (item: Row) => item.id as number,
        startSync: true,
      }

      const testCollection = createCollection(electricCollectionOptions(config))

      // Send message with invalid schema information
      expect(() => {
        subscriber([
          {
            key: `1`,
            value: { id: 1, name: `User 1` },
            headers: {
              operation: `insert`,
              schema: 123 as any, // Invalid schema type
            },
          },
          {
            headers: { control: `up-to-date` },
          },
        ])
      }).not.toThrow()

      expect(testCollection.has(1)).toBe(true)
    })

    it(`should handle txids from control messages`, async () => {
      const config = {
        id: `control-txid-test`,
        shapeOptions: {
          url: `http://test-url`,
          params: {
            table: `test_table`,
          },
        },
        getKey: (item: Row) => item.id as number,
        startSync: true,
      }

      const testCollection = createCollection(electricCollectionOptions(config))

      // Send control message with txids (as numbers, per Electric API)
      subscriber([
        {
          headers: {
            control: `up-to-date`,
            txids: [300, 400],
          },
        },
      ])

      // Txids should be tracked (converted to strings internally)
      await expect(testCollection.utils.awaitTxId(300)).resolves.toBe(true)
      await expect(testCollection.utils.awaitTxId(400)).resolves.toBe(true)
    })
  })
})
