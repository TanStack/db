/**
 * Initial-query readiness exposure witnesses for core readers.
 *
 * Law (ARCHITECTURE.md law 10): a live query is initially ready when every
 * reachable demand is covered by a settled request and every eager source is
 * ready. An on-demand source's own Collection readiness does not gate it.
 * Every reader of that readiness must release at the same point, and must stay
 * released when the source later becomes ready or changes.
 *
 * The primary oracle is Model D in `query/includes-temporal-oracle.test.ts`.
 * These witnesses cover readers that Model D does not drive: the pooled
 * live-query path that frameworks use for `eq` filters, and
 * `toArrayWhenReady`.
 */
import { describe, expect, it } from 'vitest'
import { pooledLiveQueries } from '../src/query/pooled-live-query.js'
import { createCollection } from '../src/collection/index.js'
import { createLiveQueryCollection, eq } from '../src/query/index.js'
import { resolveLiveQueryValue } from '../src/live-query-options.js'
import { Query } from '../src/query/builder/index.js'

type Post = { id: string; title: string }

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

/**
 * An on-demand source whose subset load writes its rows and then waits for
 * the test to settle it. The source stays `loading` until `markReady`.
 */
function createLaggingSource(id: string) {
  let resolveLoad: (() => void) | undefined
  let controls:
    | {
        write: (row: Post) => void
        markReady: () => void
      }
    | undefined
  const collection = createCollection<Post>({
    id,
    getKey: (post) => post.id,
    syncMode: `on-demand`,
    sync: {
      sync: ({ begin, write, commit, markReady }) => {
        controls = {
          write: (row) => {
            begin()
            write({ type: `insert`, value: row })
            commit()
          },
          markReady,
        }
        return {
          loadSubset: () =>
            new Promise<void>((resolve) => {
              resolveLoad = resolve
            }),
        }
      },
    },
  })
  return {
    collection,
    loadStarted: () => resolveLoad !== undefined,
    deliver: (row: Post) => controls!.write(row),
    settle: () => resolveLoad!(),
    markReady: () => controls!.markReady(),
  }
}

/** An eager source that has rows but is not ready until `markReady`. */
function createLoadingEagerSource(id: string) {
  let controls:
    { write: (row: Post) => void; markReady: () => void } | undefined
  const collection = createCollection<Post>({
    id,
    getKey: (post) => post.id,
    sync: {
      sync: ({ begin, write, commit, markReady }) => {
        controls = {
          write: (row) => {
            begin()
            write({ type: `insert`, value: row })
            commit()
          },
          markReady,
        }
      },
    },
  })
  return {
    collection,
    deliver: (row: Post) => controls!.write(row),
    markReady: () => controls!.markReady(),
  }
}

describe(`core readers release at initial-query readiness`, () => {
  it(`a framework-resolved eq query over an on-demand source becomes ready when its subset settles`, async () => {
    const source = createLaggingSource(`exposure-resolved-on-demand`)
    const query = new Query()
      .from({ post: source.collection })
      .where(({ post }) => eq(post.id, `p1`))
    const live = resolveLiveQueryValue(query, { pool: pooledLiveQueries })!
    // On-demand loading needs the live-query Collection, not the pooled view.
    expect(`materialize` in live).toBe(false)
    const subscription = live.subscribeChanges(() => {})
    await flush()
    expect(source.loadStarted()).toBe(true)

    source.deliver({ id: `p1`, title: `one` })
    await flush()
    expect(live.isReady()).toBe(false)

    source.settle()
    await flush()
    expect(source.collection.status).toBe(`loading`)
    expect(live.isReady()).toBe(true)
    expect(live.toArray.map((post) => post.id)).toEqual([`p1`])

    source.markReady()
    source.deliver({ id: `p2`, title: `two` })
    await flush()
    expect(live.isReady()).toBe(true)
    subscription.unsubscribe()
    await live.cleanup()
    await source.collection.cleanup()
  })

  it(`a pooled eq query over an eager source waits for source readiness`, async () => {
    const source = createLoadingEagerSource(`exposure-pooled-eager`)
    const query = new Query()
      .from({ post: source.collection })
      .where(({ post }) => eq(post.id, `p1`))
    const live = resolveLiveQueryValue(query, { pool: pooledLiveQueries })!
    expect(`materialize` in live).toBe(true)
    const subscription = live.subscribeChanges(() => {})
    await flush()

    source.deliver({ id: `p1`, title: `one` })
    await flush()
    expect(live.status === `ready`).toBe(false)

    source.markReady()
    await flush()
    expect(live.status === `ready`).toBe(true)
    // The pooled view exposes rows through `entries`, as the observer reads them.
    expect([...live.entries()].map(([key]) => key)).toEqual([`p1`])

    source.deliver({ id: `p2`, title: `two` })
    await flush()
    expect(live.status === `ready`).toBe(true)
    subscription.unsubscribe()
    await live.cleanup()
    await source.collection.cleanup()
  })

  it(`toArrayWhenReady resolves when the subset settles, not before`, async () => {
    const source = createLaggingSource(`exposure-to-array-when-ready`)
    const live = createLiveQueryCollection((q) =>
      q
        .from({ post: source.collection })
        .where(({ post }) => eq(post.id, `p1`)),
    )
    let resolved: Array<Post> | undefined
    // Rows become visible before their request settles.
    void live.preload()
    await flush()
    source.deliver({ id: `p1`, title: `one` })
    await flush()
    expect(live.isReady()).toBe(false)

    void live.toArrayWhenReady().then((rows) => {
      resolved = rows
    })
    await flush()
    expect(resolved).toBeUndefined()

    source.settle()
    await flush()
    expect(live.isReady()).toBe(true)
    expect(resolved?.map((post) => post.id)).toEqual([`p1`])
    await live.cleanup()
    await source.collection.cleanup()
  })
})
