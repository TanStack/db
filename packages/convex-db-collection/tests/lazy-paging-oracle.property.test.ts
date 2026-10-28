/**
 * Lazy page acquisitions refine the laws in lazy-paging-model-oracle.ts.
 * Five families use the same generated history and 60-run fixed/random budget:
 * values/scopes; successor work; publication/repair; acquisition/lifecycle;
 * publication-reentrant receipts.
 * Each has its own predeclared reach ledger and direct SEED/PATH replay.
 * Drivers are real Collection/ordered live-query boundaries plus the controlled
 * transport in lazy-paging-driver.ts. Expectations never use pager internals.
 *
 * Grammar: finite ranks (ties included), stable IDs, page partitions, offset,
 * forward/reverse transitions and generated finite limit-move suffixes (work
 * family). Shared arbitrary fields not used by a family earn it no coverage. The
 * constructive scenes below reconstruct the named witnesses before suffixes.
 * Removing ties loses scope-vs-display; removing holds loses early settlement;
 * removing cleanup/restart loses run authority. Unsupported orders/filters are
 * a nearby negative. The receipt family supplies two actual batches through
 * publication reentry. Arbitrary progressive multi-commit acquisitions and
 * delayed cancellation remain with core's receipt/replay owners.
 * Quiescent provider drains detect finite stalls; the fixture turn guard is
 * diagnostic and does not claim arbitrary nonquiescent termination coverage.
 */
import fc from 'fast-check'
import {
  IR,
  createCollection,
  createLiveQueryCollection,
  createTransaction,
} from '@tanstack/db'
import { expect, it } from 'vitest'
import { runOracleCampaign } from '../../db/tests/oracle-campaign'
import { oracleRuns } from '../../db/tests/oracle-config'
import { convexPaginatedCollectionOptions } from '../src/index'
import { withTestCleanup } from './helpers'
import {
  lazyFixture,
  lazyOrder,
  lazyQuery,
  lazyRequest,
} from './lazy-paging-driver'
import {
  assertLazyCoverage,
  assertLazyPublications,
  copyLazyRows,
  deliveredScopeComplete,
  expectedLazyRows,
  ordered,
} from './lazy-paging-model-oracle'
import type { LazyRow } from './lazy-paging-model-oracle'

const history = fc.record({
  size: fc.integer({ min: 16, max: 32 }),
  pageSize: fc.integer({ min: 1, max: 5 }),
  offset: fc.integer({ min: 1, max: 5 }),
  limit: fc.integer({ min: 1, max: 5 }),
  descending: fc.boolean(),
  reverse: fc.boolean(),
  texts: fc.array(fc.string({ maxLength: 8 }), {
    minLength: 32,
    maxLength: 32,
  }),
  suffix: fc.array(fc.integer({ min: 1, max: 12 }), { maxLength: 8 }),
})
type History = typeof history extends fc.Arbitrary<infer T> ? T : never
function rowsFor(h: History, ties = true): Array<LazyRow> {
  return Array.from({ length: h.size }, (_, i) => ({
    id: `r${String(i).padStart(2, `0`)}`,
    rank: ties ? Math.floor(i / 2) : i,
    text: h.texts[i]!,
  }))
}
const runBudget = oracleRuns(60)
const fixedSeed = 20261026

it(`matches exact finite, offset, tie, continuation, whole and empty scopes`, async () => {
  await runOracleCampaign(
    `CONVEX_LAZY_VALUES_ORACLE`,
    [
      `offset-crosses-page`,
      `scoped-unlimited-tie`,
      `continuation-scope`,
      `whole-source-exhausted`,
      `authoritative-empty`,
      `required-split`,
      `recommended-split`,
      `short-nonterminal`,
      `unsupported-shape-rejected`,
      `rejected-unload-preserves-peer`,
    ] as const,
    (reach, parameters) =>
      fc.assert(
        fc.asyncProperty(history, async (h) => {
          reach.beginHistory()
          const rows = rowsFor(h)
          const order = ordered(rows, h.descending)
          const scopes = [
            { offset: h.offset + h.pageSize, limit: h.limit },
            { equal: order[3]!.rank },
            { after: order[3]!.rank, limit: h.limit },
            {},
          ]
          for (const [i, scope] of scopes.entries()) {
            const f = lazyFixture(rows, h.pageSize, h.descending)
            await withTestCleanup(
              async () => {
                const load = f.load(scope)
                await f.remote.pump(() => false, h.reverse)
                await load.complete()
                const actual = [...f.source.values()]
                expect(
                  expectedLazyRows(actual, scope, h.descending),
                  `lazy exact scope ${i}`,
                ).toEqual(expectedLazyRows(rows, scope, h.descending))
                assertLazyCoverage(actual, rows, scope, h.descending)
                if (i === 0) expect(f.remote.successorStarts).toBeGreaterThan(0)
                reach.reach(
                  (
                    [
                      `offset-crosses-page`,
                      `scoped-unlimited-tie`,
                      `continuation-scope`,
                      `whole-source-exhausted`,
                    ] as const
                  )[i]!,
                )
                load.release()
              },
              () => f.source.cleanup(),
            )
          }
          for (const split of [`required`, `recommended`] as const) {
            const f = lazyFixture(rows, 4, h.descending, split, true)
            await withTestCleanup(
              async () => {
                const load = f.load({ limit: 6 })
                await f.remote.pump(() => false, h.reverse)
                await load.complete()
                assertLazyCoverage(
                  [...f.source.values()],
                  rows,
                  { limit: 6 },
                  h.descending,
                )
                expect(
                  f.remote.slots.some(
                    (slot) =>
                      slot.current?.pageStatus ===
                      (split === `required`
                        ? `SplitRequired`
                        : `SplitRecommended`),
                  ),
                ).toBe(true)
                reach.reach(
                  split === `required` ? `required-split` : `recommended-split`,
                )
                expect(
                  f.remote.slots.some(
                    (slot) =>
                      slot.current &&
                      !slot.current.isDone &&
                      slot.current.page.length < slot.opts.numItems,
                  ),
                ).toBe(true)
                reach.reach(`short-nonterminal`)
                load.release()
              },
              () => f.source.cleanup(),
            )
          }
          const capability = lazyFixture(rows, h.pageSize, h.descending)
          await withTestCleanup(
            async () => {
              const valid = lazyRequest({ limit: h.limit }, h.descending)
              const rank = new IR.PropRef([`rank`])
              const invalid = [
                { ...valid, orderBy: lazyOrder(!h.descending) },
                {
                  ...valid,
                  where: new IR.Func(`gt`, [rank, new IR.Value(h.offset)]),
                },
                { ...valid, offset: -h.offset },
                {
                  ...valid,
                  cursor: {
                    whereFrom: new IR.Func(`eq`, [
                      rank,
                      new IR.Value(h.offset),
                    ]),
                    whereCurrent: new IR.Func(`eq`, [
                      rank,
                      new IR.Value(h.offset),
                    ]),
                  },
                },
              ]
              for (const request of invalid) {
                await expect(
                  capability.source._sync.loadSubset(request),
                ).rejects.toBeInstanceOf(Error)
                capability.source._sync.unloadSubset(request)
              }
              expect(capability.remote.slots).toHaveLength(0)
              reach.reach(`unsupported-shape-rejected`)
              const peer = capability.load({ limit: h.limit })
              await capability.remote.pump()
              await peer.complete()
              for (const request of invalid)
                capability.source._sync.unloadSubset(request)
              assertLazyCoverage(
                [...capability.source.values()],
                rows,
                { limit: h.limit },
                h.descending,
              )
              reach.reach(`rejected-unload-preserves-peer`)
              peer.release()
            },
            () => capability.source.cleanup(),
          )
          const empty = lazyFixture([], h.pageSize, h.descending)
          await withTestCleanup(
            async () => {
              const load = empty.load({ limit: h.limit })
              await empty.remote.pump()
              await load.complete()
              expect([...empty.source.values()]).toEqual([])
              reach.reach(`authoritative-empty`)
              load.release()
            },
            () => empty.source.cleanup(),
          )
        }),
        { numRuns: runBudget, ...parameters },
      ),
    { fixedSeed },
  )
}, 60000)

it(`starts no unneeded ranges and preserves gap-free growth with healthy peers`, async () => {
  await runOracleCampaign(
    `CONVEX_LAZY_WORK_ORACLE`,
    [
      `no-demand`,
      `zero-limit`,
      `finite-with-unread-tail`,
      `gap-free-growth-across-page`,
      `shallow-read-during-growth`,
      `peer-survives-release`,
      `same-object-pending-attempts`,
    ] as const,
    (reach, parameters) =>
      fc.assert(
        fc.asyncProperty(history, async (h) => {
          reach.beginHistory()
          const rows = rowsFor(h, false)
          const f = lazyFixture(rows, 4, h.descending)
          await withTestCleanup(
            async () => {
              await f.remote.pump()
              expect(
                f.remote.slots,
                `lazy work: no row-range without demand`,
              ).toHaveLength(0)
              reach.reach(`no-demand`)
              const zero = f.load({ limit: 0 })
              await zero.complete()
              expect(f.remote.slots).toHaveLength(0)
              reach.reach(`zero-limit`)
              zero.release()
              const a = f.load({ limit: 3 })
              let duplicateSettled = false
              const duplicate = f.source._sync.loadSubset(a.request)
              void Promise.resolve(duplicate).then(() => {
                duplicateSettled = true
              })
              await f.remote.pump()
              await a.complete()
              expect(
                duplicateSettled,
                `lazy progress: duplicate pending attempt stranded`,
              ).toBe(true)
              await duplicate
              reach.reach(`same-object-pending-attempts`)
              assertLazyCoverage(
                [...f.source.values()],
                rows,
                { limit: 3 },
                h.descending,
              )
              expect(f.source.size).toBeLessThan(rows.length)
              reach.reach(`finite-with-unread-tail`)
              const b = f.load({ limit: 6 })
              await f.remote.pump(
                (slot) =>
                  slot.opts.cursor !== null && slot.opts.endCursor == null,
              )
              // Newly held deeper work must not make already applied shallow coverage
              // unavailable. This cut supplies no delayed cancellation premise.
              let shallow = false
              const peer = f.load({ limit: 3 })
              void Promise.resolve(peer.result).then(() => {
                shallow = true
              })
              await f.remote.pump(() => true)
              expect(shallow, `lazy shallow read blocked by deeper work`).toBe(
                true,
              )
              reach.reach(`shallow-read-during-growth`)
              a.release()
              peer.release()
              await f.remote.pump()
              await b.complete()
              assertLazyCoverage(
                [...f.source.values()],
                rows,
                { limit: 6 },
                h.descending,
              )
              reach.reach(`gap-free-growth-across-page`)
              reach.reach(`peer-survives-release`)
              for (const limit of h.suffix) {
                const next = f.load({ limit })
                await f.remote.pump()
                await next.complete()
                assertLazyCoverage(
                  [...f.source.values()],
                  rows,
                  { limit },
                  h.descending,
                )
                next.release()
              }
              b.release()
            },
            () => f.source.cleanup(),
          )
        }),
        { numRuns: runBudget, ...parameters },
      ),
    { fixedSeed },
  )
}, 60000)

it(`publishes complete initial, moved and repaired live windows`, async () => {
  await runOracleCampaign(
    `CONVEX_LAZY_PUBLICATION_ORACLE`,
    [
      `pending-initial-window`,
      `pending-window-move`,
      `pending-boundary-repair`,
      `completed-boundary-refill`,
      `coherent-cache-before-callback`,
      `refetch-cache-before-callback`,
    ] as const,
    (reach, parameters) =>
      fc.assert(
        fc.asyncProperty(history, async (h) => {
          reach.beginHistory()
          let rows = rowsFor(h, false)
          const f = lazyFixture(rows, 2, h.descending)
          const permission = {}
          f.remote.scopes.set(permission, { limit: 3 })
          const live = createLiveQueryCollection((q) =>
            q
              .from({ row: f.source })
              .orderBy(({ row }) => row.rank, h.descending ? `desc` : `asc`)
              .orderBy(({ row }) => row.id, h.descending ? `desc` : `asc`)
              .select(({ row }) => row)
              .limit(3),
          )
          const trace: Array<Array<LazyRow>> = []
          const subscription = live.subscribeChanges(() =>
            trace.push(copyLazyRows(live.toArray)),
          )
          const read = () => {
            trace.push(copyLazyRows(live.toArray))
          }
          await withTestCleanup(
            async () => {
              const ready = live.preload()
              void ready.catch(() => {})
              await f.remote.pump(
                (slot) =>
                  slot.opts.cursor !== null && slot.opts.endCursor == null,
                h.reverse,
                read,
              )
              expect(copyLazyRows(live.toArray)).toEqual([])
              reach.reach(`pending-initial-window`)
              await f.remote.pump(() => false, h.reverse, read)
              await ready
              const initial = expectedLazyRows(rows, { limit: 3 }, h.descending)
              expect(copyLazyRows(live.toArray)).toEqual(initial)
              assertLazyPublications(trace, [], initial)
              trace.length = 0
              f.remote.scopes.set(permission, { offset: 3, limit: 4 })
              const moved = Promise.resolve(
                live.utils.setWindow({ offset: 3, limit: 4 }),
              )
              void moved.catch(() => {})
              await f.remote.pump(
                (slot) =>
                  slot.opts.cursor !== null && slot.opts.endCursor == null,
                h.reverse,
                read,
              )
              expect(copyLazyRows(live.toArray)).toEqual(initial)
              reach.reach(`pending-window-move`)
              await f.remote.pump(() => false, h.reverse, read)
              await moved
              const next = expectedLazyRows(
                rows,
                { offset: 3, limit: 4 },
                h.descending,
              )
              expect(copyLazyRows(live.toArray)).toEqual(next)
              assertLazyPublications(trace, initial, next)
              trace.length = 0
              // Remove every currently acquired row. Existing bounded intervals become
              // empty; only a successor can supply the required replacement window.
              const retained = new Set(
                [...f.source.values()].map((row) => row.id),
              )
              rows = rows.filter((row) => !retained.has(row.id))
              f.remote.change(rows)
              await f.remote.pump(
                (slot) =>
                  slot.opts.cursor !== null && slot.opts.endCursor == null,
                h.reverse,
                read,
              )
              expect(copyLazyRows(live.toArray)).toEqual(next)
              reach.reach(`pending-boundary-repair`)
              await f.remote.pump(() => false, h.reverse, read)
              expect(copyLazyRows(live.toArray)).toEqual(
                expectedLazyRows(rows, { offset: 3, limit: 4 }, h.descending),
              )
              assertLazyPublications(
                trace,
                next,
                expectedLazyRows(rows, { offset: 3, limit: 4 }, h.descending),
              )
              reach.reach(`completed-boundary-refill`)
              reach.reach(`coherent-cache-before-callback`)
              trace.length = 0
              const prior = copyLazyRows(live.toArray)
              rows = rows.map((row) => ({
                ...row,
                text: `${row.text} refreshed`,
              }))
              f.remote.change(rows)
              f.remote.installCaches()
              let refreshed = false
              const refetch = f.load({ offset: 3, limit: 4 }, undefined, true)
              void Promise.resolve(refetch.result).then(() => {
                refreshed = true
              })
              // No callback runs: explicit refetch must read installed caches.
              await f.remote.pump(() => true, h.reverse, read)
              expect(
                refreshed,
                `lazy refetch left a coherent cache unread`,
              ).toBe(true)
              await refetch.complete()
              const fresh = expectedLazyRows(
                rows,
                { offset: 3, limit: 4 },
                h.descending,
              )
              expect(copyLazyRows(live.toArray)).toEqual(fresh)
              assertLazyPublications(trace, prior, fresh)
              reach.reach(`refetch-cache-before-callback`)
              refetch.release()
            },
            () => subscription.unsubscribe(),
            () => live.cleanup(),
            () => f.source.cleanup(),
          )
        }),
        { numRuns: runBudget, ...parameters },
      ),
    { fixedSeed },
  )
}, 60000)

it(`waits for applied receipts, respects abort and fences callbacks across restart`, async () => {
  await runOracleCampaign(
    `CONVEX_LAZY_LIFECYCLE_ORACLE`,
    [
      `actual-establishing-set-checked`,
      `abort-before-acceptance`,
      `abort-after-acceptance`,
      `stale-after-restart`,
      `same-run-reconnect-recovery`,
      `cleanup-start-fences-callback`,
      `held-cleanup-fences-callback`,
      `old-dependent-stays-terminal`,
      `retired-error-and-status-fenced`,
      `fresh-dependent-after-restart`,
    ] as const,
    (reach, parameters) =>
      fc.assert(
        fc.asyncProperty(history, async (h) => {
          reach.beginHistory()
          const rows = rowsFor(h, false)
          let releaseBlock = () => {}
          let cleanDependent = async () => {}
          let cleanFresh = async () => {}
          let finishCleanup!: () => void
          const cleanupGate = new Promise<void>((resolve) => {
            finishCleanup = resolve
          })
          const f = lazyFixture(
            rows,
            h.pageSize,
            h.descending,
            `none`,
            false,
            () => cleanupGate,
          )
          await withTestCleanup(
            async () => {
              const controller = new AbortController()
              const canceled = f.load({ limit: 3 }, controller.signal)
              let rejected = false
              void Promise.resolve(canceled.result).catch(() => {
                rejected = true
              })
              controller.abort()
              await f.remote.pump()
              expect(rejected).toBe(true)
              expect(f.source.size).toBe(0)
              reach.reach(`abort-before-acceptance`)
              canceled.release()
              // An optimistic write outside the query parks every following ordinary
              // sync commit. This is a real core receipt, not a substituted promise.
              let release!: () => void
              const transaction = createTransaction({
                mutationFn: () =>
                  new Promise<void>((resolve) => {
                    release = resolve
                    releaseBlock = resolve
                  }),
              })
              transaction.mutate(() =>
                f.source.insert({ id: `blocker`, rank: 1000, text: `held` }),
              )
              const after = new AbortController()
              let settled = false
              const loading = f.load({ limit: 3 }, after.signal)
              void Promise.resolve(loading.result).then(
                () => {
                  settled = true
                },
                () => {
                  settled = true
                },
              )
              await f.remote.pump()
              expect(
                settled,
                `lazy receipt: successful load before application`,
              ).toBe(false)
              expect(f.receipts.some((receipt) => receipt !== true)).toBe(true)
              after.abort()
              await f.remote.pump()
              expect(
                settled,
                `lazy abort: accepted rows must apply first`,
              ).toBe(false)
              release()
              await transaction.when('settled')
              await f.remote.pump()
              await expect(loading.result).rejects.toMatchObject({
                name: `AbortError`,
              })
              assertLazyCoverage(
                [...f.source.values()],
                rows,
                { limit: 3 },
                h.descending,
              )
              reach.reach(`actual-establishing-set-checked`)
              reach.reach(`abort-after-acceptance`)
              loading.release()
              const current = f.load({ limit: 3 })
              await f.remote.pump()
              await current.complete()
              f.remote.disconnect()
              const changed = rows.map((row, i) =>
                i === rows.length - 1
                  ? { ...row, rank: h.descending ? 100 : -100 }
                  : row,
              )
              f.remote.change(changed)
              await f.remote.pump()
              f.remote.reconnect()
              await f.remote.pump()
              assertLazyCoverage(
                [...f.source.values()],
                changed,
                { limit: 3 },
                h.descending,
              )
              reach.reach(`same-run-reconnect-recovery`)
              current.release()
              const dependent = createLiveQueryCollection((q) =>
                q
                  .from({ row: f.source })
                  .orderBy(({ row }) => row.rank, h.descending ? `desc` : `asc`)
                  .select(({ row }) => row)
                  .limit(3),
              )
              cleanDependent = () => dependent.cleanup()
              const permission = {}
              f.remote.scopes.set(permission, { limit: 3 })
              const ready = dependent.preload()
              await f.remote.pump()
              await ready
              const dependentPublications: Array<Array<LazyRow>> = []
              const dependentStatuses: Array<string> = []
              const stopDependentStatuses = dependent.on(
                `status:change`,
                ({ status }) => dependentStatuses.push(status),
              )
              const dependentObserver = dependent.subscribeChanges(
                () =>
                  dependentPublications.push(copyLazyRows(dependent.toArray)),
                { includeInitialState: false },
              )
              // Public cleanup now refuses active dependents. Internal teardown
              // still owns this stale-callback and terminal-graph boundary.
              await expect(f.source.cleanup()).rejects.toThrow(
                `dependent(s) read it`,
              )
              const cleaning = f.source._lifecycle.cleanup()
              const staleCheckpoint = async () => {
                const before = {
                  base: [...f.source.base.values()],
                  status: f.source.status,
                  statuses: [...f.statuses],
                  errors: [...f.errors],
                  syncError: f.source.utils.getSyncError(),
                  publications: [...f.publications],
                  dependentPublications: [...dependentPublications],
                  dependentStatuses: [...dependentStatuses],
                  dependent: [...dependent.values()],
                  dependentStatus: dependent.status,
                }
                f.remote.late(`success`)
                f.remote.late(`error`)
                for (let turn = 0; turn < 10; turn++) await Promise.resolve()
                expect(
                  {
                    base: [...f.source.base.values()],
                    status: f.source.status,
                    statuses: [...f.statuses],
                    errors: [...f.errors],
                    syncError: f.source.utils.getSyncError(),
                    publications: [...f.publications],
                    dependentPublications: [...dependentPublications],
                    dependentStatuses: [...dependentStatuses],
                    dependent: [...dependent.values()],
                    dependentStatus: dependent.status,
                  },
                  `retired callback retained authority across cleanup`,
                ).toEqual(before)
              }
              await staleCheckpoint()
              expect(f.source.has(`obsolete`)).toBe(false)
              expect(dependent.status).toBe(`crashed`)
              expect(() => f.source.startSyncImmediate()).toThrow()
              reach.reach(`cleanup-start-fences-callback`)
              await f.remote.pump()
              await staleCheckpoint()
              expect(f.source.has(`obsolete`)).toBe(false)
              expect(f.source.status).not.toBe(`cleaned-up`)
              reach.reach(`held-cleanup-fences-callback`)
              finishCleanup()
              await cleaning
              // Core retains the terminal query's source subscription. Its new-run
              // truncate requests a whole-source replay even though the old graph
              // remains terminal. Account for that real demand; do not call it
              // speculative work for the fresh bounded request.
              f.remote.scopes.set(permission, {})
              f.source.startSyncImmediate()
              const restarted = f.load({ limit: 3 })
              await f.remote.pump()
              await restarted.complete()
              await staleCheckpoint()
              await f.remote.pump()
              expect(f.source.has(`obsolete`)).toBe(false)
              assertLazyCoverage(
                [...f.source.values()],
                changed,
                { limit: 3 },
                h.descending,
              )
              reach.reach(`stale-after-restart`)
              expect(dependent.status).toBe(`crashed`)
              reach.reach(`old-dependent-stays-terminal`)
              reach.reach(`retired-error-and-status-fenced`)
              const fresh = createLiveQueryCollection((q) =>
                q
                  .from({ row: f.source })
                  .orderBy(({ row }) => row.rank, h.descending ? `desc` : `asc`)
                  .orderBy(({ row }) => row.id, h.descending ? `desc` : `asc`)
                  .select(({ row }) => row)
                  .limit(3),
              )
              cleanFresh = () => fresh.cleanup()
              const freshReady = fresh.preload()
              await f.remote.pump()
              await freshReady
              expect(copyLazyRows(fresh.toArray)).toEqual(
                expectedLazyRows(changed, { limit: 3 }, h.descending),
              )
              expect(fresh.status).toBe(`ready`)
              expect(dependent.status).toBe(`crashed`)
              reach.reach(`fresh-dependent-after-restart`)
              await fresh.cleanup()
              stopDependentStatuses()
              dependentObserver.unsubscribe()
              await dependent.cleanup()
              f.remote.scopes.delete(permission)
              restarted.release()
            },
            () => {
              releaseBlock()
              finishCleanup()
              return f.source.cleanup()
            },
            () => cleanDependent(),
            () => cleanFresh(),
          )
        }),
        { numRuns: runBudget, ...parameters },
      ),
    { fixedSeed },
  )
}, 60000)

/** A publication callback may open a second optimistic hold and install the
 * next source revision before the older applied receipt's continuation runs.
 * Each cached acquisition still owes the actual latest establishing receipt.
 * The two receipts here come from core; no promise is substituted. */
it(`keeps the newer establishing receipt through publication reentry`, async () => {
  await runOracleCampaign(
    `CONVEX_LAZY_RECEIPT_ORACLE`,
    [`reentrant-second-held-receipt`, `cached-load-waits-for-latest`] as const,
    (reach, parameters) =>
      fc.assert(
        fc.asyncProperty(history, async (h) => {
          reach.beginHistory()
          const rows = rowsFor(h, false)
          const target = ordered(rows, h.descending)[0]!
          const fresh = rows.map((row) =>
            row.id === target.id ? { ...row, text: `${row.text} new` } : row,
          )
          const f = lazyFixture(rows, Math.max(2, h.pageSize), h.descending)
          let open1 = () => {}
          let open2 = () => {}
          const firstBlock = createTransaction({
            mutationFn: () =>
              new Promise<void>((resolve) => {
                open1 = resolve
              }),
          })
          firstBlock.mutate(() =>
            f.source.insert({
              id: `block1`,
              rank: h.descending ? -1000 : 1000,
              text: `held`,
            }),
          )
          const first = f.load({ limit: 1 })
          await f.remote.pump()
          let second: ReturnType<typeof f.load> | undefined
          let cached: ReturnType<typeof f.load> | undefined
          let secondBlock: ReturnType<typeof createTransaction> | undefined
          let started = false
          const subscription = f.source.subscribeChanges(
            (changes) => {
              if (
                started ||
                !changes.some((change) => change.key === target.id)
              )
                return
              started = true
              secondBlock = createTransaction({
                mutationFn: () =>
                  new Promise<void>((resolve) => {
                    open2 = resolve
                  }),
              })
              secondBlock.mutate(() =>
                f.source.insert({
                  id: `block2`,
                  rank: h.descending ? -1001 : 1001,
                  text: `held`,
                }),
              )
              f.remote.change(fresh)
              f.remote.installCaches()
              second = f.load({ limit: 1 })
            },
            { includeInitialState: false },
          )
          await withTestCleanup(
            async () => {
              open1()
              await firstBlock.when('settled')
              await f.remote.pump()
              expect(started).toBe(true)
              expect(
                f.receipts.filter((receipt) => receipt !== true).length,
              ).toBeGreaterThanOrEqual(2)
              expect(f.source.get(target.id)!.text).toBe(target.text)
              reach.reach(`reentrant-second-held-receipt`)
              let settled = false
              cached = f.load({ limit: 1 })
              void Promise.resolve(cached.result).then(
                () => {
                  settled = true
                },
                () => {
                  settled = true
                },
              )
              await f.remote.pump()
              expect(
                settled,
                `lazy receipt: cached load skipped newer establishing receipt`,
              ).toBe(false)
              reach.reach(`cached-load-waits-for-latest`)
              open2()
              await secondBlock!.when('settled')
              await f.remote.pump()
              await first.complete()
              await second!.complete()
              await cached.complete()
              assertLazyCoverage(
                [...f.source.values()],
                fresh,
                { limit: 1 },
                h.descending,
              )
            },
            () => {
              open1()
              open2()
            },
            () => subscription.unsubscribe(),
            () => {
              first.release()
              second?.release()
              cached?.release()
            },
            () => f.source.cleanup(),
          )
        }),
        { numRuns: runBudget, ...parameters },
      ),
    { fixedSeed },
  )
}, 60000)

// Wrong-answer controls distinguish missing same-rank coverage, skipped
// overshoot, transient publication and hidden-suffix knowledge independently
// of the production driver. Legal batch/cached and reacquisition behavior
// carries no mandatory second-receipt or retained-tail assertion.
it(`rejects wrong coverage and transient windows while preserving discovery freedom`, () => {
  const rows = [
    { id: `a`, rank: 1, text: `` },
    { id: `b`, rank: 1, text: `` },
    { id: `c`, rank: 2, text: `` },
  ]
  expect(() => assertLazyCoverage([rows[0]!], rows, { limit: 1 })).toThrow(
    `lazy coverage`,
  )
  expect(() => assertLazyPublications([[rows[0]!]], [], rows)).toThrow(
    `lazy publication`,
  )
  for (const suffix of [
    [{ id: `c`, rank: 3, text: `` }],
    [{ id: `d`, rank: 2, text: `` }],
  ]) {
    const delivered = [
      { id: `a`, rank: 1, text: `` },
      { id: `b`, rank: 2, text: `` },
    ]
    expect(deliveredScopeComplete(delivered, false, { limit: 2 })).toBe(false)
    expect(expectedLazyRows([...delivered, ...suffix], { limit: 2 })).toEqual(
      delivered,
    )
  }
})

it.each([0, -1, 1.5, Infinity, NaN])(
  `rejects invalid lazy row caps before readiness: %s`,
  async (maxRows) => {
    const f = lazyFixture([], 1)
    await f.source.cleanup()
    const source = createCollection(
      convexPaginatedCollectionOptions({
        client: f.remote.client,
        query: lazyQuery,
        queryArgs: {},
        syncMode: `on-demand`,
        queryOrder: { field: `rank`, direction: `asc` },
        maxRows,
        getKey: (row) => row.id,
      }),
    )
    const statuses: Array<string> = []
    const off = source.on(`status:change`, ({ status }) => {
      statuses.push(status)
    })
    await withTestCleanup(
      async () => {
        await expect(source.preload()).rejects.toBeInstanceOf(Error)
        expect(source.utils.getSyncError()).toBeInstanceOf(RangeError)
        expect(
          statuses,
          `lazy startup: invalid provider config reported ready`,
        ).not.toContain(`ready`)
        expect(f.remote.slots).toHaveLength(0)
      },
      off,
      () => source.cleanup(),
    )
  },
)
