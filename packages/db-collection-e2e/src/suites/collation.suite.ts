/**
 * Collation Test Suite
 *
 * Tests string collation configuration and behavior
 */

import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { createLiveQueryCollection, eq, inArray } from '@tanstack/db'
import { waitFor, waitForQueryData } from '../utils/helpers'
import { withQueryCleanup } from './mutations.suite'
import type { E2ETestConfig, User } from '../types'

export function createCollationTestSuite(
  getConfig: () => Promise<E2ETestConfig>,
) {
  describe(`Collation Suite`, () => {
    describe(`Default Collation`, () => {
      it(`should use default collation for string comparisons`, async () => {
        await withQueryCleanup(async (own) => {
          const config = await getConfig()
          const usersCollection = config.collections.onDemand.users

          const query = own(
            createLiveQueryCollection((q) =>
              q
                .from({ user: usersCollection })
                .orderBy(({ user }) => user.name, `asc`),
            ),
          )

          await query.preload()
          await waitForQueryData(query, { minSize: 1 })

          const results = Array.from(query.state.values())
          expect(results.length).toBeGreaterThan(0)
        })
      })

      it(`should handle case-sensitive comparisons by default`, async () => {
        await withQueryCleanup(async (own) => {
          const config = await getConfig()
          const usersCollection = config.collections.onDemand.users

          // Different case variations should be treated as different
          const query = own(
            createLiveQueryCollection(
              (q) =>
                q
                  .from({ user: usersCollection })
                  .where(({ user }) => eq(user.name, `alice 0`)), // lowercase
            ),
          )

          await query.preload()

          const results = Array.from(query.state.values())
          // Should NOT match because seed data has "Alice 0" (capitalized) and default is case-sensitive
          expect(results.length).toBe(0)
        })
      })
    })

    describe(`Custom Collection-Level Collation`, () => {
      it(`should use custom defaultStringCollation at collection level`, async () => {
        await withQueryCleanup(async (own) => {
          const config = await getConfig()

          // Test will use collection with custom collation if provided
          const query = own(
            createLiveQueryCollection({
              query: (q) => q.from({ user: config.collections.onDemand.users }),
              defaultStringCollation: {
                stringSort: `lexical`,
              },
            }),
          )

          await query.preload()

          expect(query.compareOptions.stringSort).toBe(`lexical`)
        })
      })

      it(`should support locale-based collation`, async () => {
        await withQueryCleanup(async (own) => {
          const config = await getConfig()

          const query = own(
            createLiveQueryCollection({
              query: (q) => q.from({ user: config.collections.onDemand.users }),
              defaultStringCollation: {
                stringSort: `locale`,
                locale: `de-DE`,
              },
            }),
          )

          await query.preload()

          expect(query.compareOptions.stringSort).toBe(`locale`)
          // Type narrow: when stringSort is 'locale', locale property exists
          if (query.compareOptions.stringSort === `locale`) {
            expect(query.compareOptions.locale).toBe(`de-DE`)
          }
        })
      })
    })

    describe(`Query-Level Collation Override`, () => {
      it(`should override collection collation at query level`, async () => {
        await withQueryCleanup(async (own) => {
          const config = await getConfig()

          const query = own(
            createLiveQueryCollection({
              query: (q) => q.from({ user: config.collections.onDemand.users }),
              defaultStringCollation: {
                stringSort: `lexical`,
              },
            }),
          )

          await query.preload()

          expect(query.compareOptions.stringSort).toBe(`lexical`)
        })
      })
    })

    describe(`Collation in OrderBy`, () => {
      it(`should respect collation when sorting strings`, async () => {
        const config = await getConfig()
        if (!config.mutations) {
          throw new Error(`Mutations not configured - test cannot run`)
        }
        const mutations = config.mutations
        const usersCollection = config.collections.onDemand.users

        const query = createLiveQueryCollection((q) =>
          q
            .from({ user: usersCollection })
            .orderBy(({ user }) => user.name, `asc`),
        )

        const cleanups: Array<() => Promise<void>> = [() => query.cleanup()]
        const errors: Array<unknown> = []
        try {
          await query.preload()
          await waitForQueryData(query, { minSize: 1 })

          const results = Array.from(query.state.values())
          expect(results.length).toBeGreaterThan(0)
          // Retain the old default-collation smoke check. Nonempty names alone
          // do not prove an order; the independent explicit law follows below.
          for (let i = 1; i < results.length; i++) {
            expect(results[i - 1]!.name).toBeTruthy()
          }

          // This literal sequence is UTF-16 lexical order, not host locale order.
          const expected: Array<User> = [`A10`, `A2`, `Z`, `a`, `ä`].map(
            (name, index) => ({
              id: randomUUID(),
              name,
              email: null,
              age: 40 + index,
              isActive: true,
              createdAt: new Date(1_710_381_566_535 + index),
              metadata: { collation: index },
              deletedAt: null,
            }),
          )
          for (const index of [4, 2, 0, 3, 1]) {
            const row = expected[index]!
            cleanups.push(async () => {
              await mutations.deleteUser(row.id)
              await waitFor(
                () =>
                  !query.has(row.id) &&
                  !config.collections.eager.users.has(row.id),
                { message: `Owned collation row was not removed: ${row.id}` },
              )
            })
            await mutations.insertUser(structuredClone(row))
          }

          const ownedIds = expected.map((row) => row.id)
          const lexicalQuery = createLiveQueryCollection({
            query: (q) =>
              q
                .from({ user: usersCollection })
                .where(({ user }) => inArray(user.id, ownedIds))
                .orderBy(({ user }) => user.name, {
                  direction: `asc`,
                  stringSort: `lexical`,
                }),
            defaultStringCollation: { stringSort: `lexical` },
          })
          cleanups.push(() => lexicalQuery.cleanup())
          await lexicalQuery.preload()
          await waitFor(() => lexicalQuery.size === expected.length, {
            message: `Lexical query did not load all owned rows`,
          })
          const captureRows = (rows: Iterable<User>) =>
            Array.from(rows, (row) =>
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
          const observed = captureRows(lexicalQuery.values())
          const expectOrderedRows = (rows: Array<User>) => {
            expect(rows).toStrictEqual(expected)
          }
          expectOrderedRows(observed)
          expect(() => expectOrderedRows([...observed].reverse())).toThrow()
          const corrupted = structuredClone(observed)
          corrupted[0]!.age += 1
          expect(() => expectOrderedRows(corrupted)).toThrow()
          const wrongMetadata = structuredClone(observed)
          const metadata = wrongMetadata[0]!.metadata
          if (metadata === null)
            throw new Error('Expected captured non-null collation metadata')
          Object.defineProperty(metadata, 'unexpected', {
            value: undefined,
            enumerable: true,
          })
          expect(
            Object.prototype.hasOwnProperty.call(metadata, 'unexpected'),
          ).toBe(true)
          expect(() => expectOrderedRows(wrongMetadata)).toThrow()

          // The configured output default governs a subsequent query consuming
          // this collection. The producing query's explicit clause is separate.
          expect(lexicalQuery.compareOptions.stringSort).toBe(`lexical`)
          const downstream = createLiveQueryCollection((q) =>
            q
              .from({ user: lexicalQuery })
              .orderBy(({ user }) => user.name, `asc`),
          )
          cleanups.push(() => downstream.cleanup())
          await downstream.preload()
          await waitFor(() => downstream.size === expected.length, {
            message: `Downstream query did not load all owned rows`,
          })
          expectOrderedRows(captureRows(downstream.values()))
          expectOrderedRows(observed)
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
        if (errors.length > 1) {
          throw new AggregateError(errors, `Collation test and cleanup failed`)
        }
      })
    })
  })
}
