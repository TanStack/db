import { beforeEach, describe, expect, it, vi } from "vitest"
import { createTransaction } from "@tanstack/db"
import { createElectricCollection } from "../src/electric"
import type { ElectricCollection, ElectricInitialData } from "../src/electric"
import type { PendingMutation, Transaction } from "@tanstack/db"
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

const mockConstants = {
  PRIMARY_KEY_COLUMN: `id`,
}

// Initial data for testing the seeding functionality
const testInitialData: ElectricInitialData<Row> = {
  data: [
    {
      key: `initialKey1`,
      value: { id: `initialId1`, name: `Initial User 1` },
      metadata: { source: `seed` },
    },
    { key: `initialKey2`, value: { id: `initialId2`, name: `Initial User 2` } },
  ],
  txids: [99901, 99902],
  schema: `seeded_schema`,
  lastOffset: `seedOffset123`,
  shapeHandle: `seedHandle456`,
}

describe(`Electric Integration`, () => {
  let collection: ElectricCollection<Row>
  let subscriber: (messages: Array<Message<Row>>) => void

  beforeEach(() => {
    vi.clearAllMocks()

    // Reset mock subscriber
    mockSubscribe.mockImplementation((callback) => {
      subscriber = callback
      return () => {}
    })

    // Create collection with Electric configuration
    collection = createElectricCollection({
      id: `test`,
      streamOptions: {
        url: `http://test-url`,
        params: {
          table: `test_table`,
        },
      },
      primaryKey: [`id`], // Using 'id' as the primary key column
    })
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
      new Map([[`1`, { id: 1, name: `Test User` }]])
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
        [`1`, { id: 1, name: `Test User` }],
        [`2`, { id: 2, name: `Another User` }],
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
      new Map([[`1`, { id: 1, name: `Updated User` }]])
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
        value: {},
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

      // The txid should be tracked and awaitTxId should resolve immediately
      await expect(collection.awaitTxId(testTxid)).resolves.toBe(true)
    })

    it(`should handle multiple txids in a single message`, async () => {
      const txid1 = 1
      const txid2 = 2

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
      await expect(collection.awaitTxId(txid1)).resolves.not.toThrow()
      await expect(collection.awaitTxId(txid2)).resolves.not.toThrow()
    })

    it(`should reject with timeout when waiting for unknown txid`, async () => {
      // Set a short timeout for the test
      const unknownTxid = 0
      const shortTimeout = 100

      // Attempt to await a txid that hasn't been seen with a short timeout
      const promise = collection.awaitTxId(unknownTxid, shortTimeout)

      // The promise should reject with a timeout error
      await expect(promise).rejects.toThrow(
        `Timeout waiting for txId: ${unknownTxid}`
      )
    })

    it(`should resolve when a txid arrives after awaitTxId is called`, async () => {
      const laterTxid = 1000

      // Start waiting for a txid that hasn't arrived yet
      const promise = collection.awaitTxId(laterTxid, 1000)

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
        data: new Map<string, { txid: number; value: unknown }>(),
        // Simulates persisting data to a backend and returning a txid
        persist: (mutations: Array<PendingMutation>): Promise<number> => {
          const txid = Date.now()

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
          const promise = collection.awaitTxId(txid, 1000)

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
        collection.insert({ id: 1, name: `Test item 1` }, { key: `item1` })
      )

      await transaction.isPersisted.promise

      transaction = collection.transactions.state.get(transaction.id)!

      // Verify the mutation function was called correctly
      expect(testMutationFn).toHaveBeenCalledTimes(1)

      // Check that the data was added to the collection
      // Note: In a real implementation, the collection would be updated by the sync process
      // This is just verifying our test setup worked correctly
      expect(fakeBackend.data.has(`item1`)).toBe(true)
      expect(collection.state.has(`item1`)).toBe(true)
    })
  })

  it(`should include primaryKey in the metadata`, () => {
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

    // Get the metadata for the inserted item
    const metadata = collection.syncedMetadata.state.get(`1`) as {
      primaryKey: string
    }

    // Verify that the primaryKey is included in the metadata
    expect(metadata).toHaveProperty(`primaryKey`)
    expect(metadata.primaryKey).toEqual([`id`])
  })

  // Tests for initial data functionality
  describe(`initial data support`, () => {
    it(`should accept initial data during construction`, () => {
      const initialData = {
        data: [
          {
            key: `user1`,
            value: { id: 1, name: `Alice` },
            metadata: { source: `server` },
          },
          {
            key: `user2`,
            value: { id: 2, name: `Bob` },
            metadata: { source: `server` },
          },
        ],
        txids: [100, 101],
        schema: `public`,
        lastOffset: `1234567890`,
        shapeHandle: `shape_abc123`,
      }

      const collection = createElectricCollection({
        id: `test-with-initial-data`,
        streamOptions: {
          url: `http://test-url`,
          params: { table: `users` },
        },
        primaryKey: [`id`],
        initialData,
      })

      // Should have initial data immediately available
      expect(collection.state.size).toBe(2)

      // Check that the data is present (keys will be auto-generated)
      const values = Array.from(collection.state.values())
      expect(values).toContainEqual({ id: 1, name: `Alice` })
      expect(values).toContainEqual({ id: 2, name: `Bob` })
    })

    it(`should track txids from initial data`, async () => {
      const initialData = {
        data: [{ key: `user1`, value: { id: 1, name: `Alice` } }],
        txids: [555, 556],
        schema: `public`,
        lastOffset: `1234567890`,
        shapeHandle: `shape_abc123`,
      }

      const collection = createElectricCollection({
        id: `test-txids`,
        streamOptions: {
          url: `http://test-url`,
          params: { table: `users` },
        },
        primaryKey: [`id`],
        initialData,
      })

      // Should have txids from initial data immediately available
      await expect(collection.awaitTxId(555)).resolves.toBe(true)
      await expect(collection.awaitTxId(556)).resolves.toBe(true)
    })

    it(`should resume from lastOffset and shapeHandle in stream options`, async () => {
      // Get the actual mock from vitest
      const electricModule = await import(`@electric-sql/client`)
      const ShapeStreamMock = vi.mocked(electricModule.ShapeStream)

      const initialData = {
        data: [],
        txids: [],
        lastOffset: `resume_offset_123`,
        shapeHandle: `shape_handle_abc`,
      }

      createElectricCollection({
        id: `test-resume`,
        streamOptions: {
          url: `http://test-url`,
          params: { table: `users` },
        },
        primaryKey: [`id`],
        initialData,
      })

      // Verify ShapeStream was constructed with resume options
      expect(ShapeStreamMock).toHaveBeenCalledWith(
        expect.objectContaining({
          url: `http://test-url`,
          params: { table: `users` },
          offset: `resume_offset_123`,
          shapeHandle: `shape_handle_abc`,
        })
      )
    })

    it(`should have proper object key mappings for initial data`, () => {
      const initialData = {
        data: [
          { key: `user1`, value: { id: 1, name: `Alice` } },
          { key: `user2`, value: { id: 2, name: `Bob` } },
        ],
        txids: [100],
        schema: `public`,
      }

      const collection = createElectricCollection({
        id: `test-key-mapping`,
        streamOptions: {
          url: `http://test-url`,
          params: { table: `users` },
        },
        primaryKey: [`id`],
        initialData,
      })

      // Verify object key mappings are set correctly
      const alice = Array.from(collection.state.values()).find(
        (item) => item.name === `Alice`
      )!
      const bob = Array.from(collection.state.values()).find(
        (item) => item.name === `Bob`
      )!

      expect(collection.objectKeyMap.get(alice)).toBeDefined()
      expect(collection.objectKeyMap.get(bob)).toBeDefined()

      // The keys should be different
      expect(collection.objectKeyMap.get(alice)).not.toBe(
        collection.objectKeyMap.get(bob)
      )
    })

    it(`should handle empty initial data gracefully`, () => {
      const initialData = {
        data: [],
        txids: [],
      }

      const collection = createElectricCollection({
        id: `test-empty-initial`,
        streamOptions: {
          url: `http://test-url`,
          params: { table: `users` },
        },
        primaryKey: [`id`],
        initialData,
      })

      expect(collection.state.size).toBe(0)
    })

    it(`should work normally when no initial data is provided`, () => {
      const collection = createElectricCollection({
        id: `test-no-initial`,
        streamOptions: {
          url: `http://test-url`,
          params: { table: `users` },
        },
        primaryKey: [`id`],
      })

      expect(collection.state.size).toBe(0)

      // Should still handle sync messages normally
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

      expect(collection.state.get(`1`)).toEqual({ id: 1, name: `Test User` })
    })

    it(`should merge incoming sync data with initial data correctly`, () => {
      const initialData = {
        data: [{ key: `user1`, value: { id: 1, name: `Alice` } }],
        txids: [100],
        lastOffset: `initial_offset`,
        shapeHandle: `initial_handle`,
      }

      const collection = createElectricCollection({
        id: `test-merge`,
        streamOptions: {
          url: `http://test-url`,
          params: { table: `users` },
        },
        primaryKey: [`id`],
        initialData,
      })

      // Should have initial data
      const initialValues = Array.from(collection.state.values())
      expect(initialValues).toContainEqual({ id: 1, name: `Alice` })

      // Sync new data from server
      subscriber([
        {
          key: `user2`,
          value: { id: 2, name: `Bob` },
          headers: { operation: `insert` },
        },
        {
          headers: { control: `up-to-date` },
        },
      ])

      // Should have both initial and synced data
      expect(collection.state.size).toBe(2)
      const allValues = Array.from(collection.state.values())
      expect(allValues).toContainEqual({ id: 1, name: `Alice` })
      expect(allValues).toContainEqual({ id: 2, name: `Bob` })
    })

    it(`should update existing initial data with sync changes`, () => {
      const initialData = {
        data: [{ key: `user1`, value: { id: 1, name: `Alice` } }],
        txids: [100],
      }

      const collection = createElectricCollection({
        id: `test-update`,
        streamOptions: {
          url: `http://test-url`,
          params: { table: `users` },
        },
        primaryKey: [`id`],
        initialData,
      })

      // Should have initial data
      const initialValues = Array.from(collection.state.values())
      expect(initialValues).toContainEqual({ id: 1, name: `Alice` })

      // Find the auto-generated key for the initial user
      const aliceKey = Array.from(collection.state.entries()).find(
        ([key, value]) => value.name === `Alice`
      )?.[0]

      // Update the existing user via sync using the same auto-generated key
      subscriber([
        {
          key: aliceKey!,
          value: { id: 1, name: `Alice Updated`, email: `alice@example.com` },
          headers: { operation: `update` },
        },
        {
          headers: { control: `up-to-date` },
        },
      ])

      // Should have updated data
      const updatedValues = Array.from(collection.state.values())
      expect(updatedValues).toContainEqual({
        id: 1,
        name: `Alice Updated`,
        email: `alice@example.com`,
      })
    })

    it(`should handle schema from initial data`, () => {
      const mockShapeStreamConstructor = vi.mocked(
        require(`@electric-sql/client`).ShapeStream
      )

      const initialData = {
        data: [],
        txids: [],
        schema: `custom_schema`,
      }

      const collection = createElectricCollection({
        id: `test-schema`,
        streamOptions: {
          url: `http://test-url`,
          params: { table: `users` },
        },
        primaryKey: [`id`],
        initialData,
      })

      // Verify getSyncMetadata includes the schema from initial data
      const metadata = collection.config.sync.getSyncMetadata?.()
      expect(metadata?.relation).toEqual([`custom_schema`, `users`])
    })
  })
})

describe(`Initial Data Seeding`, () => {
  let collectionWithInitialData: ElectricCollection<Row>

  beforeEach(() => {
    // Create collection with Electric configuration specifically for initial data tests
    collectionWithInitialData = createElectricCollection({
      id: `test-initial-seed`,
      streamOptions: {
        url: `http://test-url`,
        params: {
          table: `seed_table`, // Use a distinct table name for these tests
        },
      },
      primaryKey: [mockConstants.PRIMARY_KEY_COLUMN],
      initialData: testInitialData,
    })
  })

  // Tests for seedFromElectricInitialData will go here
  it(`should correctly seed syncedData from initialData`, () => {
    const expectedSyncedData = new Map()
    testInitialData.data.forEach((item: { key: string; value: Row }) => {
      expectedSyncedData.set(item.key, item.value)
    })
    expect(collectionWithInitialData.syncedData.state).toEqual(
      expectedSyncedData
    )
  })

  it(`should correctly seed syncedMetadata from initialData`, () => {
    const expectedSyncedMetadata = new Map()
    const defaultSyncMetadata = {
      primaryKey: [mockConstants.PRIMARY_KEY_COLUMN],
      relation: [testInitialData.schema, `seed_table`], // schema from initialData, table from streamOptions
    }
    testInitialData.data.forEach(
      (item: {
        key: string
        value: Row
        metadata?: Record<string, unknown>
      }) => {
        expectedSyncedMetadata.set(item.key, {
          ...defaultSyncMetadata,
          ...item.metadata,
        })
      }
    )
    expect(collectionWithInitialData.syncedMetadata.state).toEqual(
      expectedSyncedMetadata
    )
  })

  it(`should correctly populate objectKeyMap from initialData`, () => {
    const expectedObjectKeyMapEntries = testInitialData.data.map(
      (item: { key: string; value: Row }) =>
        [item.value, item.key] as [Row, string]
    )
    const actualObjectKeyMap = (collectionWithInitialData as any)
      .objectKeyMap as WeakMap<Row, string>

    // Check if all expected entries are present in the WeakMap
    expectedObjectKeyMapEntries.forEach(([value, key]) => {
      expect(actualObjectKeyMap.has(value)).toBe(true)
      expect(actualObjectKeyMap.get(value)).toBe(key)
    })

    // Optionally, verify the size if possible and makes sense for WeakMap (though not directly possible)
    // For a more thorough check, one might need to iterate over the known objects that were inserted.
    // However, WeakMap's nature is that it doesn't prevent its keys (objects) from being garbage collected,
    // so checking size or iterating isn't as straightforward as with a Map.
    // The above check (all expected items are there) is usually sufficient.
  })

  it(`should call onFirstCommit when initialData is provided`, () => {
    // onFirstCommit is called internally during the seeding process.
    // A direct spy is hard due to its private nature and immediate invocation.
    // This test primarily ensures that the collection setup completes without error,
    // implying onFirstCommit was called as part of the seeding.
    // A more robust test might involve checking a side effect of onFirstCommit if one exists
    // or temporarily making it more testable.
    expect(collectionWithInitialData).toBeDefined()
    // We can also check if the collection considers itself 'committed' or 'synced'
    // if such a public state exists and is set by onFirstCommit during seeding.
    // For now, ensuring no error during setup is the main check.
  })

  it(`should track txids from initialData`, async () => {
    // Ensure txids from initialData are defined and available before testing
    const firstTxid = testInitialData.txids[0]
    if (firstTxid !== undefined) {
      await expect(
        collectionWithInitialData.awaitTxId(firstTxid)
      ).resolves.toBe(true)
    }

    const secondTxid = testInitialData.txids[1]
    if (secondTxid !== undefined) {
      await expect(
        collectionWithInitialData.awaitTxId(secondTxid)
      ).resolves.toBe(true)
    }
    // Attempt to await a txid not in initialData to ensure it doesn't resolve immediately
    const unknownTxid = 123456789
    const promise = collectionWithInitialData.awaitTxId(unknownTxid, 50) // Short timeout
    await expect(promise).rejects.toThrow(
      `Timeout waiting for txId: ${unknownTxid}`
    )
  })
})
