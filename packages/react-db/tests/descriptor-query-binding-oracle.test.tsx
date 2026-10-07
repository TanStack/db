/**
 * A Query assembled with a Collection descriptor is a reusable query plan.
 * Its source Collection belongs to the DbClient that later consumes it, so
 * construction outside DbProvider succeeds and two providers can consume the
 * same plan without sharing rows. This follows the standalone Query contract
 * and the SSR guide's factory-descriptor promise. Concrete-config descriptors
 * are intentionally outside the two-client law.
 *
 * Model: each client owns a plain map of rows. An insert into one map changes
 * only that client's expected result. The model never calls the query builder,
 * materializer, or live-query engine to calculate expected rows.
 *
 * Legal history: build once, mount under two clients, insert into the first,
 * insert into the second, then switch one mounted hook to the other client
 * and back. The public observation at each settled cut is
 * the complete projected row bag from each useLiveQuery hook. The independent
 * rows distinguish binding at construction or caching only by query hash from
 * binding at consumption. This bounded driver does not prove every query
 * clause, on-demand load, or framework adapter.
 */
import { act, renderHook, waitFor } from '@testing-library/react'
import {
  DbClient,
  Query,
  collectionOptions,
  getStableQueryBuilderHash,
} from '@tanstack/db'
import { describe, expect, it } from 'vitest'
import { DbProvider } from '../src/DbProvider'
import { useLiveQuery } from '../src/useLiveQuery'
import { mockSyncCollectionOptions } from '../../db/tests/utils'
import type { ReactNode } from 'react'

type Row = { id: string; value: string }

function expectedRows(rows: ReadonlyMap<string, Row>): Array<Row> {
  return [...rows.values()].sort((left, right) =>
    left.id.localeCompare(right.id),
  )
}

describe(`standalone descriptor query binding`, () => {
  it(`binds one prebuilt Query to each receiving DbClient`, async () => {
    const descriptor = collectionOptions(
      `standalone-descriptor-rows`,
      (client) =>
        mockSyncCollectionOptions<Row>({
          id: `standalone-descriptor-rows`,
          getKey: (row) => row.id,
          initialData: client.requireDependency<Array<Row>>(`rows`),
        }),
    )
    // Definition happens outside React and before either DbClient exists.
    const query = new Query()
      .from({ item: descriptor })
      .select(({ item }) => ({ id: item.id, value: item.value }))
    const firstModel = new Map<string, Row>([
      [`a`, { id: `a`, value: `first` }],
    ])
    const secondModel = new Map<string, Row>([
      [`b`, { id: `b`, value: `second` }],
    ])
    const firstClient = new DbClient({ rows: expectedRows(firstModel) })
    const secondClient = new DbClient({ rows: expectedRows(secondModel) })
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
    const check = async () => {
      await waitFor(() => {
        for (const [observed, model] of [
          [first.result.current.data, firstModel],
          [second.result.current.data, secondModel],
        ] as const) {
          expect(
            observed
              .map(({ id, value }) => ({ id, value }))
              .sort((left, right) => left.id.localeCompare(right.id)),
          ).toEqual(expectedRows(model))
          for (const row of observed) {
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

    const addedToFirst = { id: `c`, value: `first write` }
    firstModel.set(addedToFirst.id, addedToFirst)
    act(() => firstClient.collection(descriptor).insert(addedToFirst))
    await check()

    const addedToSecond = { id: `d`, value: `second write` }
    secondModel.set(addedToSecond.id, addedToSecond)
    act(() => secondClient.collection(descriptor).insert(addedToSecond))
    await check()

    firstReceivingClient = secondClient
    first.rerender()
    await waitFor(() =>
      expect(
        first.result.current.data
          .map(({ id, value }) => ({ id, value }))
          .sort((left, right) => left.id.localeCompare(right.id)),
      ).toEqual(expectedRows(secondModel)),
    )
    firstReceivingClient = firstClient
    first.rerender()
    await check()

    first.unmount()
    second.unmount()
  })
})
