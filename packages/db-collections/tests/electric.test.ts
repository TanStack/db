import { beforeEach, describe, expect, it, vi } from "vitest"
import { Collection, createTransaction } from "@tanstack/db"
import { electricCollectionOptions } from "../src/electric"
import type {
  MutationFnParams,
  PendingMutation,
  Transaction,
} from "@tanstack/db"
import type { Message, Row } from "@electric-sql/client"

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
  let collection: Collection<Row>
  let awaitTxId: (txId: string, timeout?: number) => Promise<boolean>
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
      getKey: (item: Row) => item.id,
    }

    const { options, awaitTxId: txIdFn } = electricCollectionOptions(config)
    collection = new Collection(options)
    awaitTxId = txIdFn
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

    // Send up-to-date control message to commit transaction
    subscriber([
      {
        headers: { control: `up-to-date` },
      },
    ])

    expect(collection.state).toEqual(
      new Map([[`KEY::${collection.id}/1`, { id: 1, name: `Test User` }]])
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

    // Send up-to-date to commit all changes
    subscriber([
      {
        headers: { control: `up-to-date` },
      },
    ])

    expect(collection.state).toEqual(
      new Map([
        [`KEY::${collection.id}/1`, { id: 1, name: `Test User` }],
        [`KEY::${collection.id}/2`, { id: 2, name: `Another User` }],
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
      new Map([[`KEY::${collection.id}/1`, { id: 1, name: `Updated User` }]])
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
        value: { id: `1` },
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
      const testTxid = `123`

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

      // The txid should be tracked and awaitTxId should resolve immediately
      await expect(awaitTxId(testTxid)).resolves.toBe(true)
    })

    it(`should track multiple txids`, async () => {
      const txid1 = `100`
      const txid2 = `200`

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
      await expect(awaitTxId(txid1)).resolves.not.toThrow()
      await expect(awaitTxId(txid2)).resolves.not.toThrow()
    })

    it(`should reject with timeout when waiting for unknown txid`, async () => {
      // Set a short timeout for the test
      const unknownTxid = `0`
      const shortTimeout = 100

      // Attempt to await a txid that hasn't been seen with a short timeout
      const promise = awaitTxId(unknownTxid, shortTimeout)

      // The promise should reject with a timeout error
      await expect(promise).rejects.toThrow(
        `Timeout waiting for txId: ${unknownTxid}`
      )
    })

    it(`should resolve when a txid arrives after awaitTxId is called`, async () => {
      const laterTxid = `1000`

      // Start waiting for a txid that hasn't arrived yet
      const promise = awaitTxId(laterTxid, 1000)

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
        data: new Map<string, { txid: string; value: unknown }>(),
        // Simulates persisting data to a backend and returning a txid
        persist: (mutations: Array<PendingMutation>): Promise<string> => {
          const txid = String(Date.now())

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
        simulateSyncMessage: (txid: string) => {
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
          const txid = await fakeBackend.persist(transaction.mutations)

          if (!txid) {
            throw new Error(`No txid found`)
          }

          // Start waiting for the txid
          const promise = awaitTxId(txid, 1000)

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

      transaction = collection.transactions.state.get(transaction.id)!

      // Verify the mutation function was called correctly
      expect(testMutationFn).toHaveBeenCalledTimes(1)

      // Check that the data was added to the collection
      // Note: In a real implementation, the collection would be updated by the sync process
      // This is just verifying our test setup worked correctly
      expect(fakeBackend.data.has(`KEY::${collection.id}/1`)).toBe(true)
      expect(collection.state.has(`KEY::${collection.id}/1`)).toBe(true)
    })
  })

  // Tests for direct persistence handlers
  describe(`Direct persistence handlers`, () => {
    it(`should pass through direct persistence handlers to collection options`, () => {
      // Create mock handlers
      const onInsert = vi.fn().mockResolvedValue({ txid: `123` })
      const onUpdate = vi.fn().mockResolvedValue({ txid: `456` })
      const onDelete = vi.fn().mockResolvedValue({ txid: `789` })

      const config = {
        id: `test-handlers`,
        shapeOptions: {
          url: `http://test-url`,
          params: {
            table: `test_table`,
          },
        },
        getKey: (item: Row) => item.id,
        onInsert,
        onUpdate,
        onDelete,
      }

      const { options } = electricCollectionOptions(config)

      // Verify that the handlers were passed to the collection options
      expect(options.onInsert).toBeDefined()
      expect(options.onUpdate).toBeDefined()
      expect(options.onDelete).toBeDefined()
    })

    it(`should throw an error if handler doesn't return a txid`, async () => {
      // Create a mock transaction for testing
      const mockTransaction = { id: `test-transaction` } as Transaction
      const mockParams: MutationFnParams = { transaction: mockTransaction }

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
        getKey: (item: Row) => item.id,
        onInsert,
      }

      const { options } = electricCollectionOptions(config)

      // Call the wrapped handler and expect it to throw
      await expect(options.onInsert!(mockParams)).rejects.toThrow(
        `Electric collection onInsert handler must return a txid`
      )
    })

    // We no longer need to test for invalid txid format since we're using strings directly

    it(`should simulate complete flow with direct persistence handlers`, async () => {
      // Create a fake backend store to simulate server-side storage
      const fakeBackend = {
        data: new Map<string, { txid: string; value: unknown }>(),
        // Simulates persisting data to a backend and returning a txid
        persist: (mutations: Array<PendingMutation>): Promise<string> => {
          const txid = String(Date.now())

          // Store the changes with the txid
          mutations.forEach((mutation) => {
            const key = mutation.key
            fakeBackend.data.set(key, { txid, value: mutation.changes })
          })

          return Promise.resolve(txid)
        },
        // Simulates the server sending sync messages with txids
        simulateSyncMessage: (txid: string) => {
          // Create messages for each item in the store that has this txid
          const messages: Array<Message<Row>> = []

          fakeBackend.data.forEach((value, key) => {
            if (value.txid === txid) {
              messages.push({
                key,
                value: value.value as Row,
                headers: {
                  operation: `insert`,
                  txids: [Number(txid)], // Convert to number as the API expects numbers but our code converts to strings
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
      const mutationFn = vi.fn(async (params: MutationFnParams) => {
        const txid = await fakeBackend.persist(params.transaction.mutations)

        // Simulate server sending sync message after a delay
        setTimeout(() => {
          fakeBackend.simulateSyncMessage(txid)
        }, 50)

        return txid
      })

      // Create direct persistence handler that returns the txid
      const onInsert = vi.fn(async (params: MutationFnParams) => {
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
        getKey: (item: Row) => item.id,
        onInsert,
      }

      const { options } = electricCollectionOptions(config)
      const testCollection = new Collection(options)

      // Insert data using the transaction
      const tx = testCollection.insert({
        id: 1,
        name: `Direct Persistence User`,
      })

      // If awaitTxId wasn't called automatically, this wouldn't be true.
      expect(testCollection.syncedData.state.size).toEqual(0)
      expect(
        testCollection.optimisticOperations.state.filter((o) => o.isActive)
          .length
      ).toEqual(1)

      // Verify that our onInsert handler was called
      expect(onInsert).toHaveBeenCalled()

      await tx.isPersisted.promise

      // Verify that the data was added to the collection via the sync process
      expect(testCollection.state.has(`KEY::${testCollection.id}/1`)).toBe(true)
      expect(testCollection.state.get(`KEY::${testCollection.id}/1`)).toEqual({
        id: 1,
        name: `Direct Persistence User`,
      })
      expect(testCollection.syncedData.state.size).toEqual(1)
      expect(
        testCollection.optimisticOperations.state.filter((o) => o.isActive)
          .length
      ).toEqual(0)
    })
  })
})
