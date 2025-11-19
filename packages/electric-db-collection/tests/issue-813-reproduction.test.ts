/**
 * Minimal reproduction test for issue #813:
 * "Scheduler detected unresolved dependencies" error when using
 * optimistic actions with electric collections and live queries
 *
 * Issue: https://github.com/TanStack/db/issues/813
 */

import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  createCollection,
  createLiveQueryCollection,
  createOptimisticAction,
} from "@tanstack/db"
import { electricCollectionOptions } from "../src/electric"
import type { ElectricCollectionUtils } from "../src/electric"
import type { Collection } from "@tanstack/db"
import type { Message, Row } from "@electric-sql/client"
import type { StandardSchemaV1 } from "@standard-schema/spec"

// Mock the ShapeStream module
const mockSubscribe = vi.fn()
const mockRequestSnapshot = vi.fn()
const mockStream = {
  subscribe: mockSubscribe,
  requestSnapshot: mockRequestSnapshot,
}

vi.mock(`@electric-sql/client`, async () => {
  const actual = await vi.importActual(`@electric-sql/client`)
  return {
    ...actual,
    ShapeStream: vi.fn(() => mockStream),
  }
})

describe(`Issue #813: Scheduler unresolved dependencies with optimistic actions`, () => {
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

    // Setup mock subscriber
    mockSubscribe.mockImplementation((callback) => {
      subscriber = callback
      return () => {}
    })

    mockRequestSnapshot.mockResolvedValue(undefined)

    // Create electric collection
    const config = {
      id: `issue-813-test`,
      shapeOptions: {
        url: `http://test-url`,
        params: {
          table: `items`,
        },
      },
      startSync: true,
      getKey: (item: Row) => item.id as string,
      onUpdate: async () => Promise.resolve({ txid: 1 }),
    }

    const options = electricCollectionOptions(config)
    collection = createCollection(options)

    // Send initial data and mark collection as ready
    subscriber([
      {
        key: `test-id`,
        value: { id: `test-id`, name: `Initial Name` },
        headers: { operation: `insert` },
      },
      {
        headers: { control: `up-to-date` },
      },
    ])
  })

  it(`should reproduce the scheduler error when updating in onMutate with live query subscribed`, async () => {
    // This is the key part - create a live query collection
    // The issue ONLY occurs when there's an active live query subscribed to the collection
    const liveQueryCollection = createLiveQueryCollection((q) =>
      q.from({ items: collection })
    )

    // Preload to ensure the live query is subscribed to the source collection
    await liveQueryCollection.preload()

    // Create an optimistic action that updates the collection in onMutate
    const testAction = createOptimisticAction<string>({
      onMutate: (id) => {
        // This is the problematic line from the issue report
        // Updating the collection within onMutate while a live query is subscribed
        collection.update(id, (draft) => {
          draft.name = `new name here`
        })
      },
      mutationFn: async (_id, _params) => Promise.resolve({ txid: 0 }),
    })

    // Execute the action - this should trigger the scheduler error
    await expect(async () => {
      const tx = testAction(`test-id`)
      await tx.isPersisted.promise
    }).rejects.toThrow(`Scheduler detected unresolved dependencies`)
  })

  it(`should work with the workaround (optimistic: false)`, async () => {
    // Create a live query collection
    const liveQueryCollection = createLiveQueryCollection((q) =>
      q.from({ items: collection })
    )

    // Preload to ensure the live query is subscribed to the source collection
    await liveQueryCollection.preload()

    // Create an optimistic action with the workaround
    const testAction = createOptimisticAction<string>({
      onMutate: (id) => {
        // Use optimistic: false as the workaround
        collection.update(id, { optimistic: false }, (draft) => {
          draft.name = `new name here`
        })
      },
      mutationFn: async (_id, _params) => Promise.resolve({ txid: 0 }),
    })

    // This should succeed with the workaround
    const tx = testAction(`test-id`)
    await tx.isPersisted.promise

    // Verify the update was applied (non-optimistic updates show in synced data)
    expect(collection.get(`test-id`)).toMatchObject({
      id: `test-id`,
      name: `new name here`,
    })
  })

  it(`should work without live query subscription`, async () => {
    // Without a live query, the issue does NOT occur
    const testAction = createOptimisticAction<string>({
      onMutate: (id) => {
        collection.update(id, (draft) => {
          draft.name = `new name here`
        })
      },
      mutationFn: async (_id, _params) => Promise.resolve({ txid: 0 }),
    })

    // This should succeed without a live query
    const tx = testAction(`test-id`)
    await tx.isPersisted.promise

    // Verify the update was applied
    expect(collection.get(`test-id`)).toMatchObject({
      id: `test-id`,
      name: `new name here`,
    })
  })
})
