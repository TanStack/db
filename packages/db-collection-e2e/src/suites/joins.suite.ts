/**
 * Joins Test Suite
 *
 * Tests multi-collection joins with various syncMode combinations
 */

import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { createLiveQueryCollection, eq, gt, isNull } from '@tanstack/db'
import { waitFor, waitForQueryData } from '../utils/helpers'
import type {
  Comment,
  E2ETestConfig,
  Post,
  SeedDataResult,
  User,
} from '../types'

type UserPost = { user: User; post: Post | undefined }
type JoinProjection = Record<string, string | number | undefined>
type JoinQuery = {
  values: () => Iterable<object>
  cleanup: () => Promise<void>
}
type OwnQuery = (query: JoinQuery) => void
type OwnCleanup = (cleanup: () => Promise<void>) => void
type Archive = (check: () => void) => void

function userPostPairs(
  users: Array<User>,
  posts: Array<Post>,
): Array<UserPost> {
  const pairs: Array<UserPost> = []
  for (const user of users) {
    const children = posts.filter((post) => post.userId === user.id)
    if (children.length === 0) pairs.push({ user, post: undefined })
    else for (const post of children) pairs.push({ user, post })
  }
  return pairs
}

function withComments(pairs: Array<UserPost>, comments: Array<Comment>) {
  const triples: Array<UserPost & { comment: Comment | undefined }> = []
  for (const pair of pairs) {
    const children = comments.filter(
      (comment) => comment.postId === pair.post?.id,
    )
    if (children.length === 0) triples.push({ ...pair, comment: undefined })
    else for (const comment of children) triples.push({ ...pair, comment })
  }
  return triples
}

function compareProjectedValue(
  left: string | number | undefined,
  right: string | number | undefined,
): number {
  if (left === right) return 0
  if (left === undefined) return -1
  if (right === undefined) return 1
  if (typeof left === 'number' && typeof right === 'number') return left - right
  if (typeof left === 'string' && typeof right === 'string')
    return left < right ? -1 : 1
  throw new Error('Mixed scalar kinds in the fixed join projection')
}

function orderJoinedFixture<T extends JoinProjection>(
  rows: Array<T>,
  key: 'id' | 'viewCount',
  direction: 'asc' | 'desc',
): Array<T> {
  // These two old ordered witnesses use defined, distinct seed Post keys.
  // Do not invent an ordering/boundary identity for missing fields or ties.
  expect(rows.every((row) => row[key] !== undefined)).toBe(true)
  expect(new Set(rows.map((row) => row[key])).size).toBe(rows.length)
  return [...rows].sort((left, right) => {
    const a = left[key]!
    const b = right[key]!
    const rank =
      typeof a === 'string' && typeof b === 'string'
        ? a.localeCompare(b)
        : compareProjectedValue(a, b)
    return direction === 'asc' ? rank : -rank
  })
}

function createJoinOracle(
  expectedRows: Array<JoinProjection>,
  fields: Array<string>,
  archive: Archive,
  ordered = false,
) {
  const expected = structuredClone(expectedRows)
  const compare = (left: JoinProjection, right: JoinProjection) => {
    for (const field of fields) {
      const rank = compareProjectedValue(left[field], right[field])
      if (rank !== 0) return rank
    }
    return 0
  }
  const assert = (actual: Array<JoinProjection>) => {
    expect(ordered ? actual : [...actual].sort(compare)).toStrictEqual(
      ordered ? expected : [...expected].sort(compare),
    )
  }
  return {
    assert,
    async check(query: { values: () => Iterable<object> }) {
      const captured = await vi.waitFor(
        () => {
          const rows = Array.from(query.values(), (value) => {
            const row: JoinProjection = {}
            for (const field of fields) {
              const item: unknown = Reflect.get(value, field)
              if (
                item !== undefined &&
                typeof item !== 'string' &&
                typeof item !== 'number'
              )
                throw new Error('Unexpected joined projection value kind')
              row[field] = item
            }
            return structuredClone(row)
          })
          assert(rows)
          return rows
        },
        { timeout: 5000 },
      )
      archive(() => assert(captured))
      if (captured.length > 0) {
        expect(() => assert(captured.slice(1))).toThrow()
        const wrongKey = structuredClone(captured)
        wrongKey[0]!.id = `${wrongKey[0]!.id}-wrong`
        expect(() => assert(wrongKey)).toThrow()
        const wrongValue = structuredClone(captured)
        wrongValue[0]!.userName = `${wrongValue[0]!.userName}-wrong`
        expect(() => assert(wrongValue)).toThrow()
        if (captured.length > 1) {
          const duplicate = structuredClone(captured)
          duplicate[0] = structuredClone(duplicate[1]!)
          expect(() => assert(duplicate)).toThrow()
          if (ordered) expect(() => assert([...captured].reverse())).toThrow()
        }
      }
      return captured
    },
  }
}

async function withJoinHistory(
  run: (
    own: OwnQuery,
    ownCleanup: OwnCleanup,
    archive: Archive,
  ) => Promise<void>,
) {
  const queries: Array<JoinQuery> = []
  const cleanup: Array<() => Promise<void>> = []
  const archived: Array<() => void> = []
  const errors: Array<unknown> = []
  try {
    await run(
      (query) => queries.push(query),
      (action) => cleanup.push(action),
      (check) => archived.push(check),
    )
  } catch (error) {
    errors.push(error)
  } finally {
    // Owned rows are removed while their actual source/query owners stay live.
    for (const action of [
      ...cleanup,
      ...queries.map((query) => () => query.cleanup()),
    ]) {
      try {
        await action()
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
    throw new AggregateError(errors, 'Join history and cleanup failed')
}

function capturePosts(rows: Iterable<Post>): Array<Post> {
  return Array.from(rows, (row) =>
    structuredClone({
      id: row.id,
      userId: row.userId,
      title: row.title,
      content: row.content,
      viewCount: row.viewCount,
      largeViewCount: row.largeViewCount,
      publishedAt: row.publishedAt,
      deletedAt: row.deletedAt,
    }),
  )
}

function assertPosts(actual: Array<Post>, expected: Array<Post>) {
  const byId = (left: Post, right: Post) =>
    left.id < right.id ? -1 : left.id > right.id ? 1 : 0
  expect([...actual].sort(byId)).toStrictEqual([...expected].sort(byId))
}

async function ownedLeftJoinContinuation(
  config: E2ETestConfig,
  fixture: SeedDataResult,
  query: JoinQuery,
  seedProjection: Array<JoinProjection>,
  own: OwnQuery,
  ownCleanup: OwnCleanup,
  archive: Archive,
) {
  const mutations = config.mutations
  if (!mutations)
    throw new Error('Owned join history requires mutation drivers')
  const parents: Array<User> = ['multiple children', 'unmatched parent'].map(
    (name) => ({
      id: randomUUID(),
      name,
      email: null,
      age: 43,
      isActive: true,
      createdAt: new Date('2024-03-04T05:06:07.123Z'),
      metadata: { owned: name },
      deletedAt: null,
    }),
  )
  const children: Array<Post> = ['first owned child', 'second owned child'].map(
    (title, index) => ({
      id: randomUUID(),
      userId: parents[0]!.id,
      title,
      content: `owned content ${index}`,
      viewCount: 71 + index,
      largeViewCount: 9007199254740993n + BigInt(index),
      publishedAt: new Date('2024-06-07T08:09:10.321Z'),
      deletedAt: null,
    }),
  )
  const expectedPosts = structuredClone([...fixture.posts, ...children])
  const expectedJoined = structuredClone([
    ...seedProjection,
    {
      id: parents[0]!.id,
      userName: 'multiple children',
      postTitle: 'first owned child',
    },
    {
      id: parents[0]!.id,
      userName: 'multiple children',
      postTitle: 'second owned child',
    },
    { id: parents[1]!.id, userName: 'unmatched parent', postTitle: undefined },
  ])
  const postOwner = createLiveQueryCollection((q) =>
    q.from({ post: config.collections.eager.posts }),
  )
  own(postOwner)
  await postOwner.preload()
  await vi.waitFor(
    () => assertPosts(capturePosts(postOwner.values()), fixture.posts),
    { timeout: 5000 },
  )

  // Register all exact child and parent IDs before the first provider write.
  for (const child of children)
    ownCleanup(async () => {
      await mutations.deletePost(child.id)
      await vi.waitFor(
        () => {
          expect(config.collections.eager.posts.has(child.id)).toBe(false)
          expect(config.collections.onDemand.posts.has(child.id)).toBe(false)
        },
        { timeout: 5000 },
      )
    })
  for (const parent of parents)
    ownCleanup(async () => {
      await mutations.deleteUser(parent.id)
      await vi.waitFor(
        () =>
          expect(config.collections.onDemand.users.has(parent.id)).toBe(false),
        { timeout: 5000 },
      )
    })
  ownCleanup(async () => {
    await vi.waitFor(
      () => assertPosts(capturePosts(postOwner.values()), fixture.posts),
      { timeout: 5000 },
    )
    await createJoinOracle(
      seedProjection,
      ['id', 'userName', 'postTitle'],
      archive,
    ).check(query)
  })
  for (const parent of parents)
    await mutations.insertUser(structuredClone(parent))
  for (const child of children)
    await mutations.insertPost(structuredClone(child))
  const observedPosts = await vi.waitFor(
    () => {
      const rows = capturePosts(postOwner.values())
      assertPosts(rows, expectedPosts)
      return rows
    },
    { timeout: 5000 },
  )
  archive(() => assertPosts(observedPosts, expectedPosts))
  const wrongPostEdge = structuredClone(observedPosts)
  const observedChild = wrongPostEdge.find((row) => row.id === children[0]!.id)
  expect(observedChild).toBeDefined()
  if (!observedChild)
    throw new Error('Owned Post driver control was not reached')
  observedChild.userId = parents[1]!.id
  expect(() => assertPosts(wrongPostEdge, expectedPosts)).toThrow()

  const oracle = createJoinOracle(
    expectedJoined,
    ['id', 'userName', 'postTitle'],
    archive,
  )
  const captured = await oracle.check(query)
  const first = captured.findIndex(
    (row) => row.id === parents[0]!.id && row.postTitle === children[0]!.title,
  )
  const second = captured.findIndex(
    (row) => row.id === parents[0]!.id && row.postTitle === children[1]!.title,
  )
  const unmatched = captured.findIndex(
    (row) => row.id === parents[1]!.id && row.postTitle === undefined,
  )
  expect(first).toBeGreaterThanOrEqual(0)
  expect(second).toBeGreaterThanOrEqual(0)
  expect(unmatched).toBeGreaterThanOrEqual(0)
  const duplicateChild = structuredClone(captured)
  duplicateChild[first] = structuredClone(duplicateChild[second]!)
  expect(() => oracle.assert(duplicateChild)).toThrow()
  const wrongJoinedEdge = structuredClone(captured)
  wrongJoinedEdge[first]!.id = parents[1]!.id
  expect(() => oracle.assert(wrongJoinedEdge)).toThrow()
  expect(() =>
    oracle.assert(captured.filter((_, index) => index !== unmatched)),
  ).toThrow()
}

export function createJoinsTestSuite(getConfig: () => Promise<E2ETestConfig>) {
  describe(`Joins Suite`, () => {
    describe(`Two-Collection Joins`, () => {
      it(`should join Users and Posts`, async () => {
        const config = await getConfig()
        const usersCollection = config.collections.onDemand.users
        const postsCollection = config.collections.onDemand.posts

        const fixture = config.fixture()
        const expected = userPostPairs(fixture.users, fixture.posts).map(
          ({ user, post }) => ({
            id: post?.id,
            userName: user.name,
            postTitle: post?.title,
          }),
        )
        await withJoinHistory(async (own, ownCleanup, archive) => {
          const oracle = createJoinOracle(
            expected,
            ['id', 'userName', 'postTitle'],
            archive,
            false,
          )
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
          own(query)

          await query.preload()
          await waitForQueryData(query, { minSize: 1 })

          const results = Array.from(query.state.values())
          expect(results.length).toBeGreaterThan(0)
          expect(results[0]!).toHaveProperty(`userName`)
          expect(results[0]!).toHaveProperty(`postTitle`)

          await oracle.check(query)
        })
      })

      it(`should join with predicates on both collections`, async () => {
        const config = await getConfig()
        const usersCollection = config.collections.onDemand.users
        const postsCollection = config.collections.onDemand.posts

        const fixture = config.fixture()
        const expected = userPostPairs(fixture.users, fixture.posts)
          .filter(
            ({ user, post }) =>
              user.isActive === true &&
              post !== undefined &&
              post.viewCount > 10,
          )
          .map(({ user, post }) => ({
            id: post?.id,
            userName: user.name,
            postTitle: post?.title,
            viewCount: post?.viewCount,
          }))
        await withJoinHistory(async (own, ownCleanup, archive) => {
          const oracle = createJoinOracle(
            expected,
            ['id', 'userName', 'postTitle', 'viewCount'],
            archive,
            false,
          )
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
          own(query)

          await query.preload()

          const results = Array.from(query.state.values())
          // Verify predicates applied
          results.forEach((r) => {
            expect(r.viewCount).toBeGreaterThan(10)
          })

          await oracle.check(query)
        })
      })

      it(
        `should join with one eager, one on-demand`,
        { timeout: 60000 },
        async () => {
          const config = await getConfig()
          const usersEager = config.collections.eager.users
          const postsOnDemand = config.collections.onDemand.posts

          const fixture = config.fixture()
          const expected = userPostPairs(fixture.users, fixture.posts).map(
            ({ user, post }) => ({
              id: post?.id,
              userName: user.name,
              postTitle: post?.title,
            }),
          )
          await withJoinHistory(async (own, ownCleanup, archive) => {
            const oracle = createJoinOracle(
              expected,
              ['id', 'userName', 'postTitle'],
              archive,
              false,
            )
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
            own(query)

            await query.preload()
            // Joins with eager + on-demand collections may need more time to load data from multiple sources
            // Use longer timeout for CI environments which can be slower
            await waitForQueryData(query, { minSize: 1, timeout: 50000 })

            const results = Array.from(query.state.values())
            expect(results.length).toBeGreaterThan(0)

            await oracle.check(query)
          })
        },
      )

      it(`should join with ordering across collections`, async () => {
        const config = await getConfig()
        const usersCollection = config.collections.onDemand.users
        const postsCollection = config.collections.onDemand.posts

        const fixture = config.fixture()
        const expected = orderJoinedFixture(
          userPostPairs(fixture.users, fixture.posts).map(({ user, post }) => ({
            id: post?.id,
            userName: user.name,
            postTitle: post?.title,
            viewCount: post?.viewCount,
          })),
          'viewCount',
          'desc',
        )
        await withJoinHistory(async (own, ownCleanup, archive) => {
          const oracle = createJoinOracle(
            expected,
            ['id', 'userName', 'postTitle', 'viewCount'],
            archive,
            true,
          )
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
          own(query)

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
          expect(results.every((r) => typeof r.viewCount === `number`)).toBe(
            true,
          )

          // Verify sorting by viewCount (descending)
          for (let i = 1; i < results.length; i++) {
            const prevCount = results[i - 1]!.viewCount
            const currCount = results[i]!.viewCount
            expect(prevCount!).toBeGreaterThanOrEqual(currCount!)
          }

          await oracle.check(query)
        })
      })

      it(`should join with pagination`, async () => {
        const config = await getConfig()
        const usersCollection = config.collections.onDemand.users
        const postsCollection = config.collections.onDemand.posts

        const fixture = config.fixture()
        const expected = orderJoinedFixture(
          userPostPairs(fixture.users, fixture.posts).map(({ user, post }) => ({
            id: post?.id,
            userName: user.name,
            postTitle: post?.title,
          })),
          'id',
          'asc',
        ).slice(5, 15)
        await withJoinHistory(async (own, ownCleanup, archive) => {
          const oracle = createJoinOracle(
            expected,
            ['id', 'userName', 'postTitle'],
            archive,
            true,
          )
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
          own(query)

          await query.preload()

          expect(query.size).toBeLessThanOrEqual(10)

          await oracle.check(query)
        })
      })
    })

    describe(`Three-Collection Joins`, () => {
      it(`should join Users + Posts + Comments`, async () => {
        const config = await getConfig()
        const { users, posts, comments } = config.collections.onDemand

        const fixture = config.fixture()
        const expected = withComments(
          userPostPairs(fixture.users, fixture.posts),
          fixture.comments,
        ).map(({ user, post, comment }) => ({
          id: comment?.id,
          userName: user.name,
          postTitle: post?.title,
          commentText: comment?.text,
        }))
        await withJoinHistory(async (own, ownCleanup, archive) => {
          const oracle = createJoinOracle(
            expected,
            ['id', 'userName', 'postTitle', 'commentText'],
            archive,
            false,
          )
          const query = createLiveQueryCollection((q) =>
            q
              .from({ user: users })
              .join({ post: posts }, ({ user, post }) =>
                eq(user.id, post.userId),
              )
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
          own(query)

          await query.preload()
          await waitForQueryData(query, { minSize: 1 })

          const results = Array.from(query.state.values())
          expect(results.length).toBeGreaterThan(0)
          expect(results[0]!).toHaveProperty(`userName`)
          expect(results[0]!).toHaveProperty(`postTitle`)
          expect(results[0]!).toHaveProperty(`commentText`)

          await oracle.check(query)
        })
      })

      it(`should handle predicates on all three collections`, async () => {
        const config = await getConfig()
        const { users, posts, comments } = config.collections.onDemand

        const fixture = config.fixture()
        const expected = withComments(
          userPostPairs(fixture.users, fixture.posts).filter(
            ({ user, post }) =>
              user.isActive === true && post?.deletedAt === null,
          ),
          fixture.comments,
        )
          .filter(({ comment }) => comment?.deletedAt === null)
          .map(({ user, post, comment }) => ({
            id: comment?.id,
            userName: user.name,
            postTitle: post?.title,
            commentText: comment?.text,
          }))
        await withJoinHistory(async (own, ownCleanup, archive) => {
          const oracle = createJoinOracle(
            expected,
            ['id', 'userName', 'postTitle', 'commentText'],
            archive,
            false,
          )
          const query = createLiveQueryCollection((q) =>
            q
              .from({ user: users })
              .where(({ user }) => eq(user.isActive, true))
              .join({ post: posts }, ({ user, post }) =>
                eq(user.id, post.userId),
              )
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
          own(query)

          await query.preload()
          await waitForQueryData(query, { minSize: 1 })

          const results = Array.from(query.state.values())
          // All results should match all predicates and return some rows
          expect(results.length).toBeGreaterThan(0)

          await oracle.check(query)
        })
      })

      it(
        `should handle mixed syncModes in 3-way join`,
        { timeout: 60000 },
        async () => {
          const config = await getConfig()
          const usersEager = config.collections.eager.users
          const postsOnDemand = config.collections.onDemand.posts
          const commentsOnDemand = config.collections.onDemand.comments

          const fixture = config.fixture()
          const expected = withComments(
            userPostPairs(fixture.users, fixture.posts),
            fixture.comments,
          ).map(({ user, post, comment }) => ({
            id: comment?.id,
            userName: user.name,
            postTitle: post?.title,
            commentText: comment?.text,
          }))
          await withJoinHistory(async (own, ownCleanup, archive) => {
            const oracle = createJoinOracle(
              expected,
              ['id', 'userName', 'postTitle', 'commentText'],
              archive,
              false,
            )
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
            own(query)

            await query.preload()
            // 3-way joins with mixed eager + on-demand collections need more time
            // Use longer timeout for CI environments which can be slower
            await waitForQueryData(query, { minSize: 1, timeout: 50000 })

            const results = Array.from(query.state.values())
            expect(results.length).toBeGreaterThan(0)

            await oracle.check(query)
          })
        },
      )
    })

    describe(`Predicates in Joined Results`, () => {
      it(`should apply predicates to the selected joined fields`, async () => {
        const config = await getConfig()
        const { users, posts } = config.collections.onDemand

        const fixture = config.fixture()
        const expected = userPostPairs(fixture.users, fixture.posts)
          .filter(({ post }) => post !== undefined && post.viewCount > 50)
          .map(({ user, post }) => ({
            id: post?.id,
            userName: user.name,
            postTitle: post?.title,
            viewCount: post?.viewCount,
          }))
        await withJoinHistory(async (own, ownCleanup, archive) => {
          const oracle = createJoinOracle(
            expected,
            ['id', 'userName', 'postTitle', 'viewCount'],
            archive,
            false,
          )
          const query = createLiveQueryCollection((q) =>
            q
              .from({ user: users })
              .join({ post: posts }, ({ user, post }) =>
                eq(user.id, post.userId),
              )
              .where(({ post }) => gt(post.viewCount, 50))
              .select(({ user, post }) => ({
                id: post.id,
                userName: user.name,
                postTitle: post.title,
                viewCount: post.viewCount,
              })),
          )
          own(query)

          await query.preload()

          const results = Array.from(query.state.values())
          // Verify predicate applied
          results.forEach((r) => {
            expect(r.viewCount).toBeGreaterThan(50)
          })

          await oracle.check(query)
        })
      })

      it(`should exclude joined rows outside the user predicate`, async () => {
        const config = await getConfig()
        const { users, posts } = config.collections.onDemand

        const fixture = config.fixture()
        const expected = userPostPairs(fixture.users, fixture.posts)
          .filter(({ user }) => user.age > 30)
          .map(({ user, post }) => ({
            id: post?.id,
            userName: user.name,
            userAge: user.age,
            postTitle: post?.title,
          }))
        await withJoinHistory(async (own, ownCleanup, archive) => {
          const oracle = createJoinOracle(
            expected,
            ['id', 'userName', 'userAge', 'postTitle'],
            archive,
            false,
          )
          const query = createLiveQueryCollection((q) =>
            q
              .from({ user: users })
              .where(({ user }) => gt(user.age, 30))
              .join({ post: posts }, ({ user, post }) =>
                eq(user.id, post.userId),
              )
              .select(({ user, post }) => ({
                id: post.id,
                userName: user.name,
                userAge: user.age,
                postTitle: post.title,
              })),
          )
          own(query)

          await query.preload()

          const results = Array.from(query.state.values())
          // All users should be > 30
          results.forEach((r) => {
            expect(r.userAge).toBeGreaterThan(30)
          })

          await oracle.check(query)
        })
      })
    })

    describe(`Left Joins`, () => {
      it(`should handle left joins correctly`, async () => {
        const config = await getConfig()
        const { users, posts } = config.collections.onDemand

        const fixture = config.fixture()
        const expected = userPostPairs(fixture.users, fixture.posts).map(
          ({ user, post }) => ({
            id: user.id,
            userName: user.name,
            postTitle: post?.title,
          }),
        )
        await withJoinHistory(async (own, ownCleanup, archive) => {
          const oracle = createJoinOracle(
            expected,
            ['id', 'userName', 'postTitle'],
            archive,
            false,
          )
          const query = createLiveQueryCollection((q) =>
            q
              .from({ user: users })
              .leftJoin({ post: posts }, ({ user, post }) =>
                eq(user.id, post.userId),
              )
              .select(({ user, post }) => ({
                id: user.id,
                userName: user.name,
                postTitle: post.title, // Missing joined fields are undefined for unmatched users
              })),
          )
          own(query)

          await query.preload()
          await waitForQueryData(query, { minSize: 1 })

          const results = Array.from(query.state.values())
          expect(results.length).toBeGreaterThan(0)

          await oracle.check(query)
          await ownedLeftJoinContinuation(
            config,
            fixture,
            query,
            expected,
            own,
            ownCleanup,
            archive,
          )
        })
      })
    })
  })
}
