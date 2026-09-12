/**
 * Backend mutation tests for on-demand collections.
 * Helpers below own only test rows/queries; expected values stay in each case.
 */
import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { createLiveQueryCollection, eq, gt, isNull } from '@tanstack/db'
import { waitForQueryData } from '../utils/helpers'
import type { E2ETestConfig, User } from '../types'

export async function withQueryCleanup(
  run: (
    own: <T extends { cleanup: () => Promise<void> }>(query: T) => T,
  ) => Promise<void>,
) {
  const queries: Array<{ cleanup: () => Promise<void> }> = []
  const errors: Array<unknown> = []
  try {
    await run((query) => {
      // Register each returned peer before another constructor or await.
      queries.push(query)
      return query
    })
  } catch (error) {
    errors.push(error)
  } finally {
    // Retain the fixed peer arrays' concurrent cleanup intent. Each async
    // callback also captures a synchronous cleanup throw before the next peer.
    const outcomes = await Promise.allSettled(
      queries.map(async (query) => {
        await query.cleanup()
      }),
    )
    for (const outcome of outcomes) {
      if (outcome.status === 'rejected') errors.push(outcome.reason)
    }
  }
  if (errors.length === 1) throw errors[0]
  if (errors.length > 1)
    throw new AggregateError(errors, 'Query history and cleanup failed')
}

export function userFixture(
  name: string,
  age: number,
  email: string | null = null,
): User {
  return {
    id: randomUUID(),
    name,
    email,
    age,
    isActive: true,
    createdAt: new Date(1_710_381_566_535),
    metadata: null,
    deletedAt: null,
  }
}

export function captureUserRows(rows: Iterable<User>): Array<User> {
  return Array.from(rows, (row) =>
    structuredClone({
      id: row.id,
      name: row.name,
      email: row.email,
      age: row.age,
      isActive: row.isActive,
      createdAt: row.createdAt,
      metadata: row.metadata,
      deletedAt: row.deletedAt,
    }),
  )
}

export function assertUserRows(
  actual: Array<User>,
  expected: Array<User>,
): void {
  const byId = (a: User, b: User) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  expect([...actual].sort(byId)).toStrictEqual([...expected].sort(byId))
}

export function waitForUserRows(
  query: { values: () => Iterable<User> },
  expected: Array<User>,
) {
  return vi.waitFor(
    () => {
      const actual = captureUserRows(query.values())
      assertUserRows(actual, expected)
      return actual
    },
    { timeout: 5000 },
  )
}

export function waitForOwnedUser(config: E2ETestConfig, expected: User) {
  return vi.waitFor(
    () => {
      const row = config.collections.eager.users.get(expected.id)
      expect(row).toBeDefined()
      assertUserRows(captureUserRows([row!]), [expected])
    },
    { timeout: 5000 },
  )
}

interface OwnedUsers {
  track: <T extends { cleanup: () => Promise<void> }>(query: T) => T
  insert: (row: User) => Promise<() => Promise<void>>
}

export async function withOwnedUsers(
  config: E2ETestConfig,
  run: (owned: OwnedUsers) => Promise<void>,
) {
  if (!config.mutations)
    throw new Error('Mutations not configured - test cannot run')
  const mutations = config.mutations
  const cleanups: Array<() => Promise<void>> = []
  const errors: Array<unknown> = []
  try {
    // Eager mode can pause at zero subscribers. Own this observation before
    // any writes, and release it last so backing-row cleanup stays observed.
    const backing = createLiveQueryCollection((q) =>
      q.from({ user: config.collections.eager.users }),
    )
    cleanups.push(() => backing.cleanup())
    await backing.preload()
    expect(backing.status).toBe('ready')
    await run({
      track(query) {
        cleanups.push(() => query.cleanup())
        return query
      },
      async insert(row) {
        const id = row.id
        let needsDeletion = true
        const remove = async () => {
          if (!needsDeletion) return
          await mutations.deleteUser(id)
          needsDeletion = false
          await vi.waitFor(
            () => {
              expect(config.collections.eager.users.has(id)).toBe(false)
            },
            { timeout: 5000 },
          )
        }
        // Register before the provider call, including ambiguous failed inserts.
        cleanups.push(remove)
        await mutations.insertUser(structuredClone(row))
        await waitForOwnedUser(config, row)
        return remove
      },
    })
  } catch (error) {
    errors.push(error)
  } finally {
    for (const cleanup of cleanups.reverse()) {
      try {
        await cleanup()
      } catch (error) {
        errors.push(error)
      }
    }
  }
  if (errors.length === 1) throw errors[0]
  if (errors.length > 1)
    throw new AggregateError(errors, 'User history and cleanup failed')
}

export function createMutationsTestSuite(
  getConfig: () => Promise<E2ETestConfig>,
) {
  describe('Mutations Suite', () => {
    describe('Insert Mutations', () => {
      it('should insert new record via collection', async () => {
        const config = await getConfig()
        await withOwnedUsers(config, async (owned) => {
          const query = owned.track(
            createLiveQueryCollection((q) =>
              q.from({ user: config.collections.onDemand.users }),
            ),
          )
          await query.preload()
          await waitForQueryData(query, { minSize: 1 })
          const before = captureUserRows(query.values())
          const initialSize = query.size
          expect(initialSize).toBeGreaterThan(0)
          // This helper drives the backend, not an optimistic collection handler.
          const row = userFixture('Test User', 42, 'test@example.com')
          const remove = await owned.insert(row)
          const observed = await waitForUserRows(query, [...before, row])
          expect(query.size).toBe(initialSize + 1)
          const corrupted = structuredClone(observed)
          corrupted[0]!.age += 1
          expect(() => assertUserRows(corrupted, [...before, row])).toThrow()
          await remove()
          await waitForUserRows(query, before)
          assertUserRows(observed, [...before, row])
        })
      })

      it('should handle insert appearing in matching queries', async () => {
        const config = await getConfig()
        await withOwnedUsers(config, async (owned) => {
          const query = owned.track(
            createLiveQueryCollection((q) =>
              q
                .from({ user: config.collections.onDemand.users })
                .where(({ user }) => gt(user.age, 30)),
            ),
          )
          await query.preload()
          await waitForQueryData(query, { minSize: 1 })
          const before = captureUserRows(query.values())
          const initialSize = query.size
          expect(initialSize).toBeGreaterThan(0)
          const row = userFixture('Test Match User', 50, 'match@example.com')
          const remove = await owned.insert(row)
          await waitForUserRows(query, [...before, row])
          expect(query.size).toBe(initialSize + 1)
          await remove()
          await waitForUserRows(query, before)
        })
      })
    })

    describe('Update Mutations', () => {
      it('should handle update that makes record match predicate', async () => {
        const config = await getConfig()
        await withOwnedUsers(config, async (owned) => {
          const query = owned.track(
            createLiveQueryCollection((q) =>
              q
                .from({ user: config.collections.onDemand.users })
                .where(({ user }) => gt(user.age, 30)),
            ),
          )
          await query.preload()
          await waitForQueryData(query, { minSize: 1 })
          const before = captureUserRows(query.values())
          const row = userFixture('Excluded User', 25)
          await owned.insert(row)
          await waitForUserRows(query, before)
          expect(query.has(row.id)).toBe(false)
          const initialSize = query.size
          expect(initialSize).toBeGreaterThan(0)
          // Known backend row, not a search inside the cold filtered source.
          await config.mutations!.updateUser(row.id, { age: 35 })
          const updated = { ...row, age: 35 }
          await waitForOwnedUser(config, updated)
          await waitForUserRows(query, [...before, updated])
          expect(query.size).toBe(initialSize + 1)
        })
      })

      it('should handle update that makes record unmatch predicate', async () => {
        const config = await getConfig()
        await withOwnedUsers(config, async (owned) => {
          const query = owned.track(
            createLiveQueryCollection((q) =>
              q
                .from({ user: config.collections.onDemand.users })
                .where(({ user }) => gt(user.age, 30)),
            ),
          )
          await query.preload()
          await waitForQueryData(query, { minSize: 1 })
          const peers = captureUserRows(query.values())
          const row = userFixture('Matching Before Update', 45)
          await owned.insert(row)
          await waitForUserRows(query, [...peers, row])
          const initialSize = query.size
          expect(initialSize).toBeGreaterThan(0)
          await config.mutations!.updateUser(row.id, { age: 25 })
          await waitForOwnedUser(config, { ...row, age: 25 })
          await waitForUserRows(query, peers)
          expect(query.size).toBe(initialSize - 1)
          expect(query.has(row.id)).toBe(false)
        })
      })
    })

    describe('Delete Mutations', () => {
      it('should handle delete removing record from query', async () => {
        const config = await getConfig()
        await withOwnedUsers(config, async (owned) => {
          const query = owned.track(
            createLiveQueryCollection((q) =>
              q.from({ user: config.collections.onDemand.users }),
            ),
          )
          await query.preload()
          await waitForQueryData(query, { minSize: 1 })
          const peers = captureUserRows(query.values())
          const row = userFixture('Owned Delete User', 42)
          const remove = await owned.insert(row)
          await waitForUserRows(query, [...peers, row])
          const initialSize = query.size
          expect(initialSize).toBeGreaterThan(0)
          await remove()
          const observed = await waitForUserRows(query, peers)
          expect(query.size).toBe(initialSize - 1)
          expect(query.has(row.id)).toBe(false)
          expect(() => assertUserRows([...observed, row], peers)).toThrow()
        })
      })
    })

    describe(`Soft Delete Pattern`, () => {
      it(`should filter out soft-deleted records`, async () => {
        await withQueryCleanup(async (own) => {
          const config = await getConfig()
          const usersCollection = config.collections.onDemand.users

          const query = own(
            createLiveQueryCollection((q) =>
              q
                .from({ user: usersCollection })
                .where(({ user }) => isNull(user.deletedAt)),
            ),
          )

          await query.preload()
          await waitForQueryData(query, { minSize: 1 })

          // All results should not be soft-deleted
          const results = Array.from(query.state.values())
          expect(results.length).toBeGreaterThan(0)
          results.forEach((u) => {
            expect(u.deletedAt).toBeNull()
          })
        })
      })

      it(`should include soft-deleted records when not filtered`, async () => {
        await withQueryCleanup(async (own) => {
          const config = await getConfig()
          const usersCollection = config.collections.onDemand.users

          const query = own(
            createLiveQueryCollection((q) => q.from({ user: usersCollection })),
          )

          await query.preload()
          await waitForQueryData(query, { minSize: 1 })

          // Should include both deleted and non-deleted
          const results = Array.from(query.state.values())
          const hasNotDeleted = results.some((u) => u.deletedAt === null)

          expect(hasNotDeleted).toBe(true)
        })
      })
    })

    describe('Mutation with Queries', () => {
      it('should maintain query state during data changes', async () => {
        const config = await getConfig()
        await withOwnedUsers(config, async (owned) => {
          const query = owned.track(
            createLiveQueryCollection((q) =>
              q
                .from({ user: config.collections.onDemand.users })
                .where(({ user }) => eq(user.isActive, true))
                .orderBy(({ user }) => user.age, 'asc')
                .limit(10),
            ),
          )
          await query.preload()
          expect(query.size).toBeLessThanOrEqual(10)
          // All eleven unique ages are below the seeded minimum (-5).
          // They remove any dependence on the seed's tied boundary identities.
          const rows = Array.from({ length: 11 }, (_, index) =>
            userFixture('Owned page ' + index, -1010 + index),
          )
          for (const row of rows) await owned.insert(row)
          await vi.waitFor(
            () => {
              expect(captureUserRows(query.values())).toStrictEqual(
                rows.slice(0, 10),
              )
            },
            { timeout: 5000 },
          )
          expect(query.size).toBeLessThanOrEqual(10)
          await config.mutations!.updateUser(rows[0]!.id, { age: -999 })
          await waitForOwnedUser(config, { ...rows[0]!, age: -999 })
          await vi.waitFor(
            () => {
              expect(captureUserRows(query.values())).toStrictEqual(
                rows.slice(1),
              )
            },
            { timeout: 5000 },
          )
          expect(query.size).toBeLessThanOrEqual(10)
        })
      })
    })
  })
}
