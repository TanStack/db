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
 * other client and back. After an Effect switches providers, an old-source
 * write produces no update event, while a new-source write produces one. The
 * public observation at each settled cut is the
 * complete projected row bag and row key from each useLiveQuery hook. A separate
 * Effect history checks enter events from two clients with the same row key,
 * then switches one mounted Effect to the other client. The
 * colliding-key history rejects a row-ID-only cross-client cache that the
 * disjoint history could miss. This bounded driver does not prove every query
 * clause, on-demand load, or framework adapter. A separate Effect history
 * observes dehydration after the committed Effect has reported its first row.
 * A no-client history changes one mounted hook from a concrete query to a
 * descriptor query with the same semantic hash. It must reject the unbound
 * source before reusing the old live-query Collection. Both explicit identity
 * forms of the ordinary and Suspense hooks owe the same React error naming
 * DbProvider as the remedy; the core error remains framework neutral.
 * A server-streaming history begins with a pending concrete-source hook and
 * then preloads a descriptor with the same query hash over another source
 * object. The client must reject that local source substitution before the
 * stream's result can answer the second preload. This is one local hook-first
 * order. A separate hydration-first history receives a server result whose
 * Collection objects cannot cross the wire. The first committed browser hook
 * claims its local source objects while the browser source is still loading;
 * a later same-hash preload over another object must reject. The model expects
 * the server row before browser readiness and the browser row after handoff.
 * A hostile observer that omits the committed claim fails at the conflicting
 * preload assertion while the source remains unready.
 * A Suspense read is itself a preload, even if React abandons its render. With
 * a pending hydrated stream, that first local preload starts the source and
 * claims its object identity before commit. A later same-source preload is
 * accepted and a different same-hash source is rejected at that cut. This
 * demand is distinct from an ordinary hook's commit-owned subscription.
 * A finite two-source grammar places the same standalone parent and child
 * descriptors in a join, nested FROM, union, or include. Two clients supply
 * different values under equal row keys. A plain per-client value model
 * predicts the complete selected rows after initial publication, a first-
 * client child write, and a second-client parent write. This detects binding
 * either source to the wrong provider; it does not observe on-demand requests
 * or arbitrary interleavings of source writes.
 * A receiving include repeats those checkpoints with a child alias that
 * shadows the parent alias and a renamed control. The child's projection
 * includes the captured parent value, so alias-only lookup changes an
 * observable field even when the correlation still admits the child. Its
 * stable identity must also survive descriptor binding: changing source
 * binding IDs while retaining captured references changes the public hash.
 * A second receiving history combines descriptor binding with RIGHT/FULL
 * outer joins, both correlation sides, shadowed and renamed aliases, and
 * eager/on-demand source modes. Plain per-client maps predict joined rows,
 * including an undefined missing side. Both clients use equal row IDs but
 * distinct values. The public check runs after initial acquisition and each
 * authored source write; source starts and on-demand requests are observed
 * after acquisition. The finite grammar does not cover every join chain or
 * arbitrary write order.
 *
 * A prepared query is a bound snapshot, not a lasting render resolver. Adding
 * a descriptor source later changes the plan without starting a sync run. The
 * next client-aware consumer binds that source. The independent start model is
 * zero for an unconsumed continuation or a render that never commits, and one
 * for the source after a committed hook consumes it. A fixed history prepares
 * a base query, releases its render deferral, then extends and mounts it. A
 * neighboring Suspense history extends a query during a render that is never
 * committed. The sync callback count and public rows are checked at those
 * cuts. Another suspended render leaves a source shared with a later direct
 * reader. That reader's preload is an independent demand for data: it may
 * start the source even though the earlier render never committed. These
 * histories do not cover arbitrary concurrent render schedules.
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
import { declareOracle } from '../../db/tests/oracle-declaration'
import type { Row } from './descriptor-query-binding-support.tsx'
import type { ReactNode } from 'react'

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

// The model reducer for one write: the row keyed by `next.id` takes its value.
function applyModelWrite(model: Map<string, Row>, next: Row): void {
  model.set(next.id, { ...next })
}

declareOracle({ model: [expectedRows, applyModelWrite] })

describe(`standalone descriptor query binding`, () => {
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
        applyModelWrite(model, next)
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
