/**
 * # A DbClient preload cannot substitute another source Collection
 *
 * A query hash names a reusable result only while its source Collection
 * objects remain the same at each source position in one DbClient. A descriptor
 * query and its concrete form intentionally have the same hash when they name
 * the same source object.
 * If a second plan with that hash names a different source object, including
 * one with the same Collection ID, preload rejects the ambiguous request.
 * Returning the first plan's rows would report data from the wrong source.
 *
 * Model: two plain source rows have distinct values. The first successful
 * preload owns the hash while its client result is reusable. Repeating it
 * with the same source yields that row; asking for the other source rejects
 * and leaves the first result intact. Once a subscribed live result becomes
 * authoritative and consumes that client result, the next observer reads its
 * own source row, regardless of whether it uses the first source object.
 * Swapping two same-ID source objects between query positions also rejects:
 * a set of source objects cannot tell which row belongs to each position.
 * A pooled view has one source even though it has no query Collection config.
 * Its observer may reuse an existing stream only for that same source, and its
 * preload must finish the view's own source demand. Observer preload returns a
 * Promise for either a successful reuse or a rejected source conflict.
 * An ordinary observer checks an active stream's source claim before retaining
 * its first listener. A conflicting attempt rejects on every retry while the
 * stream remains active; a same-source observer can attach.
 * This model uses source-object identity, not the query cache implementation.
 *
 * The finite history crosses concrete then descriptor, descriptor then
 * concrete, and two concrete source objects, plus a same-object control. The
 * pooled observer path crosses same and different local source objects.
 * An ordinary observer crosses those objects while the result is active, at
 * a retry after rejection, and after the first result is consumed. The
 * comparison is the public throw or accepted row at the subscription call
 * and after preload. The consumed cut observes no client stream in public
 * dehydration before the next observer attaches. Other attach failures and
 * concurrent subscription orders remain outside this finite history.
 * Each query is built through the public Query API. Client preloads are
 * observed through public DbClient.dehydrate(); after consumption, the next
 * observer is checked through its snapshot. The comparison runs after the
 * first preload and after the second attempted preload. The pooled path also
 * checks its observer snapshot after same-source reuse. This
 * does not define how a hydrated stream from another process matches a local
 * source, or how different explicit query keys share one hash. A separate
 * hydration-first history below gives the first local consumer authority to
 * claim a hydrated hash's runtime source objects. The stream's portable hash
 * cannot carry server-side object identity; a later local consumer must use
 * the claimed objects. This is checked while the hydrated stream is settled
 * and while its result promise is pending.
 * A failed stream has no result to reuse and relinquishes its source claim.
 * If a newer hydrated result arrives after that failure, its portable hash
 * still has no local source identity. The first healthy observer may claim it,
 * even when its source object differs from the failed stream's source. The
 * failure-then-hydration history compares the public subscription result and
 * the observer's own row after preload. It does not model concurrent first
 * claims or arbitrary hydration orders.
 */
import { describe, expect, it, vi } from 'vitest'
import { pooledLiveQueries } from '../src/query/pooled-live-query.js'
import {
  DbClient,
  Query,
  collectionOptions,
  createCollection,
  createLiveQueryObserver,
  eq,
  getLiveQueryHash,
  getStableQueryBuilderHash,
  resolveLiveQueryValue,
} from '../src'
import type { SyncConfig } from '../src/types'
import type { DehydratedLiveQueryResult } from '../src/client'

type Row = { id: string; value: string }

function sourceConfig(id: string, value: string) {
  return {
    id,
    getKey: (row: Row) => row.id,
    startSync: true,
    sync: {
      sync: ({
        begin,
        write,
        commit,
        markReady,
      }: Parameters<SyncConfig<Row, string>[`sync`]>[0]) => {
        begin()
        write({ type: `insert`, value: { id: `one`, value } })
        commit()
        markReady()
      },
    },
  }
}

function rows(client: DbClient): Array<Row> | undefined {
  return client
    .dehydrate()
    .liveQueries?.[0]?.snapshot?.rows.map(({ value }) => ({
      id: (value as Row).id,
      value: (value as Row).value,
    }))
}

describe(`DbClient preload source identity`, () => {
  it.each([`settled`, `pending`] as const)(
    `a %s hydrated stream keeps the first local source claim`,
    async (streamState) => {
      const id = `hydrated-first-source-claim-${streamState}`
      const serverSource = createCollection(sourceConfig(id, `server`))
      const firstLocal = createCollection(sourceConfig(id, `local-first`))
      const otherLocal = createCollection(sourceConfig(id, `local-other`))
      const queryFor = (source: typeof serverSource) =>
        new Query()
          .from({ item: source })
          .select(({ item }) => ({ id: item.id, value: item.value }))
      const server = new DbClient()
      const browser = new DbClient()
      let settle!: (value: { rows: Array<{ key: string; value: Row }> }) => void
      let conflictingObserver:
        ReturnType<typeof createLiveQueryObserver> | undefined
      let conflictingView: ReturnType<typeof resolveLiveQueryValue> | undefined

      try {
        await server.preloadLiveQuery({ query: queryFor(serverSource) })
        const state = server.dehydrate()
        const stream = state.liveQueries![0]!
        const firstQuery = queryFor(firstLocal)
        const otherQuery = queryFor(otherLocal)
        expect(getStableQueryBuilderHash(firstQuery)).toBe(
          getStableQueryBuilderHash(otherQuery),
        )
        if (streamState === `pending`) {
          const pending = new Promise<{
            rows: Array<{ key: string; value: Row }>
          }>((resolve) => {
            settle = resolve
          })
          browser.hydrate({
            collections: state.collections,
            liveQueries: [
              {
                queryHash: stream.queryHash,
                dehydratedAt: stream.dehydratedAt,
                promise: pending,
              },
            ],
          })
        } else {
          browser.hydrate(state)
        }

        const firstRead = browser.preloadLiveQuery({ query: firstQuery })
        expect(() => browser.preloadLiveQuery({ query: otherQuery })).toThrow(
          /different source Collections/,
        )
        if (streamState === `pending`) {
          conflictingView = resolveLiveQueryValue(otherQuery, {
            pool: pooledLiveQueries,
          })
          expect(conflictingView).not.toBeNull()
          conflictingObserver = createLiveQueryObserver(conflictingView, {
            client: browser,
            queryHash: stream.queryHash,
          })
          let rejected: Promise<void> | undefined
          expect(() => {
            rejected = conflictingObserver!.preload()
          }).not.toThrow()
          await expect(rejected).rejects.toThrow(/different source Collections/)
        }

        if (streamState === `pending`)
          settle(
            stream.snapshot! as { rows: Array<{ key: string; value: Row }> },
          )
        await firstRead
        expect(rows(browser)).toEqual([{ id: `one`, value: `server` }])

        // A newer hydration chunk updates the result, but cannot revoke the
        // browser client's already established runtime source claim.
        browser.hydrate({
          collections: [],
          liveQueries: [
            {
              queryHash: stream.queryHash,
              dehydratedAt: stream.dehydratedAt + 1,
              snapshot: {
                rows: [
                  { key: `one`, value: { id: `one`, value: `newer server` } },
                ],
              },
            },
          ],
        })
        expect(() => browser.preloadLiveQuery({ query: otherQuery })).toThrow(
          /different source Collections/,
        )
        expect(rows(browser)).toEqual([{ id: `one`, value: `newer server` }])
      } finally {
        conflictingObserver?.dispose()
        await conflictingView?.cleanup()
        await browser.cleanup()
        await server.cleanup()
        await serverSource.cleanup()
        await firstLocal.cleanup()
        await otherLocal.cleanup()
      }
    },
  )

  /**
   * Model: failure retires the old reusable result and its source claim.
   * Hydration adds a portable result without local Collection provenance, so
   * the first healthy local observer may attach and read its own source row.
   * The active-stream cells below are the opposite source-claim cut.
   */
  it.each([`settled`, `pending`] as const)(
    `a %s hydrated result after stream failure accepts a healthy observer source`,
    async (streamState) => {
      const id = `hydrated-after-failed-source-claim-${streamState}`
      let failFirst!: () => void
      const failed = createCollection({
        id,
        getKey: (row: Row) => row.id,
        startSync: true,
        sync: {
          sync: ({
            markError,
          }: Parameters<SyncConfig<Row, string>[`sync`]>[0]) => {
            failFirst = () => markError(new Error(`first source failed`))
          },
        },
      })
      const replacement = createCollection(sourceConfig(id, `replacement`))
      const queryFor = (source: typeof failed) =>
        new Query()
          .from({ item: source })
          .select(({ item }) => ({ id: item.id, value: item.value }))
      const firstQuery = queryFor(failed)
      const replacementQuery = queryFor(replacement)
      const queryHash = getLiveQueryHash({ query: firstQuery })
      const client = new DbClient()
      const snapshot: DehydratedLiveQueryResult = {
        rows: [{ key: `one`, value: { id: `one`, value: `server` } }],
      }
      let settleHydration:
        ((value: DehydratedLiveQueryResult) => void) | undefined
      const hydrationPromise = new Promise<DehydratedLiveQueryResult>(
        (resolve) => {
          settleHydration = resolve
        },
      )
      let view: ReturnType<typeof resolveLiveQueryValue> | undefined
      let observer: ReturnType<typeof createLiveQueryObserver> | undefined
      let unsubscribe: (() => void) | undefined

      try {
        expect(getLiveQueryHash({ query: replacementQuery })).toBe(queryHash)
        const pending = client.preloadLiveQuery({ query: firstQuery })
        const stream = client.dehydrate({
          shouldDehydrateLiveQuery: () => true,
        }).liveQueries?.[0]
        expect(stream?.queryHash).toBe(queryHash)
        failFirst()
        await expect(pending).rejects.toThrow(/entered error state/)
        expect(client.dehydrate().liveQueries).toBeUndefined()

        client.hydrate({
          collections: [],
          liveQueries: [
            {
              queryHash,
              dehydratedAt: stream!.dehydratedAt + 1,
              ...(streamState === `settled`
                ? { snapshot }
                : { promise: hydrationPromise }),
            },
          ],
        })
        if (streamState === `settled`)
          expect(rows(client)).toEqual([{ id: `one`, value: `server` }])

        view = resolveLiveQueryValue(replacementQuery, {
          pool: pooledLiveQueries,
        })
        expect(view).not.toBeNull()
        observer = createLiveQueryObserver(view, { client, queryHash })
        expect(() => {
          unsubscribe = observer!.subscribe(() => {})
        }).not.toThrow()
        const preload = observer.preload()
        settleHydration?.(snapshot)
        await preload
        expect(
          (observer.getSnapshot().data as Array<Row>).map((row) => row.value),
        ).toEqual([`replacement`])
        expect(observer.getSnapshot().status).toBe(`ready`)
      } finally {
        settleHydration?.(snapshot)
        unsubscribe?.()
        observer?.dispose()
        await view?.cleanup()
        await client.cleanup()
        await failed.cleanup()
        await replacement.cleanup()
      }
    },
  )

  for (const order of [
    `concrete then descriptor`,
    `descriptor then concrete`,
    `concrete then concrete`,
  ] as const) {
    it(`${order}: rejects a second source object with the same hash`, async () => {
      const id = `preload-source-identity-${order}`
      const descriptor = collectionOptions(id, () =>
        sourceConfig(id, `descriptor`),
      )
      const concrete = createCollection(sourceConfig(id, `concrete`))
      const otherConcrete =
        order === `concrete then concrete`
          ? createCollection(sourceConfig(id, `other`))
          : undefined
      const concreteQuery = new Query()
        .from({ item: concrete })
        .select(({ item }) => ({ id: item.id, value: item.value }))
      const descriptorQuery = new Query()
        .from({ item: descriptor })
        .select(({ item }) => ({ id: item.id, value: item.value }))
      const otherQuery = otherConcrete
        ? new Query()
            .from({ item: otherConcrete })
            .select(({ item }) => ({ id: item.id, value: item.value }))
        : undefined
      const firstQuery =
        order === `descriptor then concrete` ? descriptorQuery : concreteQuery
      const secondQuery =
        order === `concrete then descriptor`
          ? descriptorQuery
          : (otherQuery ?? concreteQuery)
      const firstValue =
        order === `descriptor then concrete` ? `descriptor` : `concrete`
      const client = new DbClient()

      try {
        expect(getStableQueryBuilderHash(firstQuery)).toBe(
          getStableQueryBuilderHash(secondQuery),
        )
        await client.preloadLiveQuery({ query: firstQuery })
        expect(rows(client)).toEqual([{ id: `one`, value: firstValue }])

        await expect(
          Promise.resolve().then(() =>
            client.preloadLiveQuery({ query: secondQuery }),
          ),
        ).rejects.toThrow(/different source Collections/)
        expect(rows(client)).toEqual([{ id: `one`, value: firstValue }])
      } finally {
        await client.cleanup()
        await concrete.cleanup()
        await otherConcrete?.cleanup()
      }
    })
  }

  it(`reuses a descriptor result through its own concrete Collection`, async () => {
    const id = `preload-source-identity-same-object`
    const descriptor = collectionOptions(id, () => sourceConfig(id, `same`))
    const descriptorQuery = new Query()
      .from({ item: descriptor })
      .select(({ item }) => ({ id: item.id, value: item.value }))
    const client = new DbClient()

    try {
      await client.preloadLiveQuery({ query: descriptorQuery })
      const concreteQuery = new Query()
        .from({ item: client.collection(descriptor) })
        .select(({ item }) => ({ id: item.id, value: item.value }))
      expect(getStableQueryBuilderHash(descriptorQuery)).toBe(
        getStableQueryBuilderHash(concreteQuery),
      )
      await client.preloadLiveQuery({ query: concreteQuery })
      expect(rows(client)).toEqual([{ id: `one`, value: `same` }])
    } finally {
      await client.cleanup()
    }
  })

  it(`rejects same-ID sources swapped between union branches`, async () => {
    const id = `preload-source-identity-swapped`
    const left = createCollection(sourceConfig(id, `left`))
    const right = createCollection(sourceConfig(id, `right`))
    const queryFor = (first: typeof left, second: typeof right) =>
      new Query().unionAll(
        new Query()
          .from({ first })
          .select(({ first: row }) => ({ id: row.id, value: row.value })),
        new Query()
          .from({ second })
          .select(({ second: row }) => ({ id: row.id, value: row.value })),
      )
    const first = queryFor(left, right)
    const swapped = queryFor(right, left)
    const client = new DbClient()

    try {
      expect(getStableQueryBuilderHash(first)).toBe(
        getStableQueryBuilderHash(swapped),
      )
      await client.preloadLiveQuery({ query: first })
      const before = rows(client)
      expect(before?.map((row) => row.value).sort()).toEqual([`left`, `right`])

      await expect(
        Promise.resolve().then(() =>
          client.preloadLiveQuery({ query: swapped }),
        ),
      ).rejects.toThrow(/different source Collections/)
      expect(rows(client)).toEqual(before)
    } finally {
      await client.cleanup()
      await left.cleanup()
      await right.cleanup()
    }
  })

  /**
   * Subscription admission is atomic. A rejected observer cannot retain its
   * attempted listener: while the active stream still claims the first source,
   * every attempt using the other source must reject. The same-source neighbor
   * must attach and read its own row. Both cuts use the public observer API.
   */
  it.each([`same`, `different`] as const)(
    `%s source: an observer subscription respects an active stream claim`,
    async (sourceRelation) => {
      const id = `observer-attach-source-identity-${sourceRelation}`
      const first = createCollection(sourceConfig(id, `first`))
      const second = createCollection(sourceConfig(id, `second`))
      const queryFor = (source: typeof first) =>
        new Query()
          .from({ item: source })
          .select(({ item }) => ({ id: item.id, value: item.value }))
      const firstQuery = queryFor(first)
      const candidateQuery = queryFor(
        sourceRelation === `same` ? first : second,
      )
      const client = new DbClient()
      let observer: ReturnType<typeof createLiveQueryObserver> | undefined
      let view: ReturnType<typeof resolveLiveQueryValue> | undefined

      try {
        await client.preloadLiveQuery({ query: firstQuery })
        const queryHash = getLiveQueryHash({ query: firstQuery })
        expect(getLiveQueryHash({ query: candidateQuery })).toBe(queryHash)
        view = resolveLiveQueryValue(candidateQuery, {
          pool: pooledLiveQueries,
        })
        expect(view).not.toBeNull()
        observer = createLiveQueryObserver(view, { client, queryHash })

        if (sourceRelation === `different`) {
          expect(() => observer!.subscribe(() => {})).toThrow(
            /different source Collections/,
          )
          expect(
            () => observer!.subscribe(() => {}),
            `a failed attach must not leave a listener`,
          ).toThrow(/different source Collections/)
        } else {
          const unsubscribe = observer.subscribe(() => {})
          try {
            await observer.preload()
            expect(
              (observer.getSnapshot().data as Array<Row>).map(
                (row) => row.value,
              ),
            ).toEqual([`first`])
          } finally {
            unsubscribe()
          }
        }
      } finally {
        observer?.dispose()
        await view?.cleanup()
        await client.cleanup()
        await first.cleanup()
        await second.cleanup()
      }
    },
  )

  /**
   * The source claim belongs to a reusable client result. Once a subscribed
   * live result becomes authoritative, that result is consumed. The next
   * observer must read its own source row, whether its source object is the
   * same or different. The active-stream cases above are the opposite cut.
   */
  it.each([`same`, `different`] as const)(
    `%s source: an observer can subscribe after the client result is consumed`,
    async (sourceRelation) => {
      const id = `observer-after-consumed-result-${sourceRelation}`
      const first = createCollection(sourceConfig(id, `first`))
      const second = createCollection(sourceConfig(id, `second`))
      const queryFor = (source: typeof first) =>
        new Query()
          .from({ item: source })
          .select(({ item }) => ({ id: item.id, value: item.value }))
      const firstQuery = queryFor(first)
      const candidateQuery = queryFor(
        sourceRelation === `same` ? first : second,
      )
      const client = new DbClient()
      let firstView: ReturnType<typeof resolveLiveQueryValue> | undefined
      let nextView: ReturnType<typeof resolveLiveQueryValue> | undefined
      let firstObserver: ReturnType<typeof createLiveQueryObserver> | undefined
      let nextObserver: ReturnType<typeof createLiveQueryObserver> | undefined
      let unsubscribeFirst: (() => void) | undefined
      let unsubscribeNext: (() => void) | undefined

      try {
        await client.preloadLiveQuery({ query: firstQuery })
        const queryHash = getLiveQueryHash({ query: firstQuery })
        expect(getLiveQueryHash({ query: candidateQuery })).toBe(queryHash)
        expect(rows(client)).toEqual([{ id: `one`, value: `first` }])

        firstView = resolveLiveQueryValue(firstQuery, {
          pool: pooledLiveQueries,
        })
        expect(firstView).not.toBeNull()
        firstObserver = createLiveQueryObserver(firstView, {
          client,
          queryHash,
        })
        unsubscribeFirst = firstObserver.subscribe(() => {})
        await firstObserver.preload()
        await vi.waitFor(() =>
          expect(client.dehydrate().liveQueries).toBeUndefined(),
        )
        expect(
          (firstObserver.getSnapshot().data as Array<Row>).map(
            (row) => row.value,
          ),
        ).toEqual([`first`])

        nextView = resolveLiveQueryValue(candidateQuery, {
          pool: pooledLiveQueries,
        })
        expect(nextView).not.toBeNull()
        nextObserver = createLiveQueryObserver(nextView, { client, queryHash })
        expect(() => {
          unsubscribeNext = nextObserver!.subscribe(() => {})
        }).not.toThrow()
        await nextObserver.preload()
        expect(
          (nextObserver.getSnapshot().data as Array<Row>).map(
            (row) => row.value,
          ),
        ).toEqual([sourceRelation === `same` ? `first` : `second`])
      } finally {
        unsubscribeNext?.()
        unsubscribeFirst?.()
        nextObserver?.dispose()
        firstObserver?.dispose()
        await nextView?.cleanup()
        await firstView?.cleanup()
        await client.cleanup()
        await first.cleanup()
        await second.cleanup()
      }
    },
  )

  it.each([`same`, `different`] as const)(
    `%s source: an observer preload respects a pooled view's source identity`,
    async (sourceRelation) => {
      const id = `preload-source-identity-pooled-observer`
      const first = createCollection(sourceConfig(id, `first`))
      const second = createCollection(sourceConfig(id, `second`))
      const queryFor = (source: typeof first) =>
        new Query()
          .from({ item: source })
          .where(({ item }) => eq(item.id, `one`))
      const firstQuery = queryFor(first)
      const candidateQuery = queryFor(
        sourceRelation === `same` ? first : second,
      )
      const client = new DbClient()
      const queryHash = getLiveQueryHash({ query: firstQuery })
      let observer: ReturnType<typeof createLiveQueryObserver> | undefined

      try {
        expect(getLiveQueryHash({ query: candidateQuery })).toBe(queryHash)
        await client.preloadLiveQuery({ query: firstQuery })
        expect(rows(client)?.[0]?.value).toBe(`first`)

        const view = resolveLiveQueryValue(candidateQuery, {
          pool: pooledLiveQueries,
        })
        expect(view).not.toBeNull()
        expect(view?.config, `the receiving view is pooled`).toBeUndefined()
        observer = createLiveQueryObserver(view, { client, queryHash })
        if (sourceRelation === `different`) {
          let preload: Promise<void> | undefined
          expect(() => {
            preload = observer!.preload()
          }).not.toThrow()
          await expect(preload).rejects.toThrow(/different source Collections/)
        } else {
          await expect(observer.preload()).resolves.toBeUndefined()
          expect(
            (observer.getSnapshot().data as Array<Row>).map((row) => row.value),
          ).toEqual([`first`])
        }
        expect(rows(client)?.[0]?.value).toBe(`first`)
      } finally {
        observer?.dispose()
        await client.cleanup()
        await first.cleanup()
        await second.cleanup()
      }
    },
  )

  it(`a graph observer rejects a conflicting stream source through its preload Promise`, async () => {
    const id = `preload-source-identity-graph-observer`
    const first = createCollection(sourceConfig(id, `first`))
    const second = createCollection(sourceConfig(id, `second`))
    const queryFor = (source: typeof first) =>
      new Query()
        .from({ item: source })
        .select(({ item }) => ({ id: item.id, value: item.value }))
    const firstQuery = queryFor(first)
    const secondQuery = queryFor(second)
    const client = new DbClient()
    let observer: ReturnType<typeof createLiveQueryObserver> | undefined
    let view: ReturnType<typeof resolveLiveQueryValue> | undefined

    try {
      await client.preloadLiveQuery({ query: firstQuery })
      const queryHash = getLiveQueryHash({ query: firstQuery })
      expect(getLiveQueryHash({ query: secondQuery })).toBe(queryHash)
      view = resolveLiveQueryValue(secondQuery, { pool: pooledLiveQueries })
      expect(view).not.toBeNull()
      observer = createLiveQueryObserver(view, { client, queryHash })
      let preload: Promise<void> | undefined
      expect(() => {
        preload = observer!.preload()
      }).not.toThrow()
      await expect(preload).rejects.toThrow(/different source Collections/)
      expect(rows(client)).toEqual([{ id: `one`, value: `first` }])
    } finally {
      observer?.dispose()
      await view?.cleanup()
      await client.cleanup()
      await first.cleanup()
      await second.cleanup()
    }
  })

  /**
   * A synchronous source collision can occur after an adapter hook starts a
   * second preload but before that preload registers its stream. The discarded
   * promise may later reject. This controlled registration cut checks that
   * no rejection escapes unhandled after the source conflict is reported.
   */
  it(`observes a discarded stream promise after a reentrant source conflict`, async () => {
    const id = `reentrant-preload-source-conflict`
    const first = createCollection(sourceConfig(id, `first`))
    const second = createCollection(sourceConfig(id, `second`))
    const query = new Query()
      .from({ item: first })
      .select(({ item }) => ({ id: item.id, value: item.value }))
    const client = new DbClient()
    client._setSsrStreamingEnabled(true)
    const unhandled: Array<unknown> = []
    let rejectLater!: (reason: Error) => void
    const abandoned = new Promise<DehydratedLiveQueryResult>((_, reject) => {
      rejectLater = reject
    })
    const onUnhandled = (reason: unknown, promise: Promise<unknown>) => {
      if (promise === abandoned) unhandled.push(reason)
    }

    try {
      await client.preloadLiveQuery({ query })
      const hash = getLiveQueryHash({ query })
      process.on(`unhandledRejection`, onUnhandled)
      expect(() =>
        client._registerLiveQuery(hash, abandoned, [second]),
      ).toThrow(/different source Collections/)
      rejectLater(new Error(`discarded stream`))
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(unhandled).toEqual([])
      expect(rows(client)).toEqual([{ id: `one`, value: `first` }])
    } finally {
      process.off(`unhandledRejection`, onUnhandled)
      void abandoned.catch(() => {})
      await client.cleanup()
      await first.cleanup()
      await second.cleanup()
    }
  })
})

// The same source-identity judgment applies to a captured loading view. That
// view is not a completed preload, but its declared source claim still belongs
// to the result. A conflicting preload must reject before starting its adapter.
it(`keeps a loading server view's source claim before preload startup`, async () => {
  const client = new DbClient()
  const first = createCollection<Row>({
    id: `provisional-identity`,
    getKey: (row) => row.id,
    sync: { sync: () => {} },
  })
  let starts = 0
  const other = createCollection<Row>({
    id: first.id,
    getKey: (row) => row.id,
    sync: {
      sync: ({ markReady }) => {
        starts++
        markReady()
      },
    },
  })
  const query = new Query().from({ row: first })
  const collection = resolveLiveQueryValue({ query })!
  const observer = createLiveQueryObserver(collection, {
    client,
    queryHash: getLiveQueryHash({ query }),
  })
  const browserWindow = globalThis.window
  vi.stubGlobal(`window`, undefined)
  try {
    expect(observer.getServerSnapshot().status).toBe(`loading`)
    expect(() =>
      client.preloadLiveQuery({ query: new Query().from({ row: other }) }),
    ).toThrow(/different source Collections/)
    expect(starts, `source contradiction fails before acquisition`).toBe(0)
  } finally {
    vi.stubGlobal(`window`, browserWindow)
    observer.dispose()
    await collection.cleanup()
    await client.cleanup()
    await first.cleanup()
    await other.cleanup()
  }
})
