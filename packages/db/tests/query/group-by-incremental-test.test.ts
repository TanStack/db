/**
 * Tests for groupBy incremental updates to investigate the bug where
 * the D2 pipeline might emit an insert without a corresponding delete.
 */
import { describe, expect, test } from 'vitest'
import { createLiveQueryCollection } from '../../src/query/index.js'
import { createCollection } from '../../src/collection/index.js'
import { mockSyncCollectionOptionsNoInitialState } from '../utils.js'
import { count, sum } from '../../src/query/builder/functions.js'

type Event = {
  id: string
  language: string
  amount?: number
}

/**
 * Helper to create a collection that's ready for testing.
 */
async function createReadyCollection<T extends object>(opts: {
  id: string
  getKey: (item: T) => string | number
}) {
  const collection = createCollection(
    mockSyncCollectionOptionsNoInitialState<T>(opts),
  )

  const preloadPromise = collection.preload()
  collection.utils.begin()
  collection.utils.commit()
  collection.utils.markReady()
  await preloadPromise

  return collection
}

describe(`GroupBy Incremental Updates Investigation`, () => {
  test(`basic incremental update with same groupBy key`, async () => {
    const eventsCollection = await createReadyCollection<Event>({
      id: `events-basic-inc`,
      getKey: (event) => event.id,
    })

    const languageCounts = createLiveQueryCollection({
      startSync: true,
      query: (q) =>
        q
          .from({ events: eventsCollection })
          .groupBy(({ events }) => events.language)
          .select(({ events }) => ({
            language: events.language,
            count: count(events.id),
          })),
    })

    // Initially empty
    expect(languageCounts.size).toBe(0)

    // Insert first event with language="ru"
    eventsCollection.utils.begin()
    eventsCollection.utils.write({
      type: `insert`,
      value: { id: `event1`, language: `ru` },
    })
    eventsCollection.utils.commit()

    // After first insert, should have count 1
    expect(languageCounts.size).toBe(1)
    expect(languageCounts.get(`ru`)?.count).toBe(1)

    // Insert second event with same language="ru" but different id
    // This is where the bug was reported - should NOT throw "already exists"
    eventsCollection.utils.begin()
    eventsCollection.utils.write({
      type: `insert`,
      value: { id: `event2`, language: `ru` },
    })
    eventsCollection.utils.commit()

    // After second insert, should have count 2
    expect(languageCounts.size).toBe(1)
    expect(languageCounts.get(`ru`)?.count).toBe(2)
  })

  test(`multiple incremental updates to same group`, async () => {
    const eventsCollection = await createReadyCollection<Event>({
      id: `events-multi-inc`,
      getKey: (event) => event.id,
    })

    const languageCounts = createLiveQueryCollection({
      startSync: true,
      query: (q) =>
        q
          .from({ events: eventsCollection })
          .groupBy(({ events }) => events.language)
          .select(({ events }) => ({
            language: events.language,
            count: count(events.id),
          })),
    })

    // Add 5 events incrementally
    for (let i = 1; i <= 5; i++) {
      eventsCollection.utils.begin()
      eventsCollection.utils.write({
        type: `insert`,
        value: { id: `event${i}`, language: `en` },
      })
      eventsCollection.utils.commit()

      expect(languageCounts.size).toBe(1)
      expect(languageCounts.get(`en`)?.count).toBe(i)
    }
  })

  test(`incremental updates with sum aggregate`, async () => {
    const eventsCollection = await createReadyCollection<Event>({
      id: `events-sum-inc`,
      getKey: (event) => event.id,
    })

    const languageTotals = createLiveQueryCollection({
      startSync: true,
      query: (q) =>
        q
          .from({ events: eventsCollection })
          .groupBy(({ events }) => events.language)
          .select(({ events }) => ({
            language: events.language,
            total: sum(events.amount),
            count: count(events.id),
          })),
    })

    // First event
    eventsCollection.utils.begin()
    eventsCollection.utils.write({
      type: `insert`,
      value: { id: `event1`, language: `ru`, amount: 10 },
    })
    eventsCollection.utils.commit()

    expect(languageTotals.get(`ru`)?.total).toBe(10)
    expect(languageTotals.get(`ru`)?.count).toBe(1)

    // Second event
    eventsCollection.utils.begin()
    eventsCollection.utils.write({
      type: `insert`,
      value: { id: `event2`, language: `ru`, amount: 20 },
    })
    eventsCollection.utils.commit()

    expect(languageTotals.get(`ru`)?.total).toBe(30)
    expect(languageTotals.get(`ru`)?.count).toBe(2)

    // Third event
    eventsCollection.utils.begin()
    eventsCollection.utils.write({
      type: `insert`,
      value: { id: `event3`, language: `ru`, amount: 15 },
    })
    eventsCollection.utils.commit()

    expect(languageTotals.get(`ru`)?.total).toBe(45)
    expect(languageTotals.get(`ru`)?.count).toBe(3)
  })

  test(`multiple groups with incremental updates`, async () => {
    const eventsCollection = await createReadyCollection<Event>({
      id: `events-multi-group-inc`,
      getKey: (event) => event.id,
    })

    const languageCounts = createLiveQueryCollection({
      startSync: true,
      query: (q) =>
        q
          .from({ events: eventsCollection })
          .groupBy(({ events }) => events.language)
          .select(({ events }) => ({
            language: events.language,
            count: count(events.id),
          })),
    })

    // Add events to different groups incrementally
    eventsCollection.utils.begin()
    eventsCollection.utils.write({
      type: `insert`,
      value: { id: `event1`, language: `en` },
    })
    eventsCollection.utils.commit()

    expect(languageCounts.size).toBe(1)
    expect(languageCounts.get(`en`)?.count).toBe(1)

    eventsCollection.utils.begin()
    eventsCollection.utils.write({
      type: `insert`,
      value: { id: `event2`, language: `ru` },
    })
    eventsCollection.utils.commit()

    expect(languageCounts.size).toBe(2)
    expect(languageCounts.get(`en`)?.count).toBe(1)
    expect(languageCounts.get(`ru`)?.count).toBe(1)

    // Now add more to each group
    eventsCollection.utils.begin()
    eventsCollection.utils.write({
      type: `insert`,
      value: { id: `event3`, language: `en` },
    })
    eventsCollection.utils.commit()

    expect(languageCounts.get(`en`)?.count).toBe(2)
    expect(languageCounts.get(`ru`)?.count).toBe(1)

    eventsCollection.utils.begin()
    eventsCollection.utils.write({
      type: `insert`,
      value: { id: `event4`, language: `ru` },
    })
    eventsCollection.utils.commit()

    expect(languageCounts.get(`en`)?.count).toBe(2)
    expect(languageCounts.get(`ru`)?.count).toBe(2)
  })

  test(`batch then incremental updates`, async () => {
    const eventsCollection = await createReadyCollection<Event>({
      id: `events-batch-then-inc`,
      getKey: (event) => event.id,
    })

    const languageCounts = createLiveQueryCollection({
      startSync: true,
      query: (q) =>
        q
          .from({ events: eventsCollection })
          .groupBy(({ events }) => events.language)
          .select(({ events }) => ({
            language: events.language,
            count: count(events.id),
          })),
    })

    // Batch insert
    eventsCollection.utils.begin()
    eventsCollection.utils.write({
      type: `insert`,
      value: { id: `event1`, language: `ru` },
    })
    eventsCollection.utils.write({
      type: `insert`,
      value: { id: `event2`, language: `ru` },
    })
    eventsCollection.utils.commit()

    expect(languageCounts.size).toBe(1)
    expect(languageCounts.get(`ru`)?.count).toBe(2)

    // Then incremental
    eventsCollection.utils.begin()
    eventsCollection.utils.write({
      type: `insert`,
      value: { id: `event3`, language: `ru` },
    })
    eventsCollection.utils.commit()

    expect(languageCounts.get(`ru`)?.count).toBe(3)
  })
})
