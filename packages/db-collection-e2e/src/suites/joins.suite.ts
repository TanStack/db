/**
 * Joins Test Suite
 *
 * Tests multi-collection joins with various syncMode combinations
 */

import { describe, expect, it } from 'vitest'
import { createLiveQueryCollection, eq, gt, isNull } from '@tanstack/db'
import { waitFor, waitForQueryData } from '../utils/helpers'
import type { E2ETestConfig } from '../types'

export function createJoinsTestSuite(getConfig: () => Promise<E2ETestConfig>) {
  describe(`Joins Suite`, () => {
    describe(`Two-Collection Joins`, () => {
      it(`should join Users and Posts`, async () => {
        const config = await getConfig()
        const usersCollection = config.collections.onDemand.users
        const postsCollection = config.collections.onDemand.posts

        const query = createLiveQueryCollection((q) =>
          q
            .from({ user: usersCollection })
            .join({ post: postsCollection }, ({ user, post }) =>
              eq(user.id, post.userId),
            )
            .select(({ user, post }) => ({
              id: post.id,
              userName: user.name,
              postTitle: post.title,
            })),
        )

        await query.preload()
        await waitForQueryData(query, { minSize: 1 })

        const results = Array.from(query.state.values())
        expect(results.length).toBeGreaterThan(0)
        expect(results[0]!).toHaveProperty(`userName`)
        expect(results[0]!).toHaveProperty(`postTitle`)

        await query.cleanup()
      })

      it(`should join with predicates on both collections`, async () => {
        const config = await getConfig()
        const usersCollection = config.collections.onDemand.users
        const postsCollection = config.collections.onDemand.posts

        const query = createLiveQueryCollection((q) =>
          q
            .from({ user: usersCollection })
            .where(({ user }) => eq(user.isActive, true))
            .join({ post: postsCollection }, ({ user, post }) =>
              eq(user.id, post.userId),
            )
            .where(({ post }) => gt(post.viewCount, 10))
            .select(({ user, post }) => ({
              id: post.id,
              userName: user.name,
              postTitle: post.title,
              viewCount: post.viewCount,
            })),
        )

        await query.preload()

        const results = Array.from(query.state.values())
        // Verify predicates applied
        results.forEach((r) => {
          expect(r.viewCount).toBeGreaterThan(10)
        })

        await query.cleanup()
      })

      it(
        `should join with one eager, one on-demand`,
        { timeout: 60000 },
        async () => {
          const config = await getConfig()
          const usersEager = config.collections.eager.users
          const postsOnDemand = config.collections.onDemand.posts

          const query = createLiveQueryCollection((q) =>
            q
              .from({ user: usersEager })
              .join({ post: postsOnDemand }, ({ user, post }) =>
                eq(user.id, post.userId),
              )
              .select(({ user, post }) => ({
                id: post.id,
                userName: user.name,
                postTitle: post.title,
              })),
          )

          await query.preload()
          // Joins with eager + on-demand collections may need more time to load data from multiple sources
          // Use longer timeout for CI environments which can be slower
          await waitForQueryData(query, { minSize: 1, timeout: 50000 })

          const results = Array.from(query.state.values())
          expect(results.length).toBeGreaterThan(0)

          await query.cleanup()
        },
      )

      it(`should join with ordering across collections`, async () => {
        const config = await getConfig()
        const usersCollection = config.collections.onDemand.users
        const postsCollection = config.collections.onDemand.posts

        const query = createLiveQueryCollection((q) =>
          q
            .from({ user: usersCollection })
            .join({ post: postsCollection }, ({ user, post }) =>
              eq(user.id, post.userId),
            )
            .orderBy(({ post }) => post.viewCount, `desc`)
            .select(({ user, post }) => ({
              id: post.id,
              userName: user.name,
              postTitle: post.title,
              viewCount: post.viewCount,
            })),
        )

        await query.preload()

        // For joins with ordering, we need to wait for sufficient data in BOTH collections
        // Wait for the posts collection to load enough data (not just the query results)
        await waitFor(() => postsCollection.size >= 100, {
          timeout: 5000,
          interval: 50,
          message: `Posts collection did not fully load (got ${postsCollection.size}/100)`,
        })

        // Also wait for query to have data
        await waitForQueryData(query, { minSize: 50, timeout: 5000 })

        const results = Array.from(query.state.values())
        expect(results.length).toBeGreaterThan(0)

        // All results MUST have viewCount field (verifies join completed successfully)
        expect(results.every((r) => typeof r.viewCount === `number`)).toBe(true)

        // Verify sorting by viewCount (descending)
        for (let i = 1; i < results.length; i++) {
          const prevCount = results[i - 1]!.viewCount
          const currCount = results[i]!.viewCount
          expect(prevCount!).toBeGreaterThanOrEqual(currCount!)
        }

        await query.cleanup()
      })

      it(`should join with pagination`, async () => {
        const config = await getConfig()
        const usersCollection = config.collections.onDemand.users
        const postsCollection = config.collections.onDemand.posts

        const query = createLiveQueryCollection((q) =>
          q
            .from({ user: usersCollection })
            .join({ post: postsCollection }, ({ user, post }) =>
              eq(user.id, post.userId),
            )
            .orderBy(({ post }) => post.id, `asc`)
            .limit(10)
            .offset(5)
            .select(({ user, post }) => ({
              id: post.id,
              userName: user.name,
              postTitle: post.title,
            })),
        )

        await query.preload()

        expect(query.size).toBeLessThanOrEqual(10)

        await query.cleanup()
      })
    })

    describe(`Three-Collection Joins`, () => {
      it(`should join Users + Posts + Comments`, async () => {
        const config = await getConfig()
        const { users, posts, comments } = config.collections.onDemand

        const query = createLiveQueryCollection((q) =>
          q
            .from({ user: users })
            .join({ post: posts }, ({ user, post }) => eq(user.id, post.userId))
            .join({ comment: comments }, ({ post, comment }) =>
              eq(post.id, comment.postId),
            )
            .select(({ user, post, comment }) => ({
              id: comment.id,
              userName: user.name,
              postTitle: post.title,
              commentText: comment.text,
            })),
        )

        await query.preload()
        await waitForQueryData(query, { minSize: 1 })

        const results = Array.from(query.state.values())
        expect(results.length).toBeGreaterThan(0)
        expect(results[0]!).toHaveProperty(`userName`)
        expect(results[0]!).toHaveProperty(`postTitle`)
        expect(results[0]!).toHaveProperty(`commentText`)

        await query.cleanup()
      })

      it(`should handle predicates on all three collections`, async () => {
        const config = await getConfig()
        const { users, posts, comments } = config.collections.onDemand

        const query = createLiveQueryCollection((q) =>
          q
            .from({ user: users })
            .where(({ user }) => eq(user.isActive, true))
            .join({ post: posts }, ({ user, post }) => eq(user.id, post.userId))
            .where(({ post }) => isNull(post.deletedAt))
            .join({ comment: comments }, ({ post, comment }) =>
              eq(post.id, comment.postId),
            )
            .where(({ comment }) => isNull(comment.deletedAt))
            .select(({ user, post, comment }) => ({
              id: comment.id,
              userName: user.name,
              postTitle: post.title,
              commentText: comment.text,
            })),
        )

        await query.preload()
        await waitForQueryData(query, { minSize: 1 })

        const results = Array.from(query.state.values())
        // All results should match all predicates and return some rows
        expect(results.length).toBeGreaterThan(0)

        await query.cleanup()
      })

      it(
        `should handle mixed syncModes in 3-way join`,
        { timeout: 60000 },
        async () => {
          const config = await getConfig()
          const usersEager = config.collections.eager.users
          const postsOnDemand = config.collections.onDemand.posts
          const commentsOnDemand = config.collections.onDemand.comments

          const query = createLiveQueryCollection((q) =>
            q
              .from({ user: usersEager })
              .join({ post: postsOnDemand }, ({ user, post }) =>
                eq(user.id, post.userId),
              )
              .join({ comment: commentsOnDemand }, ({ post, comment }) =>
                eq(post.id, comment.postId),
              )
              .select(({ user, post, comment }) => ({
                id: comment.id,
                userName: user.name,
                postTitle: post.title,
                commentText: comment.text,
              })),
          )

          await query.preload()
          // 3-way joins with mixed eager + on-demand collections need more time
          // Use longer timeout for CI environments which can be slower
          await waitForQueryData(query, { minSize: 1, timeout: 50000 })

          const results = Array.from(query.state.values())
          expect(results.length).toBeGreaterThan(0)

          await query.cleanup()
        },
      )
    })

    describe(`Predicate Pushdown in Joins`, () => {
      it(`should push predicates to correct collections`, async () => {
        const config = await getConfig()
        const { users, posts } = config.collections.onDemand

        const query = createLiveQueryCollection((q) =>
          q
            .from({ user: users })
            .join({ post: posts }, ({ user, post }) => eq(user.id, post.userId))
            .where(({ post }) => gt(post.viewCount, 50))
            .select(({ user, post }) => ({
              id: post.id,
              userName: user.name,
              postTitle: post.title,
              viewCount: post.viewCount,
            })),
        )

        await query.preload()

        const results = Array.from(query.state.values())
        // Verify predicate applied
        results.forEach((r) => {
          expect(r.viewCount).toBeGreaterThan(50)
        })

        await query.cleanup()
      })

      it(`should not over-fetch in joined collections`, async () => {
        const config = await getConfig()
        const { users, posts } = config.collections.onDemand

        const query = createLiveQueryCollection((q) =>
          q
            .from({ user: users })
            .where(({ user }) => gt(user.age, 30))
            .join({ post: posts }, ({ user, post }) => eq(user.id, post.userId))
            .select(({ user, post }) => ({
              id: post.id,
              userName: user.name,
              userAge: user.age,
              postTitle: post.title,
            })),
        )

        await query.preload()

        const results = Array.from(query.state.values())
        // All users should be > 30
        results.forEach((r) => {
          expect(r.userAge).toBeGreaterThan(30)
        })

        await query.cleanup()
      })
    })

    describe(`Left Joins`, () => {
      it(`should handle left joins correctly`, async () => {
        const config = await getConfig()
        const { users, posts } = config.collections.onDemand

        const query = createLiveQueryCollection((q) =>
          q
            .from({ user: users })
            .leftJoin({ post: posts }, ({ user, post }) =>
              eq(user.id, post.userId),
            )
            .select(({ user, post }) => ({
              id: user.id,
              userName: user.name,
              postTitle: post.title, // May be null for users without posts
            })),
        )

        await query.preload()
        await waitForQueryData(query, { minSize: 1 })

        const results = Array.from(query.state.values())
        expect(results.length).toBeGreaterThan(0)

        await query.cleanup()
      })
    })
  })
}
