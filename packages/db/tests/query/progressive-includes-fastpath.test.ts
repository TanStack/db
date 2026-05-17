import { describe, expect, it, vi } from 'vitest'
import { createLiveQueryCollection, eq, toArray } from '../../src/query/index.js'
import { createCollection } from '../../src/collection/index.js'
import { extractSimpleComparisons } from '../../src/query/expression-helpers.js'
import { flushPromises } from '../utils.js'
import type { LoadSubsetOptions } from '../../src/types.js'

/**
 * Regression test for a progressive-sync-mode bug with nested `toArray`
 * subqueries.
 *
 * In `progressive` sync mode an Electric collection serves a fast-path
 * `fetchSnapshot` for any `loadSubset` call that arrives BEFORE its first
 * `up-to-date` message (`isBufferingInitialSync()` in electric.ts). After that
 * the window is closed and the data is only available once the full background
 * sync finishes.
 *
 * - Direct query  (`q.from({post}).where(eq(post.userId, X))`):
 *     the collection subscriber issues `loadSubset` immediately, inside the
 *     window -> fast path works.
 *
 * - Nested query  (`post` fetched via `toArray` inside a user's `select`):
 *     the BUG was that includes lazy-loading deferred the child `loadSubset`
 *     until the parent `users` query produced rows. The fix: when the parent
 *     query statically constrains the correlation field (`eq(user.id, X)`),
 *     the child subset is loaded eagerly — in parallel with the parent — so it
 *     still lands inside the fast-path window.
 *
 * This is the deterministic proof. The fast-path window is modelled with a
 * plain `@tanstack/db` collection whose `loadSubset` records whether it was
 * called while the window was open — the deferral it exposes is real
 * `@tanstack/db` behaviour, only the window is simulated. The same scenario
 * against a real Electric server is verified end-to-end by
 * packages/electric-db-collection/e2e/progressive-nested.e2e.test.ts.
 */

type User = { id: number; name: string }
type Post = { id: number; userId: number; title: string }

const users: Array<User> = [
  { id: 1, name: `U1` },
  { id: 2, name: `U2` },
  { id: 3, name: `U3` },
]

let seq = 0

/**
 * A collection whose initial sync is gated: nothing is committed and the
 * collection is not `markReady()` until `release()` is called. Mirrors a
 * parent collection that takes a moment to sync.
 */
function makeGatedUsers() {
  let release: () => void = () => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const collection = createCollection<User>({
    id: `fastpath-users-${seq++}`,
    getKey: (u) => u.id,
    sync: {
      sync: ({ begin, write, commit, markReady }) => {
        void (async () => {
          await gate
          begin()
          for (const u of users) write({ type: `insert`, value: u })
          commit()
          markReady()
        })()
      },
    },
  })
  return { collection, release }
}

/**
 * Models an Electric collection in `progressive` sync mode.
 *
 * `windowOpen` mirrors `isBufferingInitialSync()`: the progressive fast-path
 * (`fetchSnapshot`) only runs while it is `true`. `closeWindow()` simulates the
 * first `up-to-date` message arriving, after which `loadSubset` calls can no
 * longer be served from a snapshot.
 */
function makeProgressivePosts() {
  let windowOpen = true
  const fastPathLoads: Array<LoadSubsetOptions> = []
  const lateLoads: Array<LoadSubsetOptions> = []

  const collection = createCollection<Post>({
    id: `fastpath-posts-${seq++}`,
    getKey: (p) => p.id,
    syncMode: `on-demand`,
    sync: {
      sync: ({ begin, commit, markReady }) => {
        begin()
        commit()
        markReady()
        return {
          loadSubset: vi.fn((opts: LoadSubsetOptions) => {
            ;(windowOpen ? fastPathLoads : lateLoads).push(opts)
            return Promise.resolve()
          }),
        }
      },
    },
  })

  return {
    collection,
    fastPathLoads,
    lateLoads,
    closeWindow: () => {
      windowOpen = false
    },
  }
}

describe(`progressive sync — nested subquery fast-path`, () => {
  it(`direct query: posts loadSubset runs INSIDE the fast-path window`, async () => {
    const { collection: posts, fastPathLoads, lateLoads } =
      makeProgressivePosts()

    const query = createLiveQueryCollection((q) =>
      q.from({ post: posts }).where(({ post }) => eq(post.userId, 2)),
    )
    const preloadPromise = query.preload()
    await flushPromises()

    // The collection subscriber issues loadSubset immediately — before the
    // progressive collection's buffering window could close.
    expect(fastPathLoads.length).toBeGreaterThan(0)
    expect(lateLoads.length).toBe(0)

    await preloadPromise
  })

  it(`nested toArray child: posts loadSubset runs eagerly, INSIDE the fast-path window`, async () => {
    // The parent `users` collection is gated and never released, so its data
    // never arrives. Before the fix the child `posts` loadSubset was deferred
    // behind the parent and would never run; with the fix it runs eagerly
    // because the parent filters the correlation field to a known key.
    const { collection: gatedUsers } = makeGatedUsers()
    const { collection: posts, fastPathLoads, lateLoads } =
      makeProgressivePosts()

    const query = createLiveQueryCollection((q) =>
      q
        .from({ user: gatedUsers })
        .where(({ user }) => eq(user.id, 2))
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
    // Not awaited: preload never resolves while the parent stays gated.
    void query.preload()
    await flushPromises()

    // The child loadSubset ran eagerly — inside the fast-path window — even
    // though the parent `users` collection has not synced.
    expect(fastPathLoads.length).toBeGreaterThan(0)
    expect(lateLoads.length).toBe(0)

    // It was scoped to the parent's statically-known correlation key.
    const lastLoad = fastPathLoads[fastPathLoads.length - 1]!
    expect(extractSimpleComparisons(lastLoad.where)).toEqual([
      { field: [`userId`], operator: `in`, value: [2] },
    ])
  })
})
