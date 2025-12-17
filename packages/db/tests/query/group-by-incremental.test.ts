import { describe, expect, test } from 'vitest'
import { createLiveQueryCollection } from '../../src/query/index.js'
import { createCollection } from '../../src/collection/index.js'
import { mockSyncCollectionOptionsNoInitialState } from '../utils.js'
import { count, sum } from '../../src/query/builder/functions.js'

/**
 * Tests for groupBy incremental updates
 *
 * This test file specifically addresses the bug where groupBy works correctly
 * during batch processing (preload) but fails with "already exists" errors
 * when processing incremental live updates.
 *
 * Bug report: When multiple events with the same groupBy key but different
 * primary keys arrive incrementally, the second event causes a duplicate
 * key error in the live query's internal collection.
 */

type Event = {
  id: string
  language: string
  title?: string
}

/**
 * Helper to create a collection that's ready for testing.
 * Handles all the boilerplate setup: preload, begin, commit, markReady.
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

describe(`GroupBy Incremental Updates`, () => {
  describe(`Sync layer duplicate insert handling`, () => {
    test(`sync layer should convert insert to update for live query without custom getKey when key exists`, async () => {
      // This test directly exercises the sync layer fix by simulating the scenario
      // where the D2 pipeline emits only an insert (without delete) for an existing key.
      // This happens in certain edge cases with groupBy aggregates.
      //
      // The fix checks for utils[LIVE_QUERY_INTERNAL].hasCustomGetKey to determine
      // if we should convert duplicate inserts to updates.

      type GroupResult = {
        language: string
        count: number
      }

      // Import the internal symbol used by live queries
      const { LIVE_QUERY_INTERNAL } = await import(
        `../../src/query/live/internal.js`
      )

      // Create a collection that mimics a live query collection structure
      // with hasCustomGetKey: false (like groupBy queries)
      const liveQueryCollection = createCollection<GroupResult, string>({
        id: `live-query-sync-test`,
        getKey: (item) => item.language,
        sync: {
          sync: ({ begin, write, commit, markReady }) => {
            // First batch: insert initial aggregate
            begin()
            write({
              type: `insert`,
              value: { language: `ru`, count: 1 },
            })
            commit()
            markReady()

            // Later: simulate D2 emitting only an insert for updated aggregate
            // (without the corresponding delete for the old value)
            // This is the edge case that causes the bug
            setTimeout(() => {
              begin()
              // This insert should be converted to update by the sync layer
              // because the key "ru" already exists AND hasCustomGetKey is false
              write({
                type: `insert`,
                value: { language: `ru`, count: 2 },
              })
              commit()
            }, 10)
          },
        },
        startSync: true,
        // This is the key part: set up utils with LIVE_QUERY_INTERNAL
        // to indicate this is a live query without custom getKey
        utils: {
          [LIVE_QUERY_INTERNAL]: {
            hasCustomGetKey: false,
            hasJoins: false,
            getBuilder: () => null,
          },
        } as any,
      })

      await liveQueryCollection.preload()

      // Initial state
      expect(liveQueryCollection.size).toBe(1)
      expect(liveQueryCollection.get(`ru`)?.count).toBe(1)

      // Wait for the second write
      await new Promise((resolve) => setTimeout(resolve, 50))

      // After the "insert" that should be converted to update
      // Without the fix, this would throw: "Cannot insert document with key 'ru' ... already exists"
      expect(liveQueryCollection.size).toBe(1)
      expect(liveQueryCollection.get(`ru`)?.count).toBe(2)
    })

    test(`sync layer should throw error for regular collection with duplicate insert`, async () => {
      // Regular collections (without LIVE_QUERY_INTERNAL) should still throw
      // an error when trying to insert a duplicate key

      type Item = {
        id: string
        value: number
      }

      const collection = createCollection<Item, string>({
        id: `regular-collection-test`,
        getKey: (item) => item.id,
        sync: {
          sync: ({ begin, write, commit, markReady }) => {
            begin()
            write({
              type: `insert`,
              value: { id: `item1`, value: 1 },
            })
            commit()
            markReady()

            // This should throw because it's a regular collection
            setTimeout(() => {
              begin()
              try {
                write({
                  type: `insert`,
                  value: { id: `item1`, value: 2 },
                })
                commit()
              } catch {
                // Expected - error should be thrown
              }
            }, 10)
          },
        },
        startSync: true,
      })

      await collection.preload()

      expect(collection.size).toBe(1)
      expect(collection.get(`item1`)?.value).toBe(1)

      // Wait for the second write attempt
      await new Promise((resolve) => setTimeout(resolve, 50))

      // Value should NOT be updated because the insert should have been rejected
      expect(collection.size).toBe(1)
      expect(collection.get(`item1`)?.value).toBe(1)
    })
  })

  describe(`Bug: Duplicate insert errors on live updates`, () => {
    test(`should update aggregate when second event with same groupBy key arrives`, async () => {
      // Create an empty collection that we'll populate incrementally
      const eventsCollection = await createReadyCollection<Event>({
        id: `events`,
        getKey: (event) => event.id,
      })

      // Create a groupBy query that counts events by language
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
        value: { id: `event1`, language: `ru`, title: `First Russian Event` },
      })
      eventsCollection.utils.commit()

      // Should have one group with count 1
      expect(languageCounts.size).toBe(1)
      const ruGroup1 = languageCounts.get(`ru`)
      expect(ruGroup1).toBeDefined()
      expect(ruGroup1?.language).toBe(`ru`)
      expect(ruGroup1?.count).toBe(1)

      // Insert second event with same language="ru" but different id
      // This is where the bug occurs - should UPDATE the aggregate, not try to INSERT
      eventsCollection.utils.begin()
      eventsCollection.utils.write({
        type: `insert`,
        value: { id: `event2`, language: `ru`, title: `Second Russian Event` },
      })
      eventsCollection.utils.commit()

      // Should still have one group, but with count 2
      expect(languageCounts.size).toBe(1)
      const ruGroup2 = languageCounts.get(`ru`)
      expect(ruGroup2).toBeDefined()
      expect(ruGroup2?.language).toBe(`ru`)
      expect(ruGroup2?.count).toBe(2)
    })

    test(`should handle multiple groups being updated incrementally`, async () => {
      const eventsCollection = await createReadyCollection<Event>({
        id: `events-multi`,
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

      // Insert events for different languages
      eventsCollection.utils.begin()
      eventsCollection.utils.write({
        type: `insert`,
        value: { id: `en1`, language: `en` },
      })
      eventsCollection.utils.commit()

      expect(languageCounts.size).toBe(1)
      expect(languageCounts.get(`en`)?.count).toBe(1)

      eventsCollection.utils.begin()
      eventsCollection.utils.write({
        type: `insert`,
        value: { id: `ru1`, language: `ru` },
      })
      eventsCollection.utils.commit()

      expect(languageCounts.size).toBe(2)
      expect(languageCounts.get(`en`)?.count).toBe(1)
      expect(languageCounts.get(`ru`)?.count).toBe(1)

      // Add more to Russian - this is where the bug manifests
      eventsCollection.utils.begin()
      eventsCollection.utils.write({
        type: `insert`,
        value: { id: `ru2`, language: `ru` },
      })
      eventsCollection.utils.commit()

      expect(languageCounts.size).toBe(2)
      expect(languageCounts.get(`en`)?.count).toBe(1)
      expect(languageCounts.get(`ru`)?.count).toBe(2)

      // Add more to English
      eventsCollection.utils.begin()
      eventsCollection.utils.write({
        type: `insert`,
        value: { id: `en2`, language: `en` },
      })
      eventsCollection.utils.commit()

      expect(languageCounts.size).toBe(2)
      expect(languageCounts.get(`en`)?.count).toBe(2)
      expect(languageCounts.get(`ru`)?.count).toBe(2)
    })

    test(`should handle sum aggregate with incremental updates`, async () => {
      type Order = {
        id: number
        customerId: number
        amount: number
      }

      const ordersCollection = await createReadyCollection<Order>({
        id: `orders`,
        getKey: (order) => order.id,
      })

      const customerTotals = createLiveQueryCollection({
        startSync: true,
        query: (q) =>
          q
            .from({ orders: ordersCollection })
            .groupBy(({ orders }) => orders.customerId)
            .select(({ orders }) => ({
              customerId: orders.customerId,
              total: sum(orders.amount),
              orderCount: count(orders.id),
            })),
      })

      // Add first order for customer 1
      ordersCollection.utils.begin()
      ordersCollection.utils.write({
        type: `insert`,
        value: { id: 1, customerId: 1, amount: 100 },
      })
      ordersCollection.utils.commit()

      expect(customerTotals.size).toBe(1)
      expect(customerTotals.get(1)?.total).toBe(100)
      expect(customerTotals.get(1)?.orderCount).toBe(1)

      // Add second order for same customer - this triggers the bug
      ordersCollection.utils.begin()
      ordersCollection.utils.write({
        type: `insert`,
        value: { id: 2, customerId: 1, amount: 200 },
      })
      ordersCollection.utils.commit()

      expect(customerTotals.size).toBe(1)
      expect(customerTotals.get(1)?.total).toBe(300)
      expect(customerTotals.get(1)?.orderCount).toBe(2)

      // Add third order
      ordersCollection.utils.begin()
      ordersCollection.utils.write({
        type: `insert`,
        value: { id: 3, customerId: 1, amount: 150 },
      })
      ordersCollection.utils.commit()

      expect(customerTotals.size).toBe(1)
      expect(customerTotals.get(1)?.total).toBe(450)
      expect(customerTotals.get(1)?.orderCount).toBe(3)
    })

    test(`batch processing works correctly (baseline)`, () => {
      // This test verifies that batch processing works - establishing the baseline
      type Event = {
        id: string
        language: string
      }

      // Create collection with initial data (batch processing)
      const eventsCollection = createCollection({
        id: `events-batch`,
        getKey: (event: Event) => event.id,
        sync: {
          sync: ({ begin, write, commit, markReady }) => {
            begin()
            write({
              type: `insert`,
              value: { id: `event1`, language: `ru` },
            })
            write({
              type: `insert`,
              value: { id: `event2`, language: `ru` },
            })
            write({
              type: `insert`,
              value: { id: `event3`, language: `en` },
            })
            commit()
            markReady()
          },
        },
        startSync: true,
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

      // Batch processing should work correctly
      expect(languageCounts.size).toBe(2)
      expect(languageCounts.get(`ru`)?.count).toBe(2)
      expect(languageCounts.get(`en`)?.count).toBe(1)
    })

    test(`mixed batch and incremental updates`, async () => {
      type EventType = {
        id: string
        language: string
      }

      const eventsCollection = createCollection(
        mockSyncCollectionOptionsNoInitialState<EventType>({
          id: `events-mixed`,
          getKey: (event) => event.id,
        }),
      )

      // Setup and batch insert initial data
      const preloadPromise = eventsCollection.preload()
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
      eventsCollection.utils.markReady()
      await preloadPromise

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

      // After batch, should have count 2
      expect(languageCounts.size).toBe(1)
      expect(languageCounts.get(`ru`)?.count).toBe(2)

      // Now add incrementally - this is where the bug occurs
      eventsCollection.utils.begin()
      eventsCollection.utils.write({
        type: `insert`,
        value: { id: `event3`, language: `ru` },
      })
      eventsCollection.utils.commit()

      expect(languageCounts.size).toBe(1)
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
})
