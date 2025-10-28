import { beforeEach, describe, expect, it, vi } from "vitest"
import { createCollection } from "@tanstack/db"
import { electricCollectionOptions } from "../src/electric"
import type { ElectricCollectionUtils } from "../src/electric"
import type { Collection } from "@tanstack/db"
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

describe(`TxID Wrong Value - Hypothesis Testing`, () => {
  let subscriber: (messages: Array<Message<Row>>) => void
  const changeEvents: Array<any> = []

  beforeEach(() => {
    vi.clearAllMocks()
    changeEvents.length = 0

    // Reset mock subscriber
    mockSubscribe.mockImplementation((callback) => {
      subscriber = callback
      return () => {}
    })
  })

  it(`should demonstrate issue when server function returns unexpected format`, async () => {
    // Simulate a server function that might return { txid: number }
    // but user code wraps it in an array incorrectly
    const mockServerFunction = () => {
      // Server returns single txid
      return Promise.resolve({ txid: 456 }) // This is a DIFFERENT txid than the actual delete!
    }

    const config = {
      id: `test-wrong-txid`,
      shapeOptions: {
        url: `http://test-url`,
        params: {
          table: `contacts`,
        },
      },
      startSync: true,
      getKey: (item: Row) => item.id as number,
      onDelete: vi.fn(async ({ transaction }) => {
        // User's pattern: map over mutations even though there's only one
        const results = await Promise.all(
          transaction.mutations.map(async () => {
            return await mockServerFunction()
          })
        )

        // Returns array of results
        return { txid: results.map((r) => r.txid) } // Returns { txid: [456] }
      }),
    }

    const collection = createCollection(
      electricCollectionOptions(config)
    ) as Collection<Row, string | number, ElectricCollectionUtils>

    // Track all change events
    collection.subscribeChanges((changes) => {
      console.log(`Change event:`, JSON.stringify(changes))
      changeEvents.push(...changes)
    })

    // Initial sync - insert item with txid 100
    subscriber([
      {
        key: `1`,
        value: { id: 1, name: `Test Contact` },
        headers: { operation: `insert`, txids: [100] },
      },
      {
        headers: { control: `up-to-date` },
      },
    ])

    expect(collection.state.get(1)).toEqual({ id: 1, name: `Test Contact` })
    changeEvents.length = 0 // Clear events

    // User deletes the item
    console.log(`=== Deleting item ===`)
    const tx = collection.delete(1)

    // Item should be optimistically deleted
    expect(collection.state.get(1)).toBeUndefined()
    console.log(`Optimistic delete events:`, changeEvents.length)

    // Now simulate what happens when:
    // 1. The delete operation on server gets txid 123
    // 2. But the user is waiting for txid 456 (wrong!)

    // First, send the ACTUAL delete with txid 123
    console.log(`=== Sending actual delete sync message with txid 123 ===`)
    subscriber([
      {
        key: `1`,
        value: { id: 1, name: `Test Contact` },
        headers: { operation: `delete`, txids: [123] },
      },
      {
        headers: { control: `up-to-date` },
      },
    ])

    // At this point, the delete has synced, but the transaction is still waiting for txid 456!
    // Check if transaction completed
    const isCompleted = tx.state === `completed`
    console.log(`Transaction completed after actual delete sync:`, isCompleted)
    console.log(`Transaction state:`, tx.state)

    // Now send a DIFFERENT operation with txid 456 (maybe an audit log insert)
    console.log(`=== Sending unrelated INSERT with txid 456 ===`)
    subscriber([
      {
        key: `1`,
        value: { id: 1, name: `Test Contact - Restored` },
        headers: { operation: `insert`, txids: [456] },
      },
      {
        headers: { control: `up-to-date` },
      },
    ])

    // Wait for transaction to complete
    await tx.isPersisted.promise

    console.log(
      `Final change events:`,
      changeEvents.map((e) => e.type)
    )
    console.log(`Final collection state:`, collection.state.get(1))

    // This would demonstrate the flicker:
    // 1. Optimistic delete (item disappears)
    // 2. Sync delete arrives (no event, item already deleted)
    // 3. Sync insert with txid 456 arrives (item reappears!) <- FLICKER
    // 4. Transaction completes

    const hasInsertEvent = changeEvents.some((e) => e.type === `insert`)
    console.log(`Has insert event (indicates flicker):`, hasInsertEvent)
  })
})
