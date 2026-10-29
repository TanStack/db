import fc from 'fast-check'
import { describe, expect, it, vi } from 'vitest'
import {
  OrderedLoaderInvariantError,
  OrderedSourceLoader,
} from '../../src/query/live/ordered-source-loader.js'
import { PropRef } from '../../src/query/ir.js'
import { createOracleReach } from '../oracle-reach.js'
import { captureMicrotaskErrors, flushPromises } from '../utils.js'
import {
  oraclePropertyOptions,
  oracleRuns,
  readOracleRunConfig,
} from '../oracle-config.js'
import { declareOracle } from '../oracle-declaration.js'
import { createCollection } from '../../src/collection/index.js'
import { createLiveQueryCollection } from '../../src/query/index.js'
import { BTreeIndex } from '../../src/indexes/btree-index.js'
import { evaluateReferenceExpression } from '../reference-expression-oracle.js'
import {
  createDeferred,
  createOrderByInfo,
} from './ordered-source-loader-support.js'
import type { CollectionSubscription } from '../../src/collection/subscription.js'
import type { LoadSubsetOptions, SyncConfig } from '../../src/types.js'
import type {
  Observed,
  RequestOptions,
} from './ordered-source-loader-state-support.js'

// The leading order value that a tie request asks for: its `where` is
// `eq(rank, value)`. Other requests have no tie value.
function tieValue(options: RequestOptions): unknown {
  const where = options.where as
    { name?: string; args?: Array<{ value?: unknown }> } | undefined
  return where?.name === `eq` ? where.args?.[1]?.value : undefined
}

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
 *   its participant. Neither a release's cleanup error nor a read the loader
 *   starts while handling it can replace that error. A dead request's failure
 *   belongs to its replay, and one a replay reacquired is absorbed.
 * - **Cost:** once loading is quiet and a bounded repair is available, an
 *   invalidation reads no full source, and it issues at most one chain (in
 *   this fake, a prefix, a tie, and a refill) per ordering epoch move.
 * - **Ignored report:** a sync adapter's report that served pages may have
 *   shifted issues no authoritative request before any request settled: a
 *   request in flight still owes an exact result for its own options. The
 *   loader ignores the report, and so issues no request at all, while its
 *   coverage is a held full-source read since the last truncate, whatever
 *   came before (an ordering invalidation owes such coverage nothing), or,
 *   in a quiet history, while its coverage is the loader's own
 *   first ordered prefix of at least `offset + limit` rows, with only that
 *   prefix's tie after it, and a row past the page sorts strictly after its
 *   end with no more rows needed (ARCHITECTURE.md). That row is evidence
 *   only when the page read it, or when the tie the loader read is the tie
 *   of the page's end. The law judges only quiet histories: every earlier
 *   step settled a request successfully, ran a pass, inserted a row,
 *   reported, shrank the window, or changed joined work, and no release
 *   callback has side effects, so no earlier event owes a repair.
 * - **Owed repair:** a report while the loader already owes a repair
 *   repairs instead (ARCHITECTURE.md): the pass that reacts to it reads no
 *   tie or page before the repair's prefix.
 * - **Unexpressible tie:** the loader never reads the tie of a rank that no
 *   cursor can express, such as NaN or an infinity; it reads the full source
 *   or repairs instead (ARCHITECTURE.md; `canExpressCursorOrder`).
 * - **Reset:** a truncate resets ordered loading, so the first finite
 *   request after it starts at the beginning of the order, with no cursor.
 * - **Unproven report:** in such a quiet history, a report over the loader's
 *   own first prefix that no row it read proves starts a repair on its pass,
 *   or reads the tie of the page's end, which completes the proof.
 *   An installed row past the page can come from another request, and a
 *   refetch can move the page's end before the tie the loader read, so the
 *   loader cannot use either as proof.
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
 * - `headInsert` delivers a new row that sorts before every installed row,
 *   as a refetch that moved a provider row into the first page does, so the
 *   page's end moves one row earlier. The row's rank may be `-Infinity`,
 *   which no cursor can express;
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
 * The fake subscription's installed rows move only through the unexpressible
 * boundary and a head insert. Its ordered reads apply a tie's equality, a
 * cursor, and a limit as the subscription's reads do. Publication holds are outside this
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
  // `unexpressible` gives the row a rank that no cursor can express.
  | { type: `headInsert`; unexpressible?: boolean }
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
  // A source-order invalidation reenters the first retirement callback. Unlike a
  // delete caused by retirement itself, it owes a new ordering repair.
  releaseInvalidates?: boolean
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
  {
    weight: 1,
    arbitrary: fc.record({
      type: fc.constant(`headInsert` as const),
      unexpressible: fc.boolean(),
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
  ignoredReportsOverFullSource: number
  ignoredReportsOverFallback: number
  repairedReportsOnOwnPage: number
  // Reports after a refetch moved the page's end, while a repair was owed,
  // and while authoritative work was in flight.
  movedEndReports: number
  // Reports whose own first page read past a window that then shrank, and
  // reports to a disposed loader.
  reportsPastWindow: number
  reportsAfterDispose: number
  // Reports whose page's end, moved by a head insert, has no cursor.
  unexpressibleEndReports: number
  reportsOwingRepair: number
  reportsDuringWork: number
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
  releaseInvalidations: number
  replayContinuationHandoffs: number
  // Current failed requests whose participant reason reached the identity cut.
  requestErrorChecks: number
}

// Retirement cannot pay an invalidation that happened after the covering read.
// Both drivers supply only observed source events and subsequent request starts.
// The comparison does not inspect the loader's work or debt representation.
function checkRetirementProgress(
  invalidations: number,
  replaced: boolean,
): void {
  if (invalidations > 0 && !replaced) {
    throw new Error(
      `retirement invalidation: ${invalidations} adapter invalidation reached the release pass, but no new authoritative read followed it`,
    )
  }
}

type RetirementReceiverCase = {
  indexed: boolean
  limit: 1 | 2
  synchronous: boolean
}

// This receiving driver supplies the controlled ledger's premise through the
// actual Collection subscription: adapter unload changes a contributed row's
// leading order value. A finite provider keeps a later row uninstalled. Moving
// the current prefix behind it therefore requires a fresh authoritative read.
// The shared progress judgment runs after requests and graph work drain. Public
// rows are a second formulation: full provider sorting, without loader state.
async function checkRetirementReceiver(
  scenario: RetirementReceiverCase,
  reached: () => void,
): Promise<void> {
  type Row = { id: number; rank: number }
  const truth = new Map<number, Row>(
    [1, 2, 3, 4, 5].map((id) => [id, { id, rank: id }]),
  )
  const installed = new Map<number, Row>()
  const calls: Array<LoadSubsetOptions> = []
  let invalidations = 0
  let invalidatedAt = -1
  let armed = false
  let sync!: Parameters<SyncConfig<Row, number>[`sync`]>[0]
  const source = createCollection<Row, number>({
    getKey: (row) => row.id,
    syncMode: `on-demand`,
    autoIndex: scenario.indexed ? `eager` : `off`,
    defaultIndexType: BTreeIndex,
    sync: {
      sync: (operations) => {
        sync = operations
        operations.markReady()
        return {
          loadSubset: (options) => {
            calls.push(options)
            const deliver = () => {
              if (options.signal?.aborted) return true
              const matching = [...truth.values()]
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
                .sort((left, right) => left.rank - right.rank)
              const offset = options.cursor ? 0 : (options.offset ?? 0)
              const rows = matching.slice(
                offset,
                options.limit === undefined
                  ? undefined
                  : offset + options.limit,
              )
              operations.begin()
              for (const value of rows) {
                if (installed.get(value.id) === value) continue
                operations.write({
                  type: installed.has(value.id) ? `update` : `insert`,
                  value,
                })
                installed.set(value.id, value)
              }
              return operations.commit()
            }
            return scenario.synchronous
              ? deliver()
              : Promise.resolve().then(async () => {
                  await deliver()
                })
          },
          unloadSubset: () => {
            if (!armed || invalidations > 0) return
            invalidations++
            invalidatedAt = calls.length
            reached()
            // The first repair has read the next prefix. Move every row of
            // that prefix after the provider's still-uninstalled next row.
            operations.begin()
            for (let id = 2; id <= scenario.limit + 1; id++) {
              const value = { id, rank: 20 + id }
              truth.set(id, value)
              installed.set(id, value)
              operations.write({ type: `update`, value })
            }
            operations.commit()
          },
        }
      },
    },
  })
  const live = createLiveQueryCollection((q) =>
    q
      .from({ row: source })
      .orderBy(({ row }) => row.rank)
      .limit(scenario.limit)
      .select(({ row }) => ({ id: row.id, rank: row.rank })),
  )
  const publications: Array<Array<Row>> = []
  const listener = live.subscribeChanges(
    () => {
      if (armed)
        publications.push(live.toArray.map(({ id, rank }) => ({ id, rank })))
    },
    { includeInitialState: false },
  )
  try {
    await live.preload()
    armed = true
    const moved = { id: 1, rank: 10 }
    truth.set(1, moved)
    installed.set(1, moved)
    sync.begin()
    sync.write({ type: `update`, value: moved })
    await sync.commit()
    await flushPromises()
    expect(invalidations, `real subscription retirement was reached`).toBe(1)
    const failures: Array<unknown> = []
    try {
      checkRetirementProgress(
        invalidations,
        calls
          .slice(invalidatedAt)
          .some(
            (options) =>
              options.refetch === true &&
              options.where === undefined &&
              options.cursor === undefined,
          ),
      )
    } catch (error) {
      failures.push(error)
    }
    const expected = [...truth.values()]
      .sort((left, right) => left.rank - right.rank)
      .slice(0, scenario.limit)
    try {
      expect(
        live.toArray.map(({ id, rank }) => ({ id, rank })),
        `settled public window after retirement invalidation`,
      ).toEqual(expected)
    } catch (error) {
      failures.push(error)
    }
    try {
      // Both invalidations belong to one unfinished replacement. Publication
      // cannot expose the first chain's rows after its retirement moved them.
      expect(publications, `one complete replacement publication`).toEqual([
        expected,
      ])
    } catch (error) {
      failures.push(error)
    }
    if (failures.length > 0) {
      throw new AggregateError(
        failures,
        `retirement receiving comparisons: ${failures.map((error) => (error instanceof Error ? error.message : String(error))).join(`; `)}`,
        { cause: failures[0] },
      )
    }
  } finally {
    armed = false
    listener.unsubscribe()
    await live.cleanup()
    await source.cleanup()
  }
}

async function checkAuthorityCase(
  testCase: AuthorityCase,
  reached?: (
    state: `release-invalidation` | `deferred-refill` | `reset-continuation`,
  ) => void,
  observeRejection?: (reason: unknown) => unknown,
): Promise<AuthorityObservation> {
  const ledger: Array<LedgerRequest> = []
  const participants: Array<Promise<unknown>> = []
  let joinedPending = false
  let truncatePending = false
  let boundaryUnexpressible = false
  // Rows a refetch delivered before every installed row, in rank order.
  const headRows: Array<{ id: number; rank: number }> = []
  // Whether an event since the last authoritative start owes a repair: an
  // ordering invalidation, a visible delete, or an unexpressible boundary.
  let repairOwed = false
  const info = createOrderByInfo({
    limit: testCase.limit,
    ...(testCase.indexed ? {} : { index: undefined }),
    // A synchronous repair answer reads installed rows: an eager source.
    ...(testCase.syncRepair ? { sourceHoldsAllRows: true } : {}),
    requiresFullSource: testCase.requiresFullSource,
    ...(testCase.joined ? { joinedFilterSourceId: `markers` } : {}),
    // A window that needs more always needs one row, as behind a joined
    // filter that drops rows. Otherwise it needs the window's rows that do
    // not sort at or before the loaded boundary.
    dataNeeded: (boundary?: Record<string, unknown>) =>
      testCase.needsMore
        ? 1
        : Math.max(
            0,
            info.offset +
              info.limit -
              (boundary === undefined
                ? 0
                : snapshot().filter(
                    ({ value }) => value.rank <= (boundary.rank as number),
                  ).length),
          ),
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
  let requestErrorChecks = 0
  // A request may fail, but the loader's own transition table must never
  // reject a move: that is a broken rule, wherever it surfaces.
  let invariantViolation: string | undefined
  function observe(error: unknown) {
    if (error instanceof OrderedLoaderInvariantError) {
      invariantViolation ??= error.message
    }
  }
  let releaseViolation: string | undefined
  let unexpressibleTieViolation: string | undefined
  let resetViolation: string | undefined
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
  let releaseInvalidations = 0
  let retirementInvalidationAt: number | undefined
  let replayContinuationHandoffs = 0
  let syncRepairs = 0
  let invalidatingPages = 0
  // The rank each continuation's cursor starts after, so a read of its
  // acquisition's rows applies the cursor as the subscription does.
  const cursorStarts = new WeakMap<object, unknown>()
  const record = (method: Observed[`method`], options: RequestOptions) => {
    // Like the real subscription, a continuation's acquisition carries a
    // cursor, so the loader does not take it for a prefix read.
    const cursor =
      options.minValues === undefined
        ? undefined
        : ({
            whereFrom: new PropRef([`row`, `rank`]),
            whereCurrent: new PropRef([`row`, `rank`]),
          } as unknown as NonNullable<LoadSubsetOptions[`cursor`]>)
    if (cursor) cursorStarts.set(cursor, options.minValues![0])
    const acquisition: LoadSubsetOptions = {
      orderBy: options.orderBy,
      limit: options.limit,
      where: options.where,
      ...(cursor ? { cursor } : {}),
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
    // No cursor expresses a NaN or infinite rank, so the loader reads the
    // full source or repairs instead of reading that value's tie
    // (ARCHITECTURE.md; `canExpressCursorOrder`).
    // A truncate resets ordered loading (ARCHITECTURE.md), so the first
    // finite request after it starts at the beginning of the order. A cursor
    // there would continue from a boundary the truncate discarded.
    if (
      truncates > 0 &&
      !fullSource &&
      options.minValues !== undefined &&
      ledger.every(
        (other) =>
          other === request ||
          other.fullSource ||
          other.issuedTruncates !== truncates,
      )
    ) {
      resetViolation ??= `request ${request.index}, the first finite request after a truncate, continued from a cursor`
    }
    const tie = tieValue(options)
    if (typeof tie === `number` && !Number.isFinite(tie)) {
      unexpressibleTieViolation ??= `request ${request.index} read the tie of rank ${tie}, which no cursor can express`
    }
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
    if (startsAuthority(request)) {
      epochMovesAtLastStart = epochMoves
      repairOwed = false
    }
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
      if (testCase.releaseInvalidates && releaseInvalidations === 0) {
        releaseInvalidations++
        reached?.(`release-invalidation`)
        retirementInvalidationAt = ledger.length
        repairOwed = true
        loader.invalidateSourceOrdering()
      }
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
      if (ledger.length === before && request.issuedTruncates === truncates)
        continuationOwed = true
      return
    }
    if (invalidateNextPage && method === `limited` && !authoritative) {
      // The page's own delivery changes source order before it returns.
      invalidateNextPage = false
      invalidatingPages++
      repairOwed = true
      loader.invalidateSourceOrdering()
    }
    answering.push(request)
    options.onLoadSubsetResult?.(request.deferred.promise, acquisition, release)
  }
  // Installed rows in ascending rank. An unexpressible boundary makes the
  // last one NaN, which no cursor can express. A read applies a tie's
  // equality, a cursor (rows strictly after its start), and the limit, as
  // the subscription's ordered read does.
  const snapshot = (options?: LoadSubsetOptions) => {
    const tie = options === undefined ? undefined : tieValue(options)
    const after = options?.cursor && cursorStarts.get(options.cursor)
    return [
      ...headRows.map((row) => ({ type: `insert`, key: row.id, value: row })),
      ...Array.from({ length: testCase.snapshotRows }, (_, index) => ({
        type: `insert`,
        key: index + 1,
        value: {
          id: index + 1,
          rank:
            boundaryUnexpressible && index === testCase.snapshotRows - 1
              ? Number.NaN
              : index + 1,
        },
      })),
    ]
      .filter(
        ({ value }) =>
          (tie === undefined || value.rank === tie) &&
          (after === undefined || value.rank > (after as number)),
      )
      .slice(0, options?.limit)
  }
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
        result.catch((reason: unknown) =>
          rejections.set(
            request,
            observeRejection ? observeRejection(reason) : reason,
          ),
        )
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
    if (continuationOwed) {
      replayContinuationHandoffs++
      reached?.(`deferred-refill`)
    }
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
    // Replay settlement is not a graph pass. It can finish retirement while
    // joined work still owns a staged continuation; only a pass consumes it.
    run(() => loader.settleFullSourceReplay(), false)
  }
  let unexpressibleBoundaries = 0
  let joinedDeferrals = 0
  let ignoredReportsBeforeSettle = 0
  let ignoredReportsInsideFirstPage = 0
  let ignoredReportsOverFullSource = 0
  let ignoredReportsOverFallback = 0
  let repairedReportsOnOwnPage = 0
  let movedEndReports = 0
  let reportsPastWindow = 0
  let reportsAfterDispose = 0
  let unexpressibleEndReports = 0
  let reportsOwingRepair = 0
  let reportsDuringWork = 0
  // Steps that settle a request successfully, run a pass, report, or change
  // joined work. None of them owes a repair.
  const quietCommand = (command: AuthorityCommand) =>
    (command.type === `settle` && command.ok) ||
    command.type === `settleNewest` ||
    command.type === `pass` ||
    command.type === `report` ||
    command.type === `headInsert` ||
    // A window that shrinks shows only rows that were already proven.
    (command.type === `move` && command.delta === -1) ||
    command.type === `joinedBusy` ||
    command.type === `joinedIdle`
  // An unproven report whose pass pending joined work deferred: the ledger
  // index at the report and the window size it judged.
  let owedProof:
    { from: number; endRank: unknown; expressible: boolean } | undefined
  // The proof is a bounded repair or the tie of the page's end. With every
  // installed rank expressible, a full-source read is not a repair: the
  // bounded repair is available (ARCHITECTURE.md), and a full-source read is
  // the cost the report path avoids.
  const expectProofRequest = (
    from: number,
    endRank: unknown,
    expressible: boolean,
  ) => {
    const issued = ledger
      .slice(from)
      .some(
        ({ authoritative, fullSource, options }) =>
          (authoritative && (!fullSource || !expressible)) ||
          tieValue(options) === endRank,
      )
    if (!issued) {
      throw new Error(
        `unproven report: a report over a first page that no row it read proves issued no bounded repair and no tie of its end`,
      )
    }
  }
  let truncates = 0
  let replayFailures = 0
  let optimisticDepartures = 0
  let sourceDeletes = 0
  let timerRetries = 0
  let shrinkingMoves = 0
  const run = (work: () => unknown, consumesContinuation = true) => {
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
    if (consumesContinuation && ledger.length === before && !joinedPending) {
      continuationOwed = false
    }
  }
  const inflight = () =>
    ledger.filter(({ outcome, hung }) => outcome === `inflight` && !hung)
  // A truncate resets the cursor; the subscription replays its loaded
  // subsets and holds ordinary loading until the replay settles.
  // A release callback can start a truncate, so read the flag through a call.
  const replayPending = () => truncatePending
  function truncate() {
    truncates++
    // Reset discards any staged continuation. A later settlement may stage a
    // new one only for a request issued in this replay generation.
    if (continuationOwed) reached?.(`reset-continuation`)
    continuationOwed = false
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
        if (
          request.issuedTruncates === truncates &&
          !request.replayed &&
          !isDisposed()
        )
          requestErrorChecks++
        if (reason !== request.error) {
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
    if (
      chainMember &&
      request.issuedTruncates === truncates &&
      ok &&
      ledger.length === before &&
      joinedPending
    ) {
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
    if (resetViolation) {
      throw new Error(`reset ${checkpoint}: ${resetViolation}`)
    }
    if (unexpressibleTieViolation) {
      throw new Error(
        `unexpressible tie ${checkpoint}: ${unexpressibleTieViolation}`,
      )
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
      // An event outside the quiet set, such as a truncate, a failure, a
      // move, or a disposal, can change or end what a deferred report owes.
      if (owedProof && !quietCommand(command)) owedProof = undefined
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
          repairOwed = true
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
          repairOwed = true
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
            testCase.history.slice(0, step).every(quietCommand) &&
            ledger.every(({ outcome }) => outcome !== `failed`)
          const windowSize = testCase.offset + info.limit
          const [first, ...later] = ledger
          const beforeSettle = ledger.every(({ outcome }) => outcome !== `ok`)
          // The page's end is the installed row at the window's last position.
          const ranks = snapshot().map(({ value }) => value.rank)
          const endRank = ranks[windowSize - 1]
          const expressible = ranks.every((rank) => Number.isFinite(rank))
          // The loader's coverage is its own first page with only tie
          // requests after it.
          const ownFirstPage =
            !testCase.requiresFullSource &&
            !testCase.needsMore &&
            ranks.length > windowSize &&
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
          // A row past the page proves the source's next row only when the
          // page read it, or when it ties with the page's end and the loader
          // read that tie. Any other installed row can come from another
          // request, so it proves nothing, and neither does a tie of an older
          // end that a head insert moved.
          const insideFirstPage =
            ownFirstPage &&
            ((first.options.limit ?? 0) > windowSize ||
              later.some(({ options }) => tieValue(options) === endRank))
          if (ownFirstPage && (first.options.limit ?? 0) > windowSize) {
            reportsPastWindow++
          }
          if (
            ownFirstPage &&
            later.some(({ options }) => tieValue(options) !== undefined) &&
            !insideFirstPage
          ) {
            movedEndReports++
          }
          // Coverage is a held full-source read since the last truncate. It
          // owes nothing whatever came before, so this premise needs no quiet
          // history.
          const coversSource =
            !replayPending() &&
            !isDisposed() &&
            ledger.some(
              ({ fullSource, outcome, released, issuedTruncates }) =>
                fullSource &&
                outcome === `ok` &&
                !released &&
                issuedTruncates === truncates,
            )
          if (isDisposed()) reportsAfterDispose++
          if (
            ownFirstPage &&
            typeof endRank === `number` &&
            !Number.isFinite(endRank)
          ) {
            unexpressibleEndReports++
          }
          const owesRepair =
            repairOwed && !replayPending() && !isDisposed() && command.react
          if (owesRepair) reportsOwingRepair++
          if (
            ledger.some(
              ({ outcome, authoritative, hung }) =>
                outcome === `inflight` && authoritative && !hung,
            )
          ) {
            reportsDuringWork++
          }
          const before = ledger.length
          loader.revalidateLoadedCoverage()
          if (command.react) graphPass()
          await flush()
          // A report while a repair is owed repairs instead: no tie or page
          // comes before the repair's prefix.
          const firstIssued = ledger[before]
          if (owesRepair && firstIssued && !firstIssued.authoritative) {
            throw new Error(
              `owed repair: request ${firstIssued.index}, an ordinary read, came before the repair a report owed`,
            )
          }
          // A report the loader cannot prove covers nothing it could change
          // owes a repair, which its next pass starts, or a tie request for
          // the page's end, which completes the proof. Pending joined work
          // defers ordinary loading, so the pass that runs when that work
          // finishes owes the request instead.
          if (
            command.react &&
            quiet &&
            !beforeSettle &&
            ownFirstPage &&
            !insideFirstPage
          ) {
            if (joinedPending && testCase.joined) {
              owedProof = { from: before, endRank, expressible }
            } else {
              expectProofRequest(before, endRank, expressible)
              repairedReportsOnOwnPage++
            }
          }
          if (quiet && beforeSettle) {
            const issued = ledger
              .slice(before)
              .find(({ authoritative }) => authoritative)
            if (issued) {
              throw new Error(
                `ignored report: request ${issued.index} re-read the source for a report that covers nothing it could change`,
              )
            }
            ignoredReportsBeforeSettle++
          } else if ((quiet && insideFirstPage) || coversSource) {
            // The loader ignores the report, so it reads nothing for it.
            const issued = ledger[before]
            if (issued) {
              throw new Error(
                `ignored report: request ${issued.index} was read for a report over coverage that ${coversSource ? `a full-source read` : `the loader's own first page`} proves`,
              )
            }
            if (!coversSource) ignoredReportsInsideFirstPage++
            else if (testCase.requiresFullSource) ignoredReportsOverFullSource++
            // A paged loader whose boundary fell back to a full-source read.
            else ignoredReportsOverFallback++
          }
          break
        }
        // A refetch delivered a row that sorts before every installed row.
        case `headInsert`: {
          // One `-Infinity` row at most: a second would tie with it, which
          // the fake's subtraction order cannot compare.
          const unexpressible =
            command.unexpressible === true &&
            headRows.every(({ rank }) => Number.isFinite(rank))
          const row = {
            id: 1001 + headRows.length,
            rank: unexpressible
              ? Number.NEGATIVE_INFINITY
              : -1 -
                headRows.filter(({ rank }) => Number.isFinite(rank)).length,
          }
          headRows.push(row)
          headRows.sort((left, right) =>
            left.rank === right.rank ? 0 : left.rank < right.rank ? -1 : 1,
          )
          loader.onSourceChanges(
            [{ type: `insert`, key: row.id, value: row }],
            sentRows,
            () => false,
          )
          sentRows.set(row.id, row)
          graphPass()
          await flush()
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
          repairOwed = true
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
          if (owedProof) {
            expectProofRequest(
              owedProof.from,
              owedProof.endRank,
              owedProof.expressible,
            )
            owedProof = undefined
            repairedReportsOnOwnPage++
          }
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
          repairOwed = true
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
    // An invalidation delivered by adapter code during retirement is newer
    // than the repair it interrupted. Once quiet, another authoritative start
    // must have paid that debt (ARCHITECTURE, ordered recovery). The focused
    // grammar below has no failure, disposal, or further truncate to decide it.
    if (testCase.releaseInvalidates && retirementInvalidationAt !== undefined) {
      checkRetirementProgress(
        releaseInvalidations,
        ledger.slice(retirementInvalidationAt).some(startsAuthority),
      )
    }
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
        // not need the full source, with an expressible boundary. An
        // unindexed window that still needs rows grows its prefix instead
        // (ARCHITECTURE.md, "an underfilled unindexed prefix grows"). One
        // repair is then one chain per ordering epoch move: a prefix, then a
        // tie and a refill page for each boundary it reaches (ARCHITECTURE.md,
        // ordered repair). Each boundary is a different installed row, so a
        // chain issues at most one prefix plus two requests per row.
        await drain()
        const repair = ledger.slice(before)
        const boundedRepair =
          !testCase.requiresFullSource &&
          // Every installed rank is expressible, so no boundary needs the
          // full-source fallback.
          snapshot().every(({ value }) => Number.isFinite(value.rank)) &&
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
          if (authoritative > chains * (1 + 2 * snapshot().length)) {
            throw new Error(
              `cost: one invalidation issued ${authoritative} authoritative requests for ${chains} epoch moves`,
            )
          }
          // Each boundary is a different read: no chain reads the same
          // prefix, tie, or page twice.
          const reads = new Map<string, number>()
          for (const { authoritative: owed, options } of repair) {
            if (!owed) continue
            const read = JSON.stringify([
              options.limit,
              tieValue(options),
              options.minValues,
            ])
            reads.set(read, (reads.get(read) ?? 0) + 1)
          }
          for (const [read, count] of reads) {
            if (count > chains) {
              throw new Error(
                `cost: one invalidation repeated the read ${read} ${count} times for ${chains} epoch moves`,
              )
            }
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
    ignoredReportsOverFullSource,
    ignoredReportsOverFallback,
    repairedReportsOnOwnPage,
    movedEndReports,
    reportsPastWindow,
    reportsAfterDispose,
    unexpressibleEndReports,
    reportsOwingRepair,
    reportsDuringWork,
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
    releaseInvalidations,
    replayContinuationHandoffs,
    requestErrorChecks,
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
  check: [checkAuthorityCase, checkRetirementProgress, checkRetirementReceiver],
  grammar: [authorityCaseArbitrary],
})

describe(`Ordered source request authority`, () => {
  // Checker calibration changes only the recorded participant reason. Every
  // case first executes the same legal current-failure history unmodified.
  // Neither cleanup timing nor error text grants another value authority to
  // replace that failure. The existing generated authority grammar contains
  // these indexed/full-source, width, and throwing-release dimensions too.
  it.each(
    [false, true].flatMap((indexed) =>
      ([1, 2] as const).flatMap((limit) =>
        [false, true].flatMap((releaseFault) =>
          [false, true].map((requiresFullSource) => ({
            indexed,
            limit,
            releaseFault,
            requiresFullSource,
          })),
        ),
      ),
    ),
  )(
    `rejects substituted participant errors across current failures: %j`,
    async (axes) => {
      const testCase: AuthorityCase = {
        ...ordinaryScenario,
        ...axes,
        settledFirst: false,
        syncRepair: false,
        history: [{ type: `settle`, pick: 0, ok: false }],
      }
      const genuine = await checkAuthorityCase(testCase)
      if (axes.releaseFault) expect(genuine.releaseFaults).toBeGreaterThan(0)
      for (const replacement of [
        new Error(`release 0 failed`),
        new Error(`another request failed`),
        `release non-Error failure`,
      ]) {
        let substitutions = 0
        try {
          await expect(
            checkAuthorityCase(testCase, undefined, () => {
              substitutions++
              return replacement
            }),
          ).rejects.toThrow(`error identity`)
        } finally {
          expect(substitutions).toBeGreaterThan(0)
        }
      }
    },
  )

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
      // The first page and its tie settle, then joined work starts. A report
      // over the moved end stages only that end's tie, and pending joined
      // work defers it. The pass after the joined work finishes must read it;
      // a loader that dropped the staged tie read nothing.
      name: `a staged end tie that waits for joined work`,
      testCase: {
        indexed: false,
        limit: 1,
        settledFirst: true,
        releaseFault: false,
        syncRepair: false,
        ...ordinaryScenario,
        joined: true,
        snapshotRows: 3,
        needsMore: false,
        history: [
          { type: `settle`, pick: 0, ok: true },
          { type: `settleNewest` },
          { type: `joinedBusy` },
          { type: `report`, react: true },
          { type: `joinedIdle` },
        ],
      },
    },
    {
      // A truncate after a deferred unproven report hands the window to its
      // replay, so the pass after the joined work owes no repair or tie.
      name: `an unproven report whose deferred pass a truncate replaces`,
      testCase: {
        indexed: false,
        limit: 1,
        settledFirst: true,
        releaseFault: false,
        syncRepair: false,
        ...ordinaryScenario,
        joined: true,
        snapshotRows: 3,
        needsMore: false,
        history: [
          { type: `joinedBusy` },
          { type: `settle`, pick: 0, ok: true },
          { type: `report`, react: true },
          { type: `truncate` },
          { type: `joinedIdle` },
        ],
      },
    },
    {
      // Pending joined work defers the pass after an unproven report, so the
      // repair or tie that the report owes waits for that work. The pass that
      // runs when it finishes must start it. A random campaign found the law
      // judging the deferred pass instead.
      name: `an unproven report while joined work defers loading`,
      testCase: {
        indexed: false,
        limit: 1,
        settledFirst: true,
        releaseFault: false,
        syncRepair: false,
        ...ordinaryScenario,
        joined: true,
        snapshotRows: 3,
        needsMore: false,
        history: [
          { type: `joinedBusy` },
          { type: `settle`, pick: 0, ok: true },
          { type: `settleNewest` },
          { type: `report`, react: true },
          { type: `joinedIdle` },
        ],
      },
    },
    {
      // The first page read only the window, and the loader's tie request
      // read a value past it, not the page's end. An installed row past the
      // page can come from another request, so it proves nothing, and the
      // report must repair. Ignoring it kept a window that missed a row tied
      // with a refetched page's end.
      name: `a report over a first page that read only the window`,
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

  // A replay's bookkeeping call is not a pass over the graph. In this trace,
  // joined work staged a repair refill, then replay settlement retired older
  // leases before the pass resumed that refill. It remains one repair chain.
  // Source: https://github.com/TanStack/db/issues/2296
  it(`keeps a deferred repair refill in its chain after replay retirement`, async () => {
    await checkAuthorityCase({
      indexed: false,
      limit: 1,
      settledFirst: true,
      releaseFault: false,
      syncRepair: true,
      ...ordinaryScenario,
      joined: true,
      releaseTruncates: true,
      history: [
        { type: `settle`, pick: 0, ok: true },
        { type: `settle`, pick: 0, ok: true },
        { type: `report`, react: false },
        { type: `move`, delta: -1 },
        { type: `joinedBusy` },
        { type: `settleNewest` },
      ],
    })
  })

  // The broad grammar already generated the source trace. This directed
  // grammar makes its replay/continuation handoff frequent enough to measure,
  // while index-free prefix size, local rows, joined deferral, synchronous
  // answers, and release-triggered truncation vary independently. Without
  // joined deferral there is no held continuation; without the release truncate
  // there is no replay bookkeeping to distinguish from a graph pass.
  const handoffProperty = `ordered-loader.replay-continuation`
  const handoffCase = fc
    .record({
      limit: fc.constantFrom(1 as const, 2 as const),
      snapshotRows: fc.constantFrom(1 as const, 3 as const),
      syncRepair: fc.boolean(),
      joined: fc.boolean(),
      releaseTruncates: fc.boolean(),
      reset: fc.constantFrom(
        `none` as const,
        `before-settle` as const,
        `after-settle` as const,
      ),
    })
    .map(({ reset, ...axes }): AuthorityCase => ({
      ...ordinaryScenario,
      indexed: false,
      settledFirst: true,
      releaseFault: false,
      ...axes,
      history: [
        { type: `settle`, pick: 0, ok: true },
        { type: `settle`, pick: 0, ok: true },
        { type: `report`, react: false },
        { type: `move`, delta: -1 },
        { type: `joinedBusy` },
        ...(reset === `before-settle` ? [{ type: `truncate` as const }] : []),
        { type: `settleNewest` },
        ...(reset === `after-settle` ? [{ type: `truncate` as const }] : []),
      ],
    }))
  const handoffCampaigns =
    authorityReplay.replayPath === undefined
      ? ([`fixed`, `random`] as const)
      : authorityReplay.replayProperty === handoffProperty
        ? ([`replay`] as const)
        : ([] as const)
  it.each(handoffCampaigns)(
    `preserves repair continuation identity across replay bookkeeping (%s campaign)`,
    async (campaign) => {
      const reach = createOracleReach(
        handoffProperty,
        [`deferred-refill`, `reset-continuation`] as const,
        { minimum: 5 },
      )
      await fc.assert(
        fc.asyncProperty(handoffCase, async (testCase) => {
          reach.beginHistory()
          await checkAuthorityCase(testCase, (state) => {
            if (state !== `release-invalidation`) reach.reach(state)
          })
        }),
        campaign === `fixed`
          ? { seed: 20261029, numRuns: oracleRuns(200) }
          : oraclePropertyOptions(200, handoffProperty),
      )
      reach.assertReached()
      process.stderr.write(
        `${handoffProperty} ${campaign} ${JSON.stringify(Object.fromEntries(reach.counts()))}\n`,
      )
    },
  )

  // An explicit invalidation in a release callback is new source information,
  // unlike a replaced lease's own eviction deletes. It moves the ordering
  // epoch while retirement still owns the repair slot. Both synchronous and
  // asynchronous chains, indexed ties and unindexed growth must preserve it.
  const retirementProperty = `ordered-loader.retirement-invalidation`
  const retirementCase = fc
    .record({
      indexed: fc.boolean(),
      limit: fc.constantFrom(1 as const, 2 as const),
      syncRepair: fc.boolean(),
      joined: fc.boolean(),
      needsMore: fc.boolean(),
    })
    .map((axes): AuthorityCase => ({
      ...ordinaryScenario,
      ...axes,
      settledFirst: true,
      releaseFault: false,
      releaseInvalidates: true,
      history: [{ type: `invalidate`, react: true }],
    }))
  const retirementCampaigns =
    authorityReplay.replayPath === undefined
      ? ([`fixed`, `random`] as const)
      : authorityReplay.replayProperty === retirementProperty
        ? ([`replay`] as const)
        : ([] as const)
  it.each(retirementCampaigns)(
    `repairs an invalidation delivered during completed repair retirement (%s campaign)`,
    async (campaign) => {
      const reach = createOracleReach(
        retirementProperty,
        [`release-invalidation`] as const,
        { minimum: 20 },
      )
      await fc.assert(
        fc.asyncProperty(retirementCase, async (testCase) => {
          reach.beginHistory()
          await checkAuthorityCase(testCase, (state) => {
            if (state === `release-invalidation`) reach.reach(state)
          })
        }),
        campaign === `fixed`
          ? { seed: 20261029, numRuns: oracleRuns(200) }
          : oraclePropertyOptions(200, retirementProperty),
      )
      reach.assertReached()
      process.stderr.write(
        `${retirementProperty} ${campaign} ${JSON.stringify(Object.fromEntries(reach.counts()))}\n`,
      )
    },
  )

  // This driver receives the same law through real subscription and graph
  // callbacks. Index availability, window width, and literal/Promise provider
  // settlement vary; each completed history must reach the adapter callback.
  const retirementReceiverCase = fc.record({
    indexed: fc.boolean(),
    limit: fc.constantFrom(1 as const, 2 as const),
    synchronous: fc.boolean(),
  })
  it.each(retirementCampaigns)(
    `repairs retirement invalidation through a real subscription (%s campaign)`,
    async (campaign) => {
      const reach = createOracleReach(
        retirementProperty,
        [`real-subscription-release`] as const,
        { minimum: 20 },
      )
      await fc.assert(
        fc.asyncProperty(retirementReceiverCase, async (scenario) => {
          reach.beginHistory()
          await checkRetirementReceiver(scenario, () =>
            reach.reach(`real-subscription-release`),
          )
        }),
        campaign === `fixed`
          ? { seed: 20261029, numRuns: oracleRuns(200) }
          : oraclePropertyOptions(200, retirementProperty),
      )
      reach.assertReached()
      process.stderr.write(
        `${retirementProperty} receiver ${campaign} ${JSON.stringify(Object.fromEntries(reach.counts()))}\n`,
      )
    },
  )

  it(`rejects a loader that retains successful acquisitions across a covering repair`, async () => {
    const retirement = vi
      .spyOn(
        OrderedSourceLoader.prototype as unknown as {
          retireSettledFiniteAcquisitions: () => void
        },
        `retireSettledFiniteAcquisitions`,
      )
      .mockImplementation(() => {})
    try {
      await expect(
        checkAuthorityCase({
          ...ordinaryScenario,
          indexed: true,
          limit: 1,
          settledFirst: true,
          releaseFault: false,
          syncRepair: false,
          history: [{ type: `invalidate`, react: true }],
        }),
      ).rejects.toThrow(`no leak`)
    } finally {
      retirement.mockRestore()
    }
  })

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
      const identityReach = createOracleReach(authorityProperty, [
        `current-request-error`,
        `cleanup-fault-current-request-error`,
      ] as const)
      const later = {
        unexpressibleBoundaries: 0,
        joinedDeferrals: 0,
        ignoredReportsBeforeSettle: 0,
        ignoredReportsInsideFirstPage: 0,
        repairedReportsOnOwnPage: 0,
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
          identityReach.beginHistory()
          const observation = await checkAuthorityCase(testCase)
          if (observation.requestErrorChecks > 0) {
            identityReach.reach(`current-request-error`)
            if (observation.releaseFaults > 0)
              identityReach.reach(`cleanup-fault-current-request-error`)
          }
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
        identityReach.assertReached()
        process.stderr.write(
          `${authorityProperty} identity ${campaign} ${JSON.stringify(Object.fromEntries(identityReach.counts()))}\n`,
        )
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
            dimension === `ignoredReportsInsideFirstPage` ||
            dimension === `repairedReportsOnOwnPage`
          )
            continue
          expect(count, dimension).toBeGreaterThan(0)
        }
      }
    },
    120_000,
  )

  // The report laws need premises that the broad grammar rarely lines up.
  // Each history here starts with one of these prefixes over random case
  // parameters, then a random suffix:
  // - the first page and its tie settle, then a report: the window is
  //   inside the loader's own first page, so the report is ignored;
  // - the same, but a head insert first moves the page's end before the tie
  //   the loader read, so the report is unproven;
  // - an invalidation whose reaction waits, then a report that reacts: a
  //   repair is owed;
  // - an invalidation that starts its repair, then a report while that
  //   repair is in flight;
  // - a two-row window whose first page and tie settle, then shrinks to one
  //   row before a report: the page read past the window, which proves it;
  // - the moved-end prefix with the loader disposed before the report, which
  //   the dispose law then judges;
  // - the moved-end prefix with a `-Infinity` head row, so no cursor can
  //   express the page's new end;
  // - a one-row window whose page and tie settle, then a `-Infinity` head
  //   row and an invalidation: the repair's boundary has no cursor, so it
  //   falls back to a full-source read, and a report follows over it;
  // - a plan that reads only the full source, then a report over it.
  // A release that truncates or disposes would end the quiet history, so
  // no prefix allows one.
  const unprovenReportProperty = `ordered-loader.unproven-report`
  const reportPrefixes: Array<{
    history: Array<AuthorityCommand>
    fullSource?: boolean
    narrow?: boolean
    wide?: boolean
  }> = [
    {
      history: [
        { type: `settle`, pick: 0, ok: true },
        { type: `settle`, pick: 0, ok: true },
        { type: `report`, react: true },
      ],
    },
    {
      history: [
        { type: `settle`, pick: 0, ok: true },
        { type: `settle`, pick: 0, ok: true },
        { type: `headInsert` },
        { type: `report`, react: true },
      ],
    },
    {
      history: [
        { type: `settle`, pick: 0, ok: true },
        { type: `settle`, pick: 0, ok: true },
        { type: `invalidate`, react: false },
        { type: `report`, react: true },
      ],
    },
    {
      history: [
        { type: `settle`, pick: 0, ok: true },
        { type: `settle`, pick: 0, ok: true },
        { type: `invalidate`, react: true },
        { type: `report`, react: true },
      ],
    },
    {
      history: [
        { type: `settle`, pick: 0, ok: true },
        { type: `settle`, pick: 0, ok: true },
        { type: `move`, delta: -1 },
        { type: `report`, react: true },
      ],
      wide: true,
    },
    {
      history: [
        { type: `settle`, pick: 0, ok: true },
        { type: `settle`, pick: 0, ok: true },
        { type: `headInsert` },
        { type: `dispose` },
        { type: `report`, react: true },
      ],
    },
    {
      history: [
        { type: `settle`, pick: 0, ok: true },
        { type: `settle`, pick: 0, ok: true },
        { type: `headInsert`, unexpressible: true },
        { type: `report`, react: true },
      ],
      // The end is the `-Infinity` row only in a one-row window.
      narrow: true,
    },
    {
      history: [
        { type: `settle`, pick: 0, ok: true },
        { type: `settle`, pick: 0, ok: true },
        { type: `headInsert`, unexpressible: true },
        { type: `invalidate`, react: true },
        { type: `settleNewest` },
        { type: `settleNewest` },
        { type: `settleNewest` },
        { type: `report`, react: true },
      ],
      narrow: true,
    },
    { history: [{ type: `report`, react: true }], fullSource: true },
  ]
  const unprovenReportCase: fc.Arbitrary<AuthorityCase> = fc
    .tuple(
      authorityCaseArbitrary,
      fc.constantFrom(...reportPrefixes),
      fc.array(authorityCommand, { maxLength: 8 }),
    )
    .map(([testCase, prefix, rest]) => ({
      ...testCase,
      settledFirst: true,
      requiresFullSource: prefix.fullSource === true,
      ...(prefix.wide ? { limit: 2 as const, offset: 0 as const } : {}),
      ...(prefix.narrow ? { limit: 1 as const, offset: 0 as const } : {}),
      snapshotRows: 3,
      needsMore: false,
      releaseTruncates: false,
      releaseDisposes: false,
      history: [...prefix.history, ...rest],
    }))
  const unprovenReportCampaigns =
    authorityReplay.replayPath === undefined
      ? ([`fixed`, `random`] as const)
      : authorityReplay.replayProperty === unprovenReportProperty
        ? ([`replay`] as const)
        : ([] as const)

  it.each(unprovenReportCampaigns)(
    `answers each loaded-subset report as its coverage requires (%s campaign)`,
    async (campaign) => {
      // Declared reach: histories where each report law judged a report.
      const reportStates = [
        `repairedReportsOnOwnPage`,
        `ignoredReportsInsideFirstPage`,
        `ignoredReportsOverFullSource`,
        `ignoredReportsOverFallback`,
        `movedEndReports`,
        `reportsPastWindow`,
        `reportsAfterDispose`,
        `unexpressibleEndReports`,
        `reportsOwingRepair`,
        `reportsDuringWork`,
      ] as const
      const reach = createOracleReach(unprovenReportProperty, reportStates, {
        minimum: 20,
      })
      await fc.assert(
        fc.asyncProperty(unprovenReportCase, async (testCase) => {
          reach.beginHistory()
          const observation = await checkAuthorityCase(testCase)
          for (const state of reportStates) {
            if (observation[state] > 0) reach.reach(state)
          }
        }),
        campaign === `fixed`
          ? { seed: 20261023, numRuns: oracleRuns(1000) }
          : oraclePropertyOptions(1000, unprovenReportProperty),
      )
      reach.assertReached()
    },
    120_000,
  )
})
