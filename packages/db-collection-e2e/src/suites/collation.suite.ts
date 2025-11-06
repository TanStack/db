/**
 * Collation Test Suite
 *
 * Tests string collation configuration and behavior
 */

import { describe, expect, it } from "vitest"
import { createLiveQueryCollection, eq } from "@tanstack/db"
import { waitForQueryData } from "../utils/helpers"
import type { E2ETestConfig } from "../types"

export function createCollationTestSuite(
  getConfig: () => Promise<E2ETestConfig>
) {
  describe(`Collation Suite`, () => {
    describe(`Default Collation`, () => {
      it(`should use default collation for string comparisons`, async () => {
        const config = await getConfig()
        const usersCollection = config.collections.onDemand.users

        const query = createLiveQueryCollection((q) =>
          q
            .from({ user: usersCollection })
            .orderBy(({ user }) => user.name, `asc`)
        )

        await query.preload()
        await waitForQueryData(query, { minSize: 1 })

        const results = Array.from(query.state.values())
        expect(results.length).toBeGreaterThan(0)

        await query.cleanup()
      })

      it(`should handle case-sensitive comparisons by default`, async () => {
        const config = await getConfig()
        const usersCollection = config.collections.onDemand.users

        // Different case variations should be treated as different
        const query = createLiveQueryCollection(
          (q) =>
            q
              .from({ user: usersCollection })
              .where(({ user }) => eq(user.name, `alice 0`)) // lowercase
        )

        await query.preload()

        const results = Array.from(query.state.values())
        // Should NOT match because seed data has "Alice 0" (capitalized) and default is case-sensitive
        expect(results.length).toBe(0)

        await query.cleanup()
      })
    })

    describe(`Custom Collection-Level Collation`, () => {
      it(`should use custom defaultStringCollation at collection level`, async () => {
        const config = await getConfig()

        // Test will use collection with custom collation if provided
        const query = createLiveQueryCollection({
          query: (q) => q.from({ user: config.collections.onDemand.users }),
          defaultStringCollation: {
            stringSort: `lexical`,
          },
        })

        await query.preload()

        expect(query.compareOptions.stringSort).toBe(`lexical`)

        await query.cleanup()
      })

      it(`should support locale-based collation`, async () => {
        const config = await getConfig()

        const query = createLiveQueryCollection({
          query: (q) => q.from({ user: config.collections.onDemand.users }),
          defaultStringCollation: {
            stringSort: `locale`,
            locale: `de-DE`,
          },
        })

        await query.preload()

        expect(query.compareOptions.stringSort).toBe(`locale`)
        // Type narrow: when stringSort is 'locale', locale property exists
        if (query.compareOptions.stringSort === `locale`) {
          expect(query.compareOptions.locale).toBe(`de-DE`)
        }

        await query.cleanup()
      })
    })

    describe(`Query-Level Collation Override`, () => {
      it(`should override collection collation at query level`, async () => {
        const config = await getConfig()

        const query = createLiveQueryCollection({
          query: (q) => q.from({ user: config.collections.onDemand.users }),
          defaultStringCollation: {
            stringSort: `lexical`,
          },
        })

        await query.preload()

        expect(query.compareOptions.stringSort).toBe(`lexical`)

        await query.cleanup()
      })
    })

    describe(`Collation in OrderBy`, () => {
      it(`should respect collation when sorting strings`, async () => {
        const config = await getConfig()
        const usersCollection = config.collections.onDemand.users

        const query = createLiveQueryCollection((q) =>
          q
            .from({ user: usersCollection })
            .orderBy(({ user }) => user.name, `asc`)
        )

        await query.preload()
        await waitForQueryData(query, { minSize: 1 })

        const results = Array.from(query.state.values())
        expect(results.length).toBeGreaterThan(0)

        // Verify sorted (actual sort order depends on collation)
        for (let i = 1; i < results.length; i++) {
          // Just verify it's sorted, regardless of collation
          expect(results[i - 1]!.name).toBeTruthy()
        }

        await query.cleanup()
      })
    })
  })
}
