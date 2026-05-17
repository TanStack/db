/**
 * Progressive sync mode — nested subquery & join fast-path (end-to-end)
 *
 * Regression test against a real Electric server.
 *
 * In `progressive` sync mode an Electric collection loads a fast-path snapshot
 * of the rows a query needs FIRST, then the rest of the collection in the
 * background. This works when a collection is queried directly:
 *
 *   q.from({ post: posts }).where(({ post }) => eq(post.userId, X))
 *
 * It previously did NOT work when the same `posts` were fetched as a nested
 * `toArray` child of a user, or joined to a filtered user — the fast-path was
 * missed and the rows only became available once the WHOLE `posts` collection
 * had finished its background sync.
 *
 * The fix: when the parent/main side is filtered to statically-known keys, the
 * correlation predicate is pushed onto the child/joined collection so it loads
 * its subset eagerly, exactly like the direct query.
 *
 * The test seeds a large `posts` table so the background sync is visibly slow,
 * then watches how much of the collection had to load before each query could
 * show its (small) target subset:
 *
 *   - subset visible while posts.size is still small  -> fast-path used
 *   - subset visible only once posts.size == full     -> fast-path missed
 *
 * The deterministic counterpart lives in
 * packages/db/tests/query/progressive-includes-fastpath.test.ts.
 */

import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'
import {
  createCollection,
  createLiveQueryCollection,
  eq,
  toArray,
} from '@tanstack/db'
import { electricCollectionOptions } from '../src/electric'
import { makePgClient } from '../../db-collection-e2e/support/global-setup'
import { sleep, waitFor } from '../../db-collection-e2e/src/utils/helpers'
import type { Row } from '@electric-sql/client'
import type { Client } from 'pg'

const OTHER_USERS = 3
const POSTS_PER_OTHER_USER = 1500
const TARGET_POSTS = 40
const TOTAL_POSTS = OTHER_USERS * POSTS_PER_OTHER_USER + TARGET_POSTS

type User = { id: string; name: string }
type Post = { id: string; userId: string; title: string }

describe(`Progressive mode — nested subquery & join fast-path (e2e)`, () => {
  let dbClient: Client
  let baseUrl: string
  let testSchema: string
  let usersTable: string
  let postsTable: string
  let targetUserId: string

  const shapeUrl = () => `${baseUrl}/v1/shape`

  beforeAll(async () => {
    baseUrl = inject(`baseUrl`)
    testSchema = inject(`testSchema`)

    const testId = Date.now().toString(16)
    usersTable = `"users_pn_${testId}"`
    postsTable = `"posts_pn_${testId}"`

    dbClient = makePgClient({ options: `-csearch_path=${testSchema}` })
    await dbClient.connect()
    await dbClient.query(`SET search_path TO ${testSchema}`)

    await dbClient.query(`
      CREATE TABLE ${usersTable} (id UUID PRIMARY KEY, name TEXT NOT NULL)
    `)
    await dbClient.query(`
      CREATE TABLE ${postsTable} (
        id UUID PRIMARY KEY,
        "userId" UUID NOT NULL,
        title TEXT NOT NULL
      )
    `)

    targetUserId = randomUUID()
    await dbClient.query(
      `INSERT INTO ${usersTable} (id, name) VALUES ($1, $2)`,
      [targetUserId, `Target User`],
    )
    // Small target subset.
    await dbClient.query(
      `INSERT INTO ${postsTable} (id, "userId", title)
       SELECT gen_random_uuid(), $1, 'Target Post ' || g
       FROM generate_series(1, ${TARGET_POSTS}) g`,
      [targetUserId],
    )
    // Large remainder so the background full sync is visibly slow.
    for (let u = 0; u < OTHER_USERS; u++) {
      const otherId = randomUUID()
      await dbClient.query(
        `INSERT INTO ${usersTable} (id, name) VALUES ($1, $2)`,
        [otherId, `Other User ${u}`],
      )
      await dbClient.query(
        `INSERT INTO ${postsTable} (id, "userId", title)
         SELECT gen_random_uuid(), $1, 'Post ' || g
         FROM generate_series(1, ${POSTS_PER_OTHER_USER}) g`,
        [otherId],
      )
    }

    // Ensure Electric's replication slot has caught up with the seed data.
    const verify = createCollection(
      electricCollectionOptions<Post>({
        id: `pn-verify-${testId}`,
        shapeOptions: {
          url: shapeUrl(),
          params: { table: `${testSchema}.${postsTable}` },
        },
        syncMode: `eager`,
        getKey: (item) => item.id,
        startSync: true,
      }),
    )
    await verify.preload()
    await waitFor(() => verify.size >= TOTAL_POSTS, {
      timeout: 60000,
      interval: 250,
      message: `Electric did not replicate seed posts (got ${verify.size}/${TOTAL_POSTS})`,
    })
    await verify.cleanup()
  }, 120000)

  afterAll(async () => {
    await dbClient.query(`DROP TABLE IF EXISTS ${postsTable}`)
    await dbClient.query(`DROP TABLE IF EXISTS ${usersTable}`)
    await dbClient.end()
  })

  function makeProgressive<T extends Row<unknown> & { id: string }>(
    id: string,
    table: string,
  ) {
    return createCollection(
      electricCollectionOptions<T>({
        id,
        shapeOptions: {
          url: shapeUrl(),
          params: { table: `${testSchema}.${table}` },
        },
        syncMode: `progressive`,
        getKey: (item) => item.id,
        startSync: true,
      }),
    )
  }

  /**
   * Polls until `getSubsetSize()` reaches `TARGET_POSTS` and records how much
   * of the `posts` collection had loaded at that moment. A size well below the
   * full collection means the fast-path snapshot served the query; a size
   * equal to the full collection means the query had to wait for the whole
   * background sync.
   */
  async function postsLoadedWhenSubsetReady(
    posts: { readonly size: number },
    getSubsetSize: () => number,
  ): Promise<number> {
    const deadline = Date.now() + 60000
    while (Date.now() < deadline) {
      if (getSubsetSize() >= TARGET_POSTS) {
        return posts.size
      }
      await sleep(5)
    }
    throw new Error(
      `subset never reached ${TARGET_POSTS} (got ${getSubsetSize()}, posts.size=${posts.size})`,
    )
  }

  it(`direct query loads the target subset via the fast-path snapshot`, async () => {
    const posts = makeProgressive<Post>(
      `pn-posts-direct-${Date.now().toString(16)}`,
      postsTable,
    )

    const query = createLiveQueryCollection((q) =>
      q
        .from({ post: posts })
        .where(({ post }) => eq(post.userId, targetUserId)),
    )
    void query.preload()

    const postsLoaded = await postsLoadedWhenSubsetReady(
      posts,
      () => query.size,
    )
    console.log(
      `[DIRECT] posts loaded when subset ready: ${postsLoaded}/${TOTAL_POSTS}`,
    )

    await waitFor(() => posts.status === `ready`, { timeout: 60000 })
    await query.cleanup()
    await posts.cleanup()

    // Fast path: the query saw its 40 rows long before the full background
    // sync of ~4500 rows finished.
    expect(postsLoaded).toBeLessThan(TOTAL_POSTS)
  }, 90000)

  it(`nested toArray query loads the target subset via the fast-path snapshot`, async () => {
    const suffix = Date.now().toString(16)
    const users = makeProgressive<User>(`pn-users-tarray-${suffix}`, usersTable)
    const posts = makeProgressive<Post>(`pn-posts-tarray-${suffix}`, postsTable)

    const query = createLiveQueryCollection((q) =>
      q
        .from({ user: users })
        .where(({ user }) => eq(user.id, targetUserId))
        .select(({ user }) => ({
          id: user.id,
          name: user.name,
          posts: toArray(
            q
              .from({ post: posts })
              .where(({ post }) => eq(post.userId, user.id)),
          ),
        })),
    )
    void query.preload()

    const nestedCount = () => {
      const row = Array.from(query.values())[0] as
        | { posts?: Array<Post> }
        | undefined
      return row?.posts?.length ?? 0
    }

    const postsLoaded = await postsLoadedWhenSubsetReady(posts, nestedCount)
    console.log(
      `[NESTED toArray] posts loaded when subset ready: ${postsLoaded}/${TOTAL_POSTS}`,
    )

    await waitFor(() => posts.status === `ready`, { timeout: 60000 })
    await query.cleanup()
    await users.cleanup()
    await posts.cleanup()

    // The nested subset arrives via the fast-path snapshot, well before the
    // full background sync of the posts collection completes.
    expect(postsLoaded).toBeLessThan(TOTAL_POSTS)
  }, 90000)

  it(`nested join query loads the target subset via the fast-path snapshot`, async () => {
    const suffix = Date.now().toString(16)
    const users = makeProgressive<User>(`pn-users-join-${suffix}`, usersTable)
    const posts = makeProgressive<Post>(`pn-posts-join-${suffix}`, postsTable)

    const query = createLiveQueryCollection((q) =>
      q
        .from({ user: users })
        .where(({ user }) => eq(user.id, targetUserId))
        .innerJoin({ post: posts }, ({ user, post }) =>
          eq(post.userId, user.id),
        )
        .select(({ post }) => ({ ...post })),
    )
    void query.preload()

    const postsLoaded = await postsLoadedWhenSubsetReady(
      posts,
      () => query.size,
    )
    console.log(
      `[NESTED join] posts loaded when subset ready: ${postsLoaded}/${TOTAL_POSTS}`,
    )

    await waitFor(() => posts.status === `ready`, { timeout: 60000 })
    await query.cleanup()
    await users.cleanup()
    await posts.cleanup()

    // The joined subset arrives via the fast-path snapshot, well before the
    // full background sync of the posts collection completes.
    expect(postsLoaded).toBeLessThan(TOTAL_POSTS)
  }, 90000)
})
