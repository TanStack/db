import { beforeEach, describe, expect, it, vi } from "vitest"
import { createCollection, createTransaction } from "@tanstack/db"
import { electricCollectionOptions } from "../src/electric"
import type { Collection } from "@tanstack/db"
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

describe(`Electric Integration - stuck empty repro`, () => {
  let collection: Collection<
    Row<unknown>,
    string | number,
    any,
    StandardSchemaV1<unknown, unknown>,
    Row<unknown>
  >
  let subscriber: (messages: Array<Message<Row>>) => void

  beforeEach(() => {
    vi.clearAllMocks()

    // Reset mock subscriber
    mockSubscribe.mockImplementation((callback) => {
      subscriber = callback
      return () => {}
    })

    const config = {
      id: `repro`,
      shapeOptions: {
        url: `http://test-url`,
        params: { table: `test_table` },
      },
      startSync: true,
      getKey: (item: Row) => item.id as number,
    } as any

    const options = electricCollectionOptions(config)

    collection = createCollection(options)
  })

  it(`reproduces: queued commit then must-refetch+commit yields empty`, async () => {
    // Create a persisting user transaction to defer applying the first up-to-date
    const holdTx = createTransaction({
      autoCommit: false,
      mutationFn: async () => new Promise(() => {}),
    })

    holdTx.mutate(() => {
      // Add a mutation with optimistic=false so it doesn't affect visible state
      collection.insert({ id: 999, name: `hold` } as unknown as Row, {
        optimistic: false,
      })
    })
    void holdTx.commit()

    // Batch A: initial data + up-to-date (commit queued, not applied due to persisting tx)
    subscriber([
      {
        key: `1`,
        value: { id: 1, name: `one` },
        headers: { operation: `insert` },
      },
      { headers: { control: `up-to-date` } },
    ])

    expect(collection.state.has(1)).toBe(false)

    // Batch B: must-refetch + up-to-date (truncate batch commits despite persisting tx)
    subscriber([{ headers: { control: `must-refetch` } }])
    subscriber([{ headers: { control: `up-to-date` } }])

    // BUG (pre-fix): earlier committed writes applied then truncated => empty and ready
    expect(collection.status).toBe(`ready`)
    expect(collection.state.size).toBe(0)
  })
})
