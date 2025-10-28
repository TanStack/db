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

describe(`TxID Array Bug - delete/insert/delete flicker`, () => {
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

  it(`should NOT flicker when returning array with single txid`, async () => {
    // Setup collection that returns array txid
    const config = {
      id: `test-array-txid`,
      shapeOptions: {
        url: `http://test-url`,
        params: {
          table: `contacts`,
        },
      },
      startSync: true,
      getKey: (item: Row) => item.id as number,
      onDelete: vi.fn(() => {
        // Return array with single txid (user's pattern)
        // Simulating waiting for the correct delete txid
        return Promise.resolve({ txid: [123] })
      }),
    }

    const collection = createCollection(
      electricCollectionOptions(config)
    ) as Collection<Row, string | number, ElectricCollectionUtils>

    // Track all change events
    collection.subscribeChanges((changes) => {
      changeEvents.push(...changes)
    })

    // Initial sync - insert item
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
    const tx = collection.delete(1)

    // Item should be optimistically deleted
    expect(collection.state.get(1)).toBeUndefined()
    expect(changeEvents).toHaveLength(1)
    expect(changeEvents[0].type).toBe(`delete`)

    changeEvents.length = 0 // Clear events

    // Simulate server sending back the delete sync message with txid 123
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

    // Wait for transaction to complete
    await tx.isPersisted.promise

    // Item should still be deleted
    expect(collection.state.get(1)).toBeUndefined()

    // Should NOT have any insert events (no flicker)
    const hasInsertEvent = changeEvents.some((e) => e.type === `insert`)
    expect(hasInsertEvent).toBe(false)

    // Should not have duplicate delete events
    const deleteEvents = changeEvents.filter((e) => e.type === `delete`)
    expect(deleteEvents.length).toBeLessThanOrEqual(1)

    console.log(`Events with array txid:`, changeEvents)
  })

  it(`should work correctly when returning single txid (control test)`, async () => {
    // Setup collection that returns single txid
    const config = {
      id: `test-single-txid`,
      shapeOptions: {
        url: `http://test-url`,
        params: {
          table: `contacts`,
        },
      },
      startSync: true,
      getKey: (item: Row) => item.id as number,
      onDelete: vi.fn(() => {
        // Return single txid (recommended pattern)
        return Promise.resolve({ txid: 123 })
      }),
    }

    const collection = createCollection(
      electricCollectionOptions(config)
    ) as Collection<Row, string | number, ElectricCollectionUtils>

    // Track all change events
    collection.subscribeChanges((changes) => {
      changeEvents.push(...changes)
    })

    // Initial sync - insert item
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
    const tx = collection.delete(1)

    // Item should be optimistically deleted
    expect(collection.state.get(1)).toBeUndefined()
    expect(changeEvents).toHaveLength(1)
    expect(changeEvents[0].type).toBe(`delete`)

    changeEvents.length = 0 // Clear events

    // Simulate server sending back the delete sync message with txid 123
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

    // Wait for transaction to complete
    await tx.isPersisted.promise

    // Item should still be deleted
    expect(collection.state.get(1)).toBeUndefined()

    // Should NOT have any insert events
    const hasInsertEvent = changeEvents.some((e) => e.type === `insert`)
    expect(hasInsertEvent).toBe(false)

    // Should not have duplicate delete events
    const deleteEvents = changeEvents.filter((e) => e.type === `delete`)
    expect(deleteEvents.length).toBeLessThanOrEqual(1)

    console.log(`Events with single txid:`, changeEvents)
  })
})
