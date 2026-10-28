/** Receiving driver for lazy-paging-model-oracle.ts. Real server cursors,
 * both SDK caches, fixed rank-index order, live repair and TCP loss/reconnect
 * supply the premises. The value reference is the separate unpaginated query;
 * work compares only observed responses during stable-source acquisitions.
 * Synthetic ties, held receipts and host replay are not backend claims. */
import {
  BTreeIndex,
  createCollection,
  createLiveQueryCollection,
} from '@tanstack/db'
import { ConvexClient } from 'convex/browser'
import { ConvexReactClient } from 'convex/react'
import { makeFunctionReference } from 'convex/server'
import { expect, inject, it } from 'vitest'
import { convexPaginatedCollectionOptions } from '../src/index'
import {
  assertLazyCoverage,
  deliveredScopeComplete,
  expectedLazyRows,
} from '../tests/lazy-paging-model-oracle'
import { withTestCleanup } from '../tests/helpers'
import { createNetworkGate } from './network-gate'
import type { LazyRow, LazyScope } from '../tests/lazy-paging-model-oracle'
import type { ConvexCollectionClient } from '../src/index'
import type { PaginationOptions, PaginationResult } from 'convex/server'

type Task = { _id: string; clientId: string; rank: number; text: string }
const seed = makeFunctionReference<`mutation`, { count: number }, null>(
  `tasks:seed`,
)
const write = makeFunctionReference<
  `mutation`,
  {
    idempotencyKey: string
    clientId: string
    rank: number
    text: string
    remove?: boolean
  },
  null
>(`tasks:write`)
const all = makeFunctionReference<`query`, {}, Array<Task>>(`tasks:all`)
const modelRows = (rows: ReadonlyArray<Task>): Array<LazyRow> =>
  rows.map(({ clientId, rank, text }) => ({ id: clientId, rank, text }))

it.each([`javascript`, `react`] as const)(
  `receives lazy scopes, repair and reconnect with the %s SDK`,
  async (kind) => {
    const gate = await createNetworkGate(inject(`convexUrl`))
    const writer = new ConvexClient(inject(`convexUrl`), {
      unsavedChangesWarning: false,
    })
    const client =
      kind === `javascript`
        ? new ConvexClient(gate.url, { unsavedChangesWarning: false })
        : new ConvexReactClient(gate.url, { unsavedChangesWarning: false })
    const delivered = new Map<string, LazyRow>()
    let exhausted = false
    let checkWork = true
    let scope: LazyScope = { limit: 3 }
    let required = 0
    let recommended = 0
    const started = new Set<string>()
    let successorStarts = 0
    const inspect = (
      value: PaginationResult<Task>,
      opts: PaginationOptions,
    ) => {
      if (value.pageStatus === `SplitRequired`) required++
      else {
        for (const row of modelRows(value.page)) delivered.set(row.id, row)
      }
      if (value.pageStatus === `SplitRecommended`) recommended++
      if (opts.endCursor == null && value.isDone) exhausted = true
    }
    const start = (args: { paginationOpts: PaginationOptions }) => {
      const opts = args.paginationOpts
      const key = JSON.stringify(opts)
      if (
        checkWork &&
        opts.cursor !== null &&
        opts.endCursor == null &&
        !started.has(key)
      ) {
        expect(
          deliveredScopeComplete([...delivered.values()], exhausted, scope),
          `native lazy work: unrelated successor`,
        ).toBe(false)
        successorStarts++
      }
      started.add(key)
    }
    // These wrappers record request tuples and responses without producing rows,
    // changing cancellation, or decoding the server's opaque cursor strings.
    const transport: ConvexCollectionClient =
      `onUpdate` in client
        ? {
            onUpdate: (query, args, callback, onError) => {
              start(args as { paginationOpts: PaginationOptions })
              const subscription = client.onUpdate(
                query,
                args,
                (value) => {
                  inspect(
                    value as PaginationResult<Task>,
                    (args as { paginationOpts: PaginationOptions })
                      .paginationOpts,
                  )
                  callback(value)
                },
                onError,
              )
              return Object.assign(() => subscription(), {
                unsubscribe: () => subscription(),
                getCurrentValue: () => {
                  const value = subscription.getCurrentValue()
                  if (value !== undefined)
                    inspect(
                      value as PaginationResult<Task>,
                      (args as { paginationOpts: PaginationOptions })
                        .paginationOpts,
                    )
                  return value
                },
              })
            },
          }
        : {
            watchQuery: (query, args, options) => {
              start(args as { paginationOpts: PaginationOptions })
              const watch = client.watchQuery(query, args, options)
              return {
                ...watch,
                localQueryResult: () => {
                  const value = watch.localQueryResult()
                  if (value !== undefined)
                    inspect(
                      value as PaginationResult<Task>,
                      (args as { paginationOpts: PaginationOptions })
                        .paginationOpts,
                    )
                  return value
                },
              }
            },
          }
    const source = createCollection(
      convexPaginatedCollectionOptions({
        client: transport,
        query: makeFunctionReference<
          `query`,
          { paginationOpts: PaginationOptions },
          PaginationResult<Task>
        >(`tasks:split`),
        queryArgs: {},
        syncMode: `on-demand`,
        queryOrder: { field: `rank`, direction: `asc` },
        pageSize: 4,
        getKey: (row) => row.clientId,
        autoIndex: `eager`,
        defaultIndexType: BTreeIndex,
        gcTime: 0,
      }),
    )
    const live = createLiveQueryCollection((q) =>
      q
        .from({ row: source })
        .orderBy(({ row }) => row.rank)
        .orderBy(({ row }) => row.clientId)
        .select(({ row }) => row)
        .limit(3),
    )
    await withTestCleanup(
      async () => {
        await writer.mutation(seed, { count: 23 })
        source.startSyncImmediate()
        expect(started.size).toBe(0)
        await live.preload()
        let truth = modelRows(await writer.query(all, {}))
        expect(modelRows(live.toArray)).toEqual(expectedLazyRows(truth, scope))
        assertLazyCoverage(modelRows([...source.values()]), truth, scope)
        expect(source.size).toBeLessThan(truth.length)
        scope = { offset: 2, limit: 7 }
        await live.utils.setWindow(scope)
        expect(modelRows(live.toArray)).toEqual(expectedLazyRows(truth, scope))
        assertLazyCoverage(modelRows([...source.values()]), truth, scope)
        expect(source.size).toBeLessThan(truth.length)
        expect(successorStarts).toBeGreaterThan(0)
        // Work comparison is declared only for stable acquisitions. These named
        // mutation/reconnect scenes compare source coverage and actual live values.
        checkWork = false
        const check = async () => {
          truth = modelRows(await writer.query(all, {}))
          await source.utils.awaitSync()
          await expect
            .poll(() => modelRows(live.toArray), { timeout: 10000 })
            .toEqual(expectedLazyRows(truth, scope))
          assertLazyCoverage(modelRows([...source.values()]), truth, scope)
        }
        await writer.mutation(write, {
          idempotencyKey: crypto.randomUUID(),
          clientId: `2`,
          rank: 2,
          text: `deleted`,
          remove: true,
        })
        await check()
        await writer.mutation(write, {
          idempotencyKey: crypto.randomUUID(),
          clientId: `20`,
          rank: -10,
          text: `moved into unread prefix`,
        })
        await check()
        // A bounded interval that formerly contained a few rows now contains many.
        // The real read budget forces SplitRequired, distinct from a hint.
        for (let i = 0; i < 14; i++)
          await writer.mutation(write, {
            idempotencyKey: crypto.randomUUID(),
            clientId: `dense${i}`,
            rank: 0.01 + i / 100,
            text: `dense`,
          })
        await check()
        expect(
          required,
          `native SplitRequired receiving premise`,
        ).toBeGreaterThan(0)
        // The leading boundary now crosses a native four-row rank tie. The
        // trailing clientId order belongs to DB, independent of Convex's tie order.
        for (const clientId of [`10`, `11`, `12`]) {
          await writer.mutation(write, {
            idempotencyKey: crypto.randomUUID(),
            clientId,
            rank: 0.05,
            text: `native tie`,
          })
        }
        await check()
        const nativeTieRows = truth.filter((row) => row.rank === 0.05).length
        expect(nativeTieRows).toBe(4)
        expect(
          [...source.values()].filter((row) => row.rank === 0.05),
        ).toHaveLength(nativeTieRows)
        const beforeRun = source.status
        gate.disconnect()
        await writer.mutation(write, {
          idempotencyKey: crypto.randomUUID(),
          clientId: `22`,
          rank: -20,
          text: `offline arrival`,
        })
        gate.reconnect()
        await check()
        expect(source.status).toBe(beforeRun)
        console.info(
          `CONVEX_LAZY_BACKEND ${JSON.stringify({ kind, successorStarts, required, recommended, nativeTieRows, requestTuples: started.size, scope })}`,
        )
      },
      () => live.cleanup(),
      () => source.cleanup(),
      () => client.close(),
      () => writer.close(),
      () => gate.close(),
    )
  },
  60000,
)
