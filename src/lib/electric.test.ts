import { describe, it, expect, vi, beforeEach } from "vitest"
import { Collection } from "../collection"
import { createElectricSync } from "./electric"
import { Message, Row } from "@electric-sql/client"
import "fake-indexeddb/auto"

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
  let collection: Collection
  let subscriber: (messages: Message<Row>[]) => void

  beforeEach(() => {
    vi.clearAllMocks()

    // Reset mock subscriber
    mockSubscribe.mockImplementation((callback) => {
      subscriber = callback
      return () => {}
    })

    // Create collection with Electric sync
    collection = new Collection({
      sync: createElectricSync({
        url: `http://test-url`,
        params: {
          table: `test_table`,
        },
      }),
      mutationFn: {
        persist: vi.fn().mockResolvedValue(undefined),
        awaitSync: async () => {},
      },
    })
  })

  it(`should handle incoming insert messages and commit on up-to-date`, () => {
    // Simulate incoming insert message
    subscriber([
      {
        key: `1`,
        value: { name: `Test User` },
        headers: { operation: `insert` },
      },
    ])

    // Send up-to-date control message to commit transaction
    subscriber([
      {
        headers: { control: `up-to-date` },
      },
    ])

    expect(collection.value).toEqual(new Map([[`1`, { name: `Test User` }]]))
  })

  it(`should handle multiple changes before committing`, () => {
    // First batch of changes
    subscriber([
      {
        key: `1`,
        value: { name: `Test User` },
        headers: { operation: `insert` },
      },
    ])

    // Second batch of changes
    subscriber([
      {
        key: `2`,
        value: { name: `Another User` },
        headers: { operation: `insert` },
      },
    ])

    // Send up-to-date to commit all changes
    subscriber([
      {
        headers: { control: `up-to-date` },
      },
    ])

    expect(collection.value).toEqual(
      new Map([
        [`1`, { name: `Test User` }],
        [`2`, { name: `Another User` }],
      ])
    )
  })

  it(`should handle updates across multiple messages`, () => {
    // First insert
    subscriber([
      {
        key: `1`,
        value: { name: `Test User` },
        headers: { operation: `insert` },
      },
    ])

    // Update in a separate message
    subscriber([
      {
        key: `1`,
        value: { name: `Updated User` },
        headers: { operation: `update` },
      },
    ])

    // Commit with up-to-date
    subscriber([
      {
        headers: { control: `up-to-date` },
      },
    ])

    expect(collection.value).toEqual(new Map([[`1`, { name: `Updated User` }]]))
  })

  it(`should handle delete operations`, () => {
    // Insert and commit
    subscriber([
      {
        key: `1`,
        value: { name: `Test User` },
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
        value: null,
        headers: { operation: `delete` },
      },
      {
        headers: { control: `up-to-date` },
      },
    ])

    expect(collection.value).toEqual(new Map())
  })

  it(`should not commit changes without up-to-date message`, () => {
    // Send changes without up-to-date
    subscriber([
      {
        key: `1`,
        value: { name: `Test User` },
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
    expect(collection.value).toEqual(new Map())
  })
})
