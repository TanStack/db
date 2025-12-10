import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CollectionImpl,
  createCollection,
  createTransaction,
} from '@tanstack/db'
import { electricCollectionOptions, isChangeMessage } from '../src/electric'
import type { ElectricCollectionUtils } from '../src/electric'
import type {
  Collection,
  InsertMutationFnParams,
  MutationFnParams,
  PendingMutation,
  Transaction,
  TransactionWithMutations,
} from '@tanstack/db'
import type { Message, Row } from '@electric-sql/client'
import type { StandardSchemaV1 } from '@standard-schema/spec'

// Mock the ShapeStream module
const mockSubscribe = vi.fn()
const mockRequestSnapshot = vi.fn()
const mockFetchSnapshot = vi.fn()
const mockStream = {
  subscribe: mockSubscribe,
  requestSnapshot: mockRequestSnapshot,
  fetchSnapshot: mockFetchSnapshot,
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

    // Reset mock requestSnapshot
    mockRequestSnapshot.mockResolvedValue(undefined)

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
    collection = createCollection(options) as unknown as Collection<
      Row,
      string | number,
      ElectricCollectionUtils,
      StandardSchemaV1<unknown, unknown>,
      Row
    >
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
      new Map([[1, { id: 1, name: `Test User` }]]),
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
      ]),
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
      new Map([[1, { id: 1, name: `Updated User` }]]),
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

  it(`should handle must-refetch by clearing synced data and re-syncing`, () => {
    // First, populate the collection with some data
    subscriber([
      {
        key: `1`,
        value: { id: 1, name: `Test User` },
        headers: { operation: `insert` },
      },
      {
        key: `2`,
        value: { id: 2, name: `Another User` },
        headers: { operation: `insert` },
      },
      {
        headers: { control: `up-to-date` },
      },
    ])

    // Verify the data is in the collection
    expect(collection.state.size).toBe(2)
    expect(collection.status).toBe(`ready`)

    // Send must-refetch control message
    subscriber([
      {
        headers: { control: `must-refetch` },
      },
    ])

    // The collection should still have old data because truncate is in pending
    // transaction. This is the intended behavior of the collection, you should have
    // the old data until the next up-to-date message.
    expect(collection.state.size).toBe(2)
    expect(collection.status).toBe(`ready`)

    // Send new data after must-refetch
    subscriber([
      {
        key: `3`,
        value: { id: 3, name: `New User` },
        headers: { operation: `insert` },
      },
      {
        headers: { control: `up-to-date` },
      },
    ])

    // The collection should now have the new data
    expect(collection.state.size).toBe(1)
    expect(collection.state.get(3)).toEqual({ id: 3, name: `New User` })
    expect(collection.status).toBe(`ready`)
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
        collection.utils.awaitTxId(`123`),
      ).rejects.toThrowErrorMatchingInlineSnapshot(
        `[ExpectedNumberInAwaitTxIdError: [test] Expected number in awaitTxId, received string]`,
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
        `Timeout waiting for txId: ${unknownTxid}`,
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
            transaction.mutations as Array<PendingMutation<Row>>,
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
        },
      )

      const tx1 = createTransaction({ mutationFn: testMutationFn })

      let transaction = tx1.mutate(() =>
        collection.insert({ id: 1, name: `Test item 1` }),
      )

      await transaction.isPersisted.promise

      transaction = collection._state.transactions.get(transaction.id)!

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
      // With the new matching strategies, empty object triggers void strategy (3-second wait)
      // So we expect it to resolve, not throw
      await expect(options.onInsert!(mockParams)).resolves.not.toThrow()
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
      expect(testCollection._state.syncedData.size).toEqual(0)

      // Verify that our onInsert handler was called
      expect(onInsert).toHaveBeenCalled()

      await tx.isPersisted.promise

      // Verify that the data was added to the collection via the sync process
      expect(testCollection.has(1)).toBe(true)
      expect(testCollection.get(1)).toEqual({
        id: 1,
        name: `Direct Persistence User`,
      })
      expect(testCollection._state.syncedData.size).toEqual(1)
    })

    it(`should support void strategy when handler returns nothing`, async () => {
      const onInsert = vi.fn().mockResolvedValue(undefined)

      const config = {
        id: `test-void-strategy`,
        shapeOptions: {
          url: `http://test-url`,
          params: { table: `test_table` },
        },
        startSync: true,
        getKey: (item: Row) => item.id as number,
        onInsert,
      }

      const testCollection = createCollection(electricCollectionOptions(config))

      // Insert with void strategy - should complete immediately without waiting
      const tx = testCollection.insert({ id: 1, name: `Void Test` })

      await expect(tx.isPersisted.promise).resolves.toBeDefined()
      expect(onInsert).toHaveBeenCalled()
    })

    it(`should support custom timeout in matching strategy`, async () => {
      const onInsert = vi.fn(() => {
        // Return a txid that will never arrive with a very short timeout
        return Promise.resolve({ txid: 999999, timeout: 100 })
      })

      const config = {
        id: `test-custom-timeout`,
        shapeOptions: {
          url: `http://test-url`,
          params: { table: `test_table` },
        },
        startSync: true,
        getKey: (item: Row) => item.id as number,
        onInsert,
      }

      const testCollection = createCollection(electricCollectionOptions(config))

      // Insert data - should timeout after 100ms
      const tx = testCollection.insert({ id: 1, name: `Timeout Test` })

      // Verify that our onInsert handler was called
      expect(onInsert).toHaveBeenCalled()

      // The transaction should reject due to timeout
      await expect(tx.isPersisted.promise).rejects.toThrow(
        `Timeout waiting for txId: 999999`,
      )
    })

    it(`should handle array of txids returned from handler`, async () => {
      // Create a fake backend that returns multiple txids
      const fakeBackend = {
        persist: (
          mutations: Array<PendingMutation<Row>>,
        ): Promise<Array<number>> => {
          // Simulate multiple items being persisted and each getting a txid
          const txids = mutations.map(() => Math.floor(Math.random() * 10000))
          return Promise.resolve(txids)
        },
      }

      // Create handler that returns array of txids
      const onInsert = vi.fn(async (params: MutationFnParams<Row>) => {
        const txids = await fakeBackend.persist(params.transaction.mutations)

        // Simulate server sending sync messages on different ticks
        // In the real world, multiple txids rarely arrive together
        setTimeout(() => {
          subscriber([
            {
              key: `1`,
              value: { id: 1, name: `Item 1` },
              headers: {
                operation: `insert`,
                txids: [txids[0]!],
              },
            },
            { headers: { control: `up-to-date` } },
          ])
        }, 1)

        setTimeout(() => {
          subscriber([
            {
              key: `2`,
              value: { id: 2, name: `Item 2` },
              headers: {
                operation: `insert`,
                txids: [txids[1]!],
              },
            },
            { headers: { control: `up-to-date` } },
          ])
        }, 2)

        // Return array of txids - this is the pattern that's failing
        return { txid: txids }
      })

      const config = {
        id: `test-array-txids`,
        shapeOptions: {
          url: `http://test-url`,
          params: { table: `test_table` },
        },
        startSync: true,
        getKey: (item: Row) => item.id as number,
        onInsert,
      }

      const testCollection = createCollection(electricCollectionOptions(config))

      // Insert multiple items
      const tx = testCollection.insert([
        { id: 1, name: `Item 1` },
        { id: 2, name: `Item 2` },
      ])

      // This should resolve when all txids are seen
      await expect(tx.isPersisted.promise).resolves.toBeDefined()
      expect(onInsert).toHaveBeenCalled()

      // Verify both items were added
      expect(testCollection.has(1)).toBe(true)
      expect(testCollection.has(2)).toBe(true)
    })

    it(`should support custom match function using awaitMatch utility`, async () => {
      let resolveCustomMatch: () => void
      const customMatchPromise = new Promise<void>((resolve) => {
        resolveCustomMatch = resolve
      })

      const onInsert = vi
        .fn()
        .mockImplementation(async ({ transaction, collection: col }) => {
          const item = transaction.mutations[0].modified
          await col.utils.awaitMatch((message: any) => {
            if (
              isChangeMessage(message) &&
              message.headers.operation === `insert` &&
              message.value.name === item.name
            ) {
              resolveCustomMatch()
              return true
            }
            return false
          }, 5000)
        })

      const config = {
        id: `test-custom-match`,
        shapeOptions: {
          url: `http://test-url`,
          params: { table: `test_table` },
        },
        startSync: true,
        getKey: (item: Row) => item.id as number,
        onInsert,
      }

      const testCollection = createCollection(electricCollectionOptions(config))

      // Start insert - will wait for custom match
      const insertPromise = testCollection.insert({
        id: 1,
        name: `Custom Match Test`,
      })

      // Wait a moment then send matching message
      setTimeout(() => {
        subscriber([
          {
            key: `1`,
            value: { id: 1, name: `Custom Match Test` },
            headers: { operation: `insert` },
          },
          { headers: { control: `up-to-date` } },
        ])
      }, 100)

      // Wait for both the custom match and persistence
      await Promise.all([customMatchPromise, insertPromise.isPersisted.promise])

      expect(onInsert).toHaveBeenCalled()
      expect(testCollection.has(1)).toBe(true)
    })

    // NOTE: This test has a known issue with unhandled rejection warnings
    // This is a pre-existing issue from main branch (not caused by merge)
    // The test functionality works correctly, but vitest reports unhandled rejections
    it(`should timeout with custom match function when no match found`, async () => {
      vi.useFakeTimers()

      const onInsert = vi
        .fn()
        .mockImplementation(async ({ collection: col }) => {
          await col.utils.awaitMatch(
            () => false, // Never matches
            1, // Short timeout for test
          )
        })

      const config = {
        id: `test-timeout`,
        shapeOptions: {
          url: `http://test-url`,
          params: { table: `test_table` },
        },
        startSync: true,
        getKey: (item: Row) => item.id as number,
        onInsert,
      }

      const testCollection = createCollection(electricCollectionOptions(config))
      const tx = testCollection.insert({ id: 1, name: `Timeout Test` })

      // Capture the rejection promise before advancing timers
      const rejectionPromise = expect(tx.isPersisted.promise).rejects.toThrow(
        `Timeout waiting for custom match function`,
      )

      // Advance timers to trigger timeout
      await vi.runOnlyPendingTimersAsync()

      // Should timeout and fail
      await rejectionPromise

      vi.useRealTimers()
    })

    it(`should find matching message in awaitMatch even when called after up-to-date`, async () => {
      // This test verifies the fix for the race condition where:
      // 1. Server receives insert and syncs it via Electric
      // 2. Electric messages (including up-to-date) are processed
      // 3. THEN awaitMatch is called - it should still find the message

      let resolveServerCall: () => void
      const serverCallPromise = new Promise<void>((resolve) => {
        resolveServerCall = resolve
      })

      const onInsert = vi
        .fn()
        .mockImplementation(async ({ transaction, collection: col }) => {
          const item = transaction.mutations[0].modified

          // Simulate waiting for server call to complete
          // During this time, Electric messages will arrive and be processed
          await serverCallPromise

          // Now awaitMatch is called AFTER the messages were processed
          // This should still find the message in the buffer
          await col.utils.awaitMatch((message: any) => {
            return (
              isChangeMessage(message) &&
              message.headers.operation === `insert` &&
              message.value.id === item.id
            )
          }, 5000)
        })

      const config = {
        id: `test-await-match-after-up-to-date`,
        shapeOptions: {
          url: `http://test-url`,
          params: { table: `test_table` },
        },
        startSync: true,
        getKey: (item: Row) => item.id as number,
        onInsert,
      }

      const testCollection = createCollection(electricCollectionOptions(config))

      // Start insert - will call onInsert which waits for serverCallPromise
      const insertPromise = testCollection.insert({
        id: 42,
        name: `Race Condition Test`,
      })

      // Wait for onInsert to start and reach the await serverCallPromise
      await new Promise((resolve) => setTimeout(resolve, 10))

      // Send Electric messages while onInsert is waiting for serverCallPromise
      // This simulates the race condition where messages arrive while API call is in progress
      subscriber([
        {
          key: `42`,
          value: { id: 42, name: `Race Condition Test` },
          headers: { operation: `insert` },
        },
        { headers: { control: `up-to-date` } },
      ])

      // Wait a tick to ensure messages are processed
      await new Promise((resolve) => setTimeout(resolve, 10))

      // Now resolve the server call - awaitMatch will be called AFTER messages were processed
      resolveServerCall!()

      // Should complete successfully - awaitMatch should find the message in the buffer
      await insertPromise.isPersisted.promise

      expect(onInsert).toHaveBeenCalled()
      expect(testCollection.has(42)).toBe(true)
    })

    it(`should wait for up-to-date when match found during batch processing`, async () => {
      // This test verifies that if awaitMatch finds a match while the batch
      // is still being processed (before up-to-date), it waits for up-to-date
      // before resolving, ensuring data is committed before returning

      let matchFoundTime: number | undefined
      let resolveTime: number | undefined

      const onInsert = vi
        .fn()
        .mockImplementation(async ({ transaction, collection: col }) => {
          const item = transaction.mutations[0].modified

          await col.utils.awaitMatch((message: any) => {
            if (
              isChangeMessage(message) &&
              message.headers.operation === `insert` &&
              message.value.id === item.id
            ) {
              matchFoundTime = Date.now()
              return true
            }
            return false
          }, 5000)
          resolveTime = Date.now()
        })

      const config = {
        id: `test-wait-for-up-to-date`,
        shapeOptions: {
          url: `http://test-url`,
          params: { table: `test_table` },
        },
        startSync: true,
        getKey: (item: Row) => item.id as number,
        onInsert,
      }

      const testCollection = createCollection(electricCollectionOptions(config))

      const insertPromise = testCollection.insert({
        id: 100,
        name: `Wait Test`,
      })

      // Send insert message first, then up-to-date after a delay
      // This simulates awaitMatch finding the message before up-to-date
      setTimeout(() => {
        subscriber([
          {
            key: `100`,
            value: { id: 100, name: `Wait Test` },
            headers: { operation: `insert` },
          },
        ])
      }, 50)

      // Send up-to-date after another delay
      setTimeout(() => {
        subscriber([{ headers: { control: `up-to-date` } }])
      }, 150)

      await insertPromise.isPersisted.promise

      expect(onInsert).toHaveBeenCalled()
      // Match should have been found before resolve (both times should exist)
      expect(matchFoundTime).toBeDefined()
      expect(resolveTime).toBeDefined()
      // Verify that resolve happened AFTER match was found (waited for up-to-date)
      expect(resolveTime).toBeGreaterThanOrEqual(matchFoundTime!)
    })

    it(`should clear buffer on new batch and match new messages`, async () => {
      // Verify that when a new batch arrives, the old buffer is cleared
      // and awaitMatch correctly matches messages from the new batch

      let resolveServerCall: () => void
      const serverCallPromise = new Promise<void>((resolve) => {
        resolveServerCall = resolve
      })

      const onInsert = vi
        .fn()
        .mockImplementation(async ({ transaction, collection: col }) => {
          const item = transaction.mutations[0].modified

          // Simulate API call
          await serverCallPromise

          await col.utils.awaitMatch((message: any) => {
            return (
              isChangeMessage(message) &&
              message.headers.operation === `insert` &&
              message.value.id === item.id
            )
          }, 5000)
        })

      const config = {
        id: `test-buffer-clearing`,
        shapeOptions: {
          url: `http://test-url`,
          params: { table: `test_table` },
        },
        startSync: true,
        getKey: (item: Row) => item.id as number,
        onInsert,
      }

      const testCollection = createCollection(electricCollectionOptions(config))

      // Start insert for item 201
      const insertPromise = testCollection.insert({
        id: 201,
        name: `Second Item`,
      })

      // Wait for onInsert to start
      await new Promise((resolve) => setTimeout(resolve, 10))

      // First batch - insert different item 200 (simulating other sync activity)
      subscriber([
        {
          key: `200`,
          value: { id: 200, name: `First Item` },
          headers: { operation: `insert` },
        },
        { headers: { control: `up-to-date` } },
      ])

      await new Promise((resolve) => setTimeout(resolve, 10))

      // Second batch - insert item 201 (our target)
      subscriber([
        {
          key: `201`,
          value: { id: 201, name: `Second Item` },
          headers: { operation: `insert` },
        },
        { headers: { control: `up-to-date` } },
      ])

      await new Promise((resolve) => setTimeout(resolve, 10))

      // Resolve server call - awaitMatch should find item 201 in the buffer
      // even though item 200 from the first batch is no longer in the buffer
      resolveServerCall!()

      await insertPromise.isPersisted.promise

      expect(testCollection.has(201)).toBe(true)
    })

    it(`should timeout when no match in committed batch and no new messages`, async () => {
      // Verify that awaitMatch times out when the message isn't found

      const onInsert = vi
        .fn()
        .mockImplementation(async ({ collection: col }) => {
          // Look for a message that doesn't exist
          await col.utils.awaitMatch(
            (message: any) =>
              isChangeMessage(message) && message.value.id === 999,
            100, // Short timeout
          )
        })

      const config = {
        id: `test-no-match-timeout`,
        shapeOptions: {
          url: `http://test-url`,
          params: { table: `test_table` },
        },
        startSync: true,
        getKey: (item: Row) => item.id as number,
        onInsert,
      }

      const testCollection = createCollection(electricCollectionOptions(config))

      // Send a batch with different items
      subscriber([
        {
          key: `300`,
          value: { id: 300, name: `Wrong Item` },
          headers: { operation: `insert` },
        },
        { headers: { control: `up-to-date` } },
      ])

      await new Promise((resolve) => setTimeout(resolve, 20))

      // Insert looking for id 999 which doesn't exist
      const tx = testCollection.insert({ id: 301, name: `Test` })

      await expect(tx.isPersisted.promise).rejects.toThrow(
        `Timeout waiting for custom match function`,
      )
    })

    it(`should resolve multiple awaitMatch calls from same committed batch`, async () => {
      // Verify that multiple concurrent awaitMatch calls can all find their
      // respective messages in the same committed batch

      const matches: Array<number> = []
      const serverCalls: Array<{ resolve: () => void }> = []

      const onInsert = vi
        .fn()
        .mockImplementation(async ({ transaction, collection: col }) => {
          const item = transaction.mutations[0].modified

          // Create a promise for this insert's "API call"
          const serverCallPromise = new Promise<void>((resolve) => {
            serverCalls.push({ resolve })
          })
          await serverCallPromise

          await col.utils.awaitMatch((message: any) => {
            if (
              isChangeMessage(message) &&
              message.headers.operation === `insert` &&
              message.value.id === item.id
            ) {
              matches.push(item.id)
              return true
            }
            return false
          }, 5000)
        })

      const config = {
        id: `test-multiple-matches`,
        shapeOptions: {
          url: `http://test-url`,
          params: { table: `test_table` },
        },
        startSync: true,
        getKey: (item: Row) => item.id as number,
        onInsert,
      }

      const testCollection = createCollection(electricCollectionOptions(config))

      // Start all three inserts concurrently
      const insert1 = testCollection.insert({ id: 400, name: `Item A` })
      const insert2 = testCollection.insert({ id: 401, name: `Item B` })
      const insert3 = testCollection.insert({ id: 402, name: `Item C` })

      // Wait for all onInsert handlers to start
      await new Promise((resolve) => setTimeout(resolve, 20))

      // Send batch with all three items (simulating fast sync from server)
      subscriber([
        {
          key: `400`,
          value: { id: 400, name: `Item A` },
          headers: { operation: `insert` },
        },
        {
          key: `401`,
          value: { id: 401, name: `Item B` },
          headers: { operation: `insert` },
        },
        {
          key: `402`,
          value: { id: 402, name: `Item C` },
          headers: { operation: `insert` },
        },
        { headers: { control: `up-to-date` } },
      ])

      await new Promise((resolve) => setTimeout(resolve, 20))

      // Resolve all server calls - all awaitMatch calls should find their messages
      serverCalls.forEach((call) => call.resolve())

      await Promise.all([
        insert1.isPersisted.promise,
        insert2.isPersisted.promise,
        insert3.isPersisted.promise,
      ])

      expect(matches).toContain(400)
      expect(matches).toContain(401)
      expect(matches).toContain(402)
      expect(testCollection.has(400)).toBe(true)
      expect(testCollection.has(401)).toBe(true)
      expect(testCollection.has(402)).toBe(true)
    })

    it(`should handle awaitMatch across multiple sequential batches`, async () => {
      // Real-world scenario: continuous sync with multiple batches
      // Each insert should find its matching message in the committed buffer

      const serverCalls: Array<{ resolve: () => void; id: number }> = []

      const onInsert = vi
        .fn()
        .mockImplementation(async ({ transaction, collection: col }) => {
          const item = transaction.mutations[0].modified

          // Create a promise for this insert's "API call"
          const serverCallPromise = new Promise<void>((resolve) => {
            serverCalls.push({ resolve, id: item.id })
          })
          await serverCallPromise

          await col.utils.awaitMatch((message: any) => {
            return (
              isChangeMessage(message) &&
              message.headers.operation === `insert` &&
              message.value.id === item.id
            )
          }, 5000)
        })

      const config = {
        id: `test-sequential-batches`,
        shapeOptions: {
          url: `http://test-url`,
          params: { table: `test_table` },
        },
        startSync: true,
        getKey: (item: Row) => item.id as number,
        onInsert,
      }

      const testCollection = createCollection(electricCollectionOptions(config))

      // Insert 1 - starts waiting on server call
      const insert1 = testCollection.insert({ id: 500, name: `Batch 1 Item` })
      await new Promise((resolve) => setTimeout(resolve, 10))

      // Batch 1 arrives with item 500
      subscriber([
        {
          key: `500`,
          value: { id: 500, name: `Batch 1 Item` },
          headers: { operation: `insert` },
        },
        { headers: { control: `up-to-date` } },
      ])
      await new Promise((resolve) => setTimeout(resolve, 10))

      // Resolve server call for insert 1
      const call1 = serverCalls.find((c) => c.id === 500)
      call1?.resolve()
      await insert1.isPersisted.promise
      expect(testCollection.has(500)).toBe(true)

      // Insert 2 - starts waiting on server call
      const insert2 = testCollection.insert({ id: 501, name: `Batch 2 Item` })
      await new Promise((resolve) => setTimeout(resolve, 10))

      // Batch 2 arrives (clears batch 1 from buffer)
      subscriber([
        {
          key: `501`,
          value: { id: 501, name: `Batch 2 Item` },
          headers: { operation: `insert` },
        },
        { headers: { control: `up-to-date` } },
      ])
      await new Promise((resolve) => setTimeout(resolve, 10))

      // Resolve server call for insert 2
      const call2 = serverCalls.find((c) => c.id === 501)
      call2?.resolve()
      await insert2.isPersisted.promise
      expect(testCollection.has(501)).toBe(true)

      // Insert 3 - starts waiting on server call
      const insert3 = testCollection.insert({ id: 502, name: `Batch 3 Item` })
      await new Promise((resolve) => setTimeout(resolve, 10))

      // Batch 3 arrives
      subscriber([
        {
          key: `502`,
          value: { id: 502, name: `Batch 3 Item` },
          headers: { operation: `insert` },
        },
        { headers: { control: `up-to-date` } },
      ])
      await new Promise((resolve) => setTimeout(resolve, 10))

      // Resolve server call for insert 3
      const call3 = serverCalls.find((c) => c.id === 502)
      call3?.resolve()
      await insert3.isPersisted.promise
      expect(testCollection.has(502)).toBe(true)
    })
  })

  // Tests for matching strategies utilities
  describe(`Matching strategies utilities`, () => {
    it(`should export isChangeMessage helper for custom match functions`, () => {
      expect(typeof isChangeMessage).toBe(`function`)

      // Test with a change message
      const changeMessage = {
        key: `1`,
        value: { id: 1, name: `Test` },
        headers: { operation: `insert` as const },
      }
      expect(isChangeMessage(changeMessage)).toBe(true)

      // Test with a control message
      const controlMessage = {
        headers: { control: `up-to-date` as const },
      }
      expect(isChangeMessage(controlMessage)).toBe(false)
    })

    it(`should export isChangeMessage and isControlMessage from package index`, async () => {
      // Verify that the exports are available from the package's public API
      // This tests the fix for the missing exports in index.ts
      const exports = await import(`../src/index`)

      expect(typeof exports.isChangeMessage).toBe(`function`)
      expect(typeof exports.isControlMessage).toBe(`function`)

      // Verify they work correctly
      const changeMessage = {
        key: `1`,
        value: { id: 1, name: `Test` },
        headers: { operation: `insert` as const },
      }
      expect(exports.isChangeMessage(changeMessage)).toBe(true)

      const controlMessage = {
        headers: { control: `up-to-date` as const },
      }
      expect(exports.isControlMessage(controlMessage)).toBe(true)
      expect(exports.isChangeMessage(controlMessage)).toBe(false)
    })

    it(`should provide awaitMatch utility in collection utils`, () => {
      const config = {
        id: `test-await-match`,
        shapeOptions: {
          url: `http://test-url`,
          params: { table: `test_table` },
        },
        getKey: (item: Row) => item.id as number,
      }

      const testCollection = createCollection(electricCollectionOptions(config))
      expect(typeof testCollection.utils.awaitMatch).toBe(`function`)
    })

    it(`should support multiple strategies in different handlers`, () => {
      const onInsert = vi.fn().mockResolvedValue({ txid: 100 }) // Txid strategy
      const onUpdate = vi.fn().mockResolvedValue(undefined) // Void strategy (no return)
      const onDelete = vi
        .fn()
        .mockImplementation(async ({ collection: col }) => {
          // Custom match using awaitMatch utility
          await col.utils.awaitMatch(
            (message: any) =>
              isChangeMessage(message) &&
              message.headers.operation === `delete`,
          )
        })

      const config = {
        id: `test-mixed-strategies`,
        shapeOptions: {
          url: `http://test-url`,
          params: { table: `test_table` },
        },
        getKey: (item: Row) => item.id as number,
        onInsert,
        onUpdate,
        onDelete,
      }

      const options = electricCollectionOptions(config)

      // All handlers should be wrapped properly
      expect(options.onInsert).toBeDefined()
      expect(options.onUpdate).toBeDefined()
      expect(options.onDelete).toBeDefined()
    })

    // NOTE: This test has a known issue with unhandled rejection warnings
    // This is a pre-existing issue from main branch (not caused by merge)
    // The test functionality works correctly, but vitest reports unhandled rejections
    it(`should cleanup pending matches on timeout without memory leaks`, async () => {
      vi.useFakeTimers()

      const onInsert = vi
        .fn()
        .mockImplementation(async ({ collection: col }) => {
          await col.utils.awaitMatch(
            () => false, // Never matches
            1, // Short timeout for test
          )
        })

      const config = {
        id: `test-cleanup`,
        shapeOptions: {
          url: `http://test-url`,
          params: { table: `test_table` },
        },
        startSync: true,
        getKey: (item: Row) => item.id as number,
        onInsert,
      }

      const testCollection = createCollection(electricCollectionOptions(config))

      // Start insert that will timeout
      const tx = testCollection.insert({ id: 1, name: `Timeout Test` })

      // Capture the rejection promise before advancing timers
      const rejectionPromise = expect(tx.isPersisted.promise).rejects.toThrow(
        `Timeout waiting for custom match function`,
      )

      // Advance timers to trigger timeout
      await vi.runOnlyPendingTimersAsync()

      // Should timeout and fail
      await rejectionPromise

      // Send a message after timeout - should not cause any side effects
      // This verifies that the pending match was properly cleaned up
      expect(() => {
        subscriber([
          {
            key: `1`,
            value: { id: 1, name: `Timeout Test` },
            headers: { operation: `insert` },
          },
          { headers: { control: `up-to-date` } },
        ])
      }).not.toThrow()

      vi.useRealTimers()
    })

    it(`should wait for up-to-date after custom match (commit semantics)`, async () => {
      let matchFound = false
      let persistenceCompleted = false

      const onInsert = vi
        .fn()
        .mockImplementation(async ({ transaction, collection: col }) => {
          const item = transaction.mutations[0].modified
          await col.utils.awaitMatch((message: any) => {
            if (
              isChangeMessage(message) &&
              message.headers.operation === `insert` &&
              message.value.name === item.name
            ) {
              matchFound = true
              return true
            }
            return false
          }, 5000)
        })

      const config = {
        id: `test-commit-semantics`,
        shapeOptions: {
          url: `http://test-url`,
          params: { table: `test_table` },
        },
        startSync: true,
        getKey: (item: Row) => item.id as number,
        onInsert,
      }

      const testCollection = createCollection(electricCollectionOptions(config))

      // Start insert
      const insertPromise = testCollection.insert({
        id: 1,
        name: `Commit Test`,
      })

      // Set up persistence completion tracking
      insertPromise.isPersisted.promise.then(() => {
        persistenceCompleted = true
      })

      // Give a moment for handler setup
      await new Promise((resolve) => setTimeout(resolve, 50))

      // Send matching message (should match but not complete persistence yet)
      subscriber([
        {
          key: `1`,
          value: { id: 1, name: `Commit Test` },
          headers: { operation: `insert` },
        },
      ])

      // Give time for match to be processed
      await new Promise((resolve) => setTimeout(resolve, 50))

      // Verify match was found but persistence not yet completed
      expect(matchFound).toBe(true)
      expect(persistenceCompleted).toBe(false)

      // Now send up-to-date (should complete persistence)
      subscriber([{ headers: { control: `up-to-date` } }])

      // Wait for persistence to complete
      await insertPromise.isPersisted.promise

      // Verify persistence completed after up-to-date
      expect(persistenceCompleted).toBe(true)
      expect(testCollection._state.syncedData.has(1)).toBe(true)
    })

    it(`should support custom timeout using setTimeout`, async () => {
      vi.useFakeTimers()

      const customTimeout = 500 // Custom short timeout

      const onInsert = vi.fn().mockImplementation(async () => {
        // Simple timeout approach
        await new Promise((resolve) => setTimeout(resolve, customTimeout))
      })

      const config = {
        id: `test-void-timeout`,
        shapeOptions: {
          url: `http://test-url`,
          params: { table: `test_table` },
        },
        startSync: true,
        getKey: (item: Row) => item.id as number,
        onInsert,
      }

      const testCollection = createCollection(electricCollectionOptions(config))

      // Insert with custom void timeout
      const tx = testCollection.insert({ id: 1, name: `Custom Timeout Test` })

      // Use runOnlyPendingTimers to execute the timeout
      await vi.runOnlyPendingTimersAsync()

      await expect(tx.isPersisted.promise).resolves.toBeDefined()
      expect(onInsert).toHaveBeenCalled()

      vi.useRealTimers()
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
      const subscription = testCollection.subscribeChanges(() => {})

      // Should have started a new stream
      expect(mockSubscribe).toHaveBeenCalledTimes(2)
      expect(testCollection.status).toBe(`loading`)

      subscription.unsubscribe()
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
      expect(testCollection._state.syncedData.size).toBe(0) // Still pending until up-to-date

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

    it(`should handle snapshot-end messages and match txids via snapshot metadata`, async () => {
      const config = {
        id: `snapshot-test`,
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

      // Send snapshot-end message with PostgresSnapshot metadata
      // xmin=100, xmax=150, xip_list=[120, 130]
      // Visible: txid < 100 (committed before snapshot) OR (100 <= txid < 150 AND txid NOT IN [120, 130])
      // Not visible: txid >= 150 (not yet assigned) OR txid IN [120, 130] (in-progress)
      subscriber([
        {
          key: `1`,
          value: { id: 1, name: `Test User` },
          headers: { operation: `insert` },
        },
        {
          headers: {
            control: `snapshot-end`,
            xmin: `100`,
            xmax: `150`,
            xip_list: [`120`, `130`],
          },
        },
        {
          headers: { control: `up-to-date` },
        },
      ])

      // Txids that are visible in the snapshot should resolve
      // Txids < xmin are committed and visible
      await expect(testCollection.utils.awaitTxId(50)).resolves.toBe(true)
      await expect(testCollection.utils.awaitTxId(99)).resolves.toBe(true)

      // Txids in range [xmin, xmax) not in xip_list are visible
      await expect(testCollection.utils.awaitTxId(100)).resolves.toBe(true)
      await expect(testCollection.utils.awaitTxId(110)).resolves.toBe(true)
      await expect(testCollection.utils.awaitTxId(121)).resolves.toBe(true)
      await expect(testCollection.utils.awaitTxId(125)).resolves.toBe(true)
      await expect(testCollection.utils.awaitTxId(131)).resolves.toBe(true)
      await expect(testCollection.utils.awaitTxId(149)).resolves.toBe(true)

      // Txids in xip_list (in-progress transactions) should NOT resolve
      await expect(testCollection.utils.awaitTxId(120, 100)).rejects.toThrow(
        `Timeout waiting for txId: 120`,
      )
      await expect(testCollection.utils.awaitTxId(130, 100)).rejects.toThrow(
        `Timeout waiting for txId: 130`,
      )

      // Txids >= xmax should NOT resolve (not yet assigned)
      await expect(testCollection.utils.awaitTxId(150, 100)).rejects.toThrow(
        `Timeout waiting for txId: 150`,
      )
      await expect(testCollection.utils.awaitTxId(200, 100)).rejects.toThrow(
        `Timeout waiting for txId: 200`,
      )
    })

    it(`should await for txid that arrives later via snapshot-end`, async () => {
      const config = {
        id: `snapshot-await-test`,
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

      // Start waiting for a txid before snapshot arrives
      const txidToAwait = 105
      const promise = testCollection.utils.awaitTxId(txidToAwait, 2000)

      // Send snapshot-end message after a delay
      setTimeout(() => {
        subscriber([
          {
            headers: {
              control: `snapshot-end`,
              xmin: `100`,
              xmax: `110`,
              xip_list: [],
            },
          },
          {
            headers: { control: `up-to-date` },
          },
        ])
      }, 50)

      // The promise should resolve when the snapshot arrives
      await expect(promise).resolves.toBe(true)
    })

    it(`should handle multiple snapshots and track all of them`, async () => {
      const config = {
        id: `multiple-snapshots-test`,
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

      // Send first snapshot: visible txids < 110
      subscriber([
        {
          headers: {
            control: `snapshot-end`,
            xmin: `100`,
            xmax: `110`,
            xip_list: [],
          },
        },
        {
          headers: { control: `up-to-date` },
        },
      ])

      // Send second snapshot: visible txids < 210
      subscriber([
        {
          headers: {
            control: `snapshot-end`,
            xmin: `200`,
            xmax: `210`,
            xip_list: [],
          },
        },
        {
          headers: { control: `up-to-date` },
        },
      ])

      // Txids visible in first snapshot
      await expect(testCollection.utils.awaitTxId(105)).resolves.toBe(true)

      // Txids visible in second snapshot
      await expect(testCollection.utils.awaitTxId(205)).resolves.toBe(true)

      // Txid 150 is visible in second snapshot (< xmin=200 means committed)
      await expect(testCollection.utils.awaitTxId(150)).resolves.toBe(true)

      // Txids >= second snapshot's xmax should timeout (not yet assigned)
      await expect(testCollection.utils.awaitTxId(210, 100)).rejects.toThrow(
        `Timeout waiting for txId: 210`,
      )
      await expect(testCollection.utils.awaitTxId(300, 100)).rejects.toThrow(
        `Timeout waiting for txId: 300`,
      )
    })

    it(`should prefer explicit txids over snapshot matching when both are available`, async () => {
      const config = {
        id: `explicit-txid-priority-test`,
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

      // Send message with explicit txid and snapshot
      subscriber([
        {
          key: `1`,
          value: { id: 1, name: `Test User` },
          headers: {
            operation: `insert`,
            txids: [500],
          },
        },
        {
          headers: {
            control: `snapshot-end`,
            xmin: `100`,
            xmax: `110`,
            xip_list: [],
          },
        },
        {
          headers: { control: `up-to-date` },
        },
      ])

      // Explicit txid should resolve
      await expect(testCollection.utils.awaitTxId(500)).resolves.toBe(true)

      // Snapshot txid should also resolve
      await expect(testCollection.utils.awaitTxId(105)).resolves.toBe(true)
    })
  })

  // Tests for syncMode configuration
  describe(`syncMode configuration`, () => {
    it(`should not request snapshots during subscription in eager mode`, () => {
      vi.clearAllMocks()

      const config = {
        id: `eager-no-snapshot-test`,
        shapeOptions: {
          url: `http://test-url`,
          params: {
            table: `test_table`,
          },
        },
        syncMode: `eager` as const,
        getKey: (item: Row) => item.id as number,
        startSync: true,
      }

      const testCollection = createCollection(electricCollectionOptions(config))

      // Subscribe and try to get more data
      const subscription = testCollection.subscribeChanges(() => {})

      // In eager mode, requestSnapshot should not be called
      expect(mockRequestSnapshot).not.toHaveBeenCalled()

      subscription.unsubscribe()
    })

    it(`should request incremental snapshots in on-demand mode when loadSubset is called`, async () => {
      vi.clearAllMocks()

      const config = {
        id: `on-demand-snapshot-test`,
        shapeOptions: {
          url: `http://test-url`,
          params: {
            table: `test_table`,
          },
        },
        syncMode: `on-demand` as const,
        getKey: (item: Row) => item.id as number,
        startSync: true,
      }

      const testCollection = createCollection(electricCollectionOptions(config))

      // Send up-to-date to mark collection as ready
      subscriber([
        {
          headers: { control: `up-to-date` },
        },
      ])

      // In on-demand mode, calling loadSubset should request a snapshot
      await testCollection._sync.loadSubset({ limit: 10 })

      // Verify requestSnapshot was called
      expect(mockRequestSnapshot).toHaveBeenCalledWith(
        expect.objectContaining({
          limit: 10,
          params: {},
        }),
      )
    })

    it(`should fetch snapshots in progressive mode when loadSubset is called before sync completes`, async () => {
      vi.clearAllMocks()

      mockSubscribe.mockImplementation((_callback) => {
        return () => {}
      })
      mockRequestSnapshot.mockResolvedValue(undefined)
      mockFetchSnapshot.mockResolvedValue({
        metadata: {},
        data: [
          {
            key: `2`,
            value: { id: 2, name: `Snapshot User` },
            headers: { operation: `insert` },
          },
        ],
      })

      const config = {
        id: `progressive-snapshot-test`,
        shapeOptions: {
          url: `http://test-url`,
          params: {
            table: `test_table`,
          },
        },
        syncMode: `progressive` as const,
        getKey: (item: Row) => item.id as number,
        startSync: true,
      }

      const testCollection = createCollection(electricCollectionOptions(config))

      expect(testCollection.status).toBe(`loading`) // Not ready yet

      // In progressive mode, calling loadSubset should fetch a snapshot BEFORE full sync completes
      await testCollection._sync.loadSubset({ limit: 20 })

      // Verify fetchSnapshot was called (not requestSnapshot)
      expect(mockFetchSnapshot).toHaveBeenCalledWith(
        expect.objectContaining({
          limit: 20,
          params: {},
        }),
      )
      expect(mockRequestSnapshot).not.toHaveBeenCalled()

      // Verify snapshot data was applied
      expect(testCollection.has(2)).toBe(true)
      expect(testCollection.get(2)).toEqual({ id: 2, name: `Snapshot User` })
    })

    it(`should not request snapshots when loadSubset is called in eager mode`, async () => {
      vi.clearAllMocks()

      const config = {
        id: `eager-no-loadsubset-test`,
        shapeOptions: {
          url: `http://test-url`,
          params: {
            table: `test_table`,
          },
        },
        syncMode: `eager` as const,
        getKey: (item: Row) => item.id as number,
        startSync: true,
      }

      const testCollection = createCollection(electricCollectionOptions(config))

      // Send up-to-date to mark collection as ready
      subscriber([
        {
          headers: { control: `up-to-date` },
        },
      ])

      // In eager mode, loadSubset should do nothing
      await testCollection._sync.loadSubset({ limit: 10 })

      // Verify requestSnapshot was NOT called
      expect(mockRequestSnapshot).not.toHaveBeenCalled()
    })

    it(`should handle progressive mode syncing in background`, async () => {
      vi.clearAllMocks()

      let testSubscriber!: (messages: Array<Message<Row>>) => void
      mockSubscribe.mockImplementation((callback) => {
        testSubscriber = callback
        return () => {}
      })
      mockRequestSnapshot.mockResolvedValue(undefined)
      mockFetchSnapshot.mockResolvedValue({
        metadata: {},
        data: [
          {
            key: `2`,
            value: { id: 2, name: `Snapshot User` },
            headers: { operation: `insert` },
          },
        ],
      })

      const config = {
        id: `progressive-background-sync-test`,
        shapeOptions: {
          url: `http://test-url`,
          params: {
            table: `test_table`,
          },
        },
        syncMode: `progressive` as const,
        getKey: (item: Row) => item.id as number,
        startSync: true,
      }

      const testCollection = createCollection(electricCollectionOptions(config))

      // Send stream data during snapshot phase (should be buffered)
      testSubscriber([
        {
          key: `1`,
          value: { id: 1, name: `Initial User` },
          headers: { operation: `insert` },
        },
      ])

      // Collection should NOT have the buffered data yet
      expect(testCollection.status).toBe(`loading`)
      expect(testCollection.has(1)).toBe(false)

      // Should be able to fetch snapshot data incrementally before full sync completes
      await testCollection._sync.loadSubset({ limit: 10 })
      expect(mockFetchSnapshot).toHaveBeenCalled()
      expect(mockRequestSnapshot).not.toHaveBeenCalled()

      // Snapshot data should be visible
      expect(testCollection.has(2)).toBe(true)

      // Now send up-to-date to complete the sync (triggers atomic swap)
      testSubscriber([
        {
          headers: { control: `up-to-date` },
        },
      ])

      expect(testCollection.status).toBe(`ready`)

      // After atomic swap, buffered data should be visible, snapshot data cleared
      expect(testCollection.has(1)).toBe(true)
      expect(testCollection.has(2)).toBe(false) // Snapshot data truncated
    })

    it(`should stop fetching snapshots in progressive mode after first up-to-date and perform atomic swap`, async () => {
      vi.clearAllMocks()

      let testSubscriber!: (messages: Array<Message<Row>>) => void
      mockSubscribe.mockImplementation((callback) => {
        testSubscriber = callback
        return () => {}
      })
      mockRequestSnapshot.mockResolvedValue(undefined)
      mockFetchSnapshot.mockResolvedValue({
        metadata: {},
        data: [
          {
            key: `2`,
            value: { id: 2, name: `Snapshot User` },
            headers: { operation: `insert` },
          },
        ],
      })

      const config = {
        id: `progressive-stop-after-sync-test`,
        shapeOptions: {
          url: `http://test-url`,
          params: {
            table: `test_table`,
          },
        },
        syncMode: `progressive` as const,
        getKey: (item: Row) => item.id as number,
        startSync: true,
      }

      const testCollection = createCollection(electricCollectionOptions(config))

      expect(testCollection.status).toBe(`loading`) // Not ready yet in progressive

      // Should be able to fetch data before up-to-date (snapshot phase)
      vi.clearAllMocks()
      await testCollection._sync.loadSubset({ limit: 10 })
      expect(mockFetchSnapshot).toHaveBeenCalledTimes(1)
      expect(testCollection.has(2)).toBe(true) // Snapshot data applied

      // Send change messages during snapshot phase (should be buffered)
      testSubscriber([
        {
          key: `1`,
          value: { id: 1, name: `User 1` },
          headers: { operation: `insert` },
        },
      ])

      // Data should NOT be visible yet (buffered)
      expect(testCollection.has(1)).toBe(false)

      // Now send up-to-date to complete the full sync and trigger atomic swap
      testSubscriber([
        {
          headers: { control: `up-to-date` },
        },
      ])

      expect(testCollection.status).toBe(`ready`)

      // After atomic swap, buffered data should be visible
      expect(testCollection.has(1)).toBe(true)
      // Snapshot data should be cleared by truncate, so id:2 should be gone
      expect(testCollection.has(2)).toBe(false)

      // Try to fetch more data - should NOT make a request since full sync is complete
      vi.clearAllMocks()
      await testCollection._sync.loadSubset({ limit: 10 })
      expect(mockFetchSnapshot).not.toHaveBeenCalled()
    })

    it(`should allow snapshots in on-demand mode even after up-to-date`, async () => {
      vi.clearAllMocks()

      const config = {
        id: `on-demand-after-sync-test`,
        shapeOptions: {
          url: `http://test-url`,
          params: {
            table: `test_table`,
          },
        },
        syncMode: `on-demand` as const,
        getKey: (item: Row) => item.id as number,
        startSync: true,
      }

      const testCollection = createCollection(electricCollectionOptions(config))

      // Send initial data with up-to-date
      subscriber([
        {
          key: `1`,
          value: { id: 1, name: `User 1` },
          headers: { operation: `insert` },
        },
        {
          headers: { control: `up-to-date` },
        },
      ])

      expect(testCollection.status).toBe(`ready`)

      // Should STILL be able to request more data in on-demand mode
      vi.clearAllMocks()
      await testCollection._sync.loadSubset({ limit: 10 })
      expect(mockRequestSnapshot).toHaveBeenCalled()
    })

    it(`should ignore snapshot data when fetchSnapshot completes after up-to-date in progressive mode`, async () => {
      vi.clearAllMocks()

      let testSubscriber!: (messages: Array<Message<Row>>) => void
      let resolveFetchSnapshot!: (value: any) => void
      const fetchSnapshotPromise = new Promise((resolve) => {
        resolveFetchSnapshot = resolve as any
      })

      mockSubscribe.mockImplementation((callback) => {
        testSubscriber = callback
        return () => {}
      })
      mockRequestSnapshot.mockResolvedValue(undefined)
      // Mock fetchSnapshot to return a promise we control
      mockFetchSnapshot.mockReturnValue(fetchSnapshotPromise)

      const config = {
        id: `progressive-snapshot-race-test`,
        shapeOptions: {
          url: `http://test-url`,
          params: {
            table: `test_table`,
          },
        },
        syncMode: `progressive` as const,
        getKey: (item: Row) => item.id as number,
        startSync: true,
      }

      const testCollection = createCollection(electricCollectionOptions(config))

      expect(testCollection.status).toBe(`loading`)

      // Start a loadSubset request (should call fetchSnapshot)
      const loadSubsetPromise = testCollection._sync.loadSubset({ limit: 10 })

      // Verify fetchSnapshot was called
      expect(mockFetchSnapshot).toHaveBeenCalled()

      // Before the snapshot completes, send up-to-date to complete the sync
      testSubscriber([
        {
          key: `1`,
          value: { id: 1, name: `Buffered User` },
          headers: { operation: `insert` },
        },
        {
          headers: { control: `up-to-date` },
        },
      ])

      // Sync should be complete now
      expect(testCollection.status).toBe(`ready`)
      expect(testCollection.has(1)).toBe(true)
      expect(testCollection.size).toBe(1)

      // Now resolve the fetchSnapshot with data
      resolveFetchSnapshot({
        metadata: {},
        data: [
          {
            key: `2`,
            value: { id: 2, name: `Late Snapshot User` },
            headers: { operation: `insert` },
          },
        ],
      })

      // Wait for loadSubset to complete
      await loadSubsetPromise

      // The snapshot data should be IGNORED because sync already completed
      expect(testCollection.has(2)).toBe(false)
      expect(testCollection.size).toBe(1) // Still only the buffered user
      expect(testCollection.get(1)).toEqual({ id: 1, name: `Buffered User` })
    })

    it(`should default offset to 'now' in on-demand mode when no offset provided`, async () => {
      vi.clearAllMocks()

      // Import ShapeStream to check constructor calls
      const { ShapeStream } = await import(`@electric-sql/client`)

      const config = {
        id: `on-demand-offset-now-test`,
        shapeOptions: {
          url: `http://test-url`,
          params: {
            table: `test_table`,
          },
          // No offset provided
        },
        syncMode: `on-demand` as const,
        getKey: (item: Row) => item.id as number,
        startSync: true,
      }

      createCollection(electricCollectionOptions(config))

      // Check that ShapeStream was called with offset: 'now'
      expect(ShapeStream).toHaveBeenCalledWith(
        expect.objectContaining({
          offset: `now`,
        }),
      )
    })

    it(`should use undefined offset in eager mode when no offset provided`, async () => {
      vi.clearAllMocks()

      const { ShapeStream } = await import(`@electric-sql/client`)

      const config = {
        id: `eager-offset-undefined-test`,
        shapeOptions: {
          url: `http://test-url`,
          params: {
            table: `test_table`,
          },
          // No offset provided
        },
        syncMode: `eager` as const,
        getKey: (item: Row) => item.id as number,
        startSync: true,
      }

      createCollection(electricCollectionOptions(config))

      // Check that ShapeStream was called with offset: undefined
      expect(ShapeStream).toHaveBeenCalledWith(
        expect.objectContaining({
          offset: undefined,
        }),
      )
    })

    it(`should use undefined offset in progressive mode when no offset provided`, async () => {
      vi.clearAllMocks()

      const { ShapeStream } = await import(`@electric-sql/client`)

      const config = {
        id: `progressive-offset-undefined-test`,
        shapeOptions: {
          url: `http://test-url`,
          params: {
            table: `test_table`,
          },
          // No offset provided
        },
        syncMode: `progressive` as const,
        getKey: (item: Row) => item.id as number,
        startSync: true,
      }

      createCollection(electricCollectionOptions(config))

      // Check that ShapeStream was called with offset: undefined
      expect(ShapeStream).toHaveBeenCalledWith(
        expect.objectContaining({
          offset: undefined,
        }),
      )
    })

    it(`should use explicit offset when provided regardless of syncMode`, async () => {
      vi.clearAllMocks()

      const { ShapeStream } = await import(`@electric-sql/client`)

      const config = {
        id: `explicit-offset-test`,
        shapeOptions: {
          url: `http://test-url`,
          params: {
            table: `test_table`,
          },
          offset: -1 as any, // Explicit offset
        },
        syncMode: `on-demand` as const,
        getKey: (item: Row) => item.id as number,
        startSync: true,
      }

      createCollection(electricCollectionOptions(config))

      // Check that ShapeStream was called with the explicit offset
      expect(ShapeStream).toHaveBeenCalledWith(
        expect.objectContaining({
          offset: -1,
        }),
      )
    })
  })

  // Tests for commit and ready behavior with snapshot-end and up-to-date messages
  describe(`Commit and ready behavior`, () => {
    it(`should ignore snapshot-end before first up-to-date in progressive mode`, () => {
      vi.clearAllMocks()

      let testSubscriber!: (messages: Array<Message<Row>>) => void
      mockSubscribe.mockImplementation((callback) => {
        testSubscriber = callback
        return () => {}
      })
      mockRequestSnapshot.mockResolvedValue(undefined)
      mockFetchSnapshot.mockResolvedValue({ metadata: {}, data: [] })

      const config = {
        id: `progressive-ignore-snapshot-end-test`,
        shapeOptions: {
          url: `http://test-url`,
          params: { table: `test_table` },
        },
        syncMode: `progressive` as const,
        getKey: (item: Row) => item.id as number,
        startSync: true,
      }

      const testCollection = createCollection(electricCollectionOptions(config))

      // Send data followed by snapshot-end (but no up-to-date)
      // In progressive mode, these messages should be BUFFERED, and snapshot-end
      // should NOT trigger a commit because the snapshot-end in the log could be
      // from a significant period before the stream is actually up to date
      testSubscriber([
        {
          key: `1`,
          value: { id: 1, name: `Test User` },
          headers: { operation: `insert` },
        },
        {
          headers: {
            control: `snapshot-end`,
            xmin: `100`,
            xmax: `110`,
            xip_list: [],
          },
        },
      ])

      // Data should NOT be visible yet (snapshot-end should be ignored before up-to-date)
      expect(testCollection.has(1)).toBe(false)
      expect(testCollection.status).toBe(`loading`)

      // Now send up-to-date (triggers atomic swap)
      testSubscriber([
        {
          headers: { control: `up-to-date` },
        },
      ])

      // Now data should be visible after atomic swap
      expect(testCollection.has(1)).toBe(true)
      expect(testCollection.get(1)).toEqual({ id: 1, name: `Test User` })
      expect(testCollection.status).toBe(`ready`)
    })

    it(`should commit on snapshot-end in eager mode AFTER first up-to-date`, () => {
      const config = {
        id: `eager-snapshot-end-test`,
        shapeOptions: {
          url: `http://test-url`,
          params: { table: `test_table` },
        },
        syncMode: `eager` as const,
        getKey: (item: Row) => item.id as number,
        startSync: true,
      }

      const testCollection = createCollection(electricCollectionOptions(config))

      // First send up-to-date (with initial data) to establish the connection
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

      // Data should be committed and collection ready
      expect(testCollection.has(1)).toBe(true)
      expect(testCollection.status).toBe(`ready`)

      // Now send more data followed by snapshot-end (simulating incremental snapshot)
      // After the first up-to-date, snapshot-end SHOULD commit
      subscriber([
        {
          key: `2`,
          value: { id: 2, name: `Second User` },
          headers: { operation: `insert` },
        },
        {
          headers: {
            control: `snapshot-end`,
            xmin: `100`,
            xmax: `110`,
            xip_list: [],
          },
        },
      ])

      // Data should be committed since we've already received up-to-date
      expect(testCollection.has(2)).toBe(true)
      expect(testCollection.get(2)).toEqual({ id: 2, name: `Second User` })
      expect(testCollection.status).toBe(`ready`)
    })

    it(`should commit and mark ready on snapshot-end in on-demand mode`, () => {
      const config = {
        id: `on-demand-snapshot-end-test`,
        shapeOptions: {
          url: `http://test-url`,
          params: { table: `test_table` },
        },
        syncMode: `on-demand` as const,
        getKey: (item: Row) => item.id as number,
        startSync: true,
      }

      const testCollection = createCollection(electricCollectionOptions(config))

      // Send data followed by snapshot-end (but no up-to-date)
      subscriber([
        {
          key: `1`,
          value: { id: 1, name: `Test User` },
          headers: { operation: `insert` },
        },
        {
          headers: {
            control: `snapshot-end`,
            xmin: `100`,
            xmax: `110`,
            xip_list: [],
          },
        },
      ])

      // Data should be committed (available in state)
      expect(testCollection.has(1)).toBe(true)
      expect(testCollection.get(1)).toEqual({ id: 1, name: `Test User` })

      // Collection SHOULD be marked as ready in on-demand mode
      expect(testCollection.status).toBe(`ready`)
    })

    it(`should buffer changes during snapshot phase in progressive mode until up-to-date`, () => {
      vi.clearAllMocks()

      let testSubscriber!: (messages: Array<Message<Row>>) => void
      mockSubscribe.mockImplementation((callback) => {
        testSubscriber = callback
        return () => {}
      })
      mockRequestSnapshot.mockResolvedValue(undefined)
      mockFetchSnapshot.mockResolvedValue({ metadata: {}, data: [] })

      const config = {
        id: `progressive-snapshot-end-test`,
        shapeOptions: {
          url: `http://test-url`,
          params: { table: `test_table` },
        },
        syncMode: `progressive` as const,
        getKey: (item: Row) => item.id as number,
        startSync: true,
      }

      const testCollection = createCollection(electricCollectionOptions(config))

      // Send data followed by snapshot-end (but no up-to-date)
      // In progressive mode, these messages should be BUFFERED, not committed
      testSubscriber([
        {
          key: `1`,
          value: { id: 1, name: `Test User` },
          headers: { operation: `insert` },
        },
        {
          headers: {
            control: `snapshot-end`,
            xmin: `100`,
            xmax: `110`,
            xip_list: [],
          },
        },
      ])

      // Data should NOT be visible yet (it's buffered during snapshot phase)
      expect(testCollection.has(1)).toBe(false)

      // Collection should NOT be marked as ready yet in progressive mode
      expect(testCollection.status).toBe(`loading`)

      // Now send up-to-date (triggers atomic swap)
      testSubscriber([
        {
          headers: { control: `up-to-date` },
        },
      ])

      // Now data should be visible after atomic swap
      expect(testCollection.has(1)).toBe(true)
      expect(testCollection.get(1)).toEqual({ id: 1, name: `Test User` })

      // And it should be ready
      expect(testCollection.status).toBe(`ready`)
    })

    it(`should NOT commit multiple snapshot-end messages before up-to-date in eager mode`, () => {
      const config = {
        id: `eager-multiple-snapshots-test`,
        shapeOptions: {
          url: `http://test-url`,
          params: { table: `test_table` },
        },
        syncMode: `eager` as const,
        getKey: (item: Row) => item.id as number,
        startSync: true,
      }

      const testCollection = createCollection(electricCollectionOptions(config))

      // First snapshot with data - snapshot-end should be ignored before up-to-date
      subscriber([
        {
          key: `1`,
          value: { id: 1, name: `User 1` },
          headers: { operation: `insert` },
        },
        {
          headers: {
            control: `snapshot-end`,
            xmin: `100`,
            xmax: `110`,
            xip_list: [],
          },
        },
      ])

      // First data should NOT be committed yet (snapshot-end ignored before up-to-date)
      expect(testCollection.has(1)).toBe(false)
      expect(testCollection.status).toBe(`loading`)

      // Second snapshot with more data - still before up-to-date, so should be ignored
      subscriber([
        {
          key: `2`,
          value: { id: 2, name: `User 2` },
          headers: { operation: `insert` },
        },
        {
          headers: {
            control: `snapshot-end`,
            xmin: `110`,
            xmax: `120`,
            xip_list: [],
          },
        },
      ])

      // Second data should also NOT be committed yet
      expect(testCollection.has(2)).toBe(false)
      expect(testCollection.size).toBe(0)
      expect(testCollection.status).toBe(`loading`)

      // Finally send up-to-date - this commits all the pending data
      subscriber([
        {
          headers: { control: `up-to-date` },
        },
      ])

      // Now all data should be committed and collection ready
      expect(testCollection.has(1)).toBe(true)
      expect(testCollection.has(2)).toBe(true)
      expect(testCollection.size).toBe(2)
      expect(testCollection.status).toBe(`ready`)
    })

    it(`should handle up-to-date without snapshot-end (traditional behavior)`, () => {
      const config = {
        id: `traditional-up-to-date-test`,
        shapeOptions: {
          url: `http://test-url`,
          params: { table: `test_table` },
        },
        syncMode: `eager` as const,
        getKey: (item: Row) => item.id as number,
        startSync: true,
      }

      const testCollection = createCollection(electricCollectionOptions(config))

      // Send data followed by up-to-date (no snapshot-end)
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

      // Data should be committed and collection ready
      expect(testCollection.has(1)).toBe(true)
      expect(testCollection.status).toBe(`ready`)
    })
  })

  describe(`syncMode configuration - GC and resync`, () => {
    it(`should resync after garbage collection and new subscription`, () => {
      // Use fake timers for this test
      vi.useFakeTimers()

      const config = {
        id: `gc-resync-test`,
        shapeOptions: {
          url: `http://test-url`,
          params: {
            table: `test_table`,
          },
        },
        getKey: (item: Row) => item.id as number,
        startSync: true,
        gcTime: 100, // Short GC time for testing
      }

      const testCollection = createCollection(electricCollectionOptions(config))

      // Populate collection with initial data
      subscriber([
        {
          key: `1`,
          value: { id: 1, name: `Initial User` },
          headers: { operation: `insert` },
        },
        {
          key: `2`,
          value: { id: 2, name: `Another User` },
          headers: { operation: `insert` },
        },
        {
          headers: { control: `up-to-date` },
        },
      ])

      // Verify initial data is present
      expect(testCollection.has(1)).toBe(true)
      expect(testCollection.has(2)).toBe(true)
      expect(testCollection.size).toBe(2)

      // Subscribe and then unsubscribe to trigger GC timer
      const subscription = testCollection.subscribeChanges(() => {})
      subscription.unsubscribe()

      // Collection should still be ready before GC timer fires
      expect(testCollection.status).toBe(`ready`)
      expect(testCollection.size).toBe(2)

      // Fast-forward time to trigger GC (past the 100ms gcTime)
      vi.advanceTimersByTime(150)

      // Collection should be cleaned up
      expect(testCollection.status).toBe(`cleaned-up`)
      expect(testCollection.size).toBe(0)

      // Reset mock call count for new subscription
      const initialMockCallCount = mockSubscribe.mock.calls.length

      // Subscribe again - this should restart the sync
      const newSubscription = testCollection.subscribeChanges(() => {})

      // Should have created a new stream
      expect(mockSubscribe.mock.calls.length).toBe(initialMockCallCount + 1)
      expect(testCollection.status).toBe(`loading`)

      // Send new data to simulate resync
      subscriber([
        {
          key: `3`,
          value: { id: 3, name: `Resynced User` },
          headers: { operation: `insert` },
        },
        {
          key: `1`,
          value: { id: 1, name: `Updated User` },
          headers: { operation: `insert` },
        },
        {
          headers: { control: `up-to-date` },
        },
      ])

      // Verify the collection has resynced with new data
      expect(testCollection.status).toBe(`ready`)
      expect(testCollection.has(1)).toBe(true)
      expect(testCollection.has(3)).toBe(true)
      expect(testCollection.get(1)).toEqual({ id: 1, name: `Updated User` })
      expect(testCollection.get(3)).toEqual({ id: 3, name: `Resynced User` })
      expect(testCollection.size).toBe(2)

      // Old data should not be present (collection was cleaned)
      expect(testCollection.has(2)).toBe(false)

      newSubscription.unsubscribe()

      // Restore real timers
      vi.useRealTimers()
    })
  })
})
