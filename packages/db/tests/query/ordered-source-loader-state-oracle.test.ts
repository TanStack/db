import fc from 'fast-check'
import { describe, expect, it, vi } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import { BTreeIndex } from '../../src/indexes/btree-index.js'
import { createLiveQueryCollection } from '../../src/query/index.js'
import {
  OrderedLoaderInvariantError,
  OrderedSourceLoader,
} from '../../src/query/live/ordered-source-loader.js'
import { PropRef } from '../../src/query/ir.js'
import { evaluateReferenceExpression } from '../reference-expression-oracle.js'
import { captureMicrotaskErrors, flushPromises } from '../utils.js'
import {
  declareOracle,
  oraclePropertyOptions,
  oracleRuns,
  readOracleRunConfig,
} from '../oracle-config.js'
import {
  createDeferred,
  createOrderByInfo,
} from './ordered-source-loader-state-support.js'
import type { CollectionSubscription } from '../../src/collection/subscription.js'
import type { LoadSubsetOptions } from '../../src/types.js'
import type {
  Observed,
  RequestOptions,
} from './ordered-source-loader-state-support.js'

describe(`Ordered source request ownership`, () => {
  // An order change while a tie request is in flight starts a bounded prefix
  // repair at once; the tie's later result is ignored for the boundary. When
  // that repair fails, the window move rejects with its error and the last
  // public window stays, whatever the older tie request does. An explicit
  // retry then recovers under today's failure law, from the full source, and
  // publishes once.
  it.each([`success`, `failure`] as const)(
    `keeps a failed public window private when its older tie request ends in %s`,
    async (olderOutcome) => {
      type Row = { id: number; rank: number }
      const truth: Array<Row> = [1, 2, 3].map((id) => ({ id, rank: id }))
      const requests: Array<{
        kind: `page` | `boundary` | `full`
        options: LoadSubsetOptions
        gate: ReturnType<typeof createDeferred>
      }> = []
      const releases: Array<LoadSubsetOptions> = []
      let hold = false
      let holdRepair = false
      let update!: (row: Row) => void
      const source = createCollection<Row, number>({
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        autoIndex: `eager`,
        defaultIndexType: BTreeIndex,
        sync: {
          sync: (sync) => {
            const installed = new Map<number, Row>()
            update = (row) => {
              installed.set(row.id, row)
              sync.begin()
              sync.write({ type: `update`, value: row })
              sync.commit()
            }
            sync.markReady()
            return {
              loadSubset: async (options) => {
                const kind = options.orderBy
                  ? `page`
                  : options.where
                    ? `boundary`
                    : `full`
                const gate = createDeferred()
                requests.push({ kind, options, gate })
                if (!hold || (kind === `page` && !holdRepair)) gate.resolve()
                await gate.promise
                if (options.signal?.aborted) return
                const rows = truth
                  .filter(
                    (row) =>
                      (!options.where ||
                        evaluateReferenceExpression(options.where, row) ===
                          true) &&
                      (!options.cursor ||
                        evaluateReferenceExpression(
                          options.cursor.whereFrom,
                          row,
                        ) === true),
                  )
                  .sort((a, b) => a.rank - b.rank)
                const offset = options.cursor ? 0 : (options.offset ?? 0)
                const selected = rows.slice(
                  offset,
                  options.limit === undefined
                    ? undefined
                    : offset + options.limit,
                )
                sync.begin()
                for (const row of selected) {
                  if (installed.get(row.id) === row) continue
                  sync.write({
                    type: installed.has(row.id) ? `update` : `insert`,
                    value: row,
                  })
                  installed.set(row.id, row)
                }
                await sync.commit()
              },
              unloadSubset: (options) => {
                releases.push(options)
              },
            }
          },
        },
      })
      const live = createLiveQueryCollection((q) =>
        q
          .from({ row: source })
          .orderBy(({ row }) => row.rank)
          .limit(1)
          .select(({ row }) => ({ id: row.id, rank: row.rank })),
      )
      const visibleRows = () =>
        live.toArray.map(({ id, rank }) => ({ id, rank }))
      const publications: Array<Array<Row>> = []
      live.subscribeChanges(
        (batch) => {
          if (batch.length) publications.push(visibleRows())
        },
        { includeInitialState: false },
      )
      try {
        await live.preload()
        expect(visibleRows()).toEqual([{ id: 1, rank: 1 }])
        publications.length = 0
        hold = true
        const move = Promise.resolve(live.utils.setWindow({ limit: 2 })).then(
          () => ({ status: `fulfilled` as const }),
          (error) => ({ status: `rejected` as const, error }),
        )
        await flushPromises()
        const boundary = requests.at(-1)!
        expect(boundary.kind).toBe(`boundary`)
        holdRepair = true
        truth[0] = { id: 1, rank: 10 }
        update(truth[0])
        await flushPromises()
        const repair = requests.at(-1)!
        expect(repair.kind).toBe(`page`)
        expect(repair.options.limit).toBe(2)
        expect(repair.options.cursor).toBeUndefined()
        const count = requests.length
        const failure = new Error(`authoritative repair failed`)
        repair.gate.reject(failure)
        // The window still waits for its older publication participant to settle.
        await flushPromises()
        if (olderOutcome === `failure`)
          boundary.gate.reject(new Error(`older tie failed`))
        else boundary.gate.resolve()
        await flushPromises()
        expect(requests).toHaveLength(count)
        expect(await move).toEqual({ status: `rejected`, error: failure })
        expect(releases).toEqual([])
        expect(publications).toEqual([])
        expect(visibleRows()).toEqual([{ id: 1, rank: 1 }])
        expect(live.utils.getWindow()).toEqual({ offset: 0, limit: 1 })

        hold = false
        holdRepair = false
        await live.utils.setWindow({ limit: 2 })
        expect(requests).toHaveLength(count + 1)
        expect(requests.at(-1)!.kind).toBe(`full`)
        expect(releases).toHaveLength(count)
        expect(new Set(releases)).toEqual(
          new Set(requests.slice(0, count).map(({ options }) => options)),
        )
        expect(visibleRows()).toEqual([
          { id: 2, rank: 2 },
          { id: 3, rank: 3 },
        ])
        expect(publications).toEqual([
          [
            { id: 2, rank: 2 },
            { id: 3, rank: 3 },
          ],
        ])
      } finally {
        await live.cleanup()
        for (const request of requests) request.gate.resolve()
        await source.cleanup()
      }
    },
  )

  it(`a failed window move keeps the snapshot; the retry loads the source once`, async () => {
    type Row = { id: number; rank: number }
    const truth: Array<Row> = [1, 2, 3, 4, 5, 6].map((id) => ({ id, rank: id }))
    const failure = new Error(`page rejected`)
    const requests: Array<{ kind: string; options: LoadSubsetOptions }> = []
    const unloads: Array<LoadSubsetOptions> = []
    let failNextCursor = false
    const kindOf = (options: LoadSubsetOptions) =>
      options.orderBy !== undefined
        ? options.cursor
          ? `cursor-page`
          : `page`
        : options.where !== undefined
          ? `boundary`
          : `full`
    const source = createCollection<Row, number>({
      id: `cut-c-probe-source`,
      getKey: ({ id }) => id,
      syncMode: `on-demand`,
      autoIndex: `eager`,
      defaultIndexType: BTreeIndex,
      sync: {
        sync: (sync) => {
          const installed = new Set<number>()
          sync.markReady()
          return {
            loadSubset: (options) => {
              requests.push({ kind: kindOf(options), options })
              if (options.cursor && failNextCursor) {
                failNextCursor = false
                return Promise.reject(failure)
              }
              let rows = truth.filter(
                (row) =>
                  !options.where ||
                  evaluateReferenceExpression(options.where, row) === true,
              )
              if (options.cursor)
                rows = rows.filter(
                  (row) =>
                    evaluateReferenceExpression(
                      options.cursor!.whereFrom,
                      row,
                    ) === true,
                )
              const offset = options.cursor ? 0 : (options.offset ?? 0)
              rows = rows.slice(
                offset,
                options.limit === undefined
                  ? undefined
                  : offset + options.limit,
              )
              return (async () => {
                await Promise.resolve()
                const fresh = rows.filter(({ id }) => !installed.has(id))
                if (fresh.length === 0) return
                sync.begin()
                for (const value of fresh) {
                  installed.add(value.id)
                  sync.write({ type: `insert`, value })
                }
                const receipt = sync.commit()
                if (receipt !== true) await receipt
              })()
            },
            unloadSubset: (options) => {
              unloads.push(options)
            },
          }
        },
      },
    })
    const live = createLiveQueryCollection((q) =>
      q
        .from({ row: source })
        .orderBy(({ row }) => row.rank)
        .limit(2)
        .select(({ row }) => ({ id: row.id, rank: row.rank })),
    )
    const publications: Array<Array<number>> = []
    live.subscribeChanges(
      (batch) => {
        if (batch.length > 0)
          publications.push(live.toArray.map(({ id }) => id))
      },
      { includeInitialState: false },
    )
    try {
      await live.preload()
      expect(live.toArray.map(({ id }) => id)).toEqual([1, 2])
      expect(requests.map(({ kind }) => kind)).toEqual([`page`, `boundary`])
      expect(unloads).toEqual([])
      const initialRequests = requests.length
      publications.length = 0

      failNextCursor = true
      const move = live.utils.setWindow({ limit: 4 })
      expect(move).not.toBe(true)
      await expect(move).rejects.toBe(failure)
      await flushPromises()
      // Rows: last settled snapshot; events: none; wait: rejected; requests: one.
      expect(live.toArray.map(({ id }) => id)).toEqual([1, 2])
      expect(publications).toEqual([])
      expect(live.utils.getWindow()).toEqual({ offset: 0, limit: 2 })
      expect(requests.slice(initialRequests).map(({ kind }) => kind)).toEqual([
        `cursor-page`,
      ])
      expect(unloads).toEqual([])
      expect(live.status).not.toBe(`error`)

      const retry = live.utils.setWindow({ limit: 4 })
      expect(retry).not.toBe(true)
      await retry
      await flushPromises()
      expect(live.toArray.map(({ id }) => id)).toEqual([1, 2, 3, 4])
      expect(publications).toEqual([[1, 2, 3, 4]])
      expect(live.utils.getWindow()).toEqual({ offset: 0, limit: 4 })
      expect(requests.slice(initialRequests).map(({ kind }) => kind)).toEqual([
        `cursor-page`,
        `full`,
      ])
      // Retry retires the failed page; successful repair then retires earlier
      // finite demands while keeping the new authoritative demand.
      expect(unloads).toEqual([
        requests[initialRequests]!.options,
        ...requests.slice(0, initialRequests).map(({ options }) => options),
      ])

      await flushPromises()
      expect(requests).toHaveLength(initialRequests + 2)
    } finally {
      await live.cleanup()
      await source.cleanup()
    }
  })
})

/**
 * # Request authority under generated settlement orders
 *
 * ## Contract
 *
 * ARCHITECTURE.md, "Ordered requests, continuation, and recovery", gives the
 * loader authority rules for requests that overlap an ordering invalidation:
 *
 * - **Held:** a successful bounded repair holds the acquisitions it read.
 *   Only a later read that covers them may retire them: a newer repair, a
 *   full-source read, or a truncate replay that covers the source, or a
 *   prefix read issued after the repair that reaches every repair row still
 *   inside the window. That prefix counts once it succeeds or once a
 *   successful replay reacquires its demand while it is still in flight. A request issued before the invalidation proves no
 *   current coverage, so it never retires them.
 * - **No leak:** once loading is quiet and no failure blocks it, the loader
 *   holds nothing issued before its last successful authoritative read.
 *   Otherwise every later refetch would read that request again. A
 *   superseded request that failed is retired once a full-source read issued
 *   after it succeeds, or a replay that covers the source settles after it;
 *   it needs no explicit retry.
 * - **Covering lease:** a full-source lease whose read succeeded, or whose
 *   demand a successful replay reacquired, is never released. A late failure
 *   of its own transport does not undo that coverage.
 * - **Invariant:** the loader's transition table never rejects a move. The
 *   oracle records any `OrderedLoaderInvariantError` the loader throws, so
 *   the generated histories also fuzz that table.
 * - **No stale step:** a repair chain whose ordering epoch moved is replaced
 *   before it issues another tie or refill.
 * - **Error identity:** a request that fails reports its own error through
 *   its participant, or a release's cleanup error. A read the loader starts
 *   while handling it cannot replace that error. A dead request's failure
 *   belongs to its replay, and one a replay reacquired is absorbed.
 * - **Cost:** once loading is quiet and a bounded repair is available, an
 *   invalidation reads no full source, and it issues at most one chain (in
 *   this fake, a prefix, a tie, and a refill) per ordering epoch move.
 * - **Ignored report:** a sync adapter's report that served pages may have
 *   shifted issues no authoritative request when nothing it describes can
 *   be wrong: before any request settled (a request in flight still owes an
 *   exact result for its own options), or while the loader's coverage is
 *   its own first ordered prefix of at least `offset + limit` rows, with
 *   only that prefix's tie after it, and a row past the page sorts strictly
 *   after its end with no more rows needed (ARCHITECTURE.md). The law judges
 *   only quiet histories: every earlier step settled a request successfully,
 *   ran a pass, inserted a row, reported, or changed joined work, and no
 *   release callback has side effects, so no earlier event owes a repair.
 * - **One request at a time:** a request issued while another is in flight
 *   starts authority, or an authority start lies between them. A repair
 *   chain that a newer start replaced issues no more steps.
 * - **No strand:** a request that authoritative work superseded can still
 *   fail. Its partial writes need the full-source read that the overlap
 *   replaced, so the loader starts one without an explicit retry. The
 *   loader's own failure (an authoritative request, or a request that
 *   nothing superseded) may block ordinary refills until an explicit retry.
 *   That is the failure law, so it is not a strand.
 * - **Progress:** once loading is quiet, an invalidation and an ordinary pass
 *   issue a read, unless a full-source read covers the source. A throwing
 *   release, a staged repair continuation, or a page that invalidated its
 *   own order must not leave a repair that nothing resumes.
 *
 * These laws came from a TLA+ model of the loader's request authority
 * (#2191). This property checks the real loader against them.
 *
 * The leak and progress laws also judge a truncate replay. A replay owns
 * the requests issued before the truncate. When the subscription still holds
 * a full-source lease, the settled replay covers the source.
 *
 * ## Model
 *
 * The model is a ledger of observed requests, kept outside the loader. Each
 * request is classified from its options alone:
 * - a full-source read has no order and no predicate;
 * - a request is authoritative when it is a full-source read or it carries
 *   `refetch: true` (a bounded repair and its tie and refill);
 * - an authoritative read starts at a full-source read or a repair prefix
 *   (ordered, with no predicate and no cursor); the leak and held laws
 *   measure from the latest successful start;
 * - a repair prefix is a step of a running chain, not a start, when it is
 *   issued while a chain member settles or by the continuation such a
 *   settlement left staged (a synchronous answer) or deferred (joined work),
 *   as an optimistic refill or a shrunk window's prefix is;
 * - a truncate replay that settles while the subscription holds a
 *   full-source lease, even a failed one, covers the source and counts as a
 *   successful start after every earlier request; the leases it reacquired
 *   stay held. Requests issued before the truncate belong to the replay, so
 *   the laws judge only later ones;
 * - a request is superseded when an authoritative request was issued while
 *   it was in flight.
 * The ledger records each request's outcome and whether the loader released
 * it. It never reads the loader's fields.
 *
 * ## History grammar
 *
 * A history is up to sixteen steps over a fake subscription whose requests
 * stay in flight until a step settles them:
 * - `settle` resolves or rejects one in-flight request, in any order, and
 *   `failOldest` rejects the oldest one, which is the one most often
 *   superseded;
 * - `settleNewest` resolves the newest in-flight request, as a provider that
 *   answers out of order can, so a repair chain finishes around an older
 *   request;
 * - `invalidateThenFailOldest` invalidates source ordering with the
 *   reaction deferred and rejects the oldest in-flight request before the
 *   loader reacts;
 * - `invalidate` invalidates source ordering, and `report` delivers a
 *   loaded-subset report; either can run an ordinary pass at once or leave
 *   the reaction deferred, as pending joined work or a later graph run can;
 * - `pass` runs an ordinary `loadMore()`;
 * - `move` is an explicit window move, which may also widen the window, so
 *   an unindexed loader reads a longer prefix;
 * - `syncInvalidatingPage` runs a pass whose next page's own delivery
 *   invalidates source ordering before the request returns;
 * - `unexpressibleBoundary` makes the last installed row's order value NaN,
 *   or expressible again, so no cursor can continue from it;
 * - `joinedBusy` and `joinedIdle` hold and finish LEFT-joined work, which
 *   defers ordinary loading, and the pass the subscriber runs after it;
 * - `truncate` resets the cursor and holds ordinary passes behind a pending
 *   replay; `replaySucceeds` settles the replay and `replayFails` leaves it
 *   pending;
 * - `optimisticDeparture` hides the window's row behind an optimistic
 *   overlay, and `sourceDelete` deletes it from the source;
 * - `timer` runs the bounded backoff retry when that scenario enables it;
 * - `hang` makes the provider never answer the oldest open request, like a
 *   lost TCP segment; the drain leaves it in flight;
 * - `startThrows` makes the next request throw while it starts, so it
 *   acquires nothing; `failOldestThrowingRecovery` fails a superseded
 *   request (the oldest, if none is) while the recovery read it starts
 *   throws at its start;
 * - `dispose` disposes the loader. After it the loader issues no request and
 *   releases no lease, even as earlier requests settle; the end laws then
 *   judge nothing more.
 * Passes are ordinary graph passes, which the subscriber skips while a
 * truncate replay is pending; a window move still runs. Scenarios cross an
 * indexed loader (pages and ties) with an unindexed one (prefix reads),
 * window limits 1 and 2, whether the first page settles before the history
 * (a bounded repair needs a settled request), whether the first release
 * callback throws, whether a repair's prefix answers at once from installed
 * rows (an eager source), plans that read only the full source, a joined
 * order source, one or three installed rows (three let a report fall inside
 * the loader's own first page), whether the window needs more rows,
 * whether the backoff retry is enabled, whether the first release callback
 * starts a truncate of its own (a reentrant reset), whether the first
 * release callback disposes the loader, whether each release
 * callback runs an ordinary pass synchronously (as a graph run does when a
 * release delivers deletes outside a transaction; inside one the run is
 * deferred, which is the ordinary form), and a window offset of 0 or 1.
 * Truncates can stack on a pending replay, including one that failed.
 *
 * ## Checkpoints
 *
 * Held, one request at a time, and release are checked after every step.
 * A release that throws is an adapter bug: the loader reports it uncaught
 * from a microtask and changes nothing else, so each one must be reported
 * that way exactly once, and no other error may escape a microtask.
 * The release law says each acquisition is released at most once, and that
 * nothing is released while a truncate replay owns it, unless an explicit
 * retry replaces it or a held successful full-source lease covers it. After
 * the history, a drain finishes joined work, settles each truncate replay,
 * including one a release starts during the drain, settles every in-flight
 * request that is not hung, and runs ordinary passes until the loader issues
 * nothing new. No strand is checked at that point. Then, if an own
 * failure still blocks the loader, one explicit window move retries it and
 * the drain runs again. No leak is checked next, then progress.
 *
 * ## Limits
 *
 * The fake subscription's rows do not move except for the unexpressible
 * boundary, so cursor values are fixed. Publication holds are outside this
 * property; other tests here own them. The laws do not judge requests issued
 * before a truncate, which the replay owns. The loader has no request
 * timeout, so a hung authoritative request may hold its work slot: progress
 * is not required then, the leak law does not judge the unfinished chain,
 * and the strand law accepts recovery that is owed behind it. A failed replay stays pending until the drain
 * settles it. The fake releases an acquisition when the loader calls its
 * release; it does not model an adapter that removes rows later.
 */
type LedgerRequest = {
  index: number
  options: RequestOptions
  acquisition: LoadSubsetOptions
  deferred: ReturnType<typeof createDeferred>
  fullSource: boolean
  authoritative: boolean
  superseded: boolean
  // A refetch prefix issued as a step of a running repair chain, such as an
  // optimistic refill or a shrunk window's prefix, rather than the start of
  // a new chain.
  chainStep: boolean
  outcome: `inflight` | `ok` | `failed`
  released: boolean
  // A successful truncate replay reacquired the request's demand, even while
  // its own transport was still in flight.
  replayed: boolean
  // The provider never answers the request, like a lost segment.
  hung: boolean
  // The error the request failed with, if it failed.
  error: Error | undefined
  // Truncates before the request was issued, and before it failed, and the
  // event clock at its failure. A request that fails after a truncate is
  // dead; the replay, not the loader, owns its lease.
  issuedTruncates: number
  failedTruncates: number
  failedAt: number
}

type AuthorityCommand =
  | { type: `settle`; pick: number; ok: boolean }
  | { type: `invalidate`; react: boolean }
  | { type: `report`; react: boolean }
  | { type: `failOldest` }
  | { type: `settleNewest` }
  | { type: `invalidateThenFailOldest` }
  | { type: `pass` }
  | { type: `move`; delta: -1 | 0 | 1 }
  | { type: `syncInvalidatingPage` }
  | { type: `unexpressibleBoundary` }
  | { type: `joinedBusy` }
  | { type: `joinedIdle` }
  | { type: `truncate` }
  | { type: `replaySucceeds` }
  | { type: `replayFails` }
  | { type: `optimisticDeparture` }
  | { type: `sourceDelete`; react: boolean }
  | { type: `timer` }
  | { type: `hang` }
  | { type: `dispose` }
  | { type: `startThrows` }
  | { type: `failOldestThrowingRecovery` }

type AuthorityCase = {
  indexed: boolean
  limit: 1 | 2
  // Settle the first page before the history. A bounded repair needs a
  // settled request; without one an invalidation reads the full source.
  settledFirst: boolean
  // The first release callback throws, as an adapter's cleanup can.
  releaseFault: boolean
  // A bounded repair's prefix answers at once, as an eager indexed source
  // does, and its rows change graph input.
  syncRepair: boolean
  // The plan reads only the full source.
  requiresFullSource: boolean
  // The order source is filtered by a LEFT-joined source, whose pending
  // work defers ordinary loading.
  joined: boolean
  // Installed rows the loader reads locally. Three let a window lie inside
  // its own first page, so a report may skip its repair.
  snapshotRows: 1 | 3
  // Whether the window still needs rows after each read.
  needsMore: boolean
  // A failed authoritative read retries itself after a backoff.
  retryTimer: boolean
  // The first release callback starts a truncate synchronously, as a
  // reentrant reset does.
  releaseTruncates: boolean
  // The window starts after this many rows of the order.
  offset: 0 | 1
  // Each release callback runs an ordinary pass synchronously, as a graph run
  // that reacts to the removed rows does.
  releaseReenters: boolean
  // The first release callback disposes the loader, as adapter cleanup can.
  releaseDisposes: boolean
  history: Array<AuthorityCommand>
}

const authorityCommand: fc.Arbitrary<AuthorityCommand> = fc.oneof(
  {
    weight: 6,
    arbitrary: fc.record({
      type: fc.constant(`settle` as const),
      pick: fc.nat({ max: 7 }),
      // Failures are rarer than successes, so most histories keep the
      // strand law checkable: an own failure needs an explicit retry anyway.
      ok: fc.oneof(
        { weight: 9, arbitrary: fc.constant(true) },
        { weight: 1, arbitrary: fc.constant(false) },
      ),
    }),
  },
  {
    weight: 2,
    arbitrary: fc.record({
      type: fc.constant(`invalidate` as const),
      react: fc.boolean(),
    }),
  },
  {
    weight: 1,
    arbitrary: fc.record({
      type: fc.constant(`report` as const),
      react: fc.boolean(),
    }),
  },
  // The oldest in-flight request is the one most often superseded.
  { weight: 1, arbitrary: fc.constant({ type: `failOldest` as const }) },
  // A provider can answer newer requests first, so a repair chain finishes
  // while an older request is still in flight.
  { weight: 3, arbitrary: fc.constant({ type: `settleNewest` as const }) },
  {
    weight: 1,
    arbitrary: fc.constant({ type: `invalidateThenFailOldest` as const }),
  },
  { weight: 1, arbitrary: fc.constant({ type: `pass` as const }) },
  {
    weight: 1,
    arbitrary: fc.constant({ type: `syncInvalidatingPage` as const }),
  },
  {
    weight: 1,
    arbitrary: fc.record({
      type: fc.constant(`move` as const),
      delta: fc.constantFrom(-1 as const, 0 as const, 1 as const),
    }),
  },
  {
    weight: 1,
    arbitrary: fc.constant({ type: `unexpressibleBoundary` as const }),
  },
  { weight: 1, arbitrary: fc.constant({ type: `joinedBusy` as const }) },
  { weight: 1, arbitrary: fc.constant({ type: `joinedIdle` as const }) },
  { weight: 1, arbitrary: fc.constant({ type: `truncate` as const }) },
  { weight: 1, arbitrary: fc.constant({ type: `replaySucceeds` as const }) },
  { weight: 1, arbitrary: fc.constant({ type: `replayFails` as const }) },
  {
    weight: 1,
    arbitrary: fc.constant({ type: `optimisticDeparture` as const }),
  },
  {
    weight: 1,
    arbitrary: fc.record({
      type: fc.constant(`sourceDelete` as const),
      react: fc.boolean(),
    }),
  },
  // The backoff retry needs a failed repair first, so it runs more often.
  { weight: 4, arbitrary: fc.constant({ type: `timer` as const }) },
  { weight: 1, arbitrary: fc.constant({ type: `hang` as const }) },
  { weight: 1, arbitrary: fc.constant({ type: `dispose` as const }) },
  { weight: 1, arbitrary: fc.constant({ type: `startThrows` as const }) },
  {
    weight: 3,
    arbitrary: fc.constant({ type: `failOldestThrowingRecovery` as const }),
  },
)

const authorityCaseArbitrary: fc.Arbitrary<AuthorityCase> = fc.record({
  indexed: fc.boolean(),
  limit: fc.constantFrom(1 as const, 2 as const),
  settledFirst: fc.boolean(),
  releaseFault: fc.boolean(),
  syncRepair: fc.boolean(),
  requiresFullSource: fc.oneof(
    { weight: 5, arbitrary: fc.constant(false) },
    { weight: 1, arbitrary: fc.constant(true) },
  ),
  joined: fc.boolean(),
  snapshotRows: fc.constantFrom(1 as const, 3 as const),
  needsMore: fc.oneof(
    { weight: 3, arbitrary: fc.constant(true) },
    { weight: 1, arbitrary: fc.constant(false) },
  ),
  retryTimer: fc.boolean(),
  releaseTruncates: fc.oneof(
    { weight: 4, arbitrary: fc.constant(false) },
    { weight: 1, arbitrary: fc.constant(true) },
  ),
  offset: fc.constantFrom(0 as const, 1 as const),
  releaseReenters: fc.oneof(
    { weight: 3, arbitrary: fc.constant(false) },
    { weight: 1, arbitrary: fc.constant(true) },
  ),
  releaseDisposes: fc.oneof(
    { weight: 5, arbitrary: fc.constant(false) },
    { weight: 1, arbitrary: fc.constant(true) },
  ),
  history: fc.array(authorityCommand, { minLength: 1, maxLength: 16 }),
})

type AuthorityObservation = {
  supersededFailures: number
  // Superseded requests that failed after the repair that superseded them
  // succeeded: the premise of the strand law.
  supersededFailuresAfterRepair: number
  // Such failures where the strand law was checkable: no own failure since
  // the last full-source read.
  checkedStrandPremises: number
  // Superseded requests that failed after their repair finished while a
  // newer invalidation's reaction was deferred.
  deferredStrandShapes: number
  staleSettlementsAfterRepair: number
  // Release callbacks that threw, synchronous repair answers, and pages
  // whose own delivery invalidated ordering.
  releaseFaults: number
  syncRepairs: number
  invalidatingPages: number
  // Commands of the later dimensions that changed loader input.
  unexpressibleBoundaries: number
  joinedDeferrals: number
  ignoredReportsBeforeSettle: number
  ignoredReportsInsideFirstPage: number
  truncates: number
  replayFailures: number
  optimisticDepartures: number
  sourceDeletes: number
  timerRetries: number
  shrinkingMoves: number
  reentrantTruncates: number
  stackedTruncates: number
  truncatesAfterFailedReplay: number
  reentrantPasses: number
  disposals: number
  startThrows: number
  startThrowsDuringFailure: number
  costChecks: number
  hungRequests: number
  offsetWindows: number
}

async function checkAuthorityCase(
  testCase: AuthorityCase,
): Promise<AuthorityObservation> {
  const ledger: Array<LedgerRequest> = []
  const participants: Array<Promise<unknown>> = []
  let joinedPending = false
  let truncatePending = false
  let boundaryUnexpressible = false
  const info = createOrderByInfo({
    limit: testCase.limit,
    ...(testCase.indexed ? {} : { index: undefined }),
    // A synchronous repair answer reads installed rows: an eager source.
    ...(testCase.syncRepair ? { sourceHoldsAllRows: true } : {}),
    requiresFullSource: testCase.requiresFullSource,
    ...(testCase.joined ? { joinedFilterSourceId: `markers` } : {}),
    dataNeeded: () => (testCase.needsMore ? 1 : 0),
    offset: testCase.offset,
  })
  let revision = 0
  // A repair chain's steps run as continuations of its members: while a
  // member settles, or later from the continuation that settlement left
  // staged or deferred. A refetch prefix issued either way is a step, such as
  // an optimistic refill; any other one starts a chain. After the ordering
  // epoch moves, a settling member replaces its chain before it continues, so
  // a continuation's prefix after an epoch move starts the replacement. The
  // oracle counts epoch moves as calls to `invalidateSourceOrdering()`, the
  // one method that moves the epoch, including the loader's own calls.
  let epochMoves = 0
  let epochMovesAtLastStart = -1
  let concurrencyViolation: string | undefined
  // Requests the fake has answered whose participant is not yet reported,
  // and each request's participant with the reason it rejected with.
  const answering: Array<LedgerRequest> = []
  const participantOf = new Map<LedgerRequest, Promise<unknown>>()
  const rejections = new Map<LedgerRequest, unknown>()
  let throwNextStart = false
  let startThrewDuringRetry = false
  let settlingFailure = false
  let startThrowsDuringFailure = 0
  let costChecks = 0
  // The start-throw branch sets the flag, so read it through a call.
  const retryStartThrew = () => startThrewDuringRetry
  let startThrows = 0
  let identityViolation: string | undefined
  // A request may fail, but the loader's own transition table must never
  // reject a move: that is a broken rule, wherever it surfaces.
  let invariantViolation: string | undefined
  function observe(error: unknown) {
    if (error instanceof OrderedLoaderInvariantError) {
      invariantViolation ??= error.message
    }
  }
  let releaseViolation: string | undefined
  // A disposed loader owns nothing: it issues no request and releases no
  // lease, even as requests it issued earlier settle.
  let disposed = false
  // A release callback can dispose the loader, so read the flag through a call.
  const isDisposed = () => disposed
  let disposeViolation: string | undefined
  let disposals = 0
  let explicitRetrying = false
  let reentrantTruncates = 0
  let stackedTruncates = 0
  let truncatesAfterFailedReplay = 0
  let replayFailedSinceTruncate = false
  let reentering = false
  let reentrantPasses = 0
  let hungRequests = 0
  let settlingChainMember = false
  let continuationOwed = false
  let invalidateNextPage = false
  let releaseFaults = 0
  let syncRepairs = 0
  let invalidatingPages = 0
  const record = (method: Observed[`method`], options: RequestOptions) => {
    // Like the real subscription, a continuation's acquisition carries a
    // cursor, so the loader does not take it for a prefix read.
    const acquisition: LoadSubsetOptions = {
      orderBy: options.orderBy,
      limit: options.limit,
      where: options.where,
      ...(options.minValues === undefined
        ? {}
        : {
            cursor: {
              whereFrom: new PropRef([`row`, `rank`]),
              whereCurrent: new PropRef([`row`, `rank`]),
            } as unknown as NonNullable<LoadSubsetOptions[`cursor`]>,
          }),
    }
    const fullSource =
      method === `snapshot` &&
      options.orderBy === undefined &&
      options.where === undefined
    const authoritative = fullSource || options.refetch === true
    if (authoritative) {
      for (const request of ledger) {
        if (request.outcome === `inflight` && !request.authoritative) {
          request.superseded = true
        }
      }
    }
    const request: LedgerRequest = {
      index: ledger.length,
      options,
      acquisition,
      deferred: createDeferred(),
      fullSource,
      authoritative,
      superseded: false,
      chainStep:
        options.refetch === true &&
        (settlingChainMember || continuationOwed) &&
        epochMovesAtLastStart === epochMoves,
      outcome: `inflight`,
      released: false,
      replayed: false,
      hung: false,
      error: undefined,
      issuedTruncates: truncates,
      failedTruncates: -1,
      failedAt: -1,
    }
    ledger.push(request)
    if (disposed) {
      disposeViolation ??= `request ${request.index} was issued after dispose`
    }
    // A chain whose epoch moved is replaced before it issues another tie or
    // refill (ARCHITECTURE.md, ordered repair).
    if (
      authoritative &&
      !fullSource &&
      !startsAuthority(request) &&
      epochMoves !== epochMovesAtLastStart
    ) {
      concurrencyViolation ??= `request ${request.index}, a step of a repair chain whose epoch moved, was issued before its replacement`
    }
    if (startsAuthority(request)) epochMovesAtLastStart = epochMoves
    // An issued request consumes an owed continuation. An ordinary page also
    // shows the chain finished, since none is issued while a repair runs.
    continuationOwed = false
    // One request at a time: a request issued while another is in flight
    // starts authority, or a start lies between them, so the older one is
    // superseded. The replay owns requests from before the truncate.
    if (!startsAuthority(request)) {
      const overlapped = ledger.find(
        (other) =>
          other !== request &&
          other.outcome === `inflight` &&
          other.index >= replayOwnedBefore &&
          ledger.every(
            (start) =>
              start.index <= other.index ||
              start.index >= request.index ||
              !startsAuthority(start),
          ),
      )
      if (overlapped) {
        concurrencyViolation ??= `request ${request.index} was issued while request ${overlapped.index} of the same authority was in flight`
      }
    }
    // The subscription throws while the request starts, so it acquires
    // nothing: the loader's own failure, with no lease to release.
    if (throwNextStart) {
      throwNextStart = false
      startThrows++
      if (explicitRetrying) startThrewDuringRetry = true
      // A recovery read that throws while the loader handles another failure.
      if (settlingFailure) startThrowsDuringFailure++
      request.outcome = `failed`
      request.released = true
      request.error = new Error(`request ${request.index} failed to start`)
      request.failedTruncates = truncates
      request.failedAt = ++clock
      throw request.error
    }
    const release = () => {
      if (disposed) {
        disposeViolation ??= `request ${request.index} was released after dispose`
      }
      // A full-source lease that covers the source stays held: its read
      // succeeded, or a successful replay reacquired its demand. Its own
      // transport failing later does not undo that coverage.
      if (
        request.fullSource &&
        !request.released &&
        (request.outcome === `ok` || request.replayed)
      ) {
        releaseViolation ??= `request ${request.index}, a full-source lease that covers the source, was released`
      }
      // Every acquisition is released at most once.
      if (request.released) {
        releaseViolation ??= `request ${request.index} was released twice`
      }
      // A pending truncate replay owns every demand the subscription holds.
      // A release is safe only when an explicit retry replaces the demand or
      // a held successful full-source lease covers it.
      const coveredBySource = ledger.some(
        (other) =>
          other.fullSource && other.outcome === `ok` && !other.released,
      )
      if (truncatePending && !explicitRetrying && !coveredBySource) {
        releaseViolation ??= `request ${request.index} was released while a truncate replay was pending`
      }
      request.released = true
      if (testCase.releaseDisposes && !disposed) {
        disposed = true
        disposals++
        loader.dispose()
        return
      }
      if (testCase.releaseReenters && !reentering) {
        reentering = true
        reentrantPasses++
        try {
          run(() => loader.loadMore())
        } finally {
          reentering = false
        }
      }
      if (testCase.releaseTruncates && reentrantTruncates === 0) {
        reentrantTruncates++
        truncate()
      }
      if (testCase.releaseFault && releaseFaults === 0) {
        releaseFaults++
        const failure = new Error(`release ${request.index} failed`)
        thrownReleases.push(failure)
        throw failure
      }
    }
    if (
      testCase.syncRepair &&
      method === `snapshot` &&
      options.refetch === true &&
      options.orderBy !== undefined &&
      options.where === undefined
    ) {
      syncRepairs++
      request.outcome = `ok`
      revision++
      const before = ledger.length
      const settling = settlingChainMember
      settlingChainMember = true
      try {
        answering.push(request)
        options.onLoadSubsetResult?.(true, acquisition, release)
      } finally {
        settlingChainMember = settling
      }
      if (ledger.length === before) continuationOwed = true
      return
    }
    if (invalidateNextPage && method === `limited` && !authoritative) {
      // The page's own delivery changes source order before it returns.
      invalidateNextPage = false
      invalidatingPages++
      loader.invalidateSourceOrdering()
    }
    answering.push(request)
    options.onLoadSubsetResult?.(request.deferred.promise, acquisition, release)
  }
  // Installed rows in ascending rank. An unexpressible boundary makes the
  // last one NaN, which no cursor can express.
  const snapshot = () =>
    Array.from({ length: testCase.snapshotRows }, (_, index) => ({
      type: `insert`,
      key: index + 1,
      value: {
        id: index + 1,
        rank:
          boundaryUnexpressible && index === testCase.snapshotRows - 1
            ? Number.NaN
            : index + 1,
      },
    }))
  const subscription = {
    readOrderedSnapshot: snapshot,
    setOrderByIndex: () => {},
    hasHeldSyncTransaction: false,
    get hasPendingTruncateReplacement() {
      return truncatePending
    },
    requestLimitedSnapshot: (options: RequestOptions) =>
      record(`limited`, options),
    requestSnapshot: (options: RequestOptions) => record(`snapshot`, options),
  } as unknown as CollectionSubscription
  const loader: OrderedSourceLoader = new OrderedSourceLoader(
    info,
    subscription,
    `row`,
    (result) => {
      // The loader reports a request's participant once the request returns;
      // nested requests issued meanwhile report first.
      const request = answering.pop()
      if (!(result instanceof Promise)) return
      participants.push(result.catch(observe))
      if (request) {
        participantOf.set(request, result)
        result.catch((reason: unknown) => rejections.set(request, reason))
      }
    },
    () => testCase.retryTimer,
    () => revision,
    () => joinedPending,
  )
  const invalidateSourceOrdering = loader.invalidateSourceOrdering.bind(loader)
  loader.invalidateSourceOrdering = () => {
    epochMoves++
    invalidateSourceOrdering()
  }
  const flush = async () => {
    for (let turn = 0; turn < 6; turn++) await Promise.resolve()
  }
  let windowOperation = 0
  // Requests issued before the last truncate belong to its replay, which
  // reacquires and retires them; the leak, held, and strand laws judge only
  // later requests.
  let replayOwnedBefore = 0
  // A replay reacquires every acquisition the subscription still holds. When
  // one of them is a full-source demand, even a failed one, the successful
  // replay covers the source.
  // A covering replay is an authoritative success after every request issued
  // before it: the last ledger index at that point, plus a half. The
  // full-source leases it reacquired are its coverage and stay held.
  let replayAuthority = -1
  // Events in order, so a replay can be placed after a failure.
  let clock = 0
  let replaySettledAt = -1
  let replayCoverage = new Set<LedgerRequest>()
  const settleReplay = () => {
    truncatePending = false
    replaySettledAt = ++clock
    for (const request of ledger) {
      if (!request.released && request.outcome !== `failed`) {
        request.replayed = true
      }
    }
    replayCoverage = new Set(
      ledger.filter((request) => request.fullSource && !request.released),
    )
    if (replayCoverage.size > 0) replayAuthority = ledger.length - 0.5
    run(() => loader.settleFullSourceReplay())
  }
  let unexpressibleBoundaries = 0
  let joinedDeferrals = 0
  let ignoredReportsBeforeSettle = 0
  let ignoredReportsInsideFirstPage = 0
  let truncates = 0
  let replayFailures = 0
  let optimisticDepartures = 0
  let sourceDeletes = 0
  let timerRetries = 0
  let shrinkingMoves = 0
  const run = (work: () => unknown) => {
    const before = ledger.length
    try {
      const result = work()
      if (result instanceof Promise) participants.push(result.catch(observe))
    } catch (error) {
      // A rejected request surfaces through its participant.
      observe(error)
    }
    // A pass that issues nothing consumed or finished an owed continuation,
    // unless joined work deferred it.
    if (ledger.length === before && !joinedPending) continuationOwed = false
  }
  const inflight = () =>
    ledger.filter(({ outcome, hung }) => outcome === `inflight` && !hung)
  // A truncate resets the cursor; the subscription replays its loaded
  // subsets and holds ordinary loading until the replay settles.
  // A release callback can start a truncate, so read the flag through a call.
  const replayPending = () => truncatePending
  function truncate() {
    truncates++
    // A second truncate while a replay is pending, possibly one that failed.
    if (truncatePending) {
      stackedTruncates++
      if (replayFailedSinceTruncate) truncatesAfterFailedReplay++
    }
    replayFailedSinceTruncate = false
    loader.resetCursor()
    truncatePending = true
    replayOwnedBefore = ledger.length
    replayCoverage = new Set()
  }
  // An ordinary graph pass. The subscriber asks for more only while no
  // truncate replacement is pending.
  const graphPass = () => {
    if (!truncatePending) run(() => loader.loadMore())
  }
  const sentRows = new Map([[1, { id: 1, rank: 1 }]])
  const settle = async (request: LedgerRequest, ok: boolean) => {
    request.outcome = ok ? `ok` : `failed`
    if (!ok) {
      request.failedTruncates = truncates
      request.failedAt = ++clock
    }
    const chainMember = request.authoritative && !request.fullSource
    const before = ledger.length
    settlingChainMember = chainMember
    if (ok) request.deferred.resolve()
    else {
      request.error = new Error(`request ${request.index} failed`)
      request.deferred.reject(request.error)
    }
    settlingFailure = !ok
    await flush()
    settlingFailure = false
    // A failed request's participant reports that request's own error; a
    // read the loader starts while handling it cannot replace it.
    if (!ok && participantOf.has(request)) {
      const reason = rejections.get(request)
      if (rejections.has(request)) {
        if (reason !== request.error && !injectedCleanup(reason)) {
          identityViolation ??= `request ${request.index} failed with its own error, but its participant rejected with ${String(reason)}`
        }
      } else if (
        // A dead request's failure belongs to the replay, and one a replay
        // reacquired is absorbed by its coverage; any other live failure is
        // reported.
        request.issuedTruncates === truncates &&
        !request.replayed &&
        // Dispose resets the cursor too.
        !isDisposed()
      ) {
        identityViolation ??= `request ${request.index} failed, but its participant did not reject`
      }
    }
    settlingChainMember = false
    // An asynchronous settlement runs its continuation at once unless joined
    // work defers it; a settlement that issues nothing otherwise finished.
    if (chainMember && ok && ledger.length === before && joinedPending) {
      continuationOwed = true
    }
  }
  // An authoritative read starts at a full-source read or a repair prefix;
  // the repair's tie and refill continue the same chain.
  function startsAuthority(request: LedgerRequest) {
    return (
      request.fullSource ||
      (request.authoritative &&
        !request.chainStep &&
        request.options.orderBy !== undefined &&
        request.options.where === undefined &&
        request.options.minValues === undefined)
    )
  }
  const lastAuthoritativeRead = () =>
    ledger.reduce(
      (last, request) =>
        startsAuthority(request) && request.outcome === `ok`
          ? request.index
          : last,
      -1,
    )
  const lastAuthoritativeSuccess = () =>
    Math.max(lastAuthoritativeRead(), replayAuthority)
  // A release callback's own error may replace a request's: cleanup failure
  // is reported through the participant (ARCHITECTURE.md).
  function injectedCleanup(reason: unknown) {
    return reason instanceof Error && reason.message.startsWith(`release `)
  }
  const checkHeld = (checkpoint: string) => {
    if (identityViolation) {
      throw new Error(`error identity ${checkpoint}: ${identityViolation}`)
    }
    if (disposeViolation) {
      throw new Error(`dispose ${checkpoint}: ${disposeViolation}`)
    }
    if (invariantViolation) {
      throw new Error(`invariant ${checkpoint}: ${invariantViolation}`)
    }
    if (releaseViolation) {
      throw new Error(`release ${checkpoint}: ${releaseViolation}`)
    }
    if (concurrencyViolation) {
      throw new Error(
        `one request at a time ${checkpoint}: ${concurrencyViolation}`,
      )
    }
    // The latest successful repair prefix, if no later authoritative read
    // has succeeded, must still be held.
    const repair = [...ledger]
      .reverse()
      .find(
        (request) =>
          startsAuthority(request) &&
          !request.fullSource &&
          request.outcome === `ok`,
      )
    if (
      !repair ||
      repair.index < replayOwnedBefore ||
      lastAuthoritativeSuccess() > repair.index
    )
      return
    // A prefix read issued after the repair covers the repair's rows that are
    // still inside the window when it reaches as far; it may retire the
    // repair's prefix. One issued before the repair proves no current
    // coverage and may not.
    const windowRows = Math.min(
      repair.options.limit ?? 0,
      info.offset + info.limit,
    )
    const coveredByLaterPrefix = ledger.some(
      (request) =>
        request.index > repair.index &&
        (request.outcome === `ok` || request.replayed) &&
        request.options.orderBy !== undefined &&
        request.options.where === undefined &&
        request.options.minValues === undefined &&
        (request.options.limit ?? 0) >= windowRows,
    )
    if (coveredByLaterPrefix) return
    if (repair.released) {
      throw new Error(
        `held ${checkpoint}: request ${repair.index}, a successful repair prefix, was released before a later authoritative read succeeded`,
      )
    }
  }
  const drain = async () => {
    joinedPending = false
    for (let round = 0; round < 40; round++) {
      // A release during the drain can start a truncate of its own.
      if (truncatePending) settleReplay()
      const next = inflight()[0]
      if (next) {
        await settle(next, true)
        continue
      }
      const before = ledger.length
      run(() => loader.loadMore())
      await flush()
      if (
        ledger.length === before &&
        inflight().length === 0 &&
        !truncatePending
      )
        return
    }
    throw new Error(`the loader did not reach a fixed point`)
  }
  const ownFailureSince = (index: number) =>
    ledger.some(
      (request) =>
        request.index > index &&
        request.outcome === `failed` &&
        (request.authoritative || !request.superseded),
    )
  let staleSettlementsAfterRepair = 0
  let supersededFailuresAfterRepair = 0
  let checkedStrandPremises = 0
  let deferredStrandShapes = 0
  // A release that throws is an adapter bug, which the loader reports
  // uncaught from a microtask without changing any result. Each one is
  // reported once, and no other error escapes that way.
  const thrownReleases: Array<Error> = []
  const uncaught = captureMicrotaskErrors()
  if (testCase.retryTimer) {
    vi.useFakeTimers({ toFake: [`setTimeout`, `clearTimeout`] })
  }
  try {
    run(() => loader.start())
    await flush()
    if (testCase.settledFirst && ledger[0]) await settle(ledger[0], true)
    for (const [step, command] of testCase.history.entries()) {
      switch (command.type) {
        case `settle`: {
          const open = inflight()
          if (open.length === 0) break
          const request = open[command.pick % open.length]!
          if (
            request.superseded &&
            lastAuthoritativeSuccess() > request.index
          ) {
            if (command.ok) staleSettlementsAfterRepair++
            else supersededFailuresAfterRepair++
          }
          await settle(request, command.ok)
          break
        }
        case `settleNewest`: {
          const request = inflight().at(-1)
          if (request) await settle(request, true)
          break
        }
        case `failOldest`: {
          const request = inflight()[0]
          if (!request) break
          if (
            request.superseded &&
            lastAuthoritativeSuccess() > request.index
          ) {
            supersededFailuresAfterRepair++
          }
          await settle(request, false)
          break
        }
        // An invalidation whose reaction is deferred, as pending joined work
        // or a later graph run defers it, while the oldest in-flight request
        // fails before the loader reacts.
        case `invalidateThenFailOldest`: {
          loader.invalidateSourceOrdering()
          const request = inflight()[0]
          if (!request) break
          if (
            request.superseded &&
            inflight().every((open) => open === request || !open.authoritative)
          ) {
            deferredStrandShapes++
          }
          await settle(request, false)
          break
        }
        case `invalidate`:
          loader.invalidateSourceOrdering()
          if (command.react) graphPass()
          await flush()
          break
        case `report`: {
          // The premises come from the case and the ledger alone.
          const quiet =
            !testCase.releaseFault &&
            !testCase.releaseReenters &&
            !testCase.releaseTruncates &&
            !testCase.releaseDisposes &&
            !boundaryUnexpressible &&
            testCase.history
              .slice(0, step)
              .every(
                (earlier) =>
                  (earlier.type === `settle` && earlier.ok) ||
                  earlier.type === `settleNewest` ||
                  earlier.type === `pass` ||
                  earlier.type === `report` ||
                  earlier.type === `joinedBusy` ||
                  earlier.type === `joinedIdle`,
              ) &&
            ledger.every(({ outcome }) => outcome !== `failed`)
          const windowSize = testCase.offset + info.limit
          const [first, ...later] = ledger
          const beforeSettle = ledger.every(({ outcome }) => outcome !== `ok`)
          const insideFirstPage =
            !testCase.requiresFullSource &&
            !testCase.needsMore &&
            testCase.snapshotRows > windowSize &&
            first !== undefined &&
            first.outcome === `ok` &&
            !first.authoritative &&
            first.options.orderBy !== undefined &&
            first.options.where === undefined &&
            first.options.cursor === undefined &&
            first.options.minValues === undefined &&
            (first.options.limit ?? 0) >= windowSize &&
            later.every(
              ({ options, outcome, authoritative }) =>
                outcome === `ok` &&
                !authoritative &&
                options.where !== undefined &&
                options.cursor === undefined &&
                options.orderBy === undefined,
            )
          const before = ledger.length
          loader.revalidateLoadedCoverage()
          if (command.react) graphPass()
          await flush()
          if (quiet && (beforeSettle || insideFirstPage)) {
            const issued = ledger
              .slice(before)
              .find(({ authoritative }) => authoritative)
            if (issued) {
              throw new Error(
                `ignored report: request ${issued.index} re-read the source for a report that covers nothing it could change`,
              )
            }
            if (beforeSettle) ignoredReportsBeforeSettle++
            else ignoredReportsInsideFirstPage++
          }
          break
        }
        case `pass`:
          graphPass()
          await flush()
          break
        case `syncInvalidatingPage`:
          invalidateNextPage = true
          graphPass()
          await flush()
          break
        case `move`: {
          const limit = Math.max(1, Math.min(info.limit + command.delta, 3))
          if (limit < info.limit) shrinkingMoves++
          info.limit = limit
          explicitRetrying = true
          run(() => loader.loadMore(++windowOperation))
          explicitRetrying = false
          await flush()
          break
        }
        // The last installed row's order value becomes unexpressible, or
        // expressible again; the source delivers it as an order change.
        case `unexpressibleBoundary`:
          boundaryUnexpressible = !boundaryUnexpressible
          if (boundaryUnexpressible) unexpressibleBoundaries++
          loader.invalidateSourceOrdering()
          graphPass()
          await flush()
          break
        case `joinedBusy`:
          joinedPending = true
          break
        // Joined work finishes; the subscriber runs the deferred pass.
        case `joinedIdle`:
          if (joinedPending && testCase.joined) joinedDeferrals++
          joinedPending = false
          graphPass()
          await flush()
          break
        case `truncate`:
          truncate()
          break
        case `replaySucceeds`:
          if (!replayPending()) break
          settleReplay()
          graphPass()
          await flush()
          break
        case `replayFails`:
          if (replayPending()) {
            replayFailures++
            replayFailedSinceTruncate = true
          }
          break
        // An optimistic overlay hides the window's row, so the loader must
        // refill it from the source.
        case `optimisticDeparture`:
          optimisticDepartures++
          loader.onSourceChanges(
            [{ type: `delete`, key: 1, value: { id: 1, rank: 1 } }],
            sentRows,
            () => true,
          )
          graphPass()
          await flush()
          break
        case `sourceDelete`:
          sourceDeletes++
          loader.onSourceChanges(
            [{ type: `delete`, key: 1, value: { id: 1, rank: 1 } }],
            sentRows,
            () => false,
          )
          if (command.react) graphPass()
          await flush()
          break
        case `startThrows`:
          throwNextStart = true
          break
        // A superseded request fails (the oldest, if none is), and the read
        // the loader starts to recover it throws while it starts.
        case `failOldestThrowingRecovery`: {
          const open = inflight()
          const request = open.find(({ superseded }) => superseded) ?? open[0]
          if (!request) break
          throwNextStart = true
          await settle(request, false)
          throwNextStart = false
          break
        }
        case `dispose`:
          if (!disposed) {
            disposed = true
            disposals++
            loader.dispose()
          }
          break
        // The provider never answers the oldest open request.
        case `hang`: {
          const request = inflight()[0]
          if (request) {
            request.hung = true
            hungRequests++
          }
          break
        }
        case `timer`: {
          if (!testCase.retryTimer) break
          const before = ledger.length
          await vi.advanceTimersByTimeAsync(60_000)
          await flush()
          if (ledger.length > before) timerRetries++
          break
        }
      }
      checkHeld(`after step ${step}`)
    }
    await drain()
    checkHeld(`after the drain`)
    // A disposed loader owes nothing more; the drain above settled what it
    // had issued, and the dispose law has judged those settlements.
    if (!disposed) {
      const lastFull = ledger.reduce(
        (last, request) =>
          request.fullSource && request.outcome === `ok` ? request.index : last,
        -1,
      )
      // Each superseded failure is checked against the full-source reads issued
      // before it. When no own failure happened since the last of those, the
      // failure law does not excuse a block, so a later full-source read must
      // have recovered it.
      for (const failed of ledger.filter(
        (request) =>
          request.outcome === `failed` &&
          request.superseded &&
          request.index >= replayOwnedBefore,
      )) {
        const base = ledger.reduce(
          (last, request) =>
            request.fullSource &&
            request.outcome === `ok` &&
            request.index < failed.index
              ? request.index
              : last,
          -1,
        )
        if (ownFailureSince(base)) continue
        checkedStrandPremises++
        // A recovery read that the provider never answers still started, and a
        // hung repair still owes the full-source read it restarts as.
        const recovered = ledger.some(
          (request) =>
            (request.fullSource &&
              request.index > failed.index &&
              request.outcome === `ok`) ||
            (request.hung && request.authoritative),
        )
        if (!recovered) {
          throw new Error(
            `no strand: superseded request ${failed.index} failed, and no full-source read recovered it without an explicit retry`,
          )
        }
      }
      if (ownFailureSince(lastFull)) {
        // A retry whose release callback throws reports that error; the next
        // explicit retry recovers (the failed-release contract above).
        // A retry whose request throws while it starts is the loader's own
        // failure again, so the next explicit retry recovers it.
        for (let attempt = 0; attempt < 3; attempt++) {
          const before = ledger.length
          startThrewDuringRetry = false
          explicitRetrying = true
          run(() => loader.loadMore(++windowOperation))
          explicitRetrying = false
          await flush()
          if (ledger.length > before && !retryStartThrew()) break
        }
        await drain()
        checkHeld(`after the explicit retry`)
      }
      const authority = lastAuthoritativeSuccess()
      const leaked = ledger.filter(
        (request) =>
          request.outcome === `ok` &&
          !request.released &&
          request.index >= replayOwnedBefore &&
          !replayCoverage.has(request) &&
          request.index < authority,
      )
      // A chain left unfinished by a hung request has not retired anything yet.
      const unfinishedChain = ledger.some(
        (request) =>
          request.hung && request.authoritative && request.index > authority,
      )
      // A release during the retry can dispose the loader; it owes nothing more.
      if (
        !isDisposed() &&
        authority >= 0 &&
        !unfinishedChain &&
        leaked.length > 0
      ) {
        throw new Error(
          `no leak: requests ${JSON.stringify(leaked.map(({ index }) => index))} are still held after authoritative request ${authority} succeeded`,
        )
      }
      // A superseded request's failure owes only a full-source read; once one
      // issued after it succeeds, or a covering replay settles after it, its
      // lease is retired without a retry.
      const heldFailures = ledger.filter(
        (failed) =>
          failed.outcome === `failed` &&
          failed.superseded &&
          !failed.released &&
          // A covering replay that settles after a live failure retires its
          // superseded lease, even one issued before the truncate.
          ((replayAuthority > failed.index &&
            failed.failedTruncates === failed.issuedTruncates &&
            replaySettledAt > failed.failedAt) ||
            (failed.index >= replayOwnedBefore &&
              ledger.some(
                (request) =>
                  request.fullSource &&
                  request.index > failed.index &&
                  request.outcome === `ok`,
              ))),
      )
      if (!isDisposed() && heldFailures.length > 0) {
        throw new Error(
          `no leak: superseded failed requests ${JSON.stringify(heldFailures.map(({ index }) => index))} are still held after a full-source read recovered them`,
        )
      }
      // Progress: once loading is quiet, an invalidation and an ordinary pass
      // issue a read, unless a full-source read covers the source.
      const lastRead = lastAuthoritativeRead()
      const coveredByFullSource =
        replayCoverage.size > 0 ||
        (lastRead >= 0 && ledger[lastRead]!.fullSource)
      // The loader has no request timeout, so a hung authoritative request may
      // hold its work slot. A hung finite request must not block the repair.
      const hungAuthority = ledger.some(
        (request) => request.hung && request.authoritative,
      )
      if (!coveredByFullSource && !hungAuthority && !isDisposed()) {
        const before = ledger.length
        const movesBefore = epochMoves
        loader.invalidateSourceOrdering()
        run(() => loader.loadMore())
        await flush()
        if (ledger.length === before) {
          throw new Error(
            `progress: an invalidation after the drain issued no request`,
          )
        }
        // Cost: a full-source read is very expensive, so a repair avoids one
        // whenever a bounded read is available (ARCHITECTURE.md). That holds
        // after a settled request in this incarnation, for a plan that does
        // not need the full source, with an expressible boundary, unless an
        // unindexed window still needs rows past a repeated prefix (the
        // documented fallback). One repair is then one chain per ordering
        // epoch move: in this fake, a prefix, a tie, and a refill.
        await drain()
        const repair = ledger.slice(before)
        const boundedRepair =
          !testCase.requiresFullSource &&
          !boundaryUnexpressible &&
          (testCase.indexed || !testCase.needsMore) &&
          repair.every(({ outcome }) => outcome === `ok`) &&
          ledger.some(
            (request) =>
              request.outcome === `ok` &&
              !request.fullSource &&
              request.issuedTruncates === truncates,
          )
        if (boundedRepair) {
          costChecks++
          const fullRead = repair.find(({ fullSource }) => fullSource)
          if (fullRead) {
            throw new Error(
              `cost: request ${fullRead.index} read the full source although a bounded repair was available`,
            )
          }
          const authoritative = repair.filter(
            (request) => request.authoritative,
          ).length
          const chains = epochMoves - movesBefore
          if (authoritative > 3 * chains) {
            throw new Error(
              `cost: one invalidation issued ${authoritative} authoritative requests for ${chains} epoch moves`,
            )
          }
        }
      }
    }
    await flush()
    if (
      uncaught.errors.length !== thrownReleases.length ||
      uncaught.errors.some((error, index) => error !== thrownReleases[index])
    ) {
      throw new Error(
        `uncaught release reports: expected each throwing release once, got ${uncaught.errors.map(String).join(`, `)}`,
      )
    }
  } finally {
    loader.dispose()
    for (const request of ledger) request.deferred.resolve()
    await Promise.allSettled(participants)
    if (testCase.retryTimer) vi.useRealTimers()
    uncaught.restore()
  }
  return {
    supersededFailures: ledger.filter(
      (request) => request.superseded && request.outcome === `failed`,
    ).length,
    supersededFailuresAfterRepair,
    checkedStrandPremises,
    staleSettlementsAfterRepair,
    deferredStrandShapes,
    releaseFaults,
    syncRepairs,
    invalidatingPages,
    unexpressibleBoundaries,
    joinedDeferrals,
    ignoredReportsBeforeSettle,
    ignoredReportsInsideFirstPage,
    truncates,
    replayFailures,
    optimisticDepartures,
    sourceDeletes,
    timerRetries,
    shrinkingMoves,
    reentrantTruncates,
    stackedTruncates,
    truncatesAfterFailedReplay,
    reentrantPasses,
    disposals,
    startThrows,
    startThrowsDuringFailure,
    costChecks,
    hungRequests,
    offsetWindows: testCase.offset > 0 && ledger.length > 0 ? 1 : 0,
  }
}

// The scenario flags of the later dimensions, at their ordinary values.
const ordinaryScenario = {
  requiresFullSource: false,
  joined: false,
  snapshotRows: 1,
  needsMore: true,
  retryTimer: false,
  releaseTruncates: false,
  offset: 0,
  releaseReenters: false,
  releaseDisposes: false,
} as const

const authorityProperty = `ordered-loader.request-authority`
const authorityReplay = readOracleRunConfig()
const authorityCampaigns =
  authorityReplay.replayPath === undefined
    ? ([`fixed`, `random`] as const)
    : authorityReplay.replayProperty === authorityProperty
      ? ([`replay`] as const)
      : ([] as const)

// The authority law is checked by checkAuthorityCase: it runs one generated or
// replayed history through the real loader and compares each observation with
// the request ledger. The grammar is authorityCaseArbitrary, which the campaigns
// and the calibration witnesses below read for coverage.
declareOracle({
  check: [checkAuthorityCase],
  grammar: [authorityCaseArbitrary],
})

describe(`Ordered source request authority`, () => {
  // The model's strand trace: a repair supersedes the in-flight tie and
  // finishes; a newer invalidation's reaction is deferred; the old tie fails.
  it(`recovers a superseded tie that fails after its repair finished (generated-lane replay)`, async () => {
    await checkAuthorityCase({
      indexed: true,
      limit: 1,
      settledFirst: false,
      releaseFault: false,
      syncRepair: false,
      ...ordinaryScenario,
      history: [
        { type: `settle`, pick: 0, ok: true },
        { type: `invalidate`, react: true },
        { type: `settle`, pick: 1, ok: true },
        { type: `settle`, pick: 1, ok: true },
        { type: `settle`, pick: 1, ok: true },
        { type: `invalidate`, react: false },
        { type: `settle`, pick: 0, ok: false },
      ],
    })
  })

  // Traces the generated lane found, kept as replays. Each ran through the
  // same laws and failed before its repair:
  // - a release callback throws while a repair finishes, a superseded tie
  //   fails, and an explicit window move resumes the repair (a throwing
  //   release unwound the chain mid-step, so nothing resumed it);
  // - a repair answers at once while an older tie is still in flight (the
  //   repair waited behind the superseded request, so nothing resumed it);
  // - a page's own delivery invalidates ordering (it counted as current, so
  //   its tie ran in the new epoch and was never retired);
  // - a repair prefix still in flight when a truncate replay finishes its
  //   chain and a newer invalidation starts the replacement (it took the
  //   replacement's chain tag when it settled, so nothing retired it);
  // - a replay after an explicit retry whose release throws (the replay
  //   counted the released full-source read as complete coverage, so later
  //   invalidations issued nothing);
  // - a repair tie from before a truncate that fails during the next repair
  //   (the dead failure dropped the new chain's staged step, so nothing
  //   resumed it);
  // - the same replay trace, once one request at a time was checked (the
  //   replaced chain's prefix counted as current and issued a tie beside the
  //   replacement's prefix).
  // - a repair prefix that settles after full-source coverage completed (a
  //   chain request skipped the full-coverage retirement, so it stayed held).
  // - a full-source transport that fails after a replay covered the source
  //   (complete coverage became an own failure, so a window move released
  //   the covering lease and read the source again);
  // - a repair prefix that fails after a replay finished its chain (the
  //   failure counted as the loader's own; the transition table rejected it);
  // - a backoff retry whose first release starts a truncate (the release pass
  //   kept going and released the failed demand the replay owned).
  // - a release that runs the graph during another request's settlement (the
  //   pass issued a page, and the settling request then issued its tie);
  // - a superseded failure before a truncate whose replay covers the source
  //   (only a full-source read retired superseded failed leases, so the
  //   replay left one held until a window move that an Effect never makes);
  // - a superseded failure whose recovery read throws while it starts (the
  //   start error replaced the request's own error in its participant);
  // A superseded page that fails before a covering replay settles reaches
  // the failed-lease law through a replay, which the campaigns rarely do.
  // Two replays keep traces that first failed the lane's own model: a chain
  // step it took for a chain start (an optimistic refill, and a shrunk
  // window's prefix deferred by joined work).
  it.each([
    {
      name: `a throwing release during a window move that resumes a repair`,
      testCase: {
        indexed: true,
        limit: 1,
        settledFirst: true,
        releaseFault: true,
        syncRepair: true,
        ...ordinaryScenario,
        history: [
          { type: `invalidate`, react: true },
          { type: `invalidateThenFailOldest` },
          { type: `move`, delta: 0 },
          { type: `settleNewest` },
        ],
      },
    },
    {
      name: `a repair that answers at once behind an older tie`,
      testCase: {
        indexed: true,
        limit: 1,
        settledFirst: false,
        releaseFault: false,
        syncRepair: true,
        ...ordinaryScenario,
        history: [
          { type: `settleNewest` },
          { type: `invalidate`, react: true },
          { type: `invalidate`, react: true },
          { type: `invalidate`, react: false },
        ],
      },
    },
    {
      name: `a repair prefix that settles after a replay started its replacement`,
      testCase: {
        indexed: true,
        limit: 1,
        settledFirst: true,
        releaseFault: false,
        syncRepair: false,
        ...ordinaryScenario,
        history: [
          { type: `truncate` },
          { type: `invalidate`, react: false },
          { type: `move`, delta: -1 },
          { type: `invalidate`, react: false },
        ],
      },
    },
    {
      name: `an optimistic refill inside a running repair chain`,
      testCase: {
        indexed: false,
        limit: 1,
        settledFirst: false,
        releaseFault: false,
        syncRepair: false,
        ...ordinaryScenario,
        needsMore: false,
        history: [
          { type: `settleNewest` },
          { type: `settleNewest` },
          { type: `invalidate`, react: true },
          { type: `settle`, pick: 0, ok: true },
          { type: `optimisticDeparture` },
        ],
      },
    },
    {
      name: `a replay after an explicit retry whose release throws`,
      testCase: {
        indexed: false,
        limit: 1,
        settledFirst: true,
        releaseFault: true,
        syncRepair: false,
        ...ordinaryScenario,
        history: [
          { type: `settleNewest` },
          { type: `settle`, pick: 0, ok: false },
          { type: `move`, delta: -1 },
          { type: `truncate` },
          { type: `replaySucceeds` },
        ],
      },
    },
    {
      name: `a shrunk window's prefix deferred by joined work inside a repair`,
      testCase: {
        indexed: false,
        limit: 2,
        settledFirst: true,
        releaseFault: false,
        syncRepair: true,
        ...ordinaryScenario,
        joined: true,
        needsMore: false,
        history: [
          { type: `settle`, pick: 0, ok: true },
          { type: `report`, react: true },
          { type: `joinedBusy` },
          { type: `move`, delta: -1 },
          { type: `settle`, pick: 0, ok: true },
          { type: `replaySucceeds` },
        ],
      },
    },
    {
      name: `a repair tie from before a truncate that fails during the next repair`,
      testCase: {
        indexed: true,
        limit: 1,
        settledFirst: true,
        releaseFault: false,
        syncRepair: true,
        ...ordinaryScenario,
        history: [
          { type: `syncInvalidatingPage` },
          { type: `move`, delta: -1 },
          { type: `invalidate`, react: true },
          { type: `truncate` },
          { type: `replaySucceeds` },
          { type: `settle`, pick: 0, ok: true },
          { type: `syncInvalidatingPage` },
          { type: `invalidateThenFailOldest` },
        ],
      },
    },
    {
      name: `a superseded page that fails before a covering replay settles`,
      testCase: {
        indexed: true,
        limit: 1,
        settledFirst: true,
        releaseFault: false,
        syncRepair: false,
        ...ordinaryScenario,
        history: [
          { type: `settleNewest` },
          { type: `truncate` },
          { type: `move`, delta: 0 },
          { type: `invalidate`, react: false },
          { type: `move`, delta: 0 },
          { type: `settle`, pick: 1, ok: false },
          { type: `settleNewest` },
          { type: `replaySucceeds` },
        ],
      },
    },
    {
      name: `a repair prefix that settles after full-source coverage`,
      testCase: {
        indexed: false,
        limit: 1,
        settledFirst: false,
        releaseFault: false,
        syncRepair: false,
        ...ordinaryScenario,
        needsMore: false,
        history: [
          { type: `settle`, pick: 0, ok: true },
          { type: `truncate` },
          { type: `sourceDelete`, react: false },
          { type: `move`, delta: -1 },
          { type: `failOldest` },
          { type: `replaySucceeds` },
          { type: `settleNewest` },
        ],
      },
    },
    {
      name: `a backoff retry whose first release starts a truncate`,
      testCase: {
        indexed: false,
        limit: 1,
        settledFirst: false,
        releaseFault: false,
        syncRepair: false,
        ...ordinaryScenario,
        retryTimer: true,
        releaseTruncates: true,
        history: [
          { type: `settleNewest` },
          { type: `report`, react: false },
          { type: `joinedIdle` },
          { type: `failOldest` },
          { type: `invalidateThenFailOldest` },
          { type: `timer` },
          { type: `replaySucceeds` },
        ],
      },
    },
    {
      name: `a full-source transport that fails after a replay covered the source`,
      testCase: {
        indexed: false,
        limit: 1,
        settledFirst: true,
        releaseFault: false,
        syncRepair: false,
        ...ordinaryScenario,
        history: [
          { type: `truncate` },
          { type: `move`, delta: 0 },
          { type: `settleNewest` },
          { type: `settleNewest` },
          { type: `replaySucceeds` },
          { type: `settle`, pick: 1, ok: false },
        ],
      },
    },
    {
      name: `a repair prefix that fails after a replay finished its chain`,
      testCase: {
        indexed: false,
        limit: 1,
        settledFirst: true,
        releaseFault: false,
        syncRepair: false,
        ...ordinaryScenario,
        needsMore: false,
        history: [
          { type: `report`, react: false },
          { type: `settleNewest` },
          { type: `truncate` },
          { type: `move`, delta: -1 },
          { type: `replaySucceeds` },
          { type: `failOldest` },
        ],
      },
    },
    {
      name: `a release that runs the graph during another request's settlement`,
      testCase: {
        indexed: false,
        limit: 1,
        settledFirst: false,
        releaseFault: false,
        syncRepair: false,
        ...ordinaryScenario,
        releaseReenters: true,
        history: [
          { type: `truncate` },
          { type: `replaySucceeds` },
          { type: `optimisticDeparture` },
          { type: `joinedBusy` },
        ],
      },
    },
    {
      name: `a superseded failure before a truncate whose replay covers the source`,
      testCase: {
        indexed: false,
        limit: 1,
        settledFirst: true,
        releaseFault: false,
        syncRepair: false,
        ...ordinaryScenario,
        releaseTruncates: true,
        releaseReenters: true,
        history: [
          { type: `invalidate`, react: true },
          { type: `failOldest` },
          { type: `replayFails` },
        ],
      },
    },
    {
      name: `a superseded failure whose recovery read throws while it starts`,
      testCase: {
        indexed: false,
        limit: 1,
        settledFirst: true,
        releaseFault: false,
        syncRepair: false,
        ...ordinaryScenario,
        needsMore: false,
        history: [
          { type: `report`, react: true },
          { type: `settleNewest` },
          { type: `settle`, pick: 7, ok: true },
          { type: `failOldestThrowingRecovery` },
          { type: `pass` },
        ],
      },
    },
    {
      name: `a page whose own delivery invalidates ordering`,
      testCase: {
        indexed: true,
        limit: 1,
        settledFirst: false,
        releaseFault: false,
        syncRepair: false,
        ...ordinaryScenario,
        history: [
          { type: `settle`, pick: 0, ok: true },
          { type: `syncInvalidatingPage` },
          { type: `settleNewest` },
          { type: `pass` },
          { type: `settleNewest` },
          { type: `settleNewest` },
          { type: `settle`, pick: 3, ok: true },
        ],
      },
    },
    {
      // Without the first-page check, the report repaired a window that the
      // loader's own first prefix already proves.
      name: `a report while the window is inside the loader's first page`,
      testCase: {
        indexed: false,
        limit: 1,
        settledFirst: true,
        releaseFault: false,
        syncRepair: false,
        ...ordinaryScenario,
        snapshotRows: 3,
        needsMore: false,
        history: [
          { type: `settle`, pick: 0, ok: true },
          { type: `report`, react: true },
        ],
      },
    },
    {
      // Without the settled check, a report before the first page settled
      // forced a full-source read.
      name: `a report before any request settles`,
      testCase: {
        indexed: false,
        limit: 1,
        settledFirst: false,
        releaseFault: false,
        syncRepair: false,
        ...ordinaryScenario,
        history: [{ type: `report`, react: true }],
      },
    },
  ] satisfies Array<{ name: string; testCase: AuthorityCase }>)(
    `keeps request authority for $name (generated-lane replay)`,
    async ({ testCase }) => {
      await checkAuthorityCase(testCase)
    },
  )

  it.each(authorityCampaigns)(
    `holds, retires, and recovers requests under generated settlement orders (%s campaign)`,
    async (campaign) => {
      let supersededFailures = 0
      let staleSettlementsAfterRepair = 0
      let supersededFailuresAfterRepair = 0
      let checkedStrandPremises = 0
      let deferredShapes = 0
      let releaseFaults = 0
      let syncRepairs = 0
      let invalidatingPages = 0
      const later = {
        unexpressibleBoundaries: 0,
        joinedDeferrals: 0,
        ignoredReportsBeforeSettle: 0,
        ignoredReportsInsideFirstPage: 0,
        truncates: 0,
        replayFailures: 0,
        optimisticDepartures: 0,
        sourceDeletes: 0,
        timerRetries: 0,
        shrinkingMoves: 0,
        reentrantTruncates: 0,
        stackedTruncates: 0,
        truncatesAfterFailedReplay: 0,
        reentrantPasses: 0,
        disposals: 0,
        startThrows: 0,
        startThrowsDuringFailure: 0,
        costChecks: 0,
        hungRequests: 0,
        offsetWindows: 0,
      }
      await fc.assert(
        fc.asyncProperty(authorityCaseArbitrary, async (testCase) => {
          const observation = await checkAuthorityCase(testCase)
          supersededFailures += observation.supersededFailures
          staleSettlementsAfterRepair += observation.staleSettlementsAfterRepair
          supersededFailuresAfterRepair +=
            observation.supersededFailuresAfterRepair
          checkedStrandPremises += observation.checkedStrandPremises
          deferredShapes += observation.deferredStrandShapes
          releaseFaults += observation.releaseFaults
          syncRepairs += observation.syncRepairs
          invalidatingPages += observation.invalidatingPages
          for (const key of Object.keys(later) as Array<keyof typeof later>) {
            later[key] += observation[key]
          }
        }),
        campaign === `fixed`
          ? { seed: 20261016, numRuns: oracleRuns(10000) }
          : oraclePropertyOptions(10000, authorityProperty),
      )
      // Reach witnesses: superseded requests fail, stale requests settle
      // after a repair succeeded, the strand law is checkable, a superseded
      // request fails after its repair finished while a newer invalidation's
      // reaction is deferred, a release throws, a repair answers at once,
      // and a page's own delivery invalidates ordering. Each later dimension
      // also changes loader input at least once: an unexpressible boundary,
      // deferred joined work, a truncate and a failed replay, an optimistic
      // departure, a source delete, a backoff retry that issues a read, and
      // a window that shrinks.
      if (campaign !== `replay`) {
        expect(supersededFailures).toBeGreaterThan(0)
        expect(staleSettlementsAfterRepair).toBeGreaterThan(0)
        expect(supersededFailuresAfterRepair).toBeGreaterThan(0)
        expect(checkedStrandPremises).toBeGreaterThan(0)
        expect(deferredShapes).toBeGreaterThan(0)
        expect(releaseFaults).toBeGreaterThan(0)
        expect(syncRepairs).toBeGreaterThan(0)
        expect(invalidatingPages).toBeGreaterThan(0)
        // A recovery start that throws while the loader handles a superseded
        // failure, and a report inside the loader's first page, are too rare
        // to require of every campaign; named replays reach them.
        for (const [dimension, count] of Object.entries(later)) {
          if (
            dimension === `startThrowsDuringFailure` ||
            dimension === `ignoredReportsInsideFirstPage`
          )
            continue
          expect(count, dimension).toBeGreaterThan(0)
        }
      }
    },
    120_000,
  )
})
