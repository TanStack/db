/**
 * A Query assembled with a Collection descriptor is a reusable query plan.
 * Its source Collection belongs to the DbClient that later consumes it, so
 * construction outside DbProvider succeeds and two providers can consume the
 * same plan without sharing rows. This follows the standalone Query contract
 * and the SSR guide's factory-descriptor promise. Concrete-config descriptors
 * are intentionally outside the two-client law. A committed Effect that first
 * acquires a descriptor Collection also makes that source eligible for the
 * DbClient's public dehydration snapshot.
 *
 * Model: each client owns a plain map of rows. A write to one map changes
 * only that client's expected result. An Effect reports that client's row on
 * entry, including after a mounted provider switch. The model never calls the
 * query builder, materializer, or live-query engine to calculate expected rows.
 *
 * Legal histories: one has disjoint row keys across clients; the other has the
 * same key with different values in both clients. Build once, mount under two
 * clients, write independently to each, then switch one mounted hook to the
 * other client and back. The public observation at each settled cut is the
 * complete projected row bag and row key from each useLiveQuery hook. A separate
 * Effect history checks enter events from two clients with the same row key,
 * then switches one mounted Effect to the other client. The
 * colliding-key history rejects a row-ID-only cross-client cache that the
 * disjoint history could miss. This bounded driver does not prove every query
 * clause, on-demand load, or framework adapter. A separate Effect history
 * observes dehydration after the committed Effect has reported its first row.
 * A no-client history changes one mounted hook from a concrete query to a
 * descriptor query with the same semantic hash. It must reject the unbound
 * source before reusing the old live-query Collection.
 */
import { act, renderHook, waitFor } from '@testing-library/react'
import {
  DbClient,
  Query,
  collectionOptions,
  createCollection,
  getStableQueryBuilderHash,
} from '@tanstack/db'
import { describe, expect, it } from 'vitest'
import { DbProvider } from '../src/DbProvider'
import { useLiveQuery } from '../src/useLiveQuery'
import { useLiveQueryEffect } from '../src/useLiveQueryEffect'
import { mockSyncCollectionOptions } from '../../db/tests/utils'
import type { ReactNode } from 'react'

type Row = { id: string; value: string }

const histories = [
  {
    name: `disjoint keys`,
    initial: {
      first: { id: `a`, value: `first` },
      second: { id: `b`, value: `second` },
    },
    writes: {
      first: { id: `c`, value: `first write` },
      second: { id: `d`, value: `second write` },
    },
  },
  {
    name: `colliding keys`,
    initial: {
      first: { id: `shared`, value: `first` },
      second: { id: `shared`, value: `second` },
    },
    writes: {
      first: { id: `shared`, value: `first write` },
      second: { id: `shared`, value: `second write` },
    },
  },
] satisfies ReadonlyArray<{
  name: string
  initial: { first: Row; second: Row }
  writes: { first: Row; second: Row }
}>

function expectedRows(rows: ReadonlyMap<string, Row>): Array<Row> {
  return [...rows.values()].sort((left, right) =>
    left.id.localeCompare(right.id),
  )
}

describe(`standalone descriptor query binding`, () => {
  it(`rejects an unbound descriptor after a same-hash concrete query`, async () => {
    const id = `standalone-descriptor-unbound-transition`
    const concrete = createCollection(
      mockSyncCollectionOptions<Row>({
        id,
        getKey: (row) => row.id,
        initialData: [{ id: `one`, value: `concrete` }],
      }),
    )
    const descriptor = collectionOptions(id, () =>
      mockSyncCollectionOptions<Row>({
        id,
        getKey: (row) => row.id,
        initialData: [{ id: `one`, value: `descriptor` }],
      }),
    )
    const concreteQuery = new Query()
      .from({ item: concrete })
      .select(({ item }) => ({ id: item.id, value: item.value }))
    const unboundQuery = new Query()
      .from({ item: descriptor })
      .select(({ item }) => ({ id: item.id, value: item.value }))
    expect(getStableQueryBuilderHash(unboundQuery)).toBe(
      getStableQueryBuilderHash(concreteQuery),
    )

    let query = concreteQuery
    const mounted = renderHook(() => useLiveQuery({ query }))
    await waitFor(() => {
      expect(mounted.result.current.data[0]?.value).toBe(`concrete`)
    })

    // The public error is the observation at the attempted consumption cut.
    // Returning the previous row would conceal the missing DbClient.
    query = unboundQuery
    expect(() => mounted.rerender()).toThrow(/requires a DbClient/)
    mounted.unmount()
  })

  it(`dehydrates a descriptor source first consumed by a committed Effect`, async () => {
    const id = `standalone-descriptor-effect-dehydration`
    const expected = { id: `one`, value: `first` }
    const descriptor = collectionOptions(id, (client) =>
      mockSyncCollectionOptions<Row>({
        id,
        getKey: (row) => row.id,
        initialData: client.requireDependency<Array<Row>>(`rows`),
      }),
    )
    const query = new Query()
      .from({ item: descriptor })
      .select(({ item }) => ({ id: item.id, value: item.value }))
    const client = new DbClient({ rows: [{ ...expected }] })
    const observed: Array<Row> = []

    const mounted = renderHook(
      () =>
        useLiveQueryEffect<Row, string>({
          query,
          onEnter: ({ value }) => {
            observed.push({ id: value.id, value: value.value })
          },
        }),
      {
        wrapper: ({ children }: { children: ReactNode }) => (
          <DbProvider client={client}>{children}</DbProvider>
        ),
      },
    )

    // The plain expected row is independent of the Effect and dehydration code.
    // Compare at the settled enter cut, then at the public dehydrate() call.
    await waitFor(() => expect(observed).toEqual([expected]))
    const chunk = client
      .dehydrate()
      .collections.find((collection) => collection.collectionId === id)
    expect(chunk?.rows.map(({ key, value }) => ({ key, value }))).toEqual([
      { key: expected.id, value: expected },
    ])
    mounted.unmount()
  })

  it(`binds an Effect's prebuilt query to its receiving provider`, async () => {
    const descriptor = collectionOptions(
      `standalone-descriptor-effect-rows`,
      (client) =>
        mockSyncCollectionOptions<Row>({
          id: `standalone-descriptor-effect-rows`,
          getKey: (row) => row.id,
          initialData: client.requireDependency<Array<Row>>(`rows`),
        }),
    )
    const query = new Query()
      .from({ item: descriptor })
      .select(({ item }) => ({ id: item.id, value: item.value }))
    const expected = [
      { id: `shared`, value: `first` },
      { id: `shared`, value: `second` },
    ]
    const observed: Array<Array<Row>> = [[], []]
    const clients = expected.map((row) => new DbClient({ rows: [{ ...row }] }))
    const mounted = expected.map((_, index) => {
      return renderHook(
        () =>
          useLiveQueryEffect<Row, string>({
            query,
            onEnter: ({ value }) => {
              observed[index]!.push({ id: value.id, value: value.value })
            },
          }),
        {
          wrapper: ({ children }: { children: ReactNode }) => (
            <DbProvider client={clients[index]!}>{children}</DbProvider>
          ),
        },
      )
    })

    // At initial publication, each Effect must report its own client's row.
    await waitFor(() => {
      expect(observed).toEqual(expected.map((row) => [row]))
    })

    clients[0] = clients[1]!
    mounted[0]!.rerender()
    await waitFor(() => {
      expect(observed[0]).toEqual([expected[0], expected[1]])
    })

    mounted.forEach((hook) => hook.unmount())
  })

  it.each(histories)(
    `binds one prebuilt Query to each receiving DbClient with $name`,
    async ({ name, initial, writes }) => {
      const descriptor = collectionOptions(
        `standalone-descriptor-rows-${name}`,
        (client) =>
          mockSyncCollectionOptions<Row>({
            id: `standalone-descriptor-rows-${name}`,
            getKey: (row) => row.id,
            initialData: client.requireDependency<Array<Row>>(`rows`),
          }),
      )
      // Definition happens outside React and before either DbClient exists.
      const query = new Query()
        .from({ item: descriptor })
        .select(({ item }) => ({ id: item.id, value: item.value }))
      const firstModel = new Map<string, Row>([
        [initial.first.id, initial.first],
      ])
      const secondModel = new Map<string, Row>([
        [initial.second.id, initial.second],
      ])
      const seedRows = (model: ReadonlyMap<string, Row>) =>
        expectedRows(model).map((row) => ({ ...row }))
      const firstClient = new DbClient({ rows: seedRows(firstModel) })
      const secondClient = new DbClient({ rows: seedRows(secondModel) })
      const planIdentity = getStableQueryBuilderHash(query)
      const boundShape = (client: DbClient) =>
        new Query()
          .from({ item: client.collection(descriptor) })
          .select(({ item }) => ({ id: item.id, value: item.value }))
      expect(planIdentity).toBe(
        getStableQueryBuilderHash(boundShape(firstClient)),
      )
      expect(planIdentity).toBe(
        getStableQueryBuilderHash(boundShape(secondClient)),
      )
      let firstReceivingClient = firstClient
      const first = renderHook(() => useLiveQuery({ query }), {
        wrapper: ({ children }: { children: ReactNode }) => (
          <DbProvider client={firstReceivingClient}>{children}</DbProvider>
        ),
      })
      const second = renderHook(() => useLiveQuery({ query }), {
        wrapper: ({ children }: { children: ReactNode }) => (
          <DbProvider client={secondClient}>{children}</DbProvider>
        ),
      })

      // Compare after each publication. The same descriptor ID and query shape
      // must not make either provider observe the other provider's Collection.
      const check = async (
        firstScopeModel: ReadonlyMap<string, Row> = firstModel,
      ) => {
        await waitFor(() => {
          for (const [observed, model] of [
            [first.result.current.data, firstScopeModel],
            [second.result.current.data, secondModel],
          ] as const) {
            expect(
              observed
                .map(({ id, value }) => ({ id, value }))
                .sort((left, right) => left.id.localeCompare(right.id)),
            ).toEqual(expectedRows(model))
            for (const row of observed) {
              expect(row.$key).toBe(row.id)
              expect(Object.keys(row).sort()).toEqual(
                [
                  `$collectionId`,
                  `$hasPendingWrites`,
                  `$key`,
                  `$origin`,
                  `$synced`,
                  `id`,
                  `value`,
                ].sort(),
              )
            }
          }
        })
      }
      await check()
      expect(firstClient.collection(descriptor)).not.toBe(
        secondClient.collection(descriptor),
      )

      const write = (client: DbClient, model: Map<string, Row>, next: Row) => {
        act(() => {
          const collection = client.collection(descriptor)
          if (model.has(next.id)) {
            collection.update(next.id, (draft) => {
              draft.value = next.value
            })
          } else {
            collection.insert({ ...next })
          }
        })
        model.set(next.id, { ...next })
      }

      write(firstClient, firstModel, writes.first)
      await check()

      write(secondClient, secondModel, writes.second)
      await check()

      firstReceivingClient = secondClient
      first.rerender()
      await check(secondModel)
      firstReceivingClient = firstClient
      first.rerender()
      await check()

      first.unmount()
      second.unmount()
    },
  )
})
