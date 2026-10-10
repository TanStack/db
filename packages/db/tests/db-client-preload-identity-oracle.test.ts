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
 * preload owns the hash. Repeating it with the same source yields that row;
 * asking for the other source rejects and leaves the first result intact.
 * Swapping two same-ID source objects between query positions also rejects:
 * a set of source objects cannot tell which row belongs to each position.
 * A pooled view has one source even though it has no query Collection config.
 * Its observer may reuse an existing stream only for that same source, and its
 * preload must finish the view's own source demand.
 * This model uses source-object identity, not the query cache implementation.
 *
 * The finite history crosses concrete then descriptor, descriptor then
 * concrete, and two concrete source objects, plus a same-object control. The
 * pooled observer path crosses same and different local source objects.
 * Each query is built through the public Query API, and every successful
 * preload is observed through public DbClient.dehydrate(). The comparison
 * runs after the first preload and after the second attempted preload. The
 * pooled path also checks its observer snapshot after same-source reuse. This
 * does not define how a hydrated stream from another process matches a local
 * source, or how different explicit query keys share one hash. A separate
 * hydration-first history below gives the first local consumer authority to
 * claim a hydrated hash's runtime source objects. The stream's portable hash
 * cannot carry server-side object identity; a later local consumer must use
 * the claimed objects. This is checked while the hydrated stream is settled
 * and while its result promise is pending.
 */
import { describe, expect, it } from 'vitest'
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
        await browser.cleanup()
        await server.cleanup()
        await serverSource.cleanup()
        await firstLocal.cleanup()
        await otherLocal.cleanup()
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

        const view = resolveLiveQueryValue(candidateQuery)
        expect(view).not.toBeNull()
        expect(view?.config, `the receiving view is pooled`).toBeUndefined()
        observer = createLiveQueryObserver(view, { client, queryHash })
        if (sourceRelation === `different`) {
          await expect(
            Promise.resolve().then(() => observer!.preload()),
          ).rejects.toThrow(/different source Collections/)
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
})
