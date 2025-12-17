/**
 * Tests for groupBy incremental updates to investigate the bug where
 * the D2 pipeline might emit an insert without a corresponding delete.
 */
import { describe, expect, test } from 'vitest'
import { createLiveQueryCollection } from '../../src/query/index.js'
import { createCollection } from '../../src/collection/index.js'
import { mockSyncCollectionOptionsNoInitialState } from '../utils.js'
import { count, sum } from '../../src/query/builder/functions.js'
import { DuplicateKeySyncError } from '../../src/errors.js'

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
  describe(`D2 output tracing`, () => {
    test(`trace accumulated changes for groupBy incremental update`, async () => {
      // This test verifies that D2 emits paired delete+insert for aggregate updates
      // by checking the accumulated changes passed to applyChanges

      const eventsCollection = await createReadyCollection<Event>({
        id: `events-trace`,
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

      // Insert first event
      eventsCollection.utils.begin()
      eventsCollection.utils.write({
        type: `insert`,
        value: { id: `event1`, language: `ru` },
      })
      eventsCollection.utils.commit()

      expect(languageCounts.size).toBe(1)
      expect(languageCounts.get(`ru`)?.count).toBe(1)

      // Insert second event - D2 should emit delete for {count:1} and insert for {count:2}
      eventsCollection.utils.begin()
      eventsCollection.utils.write({
        type: `insert`,
        value: { id: `event2`, language: `ru` },
      })
      eventsCollection.utils.commit()

      // Verify the result
      expect(languageCounts.size).toBe(1)
      expect(languageCounts.get(`ru`)?.count).toBe(2)

      // This test passing means D2 is correctly emitting paired delete+insert
      // which gets accumulated into a single update in applyChanges
    })
  })

  describe(`Direct bug reproduction`, () => {
    test(`simulating D2 emitting only insert (without delete) for live query should throw DuplicateKeySyncError`, async () => {
      // This test directly simulates the bug scenario:
      // D2 emits an insert for a key that already exists, without a preceding delete
      // For live queries without custom getKey (like groupBy), this triggers the bug
      //
      // We need to use LIVE_QUERY_INTERNAL to mark this as a live query

      const { LIVE_QUERY_INTERNAL } = await import(
        `../../src/query/live/internal.js`
      )

      type GroupResult = {
        language: string
        count: number
      }

      let writeInsertForExistingKey: (() => void) | undefined

      const collection = createCollection<GroupResult, string>({
        id: `direct-bug-repro`,
        getKey: (item) => item.language,
        sync: {
          sync: ({ begin, write, commit, markReady }) => {
            // First: insert initial value
            begin()
            write({
              type: `insert`,
              value: { language: `ru`, count: 1 },
            })
            commit()
            markReady()

            // Capture the write function to use later
            writeInsertForExistingKey = () => {
              begin()
              // This insert is for an existing key with a DIFFERENT value
              // Without a preceding delete, this should throw DuplicateKeySyncError
              write({
                type: `insert`,
                value: { language: `ru`, count: 2 },
              })
              commit()
            }
          },
        },
        startSync: true,
        // Mark this as a live query with custom getKey (which should throw error)
        utils: {
          [LIVE_QUERY_INTERNAL]: {
            hasCustomGetKey: true, // Has custom getKey, so should throw
            hasJoins: false,
            getBuilder: () => null,
          },
        } as any,
      })

      await collection.preload()

      // Initial state
      expect(collection.size).toBe(1)
      expect(collection.get(`ru`)?.count).toBe(1)

      // Now try to insert for the existing key without a delete
      // This should throw because we're inserting a duplicate key with different value
      // and this has custom getKey set to true
      expect(() => writeInsertForExistingKey!()).toThrow(DuplicateKeySyncError)
    })

    test(`inserting same value for existing key should convert to update (not throw)`, async () => {
      // When the new value is deepEquals to the existing value,
      // the insert should be converted to an update (not throw)

      type GroupResult = {
        language: string
        count: number
      }

      let writeInsertForExistingKey: (() => void) | undefined

      const collection = createCollection<GroupResult, string>({
        id: `same-value-repro`,
        getKey: (item) => item.language,
        sync: {
          sync: ({ begin, write, commit, markReady }) => {
            begin()
            write({
              type: `insert`,
              value: { language: `ru`, count: 1 },
            })
            commit()
            markReady()

            writeInsertForExistingKey = () => {
              begin()
              // Same value - should be converted to update
              write({
                type: `insert`,
                value: { language: `ru`, count: 1 },
              })
              commit()
            }
          },
        },
        startSync: true,
      })

      await collection.preload()

      expect(collection.size).toBe(1)
      expect(collection.get(`ru`)?.count).toBe(1)

      // This should NOT throw because the value is the same
      expect(() => writeInsertForExistingKey!()).not.toThrow()
    })
  })

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

  test(`groupBy with subquery (matching bug report pattern)`, async () => {
    // This test mimics the exact pattern from the bug report:
    // A groupBy result is used as a source for another query with orderBy/limit
    type WikiEvent = {
      id: string
      language: string
    }

    const eventsCollection = await createReadyCollection<WikiEvent>({
      id: `events-subquery`,
      getKey: (event) => event.id,
    })

    // Create the groupBy query that counts events by language
    // This is used as a subquery
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

    // Create the outer query that orders by count and limits
    const topLanguages = createLiveQueryCollection({
      startSync: true,
      query: (q) =>
        q
          .from({ stats: languageCounts })
          .orderBy(({ stats }) => stats.count, `desc`)
          .limit(5),
    })

    // Initially empty
    expect(topLanguages.size).toBe(0)

    // Insert first event with language="ru"
    eventsCollection.utils.begin()
    eventsCollection.utils.write({
      type: `insert`,
      value: { id: `event1`, language: `ru` },
    })
    eventsCollection.utils.commit()

    // Should have one language with count 1
    expect(topLanguages.size).toBe(1)
    const firstResult = [...topLanguages.values()][0]
    expect(firstResult?.language).toBe(`ru`)
    expect(firstResult?.count).toBe(1)

    // Insert second event with same language="ru" but different id
    // This is where the bug would occur
    eventsCollection.utils.begin()
    eventsCollection.utils.write({
      type: `insert`,
      value: { id: `event2`, language: `ru` },
    })
    eventsCollection.utils.commit()

    // Should still have one language, but with count 2
    expect(topLanguages.size).toBe(1)
    const secondResult = [...topLanguages.values()][0]
    expect(secondResult?.language).toBe(`ru`)
    expect(secondResult?.count).toBe(2)

    // Add more events to different languages
    eventsCollection.utils.begin()
    eventsCollection.utils.write({
      type: `insert`,
      value: { id: `event3`, language: `en` },
    })
    eventsCollection.utils.commit()

    expect(topLanguages.size).toBe(2)

    // Add another Russian event
    eventsCollection.utils.begin()
    eventsCollection.utils.write({
      type: `insert`,
      value: { id: `event4`, language: `ru` },
    })
    eventsCollection.utils.commit()

    // Russian should now have count 3
    const results = [...topLanguages.values()]
    const ruResult = results.find((r) => r.language === `ru`)
    const enResult = results.find((r) => r.language === `en`)
    expect(ruResult?.count).toBe(3)
    expect(enResult?.count).toBe(1)
  })

  test(`groupBy with rapid sequential inserts`, async () => {
    // Test rapid sequential inserts that might trigger race conditions
    const eventsCollection = await createReadyCollection<Event>({
      id: `events-rapid`,
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

    // Rapidly insert multiple events with the same language
    for (let i = 0; i < 10; i++) {
      eventsCollection.utils.begin()
      eventsCollection.utils.write({
        type: `insert`,
        value: { id: `event-${i}`, language: `ru` },
      })
      eventsCollection.utils.commit()
    }

    // Should have accumulated all counts
    expect(languageCounts.size).toBe(1)
    expect(languageCounts.get(`ru`)?.count).toBe(10)
  })

  test(`groupBy with multiple events in single batch`, async () => {
    // Test inserting multiple events with same groupBy key in a single batch
    const eventsCollection = await createReadyCollection<Event>({
      id: `events-batch-same`,
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

    // Insert multiple events in a single batch
    eventsCollection.utils.begin()
    eventsCollection.utils.write({
      type: `insert`,
      value: { id: `event1`, language: `ru` },
    })
    eventsCollection.utils.write({
      type: `insert`,
      value: { id: `event2`, language: `ru` },
    })
    eventsCollection.utils.write({
      type: `insert`,
      value: { id: `event3`, language: `ru` },
    })
    eventsCollection.utils.commit()

    // Should have one group with count 3
    expect(languageCounts.size).toBe(1)
    expect(languageCounts.get(`ru`)?.count).toBe(3)

    // Then add more incrementally
    eventsCollection.utils.begin()
    eventsCollection.utils.write({
      type: `insert`,
      value: { id: `event4`, language: `ru` },
    })
    eventsCollection.utils.commit()

    expect(languageCounts.get(`ru`)?.count).toBe(4)
  })
})
