/**
 * Pagination Test Suite
 *
 * Tests ordering, limits, offsets, and window management
 */

import { describe, expect, it, vi } from 'vitest'
import { createLiveQueryCollection, eq } from '@tanstack/db'
import {
  assertAllItemsMatch,
  assertCollectionSize,
  assertSorted,
} from '../utils/assertions'
import { waitForQueryData } from '../utils/helpers'
import type { E2ETestConfig, Post, User } from '../types'

type WindowRow = User | Post

function captureWindowRows(rows: Iterable<WindowRow>): Array<WindowRow> {
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

function createWindowOracle<T extends WindowRow>(
  input: Array<T>,
  compare: (left: T, right: T) => number,
  archive: (check: () => void) => void,
) {
  const fixture = structuredClone(input)
  const byId = new Map(fixture.map((row) => [row.id, row]))
  expect(byId.size).toBe(fixture.length)
  const ranked = [...fixture].sort(compare)

  const assert = (
    actual: Array<WindowRow>,
    offset: number,
    limit: number = fixture.length,
  ) => {
    const expectedRanks = ranked.slice(offset, offset + limit)
    expect(actual.length).toBe(expectedRanks.length)
    expect(new Set(actual.map((row) => row.id)).size).toBe(actual.length)
    actual.forEach((row, index) => {
      const original = byId.get(row.id)
      expect(original).toBeDefined()
      if (!original) throw new Error('Window row is outside its fixture')
      expect(row).toStrictEqual(original)
      // Equal declared ranks are legal ties, not permission to change values
      // or repeat a row. No hidden ID tie-breaker enters the old query.
      expect(compare(original, expectedRanks[index]!)).toBe(0)
    })
  }

  return {
    assert,
    async check(
      query: { values: () => Iterable<WindowRow> },
      offset: number,
      limit: number = fixture.length,
    ): Promise<Array<WindowRow>> {
      const captured = await vi.waitFor(
        () => {
          const rows = captureWindowRows(query.values())
          assert(rows, offset, limit)
          return rows
        },
        { timeout: 5000 },
      )
      archive(() => assert(captured, offset, limit))
      if (captured.length > 0) {
        expect(() => assert(captured.slice(1), offset, limit)).toThrow()
        const wrongKey = structuredClone(captured)
        wrongKey[0]!.id += '-wrong'
        expect(() => assert(wrongKey, offset, limit)).toThrow()
        const wrongValue = structuredClone(captured)
        const first = wrongValue[0]!
        if ('name' in first) first.name += '-wrong'
        else first.title += '-wrong'
        expect(() => assert(wrongValue, offset, limit)).toThrow()

        const ids = new Set(captured.map((row) => row.id))
        const firstRank = byId.get(captured[0]!.id)!
        const outsideRank = fixture.find(
          (row) => !ids.has(row.id) && compare(row, firstRank) !== 0,
        )
        if (outsideRank) {
          const wrongPage = structuredClone(captured)
          wrongPage[0] = structuredClone(outsideRank)
          expect(() => assert(wrongPage, offset, limit)).toThrow()
        }
        if (captured.length > 1) {
          const duplicate = structuredClone(captured)
          duplicate[0] = structuredClone(duplicate[1]!)
          expect(() => assert(duplicate, offset, limit)).toThrow()
          const differentRank = captured.findIndex(
            (row) => compare(byId.get(row.id)!, firstRank) !== 0,
          )
          if (differentRank !== -1) {
            const reversed = structuredClone(captured)
            ;[reversed[0], reversed[differentRank]] = [
              reversed[differentRank]!,
              reversed[0]!,
            ]
            expect(() => assert(reversed, offset, limit)).toThrow()
          }
        }
      }
      return captured
    },
  }
}

function assertThirdKeyControl(
  captured: Array<WindowRow>,
  assert: (rows: Array<WindowRow>) => void,
) {
  const index = captured.findIndex((right, position) => {
    const left = captured[position - 1]
    return (
      left !== undefined &&
      'name' in left &&
      'name' in right &&
      left.isActive === right.isActive &&
      left.age === right.age &&
      left.name.localeCompare(right.name) !== 0
    )
  })
  // The fixed fixture must reach a tie on both earlier keys before this
  // control can claim sensitivity to the third declared key.
  expect(index).toBeGreaterThan(0)
  const wrongThirdKey = structuredClone(captured)
  ;[wrongThirdKey[index - 1], wrongThirdKey[index]] = [
    wrongThirdKey[index]!,
    wrongThirdKey[index - 1]!,
  ]
  expect(() => assert(wrongThirdKey)).toThrow()
}

async function withPaginationHistory(
  run: (
    own: (query: { cleanup: () => Promise<void> }) => void,
    archive: (check: () => void) => void,
  ) => Promise<void>,
) {
  const owned: Array<{ cleanup: () => Promise<void> }> = []
  const archived: Array<() => void> = []
  const errors: Array<unknown> = []
  try {
    await run(
      (query) => owned.push(query),
      (check) => archived.push(check),
    )
  } catch (error) {
    errors.push(error)
  } finally {
    for (const query of owned) {
      try {
        await query.cleanup()
      } catch (error) {
        errors.push(error)
      }
    }
    for (const check of archived) {
      try {
        check()
      } catch (error) {
        errors.push(error)
      }
    }
  }
  if (errors.length === 1) throw errors[0]
  if (errors.length > 1)
    throw new AggregateError(errors, 'Window history and cleanup failed')
}

export function createPaginationTestSuite(
  getConfig: () => Promise<E2ETestConfig>,
) {
  describe(`Pagination Suite`, () => {
    describe(`OrderBy`, () => {
      it(`should sort ascending by single field`, async () => {
        const config = await getConfig()
        const usersCollection = config.collections.onDemand.users

        const fixture = config.fixture()
        await withPaginationHistory(async (own, archive) => {
          const window = createWindowOracle(
            fixture.users,
            (a, b) => a.age - b.age,
            archive,
          )
          const query = createLiveQueryCollection((q) =>
            q
              .from({ user: usersCollection })
              .orderBy(({ user }) => user.age, `asc`),
          )
          own(query)

          await query.preload()
          await waitForQueryData(query, { minSize: 1 })

          await window.check(query, 0)
          const results = Array.from(query.state.values())
          expect(results.length).toBeGreaterThan(0)
          assertSorted(results, `age`, `asc`)
        })
      })

      it(`should sort descending by single field`, async () => {
        const config = await getConfig()
        const usersCollection = config.collections.onDemand.users

        const fixture = config.fixture()
        await withPaginationHistory(async (own, archive) => {
          const window = createWindowOracle(
            fixture.users,
            (a, b) => b.age - a.age,
            archive,
          )
          const query = createLiveQueryCollection((q) =>
            q
              .from({ user: usersCollection })
              .orderBy(({ user }) => user.age, `desc`),
          )
          own(query)

          await query.preload()
          await waitForQueryData(query, { minSize: 1 })

          await window.check(query, 0)
          const results = Array.from(query.state.values())
          expect(results.length).toBeGreaterThan(0)
          assertSorted(results, `age`, `desc`)
        })
      })

      it(`should sort by string field`, async () => {
        const config = await getConfig()
        const usersCollection = config.collections.onDemand.users

        const fixture = config.fixture()
        await withPaginationHistory(async (own, archive) => {
          const window = createWindowOracle(
            fixture.users,
            (a, b) => a.name.localeCompare(b.name),
            archive,
          )
          const query = createLiveQueryCollection((q) =>
            q
              .from({ user: usersCollection })
              .orderBy(({ user }) => user.name, `asc`),
          )
          own(query)

          await query.preload()
          await waitForQueryData(query, { minSize: 1 })

          await window.check(query, 0)
          const results = Array.from(query.state.values())
          expect(results.length).toBeGreaterThan(0)

          // Retain the original shape smoke check; the fixture oracle checks this host's declared string rank.
          expect(results[0]!).toHaveProperty(`name`)
        })
      })

      it(`should sort by date field`, async () => {
        const config = await getConfig()
        const usersCollection = config.collections.onDemand.users

        const fixture = config.fixture()
        await withPaginationHistory(async (own, archive) => {
          const window = createWindowOracle(
            fixture.users,
            (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
            archive,
          )
          const query = createLiveQueryCollection((q) =>
            q
              .from({ user: usersCollection })
              .orderBy(({ user }) => user.createdAt, `desc`),
          )
          own(query)

          await query.preload()
          await waitForQueryData(query, { minSize: 1 })

          await window.check(query, 0)
          const results = Array.from(query.state.values())
          expect(results.length).toBeGreaterThan(0)
          assertSorted(results, `createdAt`, `desc`)
        })
      })

      it(`should sort by multiple fields`, async () => {
        const config = await getConfig()
        const postsCollection = config.collections.onDemand.posts

        const fixture = config.fixture()
        await withPaginationHistory(async (own, archive) => {
          const window = createWindowOracle(
            fixture.posts,
            (a, b) =>
              a.userId.localeCompare(b.userId) || a.viewCount - b.viewCount,
            archive,
          )
          const query = createLiveQueryCollection((q) =>
            q
              .from({ post: postsCollection })
              .orderBy(({ post }) => [post.userId, post.viewCount]),
          )
          own(query)

          await query.preload()
          await waitForQueryData(query, { minSize: 1 })

          await window.check(query, 0)
          const results = Array.from(query.state.values())
          expect(results.length).toBeGreaterThan(0)

          // Verify multi-field sort (userId first, then viewCount within each userId)
          for (let i = 1; i < results.length; i++) {
            const prev = results[i - 1]!
            const curr = results[i]!

            // If userId is same, viewCount should be ascending
            if (prev.userId === curr.userId) {
              expect(prev.viewCount).toBeLessThanOrEqual(curr.viewCount)
            }
          }
        })
      })

      it(`should sort by multiple fields with chained orderBy`, async () => {
        const config = await getConfig()
        const usersCollection = config.collections.onDemand.users

        const fixture = config.fixture()
        await withPaginationHistory(async (own, archive) => {
          const window = createWindowOracle(
            fixture.users,
            (a, b) =>
              (a.isActive === b.isActive ? 0 : a.isActive ? -1 : 1) ||
              a.age - b.age,
            archive,
          )
          const query = createLiveQueryCollection((q) =>
            q
              .from({ user: usersCollection })
              .orderBy(({ user }) => user.isActive, `desc`)
              .orderBy(({ user }) => user.age, `asc`),
          )
          own(query)

          await query.preload()
          await waitForQueryData(query, { minSize: 1 })

          await window.check(query, 0)
          const results = Array.from(query.state.values())
          expect(results.length).toBeGreaterThan(0)

          // Verify multi-field sort (isActive desc first, then age asc within each isActive)
          for (let i = 1; i < results.length; i++) {
            const prev = results[i - 1]!
            const curr = results[i]!

            // isActive should be descending (true before false)
            if (prev.isActive !== curr.isActive) {
              // true (1) should come before false (0) in desc order
              expect(prev.isActive ? 1 : 0).toBeGreaterThanOrEqual(
                curr.isActive ? 1 : 0,
              )
            } else {
              // If isActive is same, age should be ascending
              expect(prev.age).toBeLessThanOrEqual(curr.age)
            }
          }
        })
      })
    })

    describe(`Multi-Column OrderBy with Incremental Loading`, () => {
      it(`should correctly paginate with multi-column orderBy and limit`, async () => {
        const config = await getConfig()
        const usersCollection = config.collections.onDemand.users

        // First page - get first 10 users sorted by isActive desc, age asc
        const fixture = config.fixture()
        await withPaginationHistory(async (own, archive) => {
          const window = createWindowOracle(
            fixture.users,
            (a, b) =>
              (a.isActive === b.isActive ? 0 : a.isActive ? -1 : 1) ||
              a.age - b.age,
            archive,
          )
          const query = createLiveQueryCollection((q) =>
            q
              .from({ user: usersCollection })
              .orderBy(({ user }) => user.isActive, `desc`)
              .orderBy(({ user }) => user.age, `asc`)
              .limit(10),
          )
          own(query)

          await query.preload()
          await waitForQueryData(query, { minSize: 10 })

          await window.check(query, 0, 10)
          const results = Array.from(query.state.values())
          expect(results).toHaveLength(10)

          // Verify the ordering is correct
          for (let i = 1; i < results.length; i++) {
            const prev = results[i - 1]!
            const curr = results[i]!

            if (prev.isActive !== curr.isActive) {
              expect(prev.isActive ? 1 : 0).toBeGreaterThanOrEqual(
                curr.isActive ? 1 : 0,
              )
            } else {
              expect(prev.age).toBeLessThanOrEqual(curr.age)
            }
          }
        })
      })

      it(`should load subsequent pages correctly with multi-column orderBy`, async () => {
        const config = await getConfig()
        const usersCollection = config.collections.onDemand.users

        // Get first 15 users
        const fixture = config.fixture()
        await withPaginationHistory(async (own, archive) => {
          const window = createWindowOracle(
            fixture.users,
            (a, b) =>
              (a.isActive === b.isActive ? 0 : a.isActive ? -1 : 1) ||
              a.age - b.age,
            archive,
          )
          const query1 = createLiveQueryCollection((q) =>
            q
              .from({ user: usersCollection })
              .orderBy(({ user }) => user.isActive, `desc`)
              .orderBy(({ user }) => user.age, `asc`)
              .limit(15),
          )
          own(query1)

          await query1.preload()
          await waitForQueryData(query1, { minSize: 15 })

          const retainedFirst = await window.check(query1, 0, 15)
          const firstPage = Array.from(query1.state.values())
          expect(firstPage).toHaveLength(15)

          // Get first 30 users (expanding the window)
          const query2 = createLiveQueryCollection((q) =>
            q
              .from({ user: usersCollection })
              .orderBy(({ user }) => user.isActive, `desc`)
              .orderBy(({ user }) => user.age, `asc`)
              .limit(30),
          )
          own(query2)

          await query2.preload()
          await waitForQueryData(query2, { minSize: 30 })

          await window.check(query2, 0, 30)
          expect(await window.check(query1, 0, 15)).toStrictEqual(retainedFirst)
          const expandedPage = Array.from(query2.state.values())
          expect(expandedPage).toHaveLength(30)

          // The first 15 items should be the same in both queries
          for (let i = 0; i < 15; i++) {
            expect(expandedPage[i]!.id).toBe(firstPage[i]!.id)
          }

          // Verify ordering is maintained throughout
          for (let i = 1; i < expandedPage.length; i++) {
            const prev = expandedPage[i - 1]!
            const curr = expandedPage[i]!

            if (prev.isActive !== curr.isActive) {
              expect(prev.isActive ? 1 : 0).toBeGreaterThanOrEqual(
                curr.isActive ? 1 : 0,
              )
            } else {
              expect(prev.age).toBeLessThanOrEqual(curr.age)
            }
          }
        })
      })

      it(`should load distinct windows across multiple live queries with multi-column orderBy`, async () => {
        const config = await getConfig()
        const usersCollection = config.collections.onDemand.users

        const fixture = config.fixture()
        await withPaginationHistory(async (own, archive) => {
          const window = createWindowOracle(
            fixture.users,
            (a, b) =>
              (a.isActive === b.isActive ? 0 : a.isActive ? -1 : 1) ||
              a.age - b.age,
            archive,
          )
          const page1 = createLiveQueryCollection((q) =>
            q
              .from({ user: usersCollection })
              .orderBy(({ user }) => user.isActive, `desc`)
              .orderBy(({ user }) => user.age, `asc`)
              .limit(10)
              .offset(0),
          )
          own(page1)

          const page2 = createLiveQueryCollection((q) =>
            q
              .from({ user: usersCollection })
              .orderBy(({ user }) => user.isActive, `desc`)
              .orderBy(({ user }) => user.age, `asc`)
              .limit(10)
              .offset(10),
          )
          own(page2)

          await page1.preload()
          await waitForQueryData(page1, { minSize: 10 })
          await page2.preload()
          await waitForQueryData(page2, { minSize: 10 })

          await window.check(page1, 0, 10)
          const page1Results = Array.from(page1.state.values())
          await window.check(page2, 10, 10)
          const page2Results = Array.from(page2.state.values())

          expect(page1Results).toHaveLength(10)
          expect(page2Results).toHaveLength(10)

          const page1Ids = new Set(page1Results.map((user) => user.id))
          for (const user of page2Results) {
            expect(page1Ids.has(user.id)).toBe(false)
          }

          for (const page of [page1Results, page2Results]) {
            for (let i = 1; i < page.length; i++) {
              const prev = page[i - 1]!
              const curr = page[i]!

              if (prev.isActive !== curr.isActive) {
                expect(prev.isActive ? 1 : 0).toBeGreaterThanOrEqual(
                  curr.isActive ? 1 : 0,
                )
              } else {
                expect(prev.age).toBeLessThanOrEqual(curr.age)
              }
            }
          }
        })
      })

      it(`should allow paging a second live query without affecting the first`, async () => {
        const config = await getConfig()
        const usersCollection = config.collections.onDemand.users

        const fixture = config.fixture()
        await withPaginationHistory(async (own, archive) => {
          const window = createWindowOracle(
            fixture.users,
            (a, b) =>
              (a.isActive === b.isActive ? 0 : a.isActive ? -1 : 1) ||
              a.age - b.age,
            archive,
          )
          const baseQuery = createLiveQueryCollection((q) =>
            q
              .from({ user: usersCollection })
              .orderBy(({ user }) => user.isActive, `desc`)
              .orderBy(({ user }) => user.age, `asc`)
              .limit(10)
              .offset(0),
          )
          own(baseQuery)

          const pagedQuery = createLiveQueryCollection((q) =>
            q
              .from({ user: usersCollection })
              .orderBy(({ user }) => user.isActive, `desc`)
              .orderBy(({ user }) => user.age, `asc`)
              .limit(10)
              .offset(0),
          )
          own(pagedQuery)

          await baseQuery.preload()
          await waitForQueryData(baseQuery, { minSize: 10 })
          await pagedQuery.preload()
          await waitForQueryData(pagedQuery, { minSize: 10 })

          const retainedBase = await window.check(baseQuery, 0, 10)
          await window.check(pagedQuery, 0, 10)
          const baseIds = new Set(
            Array.from(baseQuery.state.values()).map((user) => user.id),
          )

          const moveResult = pagedQuery.utils.setWindow({
            offset: 10,
            limit: 10,
          })
          if (moveResult !== true) {
            await moveResult
          }
          await waitForQueryData(pagedQuery, { minSize: 10 })

          await window.check(pagedQuery, 10, 10)
          expect(await window.check(baseQuery, 0, 10)).toStrictEqual(
            retainedBase,
          )
          const pagedResults = Array.from(pagedQuery.state.values())
          expect(pagedResults).toHaveLength(10)
          for (const user of pagedResults) {
            expect(baseIds.has(user.id)).toBe(false)
          }
        })
      })

      it(`should handle multi-column orderBy with duplicate values in first column`, async () => {
        const config = await getConfig()
        const usersCollection = config.collections.onDemand.users

        // Sort by isActive (only 2 values: true/false) then by age
        // This tests the case where many rows have the same first column value
        const fixture = config.fixture()
        await withPaginationHistory(async (own, archive) => {
          const window = createWindowOracle(
            fixture.users,
            (a, b) =>
              (a.isActive === b.isActive ? 0 : a.isActive ? -1 : 1) ||
              a.age - b.age,
            archive,
          )
          const query = createLiveQueryCollection((q) =>
            q
              .from({ user: usersCollection })
              .orderBy(({ user }) => user.isActive, `desc`)
              .orderBy(({ user }) => user.age, `asc`)
              .limit(50),
          )
          own(query)

          await query.preload()
          await waitForQueryData(query, { minSize: 50 })

          await window.check(query, 0, 50)
          const results = Array.from(query.state.values())
          expect(results).toHaveLength(50)

          // Count how many active users we got
          const activeUsers = results.filter((u) => u.isActive)
          const inactiveUsers = results.filter((u) => !u.isActive)

          // Since isActive desc, all active users should come first
          // All active users should be at the start
          let foundInactive = false
          for (const user of results) {
            if (!user.isActive) {
              foundInactive = true
            } else if (foundInactive) {
              // Found active after inactive - this is wrong
              throw new Error(
                `Found active user after inactive user in desc order`,
              )
            }
          }

          // Verify age is ascending within each group
          if (activeUsers.length > 1) {
            for (let i = 1; i < activeUsers.length; i++) {
              expect(activeUsers[i - 1]!.age).toBeLessThanOrEqual(
                activeUsers[i]!.age,
              )
            }
          }

          if (inactiveUsers.length > 1) {
            for (let i = 1; i < inactiveUsers.length; i++) {
              expect(inactiveUsers[i - 1]!.age).toBeLessThanOrEqual(
                inactiveUsers[i]!.age,
              )
            }
          }
        })
      })

      it(`should handle multi-column orderBy with mixed directions`, async () => {
        const config = await getConfig()
        const postsCollection = config.collections.onDemand.posts

        // Sort by userId ascending, viewCount descending
        const fixture = config.fixture()
        await withPaginationHistory(async (own, archive) => {
          const window = createWindowOracle(
            fixture.posts,
            (a, b) =>
              a.userId.localeCompare(b.userId) || b.viewCount - a.viewCount,
            archive,
          )
          const query = createLiveQueryCollection((q) =>
            q
              .from({ post: postsCollection })
              .orderBy(({ post }) => post.userId, `asc`)
              .orderBy(({ post }) => post.viewCount, `desc`)
              .limit(20),
          )
          own(query)

          await query.preload()
          await waitForQueryData(query, { minSize: 20 })

          await window.check(query, 0, 20)
          const results = Array.from(query.state.values())
          expect(results).toHaveLength(20)

          // Verify ordering
          for (let i = 1; i < results.length; i++) {
            const prev = results[i - 1]!
            const curr = results[i]!

            if (prev.userId < curr.userId) {
              // userId ascending - this is correct
              continue
            } else if (prev.userId === curr.userId) {
              // Same userId, viewCount should be descending
              expect(prev.viewCount).toBeGreaterThanOrEqual(curr.viewCount)
            } else {
              // userId decreased - this is wrong
              throw new Error(
                `userId should be ascending but ${prev.userId} > ${curr.userId}`,
              )
            }
          }
        })
      })

      it(`should handle three-column orderBy`, async () => {
        const config = await getConfig()
        const usersCollection = config.collections.onDemand.users

        // Sort by isActive desc, age asc, name asc
        const fixture = config.fixture()
        await withPaginationHistory(async (own, archive) => {
          const window = createWindowOracle(
            fixture.users,
            (a, b) =>
              (a.isActive === b.isActive ? 0 : a.isActive ? -1 : 1) ||
              a.age - b.age ||
              a.name.localeCompare(b.name),
            archive,
          )
          const query = createLiveQueryCollection((q) =>
            q
              .from({ user: usersCollection })
              .orderBy(({ user }) => user.isActive, `desc`)
              .orderBy(({ user }) => user.age, `asc`)
              .orderBy(({ user }) => user.name, `asc`)
              .limit(25),
          )
          own(query)

          await query.preload()
          await waitForQueryData(query, { minSize: 25 })

          const capturedThirdKey = await window.check(query, 0, 25)
          assertThirdKeyControl(capturedThirdKey, (rows) =>
            window.assert(rows, 0, 25),
          )
          const results = Array.from(query.state.values())
          expect(results).toHaveLength(25)

          // Verify basic ordering (isActive desc, age asc)
          for (let i = 1; i < results.length; i++) {
            const prev = results[i - 1]!
            const curr = results[i]!

            if (prev.isActive !== curr.isActive) {
              expect(prev.isActive ? 1 : 0).toBeGreaterThanOrEqual(
                curr.isActive ? 1 : 0,
              )
            } else if (prev.age !== curr.age) {
              expect(prev.age).toBeLessThanOrEqual(curr.age)
            }
            // The independent fixture oracle also checks the third name key for this host's default locale.
          }
        })
      })

      it(`should use setWindow to page through multi-column orderBy results`, async () => {
        const config = await getConfig()
        const usersCollection = config.collections.onDemand.users

        // Create query with multi-column orderBy and limit
        // Using age (number) and name (string) to avoid boolean comparison issues
        const fixture = config.fixture()
        await withPaginationHistory(async (own, archive) => {
          const window = createWindowOracle(
            fixture.users,
            (a, b) => a.age - b.age || a.name.localeCompare(b.name),
            archive,
          )
          const query = createLiveQueryCollection((q) =>
            q
              .from({ user: usersCollection })
              .orderBy(({ user }) => user.age, `asc`)
              .orderBy(({ user }) => user.name, `asc`)
              .limit(10),
          )
          own(query)

          await query.preload()
          await waitForQueryData(query, { minSize: 10 })

          // Get first page
          await window.check(query, 0, 10)
          const firstPage = Array.from(query.state.values())
          expect(firstPage).toHaveLength(10)

          // Verify first page ordering (age asc, then name asc)
          for (let i = 1; i < firstPage.length; i++) {
            const prev = firstPage[i - 1]!
            const curr = firstPage[i]!
            if (prev.age !== curr.age) {
              expect(prev.age).toBeLessThanOrEqual(curr.age)
            } else {
              expect(prev.name.localeCompare(curr.name)).toBeLessThanOrEqual(0)
            }
          }

          // Move to second page using setWindow
          // setWindow returns a Promise while its window work is pending,
          // or `true` if data is already available. Both caller forms are valid.
          const setWindowResult = query.utils.setWindow({
            offset: 10,
            limit: 10,
          })

          // Await the caller receipt when this window is not already available.
          if (setWindowResult !== true) {
            // Await the pending window receipt.
            await setWindowResult
          }
          await waitForQueryData(query, { minSize: 10 })

          // Get second page
          await window.check(query, 10, 10)
          const secondPage = Array.from(query.state.values())
          expect(secondPage).toHaveLength(10)

          // Verify second page ordering
          for (let i = 1; i < secondPage.length; i++) {
            const prev = secondPage[i - 1]!
            const curr = secondPage[i]!
            if (prev.age !== curr.age) {
              expect(prev.age).toBeLessThanOrEqual(curr.age)
            } else {
              expect(prev.name.localeCompare(curr.name)).toBeLessThanOrEqual(0)
            }
          }

          // Retain the fixed nonoverlapping output-window relation; it does not count provider calls.
          const firstPageIds = new Set(firstPage.map((u) => u.id))
          const secondPageIds = new Set(secondPage.map((u) => u.id))
          for (const id of secondPageIds) {
            expect(firstPageIds.has(id)).toBe(false)
          }
        })
      })

      it(`should use setWindow to move backwards with multi-column orderBy`, async () => {
        const config = await getConfig()
        const usersCollection = config.collections.onDemand.users

        // Start at offset 20
        const fixture = config.fixture()
        await withPaginationHistory(async (own, archive) => {
          const window = createWindowOracle(
            fixture.users,
            (a, b) => a.age - b.age || a.name.localeCompare(b.name),
            archive,
          )
          const query = createLiveQueryCollection((q) =>
            q
              .from({ user: usersCollection })
              .orderBy(({ user }) => user.age, `asc`)
              .orderBy(({ user }) => user.name, `asc`)
              .limit(10)
              .offset(20),
          )
          own(query)

          await query.preload()
          await waitForQueryData(query, { minSize: 10 })

          await window.check(query, 20, 10)
          const laterPage = Array.from(query.state.values())
          expect(laterPage).toHaveLength(10)

          // Move backwards to offset 10
          const setWindowResult = query.utils.setWindow({
            offset: 10,
            limit: 10,
          })
          if (setWindowResult !== true) {
            await setWindowResult
          }
          await waitForQueryData(query, { minSize: 10 })

          await window.check(query, 10, 10)
          const earlierPage = Array.from(query.state.values())
          expect(earlierPage).toHaveLength(10)

          // Earlier page should have different users
          const laterPageIds = new Set(laterPage.map((u) => u.id))
          const earlierPageIds = new Set(earlierPage.map((u) => u.id))
          for (const id of earlierPageIds) {
            expect(laterPageIds.has(id)).toBe(false)
          }

          // Verify ordering on earlier page (age asc, name asc)
          for (let i = 1; i < earlierPage.length; i++) {
            const prev = earlierPage[i - 1]!
            const curr = earlierPage[i]!
            if (prev.age !== curr.age) {
              expect(prev.age).toBeLessThanOrEqual(curr.age)
            } else {
              expect(prev.name.localeCompare(curr.name)).toBeLessThanOrEqual(0)
            }
          }
        })
      })

      it(`should use setWindow with mixed direction multi-column orderBy`, async () => {
        const config = await getConfig()
        const postsCollection = config.collections.onDemand.posts

        // Sort by userId ascending, viewCount descending
        const fixture = config.fixture()
        await withPaginationHistory(async (own, archive) => {
          const window = createWindowOracle(
            fixture.posts,
            (a, b) =>
              a.userId.localeCompare(b.userId) || b.viewCount - a.viewCount,
            archive,
          )
          const query = createLiveQueryCollection((q) =>
            q
              .from({ post: postsCollection })
              .orderBy(({ post }) => post.userId, `asc`)
              .orderBy(({ post }) => post.viewCount, `desc`)
              .limit(10),
          )
          own(query)

          await query.preload()
          await waitForQueryData(query, { minSize: 10 })

          await window.check(query, 0, 10)
          const firstPage = Array.from(query.state.values())
          expect(firstPage).toHaveLength(10)

          // Move to second page
          const setWindowResult = query.utils.setWindow({
            offset: 10,
            limit: 10,
          })
          if (setWindowResult !== true) {
            await setWindowResult
          }
          await waitForQueryData(query, { minSize: 10 })

          await window.check(query, 10, 10)
          const secondPage = Array.from(query.state.values())
          expect(secondPage).toHaveLength(10)

          // Verify ordering on second page (userId asc, viewCount desc)
          for (let i = 1; i < secondPage.length; i++) {
            const prev = secondPage[i - 1]!
            const curr = secondPage[i]!

            if (prev.userId < curr.userId) {
              // userId ascending - correct
              continue
            } else if (prev.userId === curr.userId) {
              // Same userId, viewCount should be descending
              expect(prev.viewCount).toBeGreaterThanOrEqual(curr.viewCount)
            } else {
              throw new Error(
                `userId should be ascending but ${prev.userId} > ${curr.userId}`,
              )
            }
          }
        })
      })

      it(`should handle setWindow across duplicate first-column values`, async () => {
        const config = await getConfig()
        const usersCollection = config.collections.onDemand.users

        // Age has limited unique values in test data, so many duplicates in first column
        // This tests that the composite cursor correctly handles paging across duplicates
        const fixture = config.fixture()
        await withPaginationHistory(async (own, archive) => {
          const window = createWindowOracle(
            fixture.users,
            (a, b) => a.age - b.age || a.name.localeCompare(b.name),
            archive,
          )
          const query = createLiveQueryCollection((q) =>
            q
              .from({ user: usersCollection })
              .orderBy(({ user }) => user.age, `asc`)
              .orderBy(({ user }) => user.name, `asc`)
              .limit(20),
          )
          own(query)

          await query.preload()
          await waitForQueryData(query, { minSize: 20 })

          await window.check(query, 0, 20)
          const firstPage = Array.from(query.state.values())
          expect(firstPage).toHaveLength(20)

          // Move to second page - this crosses the boundary where first column value changes
          const setWindowResult = query.utils.setWindow({
            offset: 20,
            limit: 20,
          })
          if (setWindowResult !== true) {
            await setWindowResult
          }
          await waitForQueryData(query, { minSize: 20 })

          await window.check(query, 20, 20)
          const secondPage = Array.from(query.state.values())
          expect(secondPage).toHaveLength(20)

          // Verify ordering is maintained across the page boundary
          for (let i = 1; i < secondPage.length; i++) {
            const prev = secondPage[i - 1]!
            const curr = secondPage[i]!
            if (prev.age !== curr.age) {
              expect(prev.age).toBeLessThanOrEqual(curr.age)
            } else {
              expect(prev.name.localeCompare(curr.name)).toBeLessThanOrEqual(0)
            }
          }

          // Pages should not overlap
          const firstPageIds = new Set(firstPage.map((u) => u.id))
          for (const user of secondPage) {
            expect(firstPageIds.has(user.id)).toBe(false)
          }

          // Move to third page to ensure continued paging works
          const setWindowResult2 = query.utils.setWindow({
            offset: 40,
            limit: 20,
          })
          if (setWindowResult2 !== true) {
            await setWindowResult2
          }
          await waitForQueryData(query, { minSize: 1 })

          await window.check(query, 40, 20)
          const thirdPage = Array.from(query.state.values())
          expect(thirdPage.length).toBeGreaterThan(0)
          expect(thirdPage.length).toBeLessThanOrEqual(20)

          // Third page should not overlap with first or second
          const secondPageIds = new Set(secondPage.map((u) => u.id))
          for (const user of thirdPage) {
            expect(firstPageIds.has(user.id)).toBe(false)
            expect(secondPageIds.has(user.id)).toBe(false)
          }
        })
      })

      it(`should expose successive windows when paging with multi-column orderBy`, async () => {
        const config = await getConfig()
        const usersCollection = config.collections.onDemand.users

        // Use a small limit to exercise two distinct public windows.
        const fixture = config.fixture()
        await withPaginationHistory(async (own, archive) => {
          const window = createWindowOracle(
            fixture.users,
            (a, b) => a.age - b.age || a.name.localeCompare(b.name),
            archive,
          )
          const query = createLiveQueryCollection((q) =>
            q
              .from({ user: usersCollection })
              .orderBy(({ user }) => user.age, `asc`)
              .orderBy(({ user }) => user.name, `asc`)
              .limit(5),
          )
          own(query)

          await query.preload()
          await waitForQueryData(query, { minSize: 5 })

          // Get the first five-row public page.
          await window.check(query, 0, 5)
          const firstPage = Array.from(query.state.values())
          expect(firstPage).toHaveLength(5)
          const lastItemFirstPage = firstPage[firstPage.length - 1]!

          // Move to the next public page; existing source/cache ownership may already supply it.
          const setWindowResult = query.utils.setWindow({ offset: 5, limit: 5 })

          // Preserve the public true-or-Promise caller contract; this is not a physical request count.
          expect(
            setWindowResult === true || setWindowResult instanceof Promise,
          ).toBe(true)

          if (setWindowResult !== true) {
            // Await the pending window receipt.
            await setWindowResult
          }
          await waitForQueryData(query, { minSize: 5 })

          // Get second page
          await window.check(query, 5, 5)
          const secondPage = Array.from(query.state.values())
          expect(secondPage).toHaveLength(5)

          // Verify the two public windows contain different records.
          const firstPageIds = new Set(firstPage.map((u) => u.id))
          for (const user of secondPage) {
            expect(firstPageIds.has(user.id)).toBe(false)
          }

          // Verify ordering continues correctly from where first page ended
          const firstItemSecondPage = secondPage[0]!

          // The first item of page 2 should come after the last item of page 1
          // in the sort order (age asc, name asc)
          if (lastItemFirstPage.age === firstItemSecondPage.age) {
            // Same age value, so name should be greater or equal
            expect(
              firstItemSecondPage.name.localeCompare(lastItemFirstPage.name),
            ).toBeGreaterThanOrEqual(0)
          } else {
            // Different age, page 2 first should have greater or equal age
            expect(firstItemSecondPage.age).toBeGreaterThanOrEqual(
              lastItemFirstPage.age,
            )
          }
        })
      })
    })

    describe(`Limit`, () => {
      it(`should limit to specific number of records`, async () => {
        const config = await getConfig()
        const usersCollection = config.collections.onDemand.users

        const fixture = config.fixture()
        await withPaginationHistory(async (own, archive) => {
          const window = createWindowOracle(
            fixture.users,
            (a, b) => a.id.localeCompare(b.id),
            archive,
          )
          const query = createLiveQueryCollection((q) =>
            q
              .from({ user: usersCollection })
              .orderBy(({ user }) => user.id, `asc`)
              .limit(10),
          )
          own(query)

          await query.preload()
          await waitForQueryData(query, { minSize: 10 })

          assertCollectionSize(query, 10)

          await window.check(query, 0, 10)
        })
      })

      it(`should handle limit=0`, async () => {
        const config = await getConfig()
        const usersCollection = config.collections.onDemand.users

        const fixture = config.fixture()
        await withPaginationHistory(async (own, archive) => {
          const window = createWindowOracle(
            fixture.users,
            (a, b) => a.id.localeCompare(b.id),
            archive,
          )
          const query = createLiveQueryCollection((q) =>
            q
              .from({ user: usersCollection })
              .orderBy(({ user }) => user.id, `asc`)
              .limit(0),
          )
          own(query)

          await query.preload()

          assertCollectionSize(query, 0)

          await window.check(query, 0, 0)
        })
      })

      it(`should handle limit larger than dataset`, async () => {
        const config = await getConfig()
        const usersCollection = config.collections.onDemand.users

        const fixture = config.fixture()
        await withPaginationHistory(async (own, archive) => {
          const window = createWindowOracle(
            fixture.users,
            (a, b) => a.id.localeCompare(b.id),
            archive,
          )
          const query = createLiveQueryCollection((q) =>
            q
              .from({ user: usersCollection })
              .orderBy(({ user }) => user.id, `asc`)
              .limit(1000),
          )
          own(query)

          await query.preload()

          // Should return all records (100 from seed data)
          expect(query.size).toBeLessThanOrEqual(100)

          await window.check(query, 0, 1000)
        })
      })

      it(`should combine limit with orderBy`, async () => {
        const config = await getConfig()
        const usersCollection = config.collections.onDemand.users

        const fixture = config.fixture()
        await withPaginationHistory(async (own, archive) => {
          const window = createWindowOracle(
            fixture.users,
            (a, b) => a.age - b.age,
            archive,
          )
          const query = createLiveQueryCollection((q) =>
            q
              .from({ user: usersCollection })
              .orderBy(({ user }) => user.age, `asc`)
              .limit(5),
          )
          own(query)

          await query.preload()
          await waitForQueryData(query, { minSize: 5 })

          assertCollectionSize(query, 5)
          await window.check(query, 0, 5)
          const results = Array.from(query.state.values())
          assertSorted(results, `age`, `asc`)
        })
      })
    })

    describe(`Offset`, () => {
      it(`should skip records with offset`, async () => {
        const config = await getConfig()
        const usersCollection = config.collections.onDemand.users

        const fixture = config.fixture()
        await withPaginationHistory(async (own, archive) => {
          const window = createWindowOracle(
            fixture.users,
            (a, b) => a.id.localeCompare(b.id),
            archive,
          )
          const query = createLiveQueryCollection((q) =>
            q
              .from({ user: usersCollection })
              .orderBy(({ user }) => user.id, `asc`)
              .limit(100) // Need limit with offset
              .offset(20),
          )
          own(query)

          await query.preload()
          await waitForQueryData(query, { minSize: 80 })

          await window.check(query, 20, 100)
          const results = Array.from(query.state.values())
          expect(results.length).toBe(80) // 100 - 20 = 80
        })
      })

      it(`should combine offset with limit (pagination)`, async () => {
        const config = await getConfig()
        const usersCollection = config.collections.onDemand.users

        const fixture = config.fixture()
        await withPaginationHistory(async (own, archive) => {
          const window = createWindowOracle(
            fixture.users,
            (a, b) => a.id.localeCompare(b.id),
            archive,
          )
          const query = createLiveQueryCollection((q) =>
            q
              .from({ user: usersCollection })
              .orderBy(({ user }) => user.id, `asc`)
              .limit(10)
              .offset(20),
          )
          own(query)

          await query.preload()
          await waitForQueryData(query, { minSize: 10 })

          assertCollectionSize(query, 10)

          await window.check(query, 20, 10)
        })
      })

      it(`should handle offset beyond dataset`, async () => {
        const config = await getConfig()
        const usersCollection = config.collections.onDemand.users

        const fixture = config.fixture()
        await withPaginationHistory(async (own, archive) => {
          const window = createWindowOracle(
            fixture.users,
            (a, b) => a.id.localeCompare(b.id),
            archive,
          )
          const query = createLiveQueryCollection((q) =>
            q
              .from({ user: usersCollection })
              .orderBy(({ user }) => user.id, `asc`)
              .limit(100)
              .offset(200),
          )
          own(query)

          await query.preload()

          assertCollectionSize(query, 0)

          await window.check(query, 200, 100)
        })
      })
    })

    describe(`Complex Pagination Scenarios`, () => {
      it(`should paginate with predicates`, async () => {
        const config = await getConfig()
        const usersCollection = config.collections.onDemand.users

        const fixture = config.fixture()
        await withPaginationHistory(async (own, archive) => {
          const window = createWindowOracle(
            fixture.users.filter((user) => user.isActive === true),
            (a, b) => a.age - b.age,
            archive,
          )
          const query = createLiveQueryCollection((q) =>
            q
              .from({ user: usersCollection })
              .where(({ user }) => eq(user.isActive, true))
              .orderBy(({ user }) => user.age, `asc`)
              .limit(10)
              .offset(5),
          )
          own(query)

          await query.preload()

          await window.check(query, 5, 10)
          const results = Array.from(query.state.values())
          expect(results.length).toBeLessThanOrEqual(10)
          assertAllItemsMatch(query, (u) => u.isActive === true)
          assertSorted(results, `age`, `asc`)
        })
      })

      it(`should handle pagination edge cases - last page with fewer records`, async () => {
        const config = await getConfig()
        const usersCollection = config.collections.onDemand.users

        const fixture = config.fixture()
        await withPaginationHistory(async (own, archive) => {
          const window = createWindowOracle(
            fixture.users,
            (a, b) => a.id.localeCompare(b.id),
            archive,
          )
          const query = createLiveQueryCollection(
            (q) =>
              q
                .from({ user: usersCollection })
                .orderBy(({ user }) => user.id, `asc`)
                .limit(10)
                .offset(95), // Last 5 records
          )
          own(query)

          await query.preload()
          await waitForQueryData(query, { minSize: 1 })

          expect(query.size).toBeLessThanOrEqual(10)
          expect(query.size).toBeGreaterThan(0)

          await window.check(query, 95, 10)
        })
      })

      it(`should handle single record pages`, async () => {
        const config = await getConfig()
        const usersCollection = config.collections.onDemand.users

        const fixture = config.fixture()
        await withPaginationHistory(async (own, archive) => {
          const window = createWindowOracle(
            fixture.users,
            (a, b) => a.id.localeCompare(b.id),
            archive,
          )
          const query = createLiveQueryCollection((q) =>
            q
              .from({ user: usersCollection })
              .orderBy(({ user }) => user.id, `asc`)
              .limit(1)
              .offset(0),
          )
          own(query)

          await query.preload()
          await waitForQueryData(query, { minSize: 1 })

          assertCollectionSize(query, 1)

          await window.check(query, 0, 1)
        })
      })
    })

    describe(`Requested Window Verification`, () => {
      it(`should return only the requested page`, async () => {
        const config = await getConfig()
        const usersCollection = config.collections.onDemand.users

        const fixture = config.fixture()
        await withPaginationHistory(async (own, archive) => {
          const window = createWindowOracle(
            fixture.users,
            (a, b) => a.id.localeCompare(b.id),
            archive,
          )
          const query = createLiveQueryCollection((q) =>
            q
              .from({ user: usersCollection })
              .orderBy(({ user }) => user.id, `asc`)
              .limit(10)
              .offset(20),
          )
          own(query)

          await query.preload()
          await waitForQueryData(query, { minSize: 10 })

          // Verify we got exactly 10 records
          assertCollectionSize(query, 10)

          // This law checks output-window completeness, not physical source overfetch.

          await window.check(query, 20, 10)
        })
      })
    })
  })
}
