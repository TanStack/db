/**
 * # A DbClient preload cannot substitute another source Collection
 *
 * A query hash names a reusable result only while its source Collection
 * objects remain the same at each source position in one DbClient. A descriptor query and its concrete
 * form intentionally have the same hash when they name the same source object.
 * If a second plan with that hash names a different source object, including
 * one with the same Collection ID, preload rejects the ambiguous request.
 * Returning the first plan's rows would report data from the wrong source.
 *
 * Model: two plain source rows have distinct values. The first successful
 * preload owns the hash. Repeating it with the same source yields that row;
 * asking for the other source rejects and leaves the first result intact.
 * Swapping two same-ID source objects between query positions also rejects:
 * a set of source objects cannot tell which row belongs to each position.
 * This model uses source-object identity, not the query cache implementation.
 *
 * The finite history crosses concrete then descriptor, descriptor then
 * concrete, and two concrete source objects, plus a same-object control.
 * Each query is built through the public Query API, and every successful
 * preload is observed through public DbClient.dehydrate(). The comparison
 * runs after the first preload and after the second attempted preload. This
 * does not define how a hydrated stream from another process matches a local
 * source, or how different explicit query keys share one hash.
 */
import { describe, expect, it } from 'vitest'
import {
  DbClient,
  Query,
  collectionOptions,
  createCollection,
  getStableQueryBuilderHash,
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
})
