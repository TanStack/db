import { describe, expect, test } from "vitest"
import { createLiveQueryCollection } from "../../src/query/index.js"
import { createCollection } from "../../src/collection/index.js"
import { mockSyncCollectionOptions } from "../utils.js"

type EpochInfo = {
  epochNumber: number
  timestamp: number
}

describe(`findOne() should return single result, not array`, () => {
  test(`findOne() with liveQueryCollection should return single result`, async () => {
    // Create a collection with test data
    const epochInfoCollection = createCollection(
      mockSyncCollectionOptions<EpochInfo>({
        id: `test-epoch-info`,
        getKey: (epoch) => epoch.epochNumber,
        initialData: [
          { epochNumber: 1, timestamp: 1000 },
          { epochNumber: 2, timestamp: 2000 },
          { epochNumber: 3, timestamp: 3000 },
        ],
      })
    )

    // Create a live query collection with findOne()
    const latestEpochCollection = createLiveQueryCollection((q) =>
      q
        .from({ e: epochInfoCollection })
        .orderBy(({ e }) => e.epochNumber, "desc")
        .select(({ e }) => ({ epochNumber: e.epochNumber }))
        .findOne()
    )

    // Wait for the collection to be ready
    await latestEpochCollection.preload()

    // The collection should have singleResult flag set
    expect(latestEpochCollection.singleResult).toBe(true)

    // toArray should return a single result, not an array
    // BUG: Currently returns [{ epochNumber: 3 }] instead of { epochNumber: 3 }
    const result = latestEpochCollection.toArray

    // This is the expected behavior:
    expect(result).toEqual({ epochNumber: 3 })

    // NOT an array:
    expect(Array.isArray(result)).toBe(false)
  })

  test(`findOne() with no matching results should return undefined`, async () => {
    const epochInfoCollection = createCollection(
      mockSyncCollectionOptions<EpochInfo>({
        id: `test-epoch-info-empty`,
        getKey: (epoch) => epoch.epochNumber,
        initialData: [],
      })
    )

    const latestEpochCollection = createLiveQueryCollection((q) =>
      q
        .from({ e: epochInfoCollection })
        .orderBy(({ e }) => e.epochNumber, "desc")
        .select(({ e }) => ({ epochNumber: e.epochNumber }))
        .findOne()
    )

    await latestEpochCollection.preload()

    const result = latestEpochCollection.toArray

    // Should return undefined, not an empty array
    expect(result).toBeUndefined()
    expect(Array.isArray(result)).toBe(false)
  })

  test(`state property should also return single result`, async () => {
    const epochInfoCollection = createCollection(
      mockSyncCollectionOptions<EpochInfo>({
        id: `test-epoch-info-state`,
        getKey: (epoch) => epoch.epochNumber,
        initialData: [
          { epochNumber: 1, timestamp: 1000 },
          { epochNumber: 2, timestamp: 2000 },
        ],
      })
    )

    const latestEpochCollection = createLiveQueryCollection((q) =>
      q
        .from({ e: epochInfoCollection })
        .orderBy(({ e }) => e.epochNumber, "desc")
        .findOne()
    )

    await latestEpochCollection.preload()

    // state should also return a single result for findOne() queries
    const state = latestEpochCollection.state

    // Should return the single object, not a Map
    expect(state).toEqual({ epochNumber: 2, timestamp: 2000 })
  })
})
