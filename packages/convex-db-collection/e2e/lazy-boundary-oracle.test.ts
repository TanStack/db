/**
 * A partial source may retain delivered rows without representing the complete
 * server relation. Its promised ordered window must still be one coherent
 * authored window, monotonically advancing through offered revisions. Cleanup
 * can abandon accepted receipts, but caller abort/provider errors cannot. Old
 * dependent graphs remain terminal; recovery requires a fresh graph.
 * Authority: LoadSubsetFn/SyncAppliedReceipt/CleanupFn in db/src/types.ts and
 * live/ARCHITECTURE.md laws 7, 9, 14. The scientific judgments are reused from
 * lazy-paging-model-oracle, LazyVersionModel and LazyReceiptModel.
 *
 * Real SDK caches, opaque cursors, atomic backend edits, actual query errors,
 * optimistic holds, and cleanup supply the receiving premises. Expected rows
 * are authored before mutations. The independent all query verifies the server
 * fixture; provider-result recording proves provenance without defining truth.
 * Every graph change/status event reaches the monitors; checkpoints retain
 * semantic failures instead of throwing through production subscribers.
 *
 * Grammar varies unread source size, page/window sizes, text, the canceled
 * caller, and two or three revisions while application is held. Every history
 * receives both SDKs. Limits: ascending unique numeric ranks, isolated atomic
 * server edits, finitely drained schedules; no arbitrary reentry, idempotent
 * receipt attribution, authoritative truncate replay or React render claim.
 */
import {
  BTreeIndex,
  createCollection,
  createLiveQueryCollection,
  createTransaction,
} from '@tanstack/db'
import { ConvexClient } from 'convex/browser'
import { ConvexReactClient } from 'convex/react'
import { makeFunctionReference } from 'convex/server'
import fc from 'fast-check'
import { expect, inject, it } from 'vitest'
import { convexPaginatedCollectionOptions } from '../src/index'
import { runOracleCampaign } from '../../db/tests/oracle-campaign'
import { withTestCleanup } from '../tests/helpers'
import { lazyRequest } from '../tests/lazy-paging-driver'
import { lazyOracleRuns, receiveBothSdks } from '../tests/lazy-paging-campaign'
import {
  LazyTerminalGraphModel,
  assertLazyCoverage,
  assertLazySourceFacts,
  copyLazyRows,
  expectedLazyRows,
} from '../tests/lazy-paging-model-oracle'
import { LazyReceiptModel } from '../tests/lazy-paging-receipt-model'
import { LazyVersionModel } from '../tests/lazy-paging-version-model-oracle'
import type { LazyRow, LazyScope } from '../tests/lazy-paging-model-oracle'
import type { ConvexCollectionClient } from '../src/index'
import type { LoadSubsetOptions } from '@tanstack/db'
import type { PaginationOptions, PaginationResult } from 'convex/server'

type Task = { _id: string; clientId: string; rank: number; text: string }
type Change = { clientId: string; rank: number; text: string; remove?: boolean }
const seed = makeFunctionReference<`mutation`, { count: number }, null>(
  `tasks:seed`,
)
const all = makeFunctionReference<`query`, {}, Array<Task>>(`tasks:all`)
const reshape = makeFunctionReference<
  `mutation`,
  { changes: Array<Change> },
  null
>(`tasks:reshape`)
const setFailure = makeFunctionReference<
  `mutation`,
  { enabled: boolean },
  null
>(`tasks:setQueryFailure`)
const query = makeFunctionReference<
  `query`,
  { paginationOpts: PaginationOptions },
  PaginationResult<Task>
>(`tasks:guardedList`)
const project = (row: Task): LazyRow => ({
  id: row.clientId,
  rank: row.rank,
  text: row.text,
})
const fact = (row: LazyRow) => JSON.stringify([row.id, row.rank, row.text])
const signature = (rows: ReadonlyArray<LazyRow>) =>
  JSON.stringify(copyLazyRows(rows))
const turns = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve()
}
const grammar = fc.record({
  size: fc.integer({ min: 18, max: 24 }),
  pageSize: fc.integer({ min: 2, max: 3 }),
  limit: fc.integer({ min: 2, max: 3 }),
  text: fc.string({ maxLength: 8 }),
  cancelFirst: fc.boolean(),
  revisions: fc.integer({ min: 1, max: 2 }),
})
type History = typeof grammar extends fc.Arbitrary<infer T> ? T : never

async function receive(h: History, kind: `javascript` | `react`) {
  const writer = new ConvexClient(inject(`convexUrl`), {
    unsavedChangesWarning: false,
  })
  const reader =
    kind === `javascript`
      ? new ConvexClient(inject(`convexUrl`), { unsavedChangesWarning: false })
      : new ConvexReactClient(inject(`convexUrl`), {
          unsavedChangesWarning: false,
        })
  const receipts = new LazyReceiptModel()
  const terminal = new LazyTerminalGraphModel()
  const failures: Array<unknown> = []
  const providerErrors: Array<unknown> = []
  const evidence = new Map<string, LazyRow>()
  const applied = new Set<string>()
  const attempts = new Map<string, { missing: Set<string>; outcome?: string }>()
  const batches: Array<{
    id: string
    facts: Array<string>
    owners: Array<string>
    held: boolean
    state: `pending` | `applied` | `abandoned`
  }> = []
  const requests: Array<LoadSubsetOptions> = []
  const reaches = new Set<string>()
  const inspect = (value: unknown) => {
    const result = value as PaginationResult<Task>
    if (result.pageStatus !== `SplitRequired`)
      for (const row of result.page) {
        const observed = project(row)
        evidence.set(fact(observed), observed)
      }
  }
  const transport: ConvexCollectionClient =
    `onUpdate` in reader
      ? {
          onUpdate: (fn, args, callback, onError) => {
            const subscription = reader.onUpdate(
              fn,
              args,
              (value) => {
                inspect(value)
                callback(value)
              },
              onError,
            )
            return Object.assign(() => subscription(), {
              unsubscribe: () => subscription(),
              getCurrentValue: () => {
                const value = subscription.getCurrentValue()
                if (value !== undefined) inspect(value)
                return value
              },
            })
          },
        }
      : {
          watchQuery: (fn, args, options) => {
            const watch = reader.watchQuery(fn, args, options)
            return {
              ...watch,
              localQueryResult: () => {
                const value = watch.localQueryResult()
                if (value !== undefined) inspect(value)
                return value
              },
            }
          },
        }
  const options = convexPaginatedCollectionOptions({
    client: transport,
    query,
    queryArgs: {},
    syncMode: `on-demand`,
    queryOrder: { field: `rank`, direction: `asc` },
    pageSize: h.pageSize,
    getKey: (row) => row.clientId,
    autoIndex: `eager`,
    defaultIndexType: BTreeIndex,
    gcTime: 0,
    onError: (error) => providerErrors.push(error),
  })
  let recordReceipts = true
  const sync = options.sync.sync
  options.sync = {
    ...options.sync,
    sync: (controls) => {
      let values: Array<LazyRow> = []
      return sync({
        ...controls,
        begin: (...args) => {
          values = []
          controls.begin(...args)
        },
        write: (message) => {
          if (message.type !== `delete`) values.push(project(message.value))
          controls.write(message)
        },
        commit: (signal) => {
          const supplied = values.map(fact)
          const owners = [...attempts].filter(
            ([, attempt]) =>
              attempt.outcome === undefined &&
              supplied.some((value) => attempt.missing.has(value)),
          )
          for (const [, attempt] of owners)
            for (const value of supplied) attempt.missing.delete(value)
          const actual = controls.commit(signal)
          if (!recordReceipts) return actual
          const batch = {
            id: `batch-${batches.length}`,
            facts: supplied,
            owners: owners.map(([id]) => id),
            held: actual !== true,
            state: `pending` as `pending` | `applied` | `abandoned`,
          }
          batches.push(batch)
          try {
            receipts.accept(batch.id, supplied, batch.owners)
          } catch (error) {
            failures.push(error)
          }
          const apply = () => {
            try {
              receipts.apply(batch.id)
              batch.state = `applied`
              for (const value of supplied) applied.add(value)
            } catch (error) {
              failures.push(error)
            }
          }
          if (actual === true) apply()
          else
            void actual.then(apply, (error: unknown) => {
              try {
                if (!(error instanceof Error) || error.name !== `AbortError`)
                  throw error
                receipts.abandon(batch.id)
                batch.state = `abandoned`
              } catch (failure) {
                failures.push(failure)
              }
            })
          return actual
        },
      })
    },
  }
  const source = createCollection(options)
  const dependent = (limit: number) =>
    createLiveQueryCollection((q) =>
      q
        .from({ row: source })
        .orderBy(({ row }) => row.rank)
        .orderBy(({ row }) => row.clientId)
        .select(({ row }) => row)
        .limit(limit),
    )
  const graph = dependent(h.limit)
  let fresh: ReturnType<typeof dependent> | undefined
  let versions: LazyVersionModel | undefined
  const callbackSnapshots: Array<string> = []
  const observeGraph = () => {
    try {
      const rows = graph.toArray.map(project)
      terminal.observe(graph.status, rows)
      versions?.observe(rows)
    } catch (error) {
      failures.push(error)
    }
  }
  let graphObserver: ReturnType<typeof graph.subscribeChanges> | undefined
  let stopStatus = () => {}
  const sourceObserver = source.subscribeChanges(
    () => {
      try {
        assertLazySourceFacts([...source.base.values()].map(project), [
          ...evidence.values(),
        ])
      } catch (error) {
        failures.push(error)
      }
    },
    { includeInitialState: false },
  )
  const checkpoint = () => {
    if (failures.length) throw failures[0]
  }
  const waitFor = async (predicate: () => boolean) => {
    await expect
      .poll(() => failures.length > 0 || predicate(), {
        timeout: 10000,
        interval: 10,
      })
      .toBe(true)
    await turns()
    checkpoint()
  }
  let release = () => {}
  let persisted: Promise<unknown> | undefined
  let holds = 0
  const hold = () => {
    const pending = new Promise<void>((resolve) => {
      release = resolve
    })
    const transaction = createTransaction({ mutationFn: () => pending })
    transaction.mutate(() =>
      source.insert({
        _id: `overlay-${holds}`,
        clientId: `overlay-${holds++}`,
        rank: 10000,
        text: `hold`,
      }),
    )
    persisted = transaction.isPersisted.promise
  }
  const drain = async () => {
    release()
    await persisted
    await turns()
    checkpoint()
  }
  let truth: Array<LazyRow> = Array.from({ length: h.size }, (_, rank) => ({
    id: String(rank),
    rank,
    text: `task ${rank}`,
  }))
  let scope: LazyScope = { limit: h.limit }
  const monitor = () => {
    versions = new LazyVersionModel(`sequence`)
    versions.offer(expectedLazyRows(truth, scope))
    versions.observe(graph.toArray.map(project))
  }
  const edit = async (changes: Array<Change>) => {
    // The independent ledger authors truth before touching the server.
    const next = truth.filter(
      (row) => !changes.some((change) => change.clientId === row.id),
    )
    next.push(
      ...changes
        .filter((change) => !change.remove)
        .map(({ clientId, rank, text }) => ({ id: clientId, rank, text })),
    )
    truth = next
    versions!.offer(expectedLazyRows(truth, scope))
    const before = batches.length
    await writer.mutation(reshape, { changes })
    const changed = new Set(
      changes
        .filter((change) => !change.remove)
        .map(({ clientId, rank, text }) => fact({ id: clientId, rank, text })),
    )
    await waitFor(() =>
      batches
        .slice(before)
        .some(
          (batch) =>
            batch.held && batch.facts.some((value) => changed.has(value)),
        ),
    )
    expect(
      source.base.size,
      `partial prefix accidentally exhausted source`,
    ).toBeLessThan(truth.length)
  }
  const reachLatest = async () => {
    const expected = signature(expectedLazyRows(truth, scope))
    await waitFor(() => signature(graph.toArray.map(project)) === expected)
    expect(
      callbackSnapshots,
      `latest window never reached actual change callback`,
    ).toContain(expected)
    assertLazyCoverage([...source.base.values()].map(project), truth, scope)
    checkpoint()
  }
  const acquire = (id: string, signal: AbortSignal) => {
    const required = truth.map(fact)
    receipts.acquire(id, required)
    const attempt = {
      missing: new Set(required.filter((value) => !applied.has(value))),
      outcome: undefined as string | undefined,
    }
    attempts.set(id, attempt)
    const request = { ...lazyRequest({}), signal }
    requests.push(request)
    const result = source._sync.loadSubset(request)
    const settle = (outcome: `success` | `canceled` | `rejected`) => {
      attempt.outcome = outcome
      try {
        receipts.observe(id, outcome)
      } catch (error) {
        failures.push(error)
      }
    }
    void Promise.resolve(result).then(
      () => settle(`success`),
      (error: unknown) =>
        settle(
          error instanceof Error && error.name === `AbortError`
            ? `canceled`
            : `rejected`,
        ),
    )
    return attempt
  }
  let cleaning: Promise<void> | undefined
  await withTestCleanup(
    async () => {
      await writer.mutation(seed, { count: h.size })
      graphObserver = graph.subscribeChanges(
        () => {
          callbackSnapshots.push(signature(graph.toArray.map(project)))
          observeGraph()
        },
        { includeInitialState: false },
      )
      stopStatus = graph.on(`status:change`, observeGraph)
      await graph.preload()
      monitor()
      expect(source.base.size).toBeLessThan(truth.length)
      expect(source.base.has(String(h.size - 1))).toBe(false)
      reaches.add(`unread-tail`)
      hold()
      await edit([
        { clientId: `0`, rank: 0, text: `removed`, remove: true },
        { clientId: String(h.size - 1), rank: -2, text: `${h.text}:moved-1` },
        { clientId: `insert-1`, rank: -1, text: `${h.text}:insert-1` },
      ])
      checkpoint()
      reaches.add(`partial-membership-order-held`)
      await drain()
      await reachLatest()

      const prior = graph.toArray.map(project)
      scope = { offset: 1, limit: h.limit + 5 }
      versions = new LazyVersionModel(`sequence`)
      versions.offer(prior)
      versions.offer(expectedLazyRows(truth, scope))
      hold()
      const beforeGrowth = batches.length
      let growthSettled = false
      const growth = Promise.resolve(graph.utils.setWindow(scope))
      void growth.then(
        () => {
          growthSettled = true
        },
        () => {
          growthSettled = true
        },
      )
      await waitFor(() =>
        batches.slice(beforeGrowth).some((batch) => batch.held),
      )
      expect(growthSettled, `growth escaped held application`).toBe(false)
      reaches.add(`demand-growth-held`)
      await edit([
        { clientId: `1`, rank: 1, text: `removed`, remove: true },
        { clientId: String(h.size - 2), rank: -3, text: `${h.text}:moved-2` },
        { clientId: `insert-2`, rank: -2.5, text: `${h.text}:insert-2` },
      ])
      for (let revision = 1; revision <= h.revisions; revision++)
        await edit([
          {
            clientId: `insert-1`,
            rank: -1,
            text: `${h.text}:superseding-${revision}`,
          },
        ])
      reaches.add(`two-partial-revisions-held`)
      await drain()
      await waitFor(() => growthSettled)
      await growth
      await reachLatest()
      expect(source.base.size).toBeLessThan(truth.length)
      const unread = truth.find((row) => row.id === String(h.size - 3))!
      expect(
        evidence.has(fact(unread)),
        `growth must retain a genuinely unread tail`,
      ).toBe(false)
      reaches.add(`demand-growth-with-unread-tail`)
      expect(providerErrors).toEqual([])

      // Only now acquire the whole relation, to compose shared acceptance with
      // a genuine query error and cleanup-abandoned actual receipts.
      hold()
      const controllers = [new AbortController(), new AbortController()]
      const first = acquire(`a`, controllers[0]!.signal)
      const second = acquire(`b`, controllers[1]!.signal)
      await waitFor(
        () =>
          batches.some(
            (batch) =>
              batch.held &&
              batch.owners.includes(`a`) &&
              batch.owners.includes(`b`),
          ) &&
          first.missing.size === 0 &&
          second.missing.size === 0,
      )
      const canceled = h.cancelFirst ? `a` : `b`
      receipts.abort(canceled)
      controllers[h.cancelFirst ? 0 : 1]!.abort()
      await writer.mutation(setFailure, { enabled: true })
      await waitFor(() =>
        providerErrors.some((error) =>
          String(error).includes(`oracle query failure`),
        ),
      )
      expect(
        attempts.get(canceled)!.outcome,
        `canceled caller escaped accepted work before cleanup`,
      ).toBeUndefined()
      reaches.add(`real-query-error-after-shared-acceptance`)
      // A provider error does not grant abandonment authority. Graph status
      // before cleanup is unconstrained here; only cleanup activates terminality.
      versions = undefined
      terminal.cleanup(graph.toArray.map(project))
      receipts.cleanup()
      const pending = batches.filter((batch) => batch.state === `pending`)
      expect(pending.length).toBeGreaterThan(0)
      cleaning = source._lifecycle.cleanup()
      terminal.observe(graph.status, graph.toArray.map(project))
      await waitFor(
        () =>
          pending.every((batch) => batch.state === `abandoned`) &&
          [...attempts.values()].every(
            (attempt) => attempt.outcome !== undefined,
          ),
      )
      await cleaning
      receipts.complete()
      reaches.add(`actual-cleanup-abandonment`)
      await drain()
      await writer.mutation(setFailure, { enabled: false })
      // A fresh sync run needs its own receipt authority; the ended model remains
      // complete. Stop the old receipt recorder before creating the fresh source.
      recordReceipts = false
      source.startSyncImmediate()
      fresh = dependent(h.limit)
      await fresh.preload()
      await waitFor(
        () =>
          signature(fresh!.toArray.map(project)) ===
          signature(expectedLazyRows(truth, { limit: h.limit })),
      )
      terminal.observe(graph.status, graph.toArray.map(project))
      checkpoint()
      const server = (await writer.query(all, {})).map(project)
      expect([...server].sort((a, b) => a.id.localeCompare(b.id))).toEqual(
        [...truth].sort((a, b) => a.id.localeCompare(b.id)),
      )
      reaches.add(`fresh-graph-old-terminal`)
    },
    () => release(),
    () => Promise.allSettled(persisted ? [persisted] : []),
    () => {
      for (const request of requests) source._sync.unloadSubset(request)
    },
    () => fresh?.cleanup(),
    () => graph.cleanup(),
    () => source.cleanup(),
    () => {
      graphObserver?.unsubscribe()
      sourceObserver.unsubscribe()
      stopStatus()
    },
    () => writer.mutation(setFailure, { enabled: false }),
    () => reader.close(),
    () => writer.close(),
  )
  return reaches
}

it(`receives partial windows, query failure and abandoned receipts through both SDKs`, async () => {
  await runOracleCampaign(
    `CONVEX_BOUNDARY_ORACLE`,
    [
      `unread-tail`,
      `partial-membership-order-held`,
      `demand-growth-with-unread-tail`,
      `demand-growth-held`,
      `two-partial-revisions-held`,
      `real-query-error-after-shared-acceptance`,
      `actual-cleanup-abandonment`,
      `fresh-graph-old-terminal`,
      `javascript`,
      `react`,
    ] as const,
    (reach, parameters) =>
      fc.assert(
        fc.asyncProperty(grammar, async (h) => {
          reach.beginHistory()
          for (const [kind, reached] of await receiveBothSdks((sdk) =>
            receive(h, sdk),
          )) {
            for (const state of [
              `unread-tail`,
              `partial-membership-order-held`,
              `demand-growth-with-unread-tail`,
              `demand-growth-held`,
              `two-partial-revisions-held`,
              `real-query-error-after-shared-acceptance`,
              `actual-cleanup-abandonment`,
              `fresh-graph-old-terminal`,
            ] as const)
              if (reached.has(state)) reach.reach(state)
            reach.reach(kind)
          }
        }),
        { numRuns: lazyOracleRuns(4), ...parameters },
      ),
    { fixedSeed: 20261029 },
  )
}, 120000)
