/**
 * Predicates Test Suite
 *
 * Tests basic where clause functionality with all comparison operators
 * across different data types.
 */

import { describe, expect, it, vi } from 'vitest'
import {
  and,
  createLiveQueryCollection,
  eq,
  gt,
  gte,
  ilike,
  inArray,
  isNull,
  like,
  lower,
  lt,
  lte,
  not,
  or,
} from '@tanstack/db'
import { assertAllItemsMatch, assertCollectionSize } from '../utils/assertions'
import { waitForQueryData } from '../utils/helpers'
import type { E2ETestConfig, Post, User } from '../types'

type PredicateRow = User | Post

function capturePredicateRows(
  rows: Iterable<PredicateRow>,
): Array<PredicateRow> {
  return Array.from(rows, (row) =>
    structuredClone(
      'largeViewCount' in row
        ? {
            id: row.id,
            userId: row.userId,
            title: row.title,
            content: row.content,
            viewCount: row.viewCount,
            largeViewCount: row.largeViewCount,
            publishedAt: row.publishedAt,
            deletedAt: row.deletedAt,
          }
        : {
            id: row.id,
            name: row.name,
            email: row.email,
            age: row.age,
            isActive: row.isActive,
            createdAt: row.createdAt,
            metadata: row.metadata,
            deletedAt: row.deletedAt,
          },
    ),
  )
}

function assertPredicateRows(
  actual: Array<PredicateRow>,
  expected: Array<PredicateRow>,
  ordered: boolean,
) {
  const byId = (a: PredicateRow, b: PredicateRow) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  expect(ordered ? actual : [...actual].sort(byId)).toStrictEqual(
    ordered ? expected : [...expected].sort(byId),
  )
}

function orderedAliceRows(users: Array<User>): Array<User> {
  const expected = users
    .filter((u) => u.name.toLowerCase().includes('alice'))
    .sort((a, b) => a.name.localeCompare(b.name))
  // The existing witness uses this host-default locale and distinct names.
  // Reject a tied fixture before claiming an exact boundary identity/order.
  for (let index = 1; index < expected.length; index++) {
    expect(
      expected[index - 1]!.name.localeCompare(expected[index]!.name),
    ).not.toBe(0)
  }
  return expected
}

async function withPredicateRows(
  query: { values: () => Iterable<PredicateRow>; cleanup: () => Promise<void> },
  expectedRows: Array<PredicateRow>,
  oldChecks: () => Promise<void>,
  ordered = false,
) {
  const expected = structuredClone(expectedRows)
  const errors: Array<unknown> = []
  let observed: Array<PredicateRow> | undefined
  try {
    await oldChecks()
    observed = await vi.waitFor(
      () => {
        const captured = capturePredicateRows(query.values())
        assertPredicateRows(captured, expected, ordered)
        return captured
      },
      { timeout: 5000 },
    )
    if (observed.length > 0) {
      const metadataIndex = observed.findIndex(
        (row) => 'metadata' in row && row.metadata !== null,
      )
      if (metadataIndex !== -1) {
        const wrongMetadata = structuredClone(observed)
        const row = wrongMetadata[metadataIndex]!
        if (!('metadata' in row) || row.metadata === null) {
          throw new Error('Captured metadata control did not reach a User')
        }
        expect(Object.hasOwn(row.metadata, 'unexpected')).toBe(false)
        row.metadata.unexpected = undefined
        expect(Object.hasOwn(row.metadata, 'unexpected')).toBe(true)
        expect(() =>
          assertPredicateRows(wrongMetadata, expected, ordered),
        ).toThrow()
      }
      expect(() =>
        assertPredicateRows(observed!.slice(1), expected, ordered),
      ).toThrow()
      const wrongKey = structuredClone(observed)
      wrongKey[0]!.id += '-wrong'
      expect(() => assertPredicateRows(wrongKey, expected, ordered)).toThrow()
      const wrongValue = structuredClone(observed)
      const first = wrongValue[0]!
      if ('name' in first) first.name += '-wrong'
      else first.title += '-wrong'
      expect(() => assertPredicateRows(wrongValue, expected, ordered)).toThrow()
      if (observed.length > 1) {
        const duplicate = structuredClone(observed)
        duplicate[0] = structuredClone(duplicate[1]!)
        expect(() =>
          assertPredicateRows(duplicate, expected, ordered),
        ).toThrow()
        if (ordered) {
          expect(() =>
            assertPredicateRows([...observed!].reverse(), expected, true),
          ).toThrow()
        }
      }
    }
  } catch (error) {
    errors.push(error)
  } finally {
    try {
      await query.cleanup()
    } catch (error) {
      errors.push(error)
    }
  }
  if (observed) {
    try {
      assertPredicateRows(observed, expected, ordered)
    } catch (error) {
      errors.push(error)
    }
  }
  if (errors.length === 1) throw errors[0]
  if (errors.length > 1)
    throw new AggregateError(errors, 'Predicate history and cleanup failed')
}

export function createPredicatesTestSuite(
  getConfig: () => Promise<E2ETestConfig>,
) {
  describe(`Predicates Suite`, () => {
    describe(`Equality Operators`, () => {
      it(`should filter with eq() on string field`, async () => {
        const config = await getConfig()
        const fixture = config.fixture()
        const expected = fixture.users.filter((u) => u.name === `Alice 0`)
        const usersCollection = config.collections.onDemand.users

        const query = createLiveQueryCollection((q) =>
          q
            .from({ user: usersCollection })
            .where(({ user }) => eq(user.name, `Alice 0`)),
        )
        await withPredicateRows(query, expected, async () => {
          await query.preload()
          await waitForQueryData(query, { minSize: 1 })

          const results = Array.from(query.state.values())
          expect(results.length).toBeGreaterThan(0)
          expect(results.every((u) => u.name === `Alice 0`)).toBe(true)
        })
      })

      it(`should filter with eq() on number field`, async () => {
        const config = await getConfig()
        const fixture = config.fixture()
        const expected = fixture.users.filter((u) => u.age === 25)
        const usersCollection = config.collections.onDemand.users

        const query = createLiveQueryCollection((q) =>
          q
            .from({ user: usersCollection })
            .where(({ user }) => eq(user.age, 25)),
        )
        await withPredicateRows(query, expected, async () => {
          await query.preload()

          assertAllItemsMatch(query, (u) => u.age === 25)
        })
      })

      it(`should filter with eq() on boolean field`, async () => {
        const config = await getConfig()
        const fixture = config.fixture()
        const expected = fixture.users.filter((u) => u.isActive === true)
        const usersCollection = config.collections.onDemand.users

        const query = createLiveQueryCollection((q) =>
          q
            .from({ user: usersCollection })
            .where(({ user }) => eq(user.isActive, true)),
        )
        await withPredicateRows(query, expected, async () => {
          await query.preload()
          await waitForQueryData(query, { minSize: 1 })

          const results = Array.from(query.state.values())
          expect(results.length).toBeGreaterThan(0)
          assertAllItemsMatch(query, (u) => u.isActive === true)
        })
      })

      it(`should filter with eq() on UUID field`, async () => {
        const config = await getConfig()
        const fixture = config.fixture()
        const expected = fixture.users.filter(
          (u) => u.id === `00000000-0000-4000-8000-000000000000`,
        )
        const usersCollection = config.collections.onDemand.users

        const testUserId = `00000000-0000-4000-8000-000000000000` // User ID for index 0

        const query = createLiveQueryCollection((q) =>
          q
            .from({ user: usersCollection })
            .where(({ user }) => eq(user.id, testUserId)),
        )
        await withPredicateRows(query, expected, async () => {
          await query.preload()
          await waitForQueryData(query, { minSize: 1 })

          assertCollectionSize(query, 1)
          const result = Array.from(query.state.values())[0]
          expect(result?.id).toBe(testUserId)
        })
      })

      it(`should filter with isNull() for null values`, async () => {
        const config = await getConfig()
        const fixture = config.fixture()
        const expected = fixture.users.filter((u) => u.email === null)
        const usersCollection = config.collections.onDemand.users

        const query = createLiveQueryCollection((q) =>
          q
            .from({ user: usersCollection })
            .where(({ user }) => isNull(user.email)),
        )
        await withPredicateRows(query, expected, async () => {
          await query.preload()
          await waitForQueryData(query, { minSize: 1 })

          const results = Array.from(query.state.values())
          expect(results.length).toBeGreaterThan(0)
          assertAllItemsMatch(query, (u) => u.email === null)
        })
      })
    })

    describe(`Inequality Operators`, () => {
      it(`should filter with not(eq()) on string field`, async () => {
        const config = await getConfig()
        const fixture = config.fixture()
        const expected = fixture.users.filter((u) => u.name !== `Alice 0`)
        const usersCollection = config.collections.onDemand.users

        const query = createLiveQueryCollection((q) =>
          q
            .from({ user: usersCollection })
            .where(({ user }) => not(eq(user.name, `Alice 0`))),
        )
        await withPredicateRows(query, expected, async () => {
          await query.preload()
          await waitForQueryData(query, { minSize: 1 })

          const results = Array.from(query.state.values())
          expect(results.length).toBeGreaterThan(0)
          assertAllItemsMatch(query, (u) => u.name !== `Alice 0`)
        })
      })

      it(`should filter with not(isNull()) for non-null values`, async () => {
        const config = await getConfig()
        const fixture = config.fixture()
        const expected = fixture.users.filter((u) => u.email !== null)
        const usersCollection = config.collections.onDemand.users

        const query = createLiveQueryCollection((q) =>
          q
            .from({ user: usersCollection })
            .where(({ user }) => not(isNull(user.email))),
        )
        await withPredicateRows(query, expected, async () => {
          await query.preload()
          await waitForQueryData(query, { minSize: 1 })

          const results = Array.from(query.state.values())
          expect(results.length).toBeGreaterThan(0)
          assertAllItemsMatch(query, (u) => u.email !== null)
        })
      })
    })

    describe(`Comparison Operators`, () => {
      it(`should filter with gt() on number field`, async () => {
        const config = await getConfig()
        const fixture = config.fixture()
        const expected = fixture.users.filter((u) => u.age > 50)
        const usersCollection = config.collections.onDemand.users

        const query = createLiveQueryCollection((q) =>
          q
            .from({ user: usersCollection })
            .where(({ user }) => gt(user.age, 50)),
        )
        await withPredicateRows(query, expected, async () => {
          await query.preload()

          assertAllItemsMatch(query, (u) => u.age > 50)
        })
      })

      it(`should filter with gte() on number field`, async () => {
        const config = await getConfig()
        const fixture = config.fixture()
        const expected = fixture.users.filter((u) => u.age >= 50)
        const usersCollection = config.collections.onDemand.users

        const query = createLiveQueryCollection((q) =>
          q
            .from({ user: usersCollection })
            .where(({ user }) => gte(user.age, 50)),
        )
        await withPredicateRows(query, expected, async () => {
          await query.preload()

          assertAllItemsMatch(query, (u) => u.age >= 50)
        })
      })

      it(`should filter with lt() on number field`, async () => {
        const config = await getConfig()
        const fixture = config.fixture()
        const expected = fixture.users.filter((u) => u.age < 30)
        const usersCollection = config.collections.onDemand.users

        const query = createLiveQueryCollection((q) =>
          q
            .from({ user: usersCollection })
            .where(({ user }) => lt(user.age, 30)),
        )
        await withPredicateRows(query, expected, async () => {
          await query.preload()

          assertAllItemsMatch(query, (u) => u.age < 30)
        })
      })

      it(`should filter with lte() on number field`, async () => {
        const config = await getConfig()
        const fixture = config.fixture()
        const expected = fixture.users.filter((u) => u.age <= 30)
        const usersCollection = config.collections.onDemand.users

        const query = createLiveQueryCollection((q) =>
          q
            .from({ user: usersCollection })
            .where(({ user }) => lte(user.age, 30)),
        )
        await withPredicateRows(query, expected, async () => {
          await query.preload()

          assertAllItemsMatch(query, (u) => u.age <= 30)
        })
      })

      it(`should filter with gt() on viewCount field`, async () => {
        const config = await getConfig()
        const fixture = config.fixture()
        const expected = fixture.posts.filter((p) => p.viewCount > 100)
        const postsCollection = config.collections.onDemand.posts

        const query = createLiveQueryCollection((q) =>
          q
            .from({ post: postsCollection })
            .where(({ post }) => gt(post.viewCount, 100)),
        )
        await withPredicateRows(query, expected, async () => {
          await query.preload()

          assertAllItemsMatch(query, (p) => p.viewCount > 100)
        })
      })

      it(`should filter with eq() on BIGINT field using JavaScript BigInt`, async () => {
        const config = await getConfig()
        const fixture = config.fixture()
        const expected = fixture.posts.filter(
          (p) => p.largeViewCount === 9007199254740992n,
        )
        const postsCollection = config.collections.onDemand.posts

        // Target the first post which has largeViewCount = 9007199254740992n (MAX_SAFE_INTEGER + 1)
        const targetBigInt = BigInt(`9007199254740992`)

        const query = createLiveQueryCollection((q) =>
          q
            .from({ post: postsCollection })
            .where(({ post }) => eq(post.largeViewCount, targetBigInt)),
        )
        await withPredicateRows(query, expected, async () => {
          await query.preload()
          await waitForQueryData(query, { minSize: 1 })

          const results = Array.from(query.state.values())
          expect(results.length).toBe(1)
          // Post 0 has largeViewCount = 9007199254740992n
          // Database may return as bigint or string depending on driver
          assertAllItemsMatch(query, (p) => {
            const value = String(p.largeViewCount)
            return value === targetBigInt.toString()
          })
        })
      })

      it(`should filter with gt() on BIGINT field using JavaScript BigInt`, async () => {
        const config = await getConfig()
        const fixture = config.fixture()
        const expected = fixture.posts.filter(
          (p) => p.largeViewCount > 9007199254740995n,
        )
        const postsCollection = config.collections.onDemand.posts

        // Filter for posts with largeViewCount > 9007199254740995
        // This should match posts 4-9 (indices 4,5,6,7,8,9 have values 9007199254740996-9007199254741001)
        const thresholdBigInt = BigInt(`9007199254740995`)

        const query = createLiveQueryCollection((q) =>
          q
            .from({ post: postsCollection })
            .where(({ post }) => gt(post.largeViewCount, thresholdBigInt)),
        )
        await withPredicateRows(query, expected, async () => {
          await query.preload()
          await waitForQueryData(query, { minSize: 1 })

          const results = Array.from(query.state.values())
          expect(results.length).toBeGreaterThan(0)
          // All results should have largeViewCount > threshold
          assertAllItemsMatch(query, (p) => {
            const value =
              typeof p.largeViewCount === `bigint`
                ? p.largeViewCount
                : BigInt(p.largeViewCount)
            return value > thresholdBigInt
          })
        })
      })
    })

    describe(`String Pattern Matching Operators`, () => {
      it(`should filter with like() operator (case-sensitive)`, async () => {
        const config = await getConfig()
        const fixture = config.fixture()
        const expected = fixture.users.filter((u) => u.name.startsWith(`Alice`))
        const usersCollection = config.collections.onDemand.users

        const query = createLiveQueryCollection((q) =>
          q
            .from({ user: usersCollection })
            .where(({ user }) => like(user.name, `Alice%`)),
        )
        await withPredicateRows(query, expected, async () => {
          await query.preload()
          await waitForQueryData(query, { minSize: 1 })

          const results = Array.from(query.state.values())
          expect(results.length).toBeGreaterThan(0)
          // Should match names starting with "Alice" (case-sensitive)
          assertAllItemsMatch(query, (u) => u.name.startsWith(`Alice`))
        })
      })

      it(`should filter with ilike() operator (case-insensitive)`, async () => {
        const config = await getConfig()
        const fixture = config.fixture()
        const expected = fixture.users.filter((u) =>
          u.name.toLowerCase().startsWith(`alice`),
        )
        const usersCollection = config.collections.onDemand.users

        const query = createLiveQueryCollection((q) =>
          q
            .from({ user: usersCollection })
            .where(({ user }) => ilike(user.name, `alice%`)),
        )
        await withPredicateRows(query, expected, async () => {
          await query.preload()
          await waitForQueryData(query, { minSize: 1 })

          const results = Array.from(query.state.values())
          expect(results.length).toBeGreaterThan(0)
          // Should match names starting with "Alice" (case-insensitive)
          assertAllItemsMatch(query, (u) =>
            u.name.toLowerCase().startsWith(`alice`),
          )
        })
      })

      it(`should filter with like() with wildcard pattern (% at end)`, async () => {
        const config = await getConfig()
        const fixture = config.fixture()
        const expected = fixture.users.filter(
          (u) => u.email?.endsWith(`@example.com`) ?? false,
        )
        const usersCollection = config.collections.onDemand.users

        const query = createLiveQueryCollection((q) =>
          q
            .from({ user: usersCollection })
            .where(({ user }) => like(user.email, `%@example.com`)),
        )
        await withPredicateRows(query, expected, async () => {
          await query.preload()
          await waitForQueryData(query, { minSize: 1 })

          const results = Array.from(query.state.values())
          expect(results.length).toBeGreaterThan(0)
          // Should match emails ending with @example.com
          assertAllItemsMatch(
            query,
            (u) => u.email?.endsWith(`@example.com`) ?? false,
          )
        })
      })

      it(`should filter with like() with wildcard pattern (% in middle)`, async () => {
        const config = await getConfig()
        const fixture = config.fixture()
        const expected = fixture.users.filter(
          (u) => u.email !== null && /^user.*0@example\.com$/.test(u.email),
        )
        const usersCollection = config.collections.onDemand.users

        const query = createLiveQueryCollection((q) =>
          q
            .from({ user: usersCollection })
            .where(({ user }) => like(user.email, `user%0@example.com`)),
        )
        await withPredicateRows(query, expected, async () => {
          await query.preload()
          await waitForQueryData(query, { minSize: 1 })

          const results = Array.from(query.state.values())
          expect(results.length).toBeGreaterThan(0)
          // Should match emails like user0@example.com, user10@example.com, user20@example.com, etc.
          assertAllItemsMatch(
            query,
            (u) => (u.email?.match(/^user.*0@example\.com$/) ?? null) !== null,
          )
        })
      })

      it(`should filter with like() with wildcard pattern matching newline`, async () => {
        const config = await getConfig()
        const fixture = config.fixture()
        const expected = fixture.users.filter((u) =>
          u.name.startsWith(`Ursula`),
        )
        const usersCollection = config.collections.onDemand.users

        const query = createLiveQueryCollection((q) =>
          q
            .from({ user: usersCollection })
            .where(({ user }) => like(user.name, `Ursula%`)),
        )
        await withPredicateRows(query, expected, async () => {
          await query.preload()
          await waitForQueryData(query, { minSize: 1 })

          const results = Array.from(query.state.values())
          expect(results.length).toBeGreaterThan(0)
          // should match names starting with "Ursula" even if it contains a newline character
          assertAllItemsMatch(query, (u) => u.name.startsWith(`Ursula`))
        })
      })

      it(`should filter with like() with lower() function`, async () => {
        const config = await getConfig()
        const fixture = config.fixture()
        const expected = fixture.users.filter((u) =>
          u.name.toLowerCase().includes(`alice`),
        )
        const usersCollection = config.collections.onDemand.users

        const query = createLiveQueryCollection((q) =>
          q
            .from({ user: usersCollection })
            .where(({ user }) => like(lower(user.name), `%alice%`)),
        )
        await withPredicateRows(query, expected, async () => {
          await query.preload()
          await waitForQueryData(query, { minSize: 1 })

          const results = Array.from(query.state.values())
          expect(results.length).toBeGreaterThan(0)
          // Should match names containing "alice" (case-insensitive via lower())
          assertAllItemsMatch(query, (u) =>
            u.name.toLowerCase().includes(`alice`),
          )
        })
      })

      it(`should filter with ilike() with lower() function`, async () => {
        const config = await getConfig()
        const fixture = config.fixture()
        const expected = fixture.users.filter((u) =>
          u.name.toLowerCase().includes(`bob`),
        )
        const usersCollection = config.collections.onDemand.users

        const query = createLiveQueryCollection((q) =>
          q
            .from({ user: usersCollection })
            .where(({ user }) => ilike(lower(user.name), `%bob%`)),
        )
        await withPredicateRows(query, expected, async () => {
          await query.preload()
          await waitForQueryData(query, { minSize: 1 })

          const results = Array.from(query.state.values())
          expect(results.length).toBeGreaterThan(0)
          // Should match names containing "bob" (case-insensitive)
          assertAllItemsMatch(query, (u) =>
            u.name.toLowerCase().includes(`bob`),
          )
        })
      })

      it(`should filter with or() combining multiple like() conditions (search pattern)`, async () => {
        const config = await getConfig()
        const fixture = config.fixture()
        const expected = fixture.posts.filter(
          (p) =>
            p.title.toLowerCase().includes(`introduction`) ||
            (p.content?.toLowerCase().includes(`introduction`) ?? false),
        )
        const postsCollection = config.collections.onDemand.posts

        // This mimics the user's exact query pattern with multiple fields
        // User's pattern: like(lower(offers.title), `%${searchLower}%`) OR like(lower(offers.human_id), `%${searchLower}%`)
        const searchTerm = `Introduction`
        const searchLower = searchTerm.toLowerCase()

        const query = createLiveQueryCollection((q) =>
          q
            .from({ post: postsCollection })
            .where(({ post }) =>
              or(
                like(lower(post.title), `%${searchLower}%`),
                like(lower(post.content ?? ``), `%${searchLower}%`),
              ),
            ),
        )
        await withPredicateRows(query, expected, async () => {
          await query.preload()
          await waitForQueryData(query, { minSize: 1 })

          const results = Array.from(query.state.values())
          expect(results.length).toBeGreaterThan(0)
          // Should match posts with title or content containing "introduction" (case-insensitive)
          assertAllItemsMatch(
            query,
            (p) =>
              p.title.toLowerCase().includes(searchLower) ||
              (p.content?.toLowerCase().includes(searchLower) ?? false),
          )
        })
      })

      it(`should filter with like() and orderBy`, async () => {
        const config = await getConfig()
        const fixture = config.fixture()
        const expected = orderedAliceRows(fixture.users)
        const usersCollection = config.collections.onDemand.users

        const query = createLiveQueryCollection((q) =>
          q
            .from({ user: usersCollection })
            .where(({ user }) => like(lower(user.name), `%alice%`))
            .orderBy(({ user }) => user.name, `asc`),
        )
        await withPredicateRows(
          query,
          expected,
          async () => {
            await query.preload()
            await waitForQueryData(query, { minSize: 1 })

            const results = Array.from(query.state.values())
            expect(results.length).toBeGreaterThan(0)
            assertAllItemsMatch(query, (u) =>
              u.name.toLowerCase().includes(`alice`),
            )

            // Verify ordering
            const names = results.map((u) => u.name)
            const sortedNames = [...names].sort((a, b) => a.localeCompare(b))
            expect(names).toEqual(sortedNames)
          },
          true,
        )
      })

      it(`should filter with like() and limit`, async () => {
        const config = await getConfig()
        const fixture = config.fixture()
        const expected = orderedAliceRows(fixture.users).slice(0, 5)
        const usersCollection = config.collections.onDemand.users

        const query = createLiveQueryCollection((q) =>
          q
            .from({ user: usersCollection })
            .where(({ user }) => like(lower(user.name), `%alice%`))
            .orderBy(({ user }) => user.name, `asc`) // Required when using LIMIT
            .limit(5),
        )
        await withPredicateRows(
          query,
          expected,
          async () => {
            await query.preload()
            await waitForQueryData(query, { minSize: 1 })

            const results = Array.from(query.state.values())
            // Should respect limit
            expect(results.length).toBeLessThanOrEqual(5)
            assertAllItemsMatch(query, (u) =>
              u.name.toLowerCase().includes(`alice`),
            )
          },
          true,
        )
      })

      it(`should handle like() with pattern matching no records`, async () => {
        const config = await getConfig()
        const fixture = config.fixture()
        const expected = fixture.users.filter((u) =>
          u.name.startsWith(`NonExistent`),
        )
        const usersCollection = config.collections.onDemand.users

        const query = createLiveQueryCollection((q) =>
          q
            .from({ user: usersCollection })
            .where(({ user }) => like(user.name, `NonExistent%`)),
        )
        await withPredicateRows(query, expected, async () => {
          await query.preload()

          assertCollectionSize(query, 0)
        })
      })
    })

    describe(`In Operator`, () => {
      it(`should filter with inArray() on string array`, async () => {
        const config = await getConfig()
        const fixture = config.fixture()
        const expected = fixture.users.filter((u) =>
          [`Alice 0`, `bob 1`, `Charlie 2`].includes(u.name),
        )
        const usersCollection = config.collections.onDemand.users

        const query = createLiveQueryCollection((q) =>
          q
            .from({ user: usersCollection })
            .where(({ user }) =>
              inArray(user.name, [`Alice 0`, `bob 1`, `Charlie 2`]),
            ),
        )
        await withPredicateRows(query, expected, async () => {
          await query.preload()

          const validNames = new Set([`Alice 0`, `bob 1`, `Charlie 2`])
          assertAllItemsMatch(query, (u) => validNames.has(u.name))
        })
      })

      it(`should filter with inArray() on number array`, async () => {
        const config = await getConfig()
        const fixture = config.fixture()
        const expected = fixture.users.filter((u) =>
          [25, 30, 35].includes(u.age),
        )
        const usersCollection = config.collections.onDemand.users

        const query = createLiveQueryCollection((q) =>
          q
            .from({ user: usersCollection })
            .where(({ user }) => inArray(user.age, [25, 30, 35])),
        )
        await withPredicateRows(query, expected, async () => {
          await query.preload()

          const validAges = new Set([25, 30, 35])
          assertAllItemsMatch(query, (u) => validAges.has(u.age))
        })
      })

      it(`should filter with inArray() on UUID array`, async () => {
        const config = await getConfig()
        const fixture = config.fixture()
        const expected = fixture.users.filter((u) =>
          [
            `00000000-0000-4000-8000-000000000000`,
            `00000001-0000-4000-8000-000000000001`,
            `00000002-0000-4000-8000-000000000002`,
          ].includes(u.id),
        )
        const usersCollection = config.collections.onDemand.users

        const userIds = [
          `00000000-0000-4000-8000-000000000000`, // User ID for index 0
          `00000001-0000-4000-8000-000000000001`, // User ID for index 1
          `00000002-0000-4000-8000-000000000002`, // User ID for index 2
        ]

        const query = createLiveQueryCollection((q) =>
          q
            .from({ user: usersCollection })
            .where(({ user }) => inArray(user.id, userIds)),
        )
        await withPredicateRows(query, expected, async () => {
          await query.preload()

          const validIds = new Set(userIds)
          assertAllItemsMatch(query, (u) => validIds.has(u.id))
        })
      })

      it(`should handle empty inArray()`, async () => {
        const config = await getConfig()
        const fixture = config.fixture()
        const expectedIds = new Set<string>()
        const expected = fixture.users.filter((u) => expectedIds.has(u.id))
        const usersCollection = config.collections.onDemand.users

        const query = createLiveQueryCollection((q) =>
          q
            .from({ user: usersCollection })
            .where(({ user }) => inArray(user.id, [])),
        )
        await withPredicateRows(query, expected, async () => {
          await query.preload()

          assertCollectionSize(query, 0)
        })
      })

      it(`should filter with inArray() on BIGINT array using JavaScript BigInt`, async () => {
        const config = await getConfig()
        const fixture = config.fixture()
        const expected = fixture.posts.filter((p) =>
          [9007199254740992n, 9007199254740993n].includes(p.largeViewCount),
        )
        const postsCollection = config.collections.onDemand.posts

        // Target posts 0 and 1 which have largeViewCount values:
        // Post 0: 9007199254740992n, Post 1: 9007199254740993n
        const targetBigInts = [
          BigInt(`9007199254740992`),
          BigInt(`9007199254740993`),
        ]

        const query = createLiveQueryCollection((q) =>
          q
            .from({ post: postsCollection })
            .where(({ post }) => inArray(post.largeViewCount, targetBigInts)),
        )
        await withPredicateRows(query, expected, async () => {
          await query.preload()
          await waitForQueryData(query, { minSize: 2 })

          const results = Array.from(query.state.values())
          expect(results.length).toBe(2)

          // Verify both matching posts are returned
          const targetStrings = targetBigInts.map((b) => b.toString())
          assertAllItemsMatch(query, (p) => {
            const value =
              typeof p.largeViewCount === `bigint`
                ? p.largeViewCount.toString()
                : String(p.largeViewCount)
            return targetStrings.includes(value)
          })
        })
      })
    })

    describe(`Null Operators`, () => {
      it(`should filter with isNull() on nullable field`, async () => {
        const config = await getConfig()
        const fixture = config.fixture()
        const expected = fixture.users.filter((u) => u.email === null)
        const usersCollection = config.collections.onDemand.users

        const query = createLiveQueryCollection((q) =>
          q
            .from({ user: usersCollection })
            .where(({ user }) => isNull(user.email)),
        )
        await withPredicateRows(query, expected, async () => {
          await query.preload()
          await waitForQueryData(query, { minSize: 1 })

          const results = Array.from(query.state.values())
          expect(results.length).toBeGreaterThan(0)
          assertAllItemsMatch(query, (u) => u.email === null)
        })
      })

      it(`should filter with not(isNull()) on nullable field`, async () => {
        const config = await getConfig()
        const fixture = config.fixture()
        const expected = fixture.users.filter((u) => u.email !== null)
        const usersCollection = config.collections.onDemand.users

        const query = createLiveQueryCollection((q) =>
          q
            .from({ user: usersCollection })
            .where(({ user }) => not(isNull(user.email))),
        )
        await withPredicateRows(query, expected, async () => {
          await query.preload()
          await waitForQueryData(query, { minSize: 1 })

          const results = Array.from(query.state.values())
          expect(results.length).toBeGreaterThan(0)
          assertAllItemsMatch(query, (u) => u.email !== null)
        })
      })

      it(`should filter with isNull() on deletedAt (soft delete pattern)`, async () => {
        const config = await getConfig()
        const fixture = config.fixture()
        const expected = fixture.users.filter((u) => u.deletedAt === null)
        const usersCollection = config.collections.onDemand.users

        const query = createLiveQueryCollection((q) =>
          q
            .from({ user: usersCollection })
            .where(({ user }) => isNull(user.deletedAt)),
        )
        await withPredicateRows(query, expected, async () => {
          await query.preload()
          await waitForQueryData(query, { minSize: 1 })

          const results = Array.from(query.state.values())
          expect(results.length).toBeGreaterThan(0)
          assertAllItemsMatch(query, (u) => u.deletedAt === null)
        })
      })
    })

    describe(`Boolean Logic`, () => {
      it(`should combine predicates with and()`, async () => {
        const config = await getConfig()
        const fixture = config.fixture()
        const expected = fixture.users.filter(
          (u) => u.age > 25 && u.isActive === true,
        )
        const usersCollection = config.collections.onDemand.users

        const query = createLiveQueryCollection((q) =>
          q
            .from({ user: usersCollection })
            .where(({ user }) =>
              and(gt(user.age, 25), eq(user.isActive, true)),
            ),
        )
        await withPredicateRows(query, expected, async () => {
          await query.preload()

          assertAllItemsMatch(query, (u) => u.age > 25 && u.isActive === true)
        })
      })

      it(`should combine predicates with or()`, async () => {
        const config = await getConfig()
        const fixture = config.fixture()
        const expected = fixture.users.filter(
          (u) => u.age === 25 || u.age === 30,
        )
        const usersCollection = config.collections.onDemand.users

        const query = createLiveQueryCollection((q) =>
          q
            .from({ user: usersCollection })
            .where(({ user }) => or(eq(user.age, 25), eq(user.age, 30))),
        )
        await withPredicateRows(query, expected, async () => {
          await query.preload()

          assertAllItemsMatch(query, (u) => u.age === 25 || u.age === 30)
        })
      })

      it(`should handle complex nested logic`, async () => {
        const config = await getConfig()
        const fixture = config.fixture()
        const expected = fixture.users.filter(
          (u) => (u.age === 25 || u.age === 30) && u.isActive === true,
        )
        const usersCollection = config.collections.onDemand.users

        const query = createLiveQueryCollection((q) =>
          q
            .from({ user: usersCollection })
            .where(({ user }) =>
              and(
                or(eq(user.age, 25), eq(user.age, 30)),
                eq(user.isActive, true),
              ),
            ),
        )
        await withPredicateRows(query, expected, async () => {
          await query.preload()

          assertAllItemsMatch(
            query,
            (u) => (u.age === 25 || u.age === 30) && u.isActive === true,
          )
        })
      })

      it(`should handle NOT operator`, async () => {
        const config = await getConfig()
        const fixture = config.fixture()
        const expected = fixture.users.filter((u) => u.isActive !== true)
        const usersCollection = config.collections.onDemand.users

        const query = createLiveQueryCollection((q) =>
          q
            .from({ user: usersCollection })
            .where(({ user }) => not(eq(user.isActive, true))),
        )
        await withPredicateRows(query, expected, async () => {
          await query.preload()

          assertAllItemsMatch(query, (u) => u.isActive !== true)
        })
      })
    })

    describe(`Predicate Result Verification`, () => {
      it(`should return only data matching the predicate`, async () => {
        const config = await getConfig()
        const fixture = config.fixture()
        const expected = fixture.users.filter((u) => u.age === 25)
        const usersCollection = config.collections.onDemand.users

        const query = createLiveQueryCollection((q) =>
          q
            .from({ user: usersCollection })
            .where(({ user }) => eq(user.age, 25)),
        )
        await withPredicateRows(query, expected, async () => {
          await query.preload()
          await waitForQueryData(query, { minSize: 1 })

          // This checks query output, not physical backend acquisition.
          const results = Array.from(query.state.values())
          expect(results.length).toBeGreaterThan(0)
          expect(results.length).toBeLessThan(100) // Filtered output, not backend work
        })
      })

      it(`should exclude deleted records from filtered results`, async () => {
        const config = await getConfig()
        const fixture = config.fixture()
        const expected = fixture.users.filter((u) => u.deletedAt === null)
        const usersCollection = config.collections.onDemand.users

        const query = createLiveQueryCollection((q) =>
          q
            .from({ user: usersCollection })
            .where(({ user }) => isNull(user.deletedAt)),
        )
        await withPredicateRows(query, expected, async () => {
          await query.preload()
          await waitForQueryData(query, { minSize: 1 })

          const results = Array.from(query.state.values())
          expect(results.length).toBeGreaterThan(0)
          assertAllItemsMatch(query, (u) => u.deletedAt === null)
        })
      })
    })

    describe(`Multiple where() Calls`, () => {
      it(`should AND multiple where() calls together`, async () => {
        const config = await getConfig()
        const fixture = config.fixture()
        const expected = fixture.users.filter(
          (u) => u.age > 25 && u.isActive === true,
        )
        const usersCollection = config.collections.onDemand.users

        const query = createLiveQueryCollection((q) =>
          q
            .from({ user: usersCollection })
            .where(({ user }) => gt(user.age, 25))
            .where(({ user }) => eq(user.isActive, true)),
        )
        await withPredicateRows(query, expected, async () => {
          await query.preload()

          assertAllItemsMatch(query, (u) => u.age > 25 && u.isActive === true)
        })
      })
    })

    describe(`Edge Cases`, () => {
      it(`should handle query with no where clause on on-demand collection`, async () => {
        // NOTE: Electric has a bug where empty subset requests don't load data
        // We work around this by injecting "true = true" when there's no where clause
        // This is always true so doesn't filter data, just tricks Electric into loading

        const config = await getConfig()
        const fixture = config.fixture()
        const expected = fixture.users
        const usersCollection = config.collections.onDemand.users

        // Query with NO where clause - loads all data
        const query = createLiveQueryCollection(
          (q) => q.from({ user: usersCollection }),
          // No where, no limit, no orderBy
        )
        await withPredicateRows(query, expected, async () => {
          await query.preload()
          await waitForQueryData(query, { minSize: 50 })

          // Should load significant data (true = true workaround for Electric)
          expect(query.size).toBeGreaterThan(0)
          expect(query.size).toBe(usersCollection.size) // Query shows all collection data
        })
      })

      it(`should handle predicate matching no records`, async () => {
        const config = await getConfig()
        const fixture = config.fixture()
        const expected = fixture.users.filter((u) => u.age === 999)
        const usersCollection = config.collections.onDemand.users

        const query = createLiveQueryCollection((q) =>
          q
            .from({ user: usersCollection })
            .where(({ user }) => eq(user.age, 999)),
        )
        await withPredicateRows(query, expected, async () => {
          await query.preload()

          assertCollectionSize(query, 0)
        })
      })

      it(`should handle complex AND with no matches`, async () => {
        const config = await getConfig()
        const fixture = config.fixture()
        const expected = fixture.users.filter((u) =>
          [25, 30].every((age) => u.age === age),
        )
        const usersCollection = config.collections.onDemand.users

        const query = createLiveQueryCollection((q) =>
          q.from({ user: usersCollection }).where(({ user }) =>
            and(
              eq(user.age, 25),
              eq(user.age, 30), // Impossible: age can't be both 25 and 30
            ),
          ),
        )
        await withPredicateRows(query, expected, async () => {
          await query.preload()

          assertCollectionSize(query, 0)
        })
      })
    })
  })
}
