import { describe, expect, it } from 'vitest'
import { createCollection } from '../src/collection/index.js'
import { createLiveQueryCollection } from '../src/query/index.js'
import { eq } from '../src/query/builder/functions.js'
import { mockSyncCollectionOptions } from './utils.js'

/**
 * Test that reproduces the infinite loop bug caused by NaN values in comparisons.
 *
 * The bug occurs when:
 * 1. Data contains invalid Date objects (where getTime() returns NaN)
 * 2. An ORDER BY + LIMIT query runs on the date field
 * 3. The comparator returns NaN instead of -1, 0, or 1
 * 4. Binary search in TopK can't find a stable position
 * 5. The comparison function is called infinitely
 *
 * This matches the production bug where:
 * - Debugger paused in `gte` comparison code
 * - App completely froze (not just slow)
 * - Clearing Electric cache fixed it (fresh data had valid dates)
 */

type TestItem = {
  id: number
  name: string
  createdAt: Date
}

describe(`NaN comparator infinite loop`, () => {
  it(`should handle invalid dates in ORDER BY without infinite loop`, async () => {
    // Create data with a mix of valid and INVALID dates
    // Invalid dates have getTime() = NaN, which breaks comparisons
    const initialData: Array<TestItem> = [
      { id: 1, name: `Valid 1`, createdAt: new Date(`2024-01-01`) },
      { id: 2, name: `Valid 2`, createdAt: new Date(`2024-01-02`) },
      { id: 3, name: `Invalid`, createdAt: new Date(`not a valid date`) }, // NaN!
      { id: 4, name: `Valid 3`, createdAt: new Date(`2024-01-03`) },
      { id: 5, name: `Valid 4`, createdAt: new Date(`2024-01-04`) },
    ]

    // Verify we actually have an invalid date
    expect(Number.isNaN(initialData[2]!.createdAt.getTime())).toBe(true)

    const sourceCollection = createCollection(
      mockSyncCollectionOptions({
        id: `nan-date-test`,
        getKey: (item: TestItem) => item.id,
        initialData,
      }),
    )

    await sourceCollection.preload()

    // This query should NOT hang - it should either:
    // 1. Handle the NaN gracefully (ideal)
    // 2. Throw an error (acceptable)
    // 3. NOT infinite loop (critical)
    const liveQueryCollection = createLiveQueryCollection((q) =>
      q
        .from({ items: sourceCollection })
        .orderBy(({ items }) => items.createdAt, `desc`)
        .limit(3)
        .select(({ items }) => ({
          id: items.id,
          name: items.name,
          createdAt: items.createdAt,
        })),
    )

    // Set up a timeout to detect infinite loop
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Test timed out - infinite loop detected in ORDER BY with NaN date`))
      }, 5000)
    })

    // Race the preload against the timeout
    const result = await Promise.race([
      liveQueryCollection.preload().then(() => `completed`),
      timeoutPromise,
    ])

    expect(result).toBe(`completed`)

    // If we get here, the query completed without hanging
    const results = Array.from(liveQueryCollection.values())
    // We should have some results (exact behavior depends on how NaN is handled)
    expect(results.length).toBeGreaterThanOrEqual(0)
  })

  it(`should handle NaN in numeric ORDER BY without infinite loop`, async () => {
    // Test with explicit NaN numeric values (not just invalid dates)
    type NumericItem = {
      id: number
      value: number
    }

    const initialData: Array<NumericItem> = [
      { id: 1, value: 10 },
      { id: 2, value: 20 },
      { id: 3, value: NaN }, // Explicit NaN
      { id: 4, value: 30 },
      { id: 5, value: 40 },
    ]

    const sourceCollection = createCollection(
      mockSyncCollectionOptions({
        id: `nan-numeric-test`,
        getKey: (item: NumericItem) => item.id,
        initialData,
      }),
    )

    await sourceCollection.preload()

    const liveQueryCollection = createLiveQueryCollection((q) =>
      q
        .from({ items: sourceCollection })
        .orderBy(({ items }) => items.value, `desc`)
        .limit(3)
        .select(({ items }) => ({
          id: items.id,
          value: items.value,
        })),
    )

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Test timed out - infinite loop detected in ORDER BY with NaN value`))
      }, 5000)
    })

    const result = await Promise.race([
      liveQueryCollection.preload().then(() => `completed`),
      timeoutPromise,
    ])

    expect(result).toBe(`completed`)
  })

  it(`should handle mixed valid/invalid dates during updates without infinite loop`, async () => {
    // This simulates the Electric scenario where updates arrive with potentially invalid data
    const initialData: Array<TestItem> = [
      { id: 1, name: `Item 1`, createdAt: new Date(`2024-01-01`) },
      { id: 2, name: `Item 2`, createdAt: new Date(`2024-01-02`) },
      { id: 3, name: `Item 3`, createdAt: new Date(`2024-01-03`) },
    ]

    const { utils, ...options } = mockSyncCollectionOptions({
      id: `nan-update-test`,
      getKey: (item: TestItem) => item.id,
      initialData,
    })

    const sourceCollection = createCollection(options)
    await sourceCollection.preload()

    const liveQueryCollection = createLiveQueryCollection((q) =>
      q
        .from({ items: sourceCollection })
        .orderBy(({ items }) => items.createdAt, `desc`)
        .limit(5)
        .select(({ items }) => ({
          id: items.id,
          name: items.name,
        })),
    )

    await liveQueryCollection.preload()

    // Initial results should work
    let results = Array.from(liveQueryCollection.values())
    expect(results).toHaveLength(3)

    // Now send an UPDATE that introduces an invalid date
    // This simulates Electric sending corrupted data
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Test timed out - infinite loop detected after update with NaN date`))
      }, 5000)
    })

    const updatePromise = (async () => {
      utils.begin()
      utils.write({
        type: `update`,
        value: { id: 2, name: `Updated Item 2`, createdAt: new Date(`invalid date string`) },
      })
      utils.commit()

      // Wait for processing
      await new Promise((resolve) => setTimeout(resolve, 100))

      return `completed`
    })()

    const result = await Promise.race([updatePromise, timeoutPromise])
    expect(result).toBe(`completed`)

    // Query should still return results (behavior with NaN may vary)
    results = Array.from(liveQueryCollection.values())
    expect(results.length).toBeGreaterThanOrEqual(0)
  })

  it(`should handle JOIN + ORDER BY + LIMIT with rapid updates (Electric scenario)`, async () => {
    // This simulates the production scenario:
    // - Two collections JOINed together
    // - ORDER BY + LIMIT on a date field
    // - Rapid updates arriving during processing (like Electric initial sync)

    type User = { id: number; name: string }
    type Post = {
      id: number
      userId: number
      title: string
      createdAt: Date
    }

    const usersData: Array<User> = [
      { id: 1, name: `Alice` },
      { id: 2, name: `Bob` },
      { id: 3, name: `Charlie` },
    ]

    const postsData: Array<Post> = []
    for (let i = 1; i <= 20; i++) {
      postsData.push({
        id: i,
        userId: (i % 3) + 1,
        title: `Post ${i}`,
        createdAt: new Date(`2024-01-${String(i).padStart(2, `0`)}`),
      })
    }

    const usersCollection = createCollection(
      mockSyncCollectionOptions({
        id: `join-users`,
        getKey: (item: User) => item.id,
        initialData: usersData,
      }),
    )

    const { utils: postsUtils, ...postsOptions } = mockSyncCollectionOptions({
      id: `join-posts`,
      getKey: (item: Post) => item.id,
      initialData: postsData,
    })

    const postsCollection = createCollection(postsOptions)

    await usersCollection.preload()
    await postsCollection.preload()

    // JOIN + ORDER BY createdAt DESC + LIMIT 5
    const liveQueryCollection = createLiveQueryCollection((q) =>
      q
        .from({ posts: postsCollection })
        .join({ users: usersCollection }, ({ posts, users }) =>
          eq(posts.userId, users.id),
        )
        .orderBy(({ posts }) => posts.createdAt, `desc`)
        .limit(5)
        .select(({ posts, users }) => ({
          postId: posts.id,
          title: posts.title,
          author: users!.name,
          createdAt: posts.createdAt,
        })),
    )

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Test timed out - infinite loop in JOIN + ORDER BY + LIMIT`))
      }, 5000)
    })

    // Start preload and send rapid updates simultaneously (like Electric sync)
    const testPromise = (async () => {
      const preloadPromise = liveQueryCollection.preload()

      // Simulate rapid Electric updates during initial sync
      for (let i = 21; i <= 40; i++) {
        postsUtils.begin()
        postsUtils.write({
          type: `insert`,
          value: {
            id: i,
            userId: (i % 3) + 1,
            title: `Post ${i}`,
            createdAt: new Date(`2024-02-${String(i - 20).padStart(2, `0`)}`),
          },
        })
        postsUtils.commit()
        // Small delay between updates
        await new Promise((resolve) => setTimeout(resolve, 1))
      }

      await preloadPromise
      return `completed`
    })()

    const result = await Promise.race([testPromise, timeoutPromise])
    expect(result).toBe(`completed`)

    const results = Array.from(liveQueryCollection.values())
    expect(results.length).toBeLessThanOrEqual(5)
  })

  it(`should handle empty string dates (common data issue) without infinite loop`, async () => {
    // Empty strings are a common data issue - they create invalid dates
    // Simulate data that might come from a database with empty date fields
    const rawData = [
      { id: 1, name: `Has date`, createdAt: `2024-01-01` },
      { id: 2, name: `Empty string`, createdAt: `` }, // Common issue!
      { id: 3, name: `Has date`, createdAt: `2024-01-03` },
    ]

    // Convert to Date objects (as user code might do)
    const initialData: Array<TestItem> = rawData.map((item) => ({
      id: item.id,
      name: item.name,
      createdAt: new Date(item.createdAt), // Empty string -> Invalid Date
    }))

    // Verify empty string creates invalid date
    expect(Number.isNaN(initialData[1]!.createdAt.getTime())).toBe(true)

    const sourceCollection = createCollection(
      mockSyncCollectionOptions({
        id: `empty-string-date-test`,
        getKey: (item: TestItem) => item.id,
        initialData,
      }),
    )

    await sourceCollection.preload()

    const liveQueryCollection = createLiveQueryCollection((q) =>
      q
        .from({ items: sourceCollection })
        .orderBy(({ items }) => items.createdAt, `desc`)
        .limit(3)
        .select(({ items }) => ({
          id: items.id,
          name: items.name,
        })),
    )

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Test timed out - infinite loop with empty string date`))
      }, 5000)
    })

    const result = await Promise.race([
      liveQueryCollection.preload().then(() => `completed`),
      timeoutPromise,
    ])

    expect(result).toBe(`completed`)
  })
})
