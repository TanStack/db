import fc from 'fast-check'
import { describe, expect, it, vi } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import {
  createLiveQueryCollection,
  eq,
  isUndefined,
  not,
  toArray,
} from '../../src/query/index.js'
import { BTreeIndex } from '../../src/indexes/btree-index.js'
import { CollectionSubscription } from '../../src/collection/subscription.js'
import { createOracleReach } from '../oracle-reach.js'
import { evaluateReferenceExpression } from '../reference-expression-oracle.js'
import { flushPromises } from '../utils.js'
import {
  oraclePropertyOptions,
  oracleRuns,
  readOracleRunConfig,
} from '../oracle-config.js'
import { declareOracle } from '../oracle-declaration.js'
import type { LoadSubsetOptions, SyncConfig } from '../../src/types.js'

/**
 * # Which ordered window does a truncate replay publish?
 *
 * Contract: ARCHITECTURE.md, "Ordered requests, continuation, and recovery"
 * and the truncate-replay rules (law 9). A truncate replays the demands that
 * a subscription holds, and a failed replay keeps the prior public rows. The
 * generated ordered-window histories below are checked by `checkOrderedReplay`.
 * The fixed-scenario replay tests that compared literal row sets were moved to
 * load-subset-replay-refinement.test.ts, because their expectations were written
 * values, not a model.
 */

/**
 * # Ordered windows across truncate replays with adapter faults
 *
 * Contract: ARCHITECTURE.md, "Ordered requests, continuation, and recovery"
 * and the truncate-replay rules. An ordered live query shows the source's
 * first `limit` rows by rank. A truncate replays the demands its subscription
 * holds, and a failed replay keeps the prior public rows (law 9). A lease
 * release that throws reports its error, but it does not undo an acquisition
 * and it does not hold back the graph run that publishes a replay.
 *
 * Model: the source rows, with distinct ranks. The expected window sorts them
 * by rank and keeps the first `limit`.
 *
 * Laws, checked once loading is quiet:
 * - **Adapter release:** `unloadSubset` releases only a demand that
 *   `loadSubset` acquired, and no more often than it was acquired.
 * - **Settled window:** when no load failed, and no unload threw while a load
 *   issued after the last truncate was still unsettled, the window equals the
 *   model. An unload that throws after those loads settle is inside this law:
 *   it is a settlement-phase release, which must not hold back publication.
 *   An unload that throws while the replay starts can fail the replay, which
 *   law 9 allows, so the law does not judge that case.
 * - **Retention:** a truncate replay is one publication barrier (law 9 and
 *   "Replay participants and failure"). It rises when a source truncates and
 *   falls when its replay succeeds. Every load the source starts while its
 *   replay is open joins the barrier; a load that a newer truncate aborts or
 *   whose demand retires stops participating, and work an older replay
 *   started still holds the newer one. A participant that fails fails the
 *   replay while its logical demand is held. Once that demand retires, its
 *   failure no longer counts, and demand started meanwhile joins the
 *   replacement, which publishes when it succeeds; otherwise only a later
 *   truncate of that source can replace the failed replay. While
 *   any barrier is up, the query shows exactly the rows it showed when the
 *   first one rose: partly replayed rows, rank moves, and marker changes stay
 *   private, and a failed replay keeps that result instead of ending the
 *   query. The law is checked after every command and once loading is quiet,
 *   for barriers that rise after the query first became ready; before that
 *   there is no complete publication to keep, and initial readiness governs.
 * - **Convergence:** after a final truncate with no faults, and an explicit
 *   window move that revalidates a window whose own move failed, the window
 *   equals the model.
 * - **Newest move wins:** a superseded window move resolves only after the
 *   newest move has settled, so an awaited move reflects the window that
 *   won. A superseded move that fails still rejects with its own error.
 * - **Include children:** wherever the window law holds, each shown row's
 *   included markers equal the model's: its own marker if it is marked, and
 *   none otherwise. A windowed query routes child demand only from the rows
 *   it shows (ARCHITECTURE.md), so this also judges child loads through
 *   holds, failures, and marker truncates.
 * - **Terminal and request errors:** a load that fails before the query
 *   first becomes ready is fatal (an initial load failure), except on a lazy
 *   join source, which owns its demand; the query then stays in `error` and
 *   convergence does not apply. After initial-query readiness no load failure
 *   ends the query (ARCHITECTURE.md law 16): a failed lazy demand load is a
 *   request error on the query's own node, and the query stays `ready`. A
 *   demand load asks for keys (a `where` with no `orderBy`); either side can
 *   be the lazy one, since the planner loads an inner join's root by key when
 *   the marker source is eager. A failed load that belongs to a truncate's
 *   recovery also fails that replay, so the query keeps its last publication
 *   until a later replay of that source (law 9). Two kinds of load belong to
 *   a recovery:
 *   - a replay load, which asks again for a demand the source held before
 *     the truncate; and
 *   - a demand load that the graph starts while the truncate commits. The
 *     commit deletes the source's rows privately, so the query can demand
 *     keys that it never published, such as a row that a LEFT join filter
 *     now keeps.
 *   A load that joins an open replay belongs to it as well, which covers a
 *   demand that the graph starts after the commit while the replay still
 *   loads, from any of the query's subscriptions to that source. The model
 *   judges that only without a peer (see Limits). A load that throws while
 *   it starts, as a synchronous adapter does, is a rejection: a throw inside
 *   an open replay fails that replay. The throw happens while the
 *   subscription registers the demand, so it joins a replay only if that
 *   replay still has a participant, a failure, or no participant yet. So a
 *   query may end in `error` only after a load failed while that query was
 *   still loading. At each history cut, the query lists every request failure
 *   that the request-error account still owes, by its injected error object.
 *   After recovery replays every source, no request error stays.
 * - **Status:** with no failed load, a quiet live query and its peer are
 *   `ready`; a release that throws does not change status.
 * - **Initial readiness:** when the history starts during the initial
 *   preload, that preload has resolved or rejected once loading is quiet. A
 *   failure before the first ready ends the query, so the preload cannot wait
 *   for a later truncate.
 * - **Reported faults:** an injected fault may surface as a rejected load, a
 *   thrown release, a window move rejected by a load failure, or an error the
 *   subscription rethrows from a microtask. A window move whose load a
 *   truncate aborts may also reject with an `AbortError`. A release failure never rejects a
 *   window move. No other error may escape.
 *
 * History grammar: rank moves, holding the next loads, settling the oldest
 * or newest held load with success or failure (optionally keeping later
 * loads held),
 * truncates (optionally arming the next unload once the replay has started),
 * arming the next unload to throw, and arming the next marker load to throw
 * while it starts. An armed throw that no history load consumed expires
 * before the drain, whose loads succeed. A history may start while the initial
 * preload's loads are held. A marker load whose request was aborted either
 * resolves without writing or rejects with `AbortError`, as the source
 * contract asks; an `AbortError` is not a failed load. The driver uses a real on-demand Collection with an index and an
 * ordered live query. At the end, every held load succeeds in order.
 *
 * The joined scenarios cross a LEFT join that keeps marked or unmarked rows
 * and an inner join, over an eager marker source or one that loads markers on
 * demand through the same held and failing loads; markers change and truncate
 * through sync.
 *
 * The include scenarios add a `toArray` child that reads the marker source
 * for each shown row.
 *
 * Limits: one ordered source; no full joins (the ordered-work oracle owns
 * them); includes one level deep; and a provider that reads its rows at the time it
 * answers. A query's subscriptions to one source share one replay barrier,
 * so a load joins it whichever of them issued it. A peer is another query
 * with its own barrier, and the adapter boundary cannot tell which query
 * issued a load, so the retention law skips histories with a peer. A
 * release that throws while a replay starts may
 * fail that replay, so the retention law skips a barrier where one did.
 * A load that throws acquires nothing, so the adapter never sees its demand
 * retire, and any graph run can retire it. The retention law therefore skips
 * the marker barrier from a throw to the end of its episode (a barrier
 * raised while an earlier one in the episode is ambiguous inherits that). So
 * a design that dropped a thrown demand and let its replay succeed would pass
 * wherever only retention could see it. The request-error account judges a
 * failure in a replay by its own subscription's verdict, using the
 * subscription that each load names; publication retention stays shared
 * across the query's subscriptions to a source. It reads only the query's
 * own node and permits extra listed failures. With a peer, either query's
 * node may list a failure, and the replay-error identity law skips peer
 * histories. The replay-error identity law judges only rejections with a failure of a replay
 * the move waited on; a move that resumes into another failed replay is not
 * judged. Each subscription owns its replay verdict, even when publication
 * is shared with a sibling. Error-order comparisons keep that distinction.
 */
type OrderedFailureState =
  `initiating-keyed-request-failed` | `keyed-reacquisition-failed`

type OrderedRow = { id: number; rank: number }
type OrderedCommand =
  | { type: `move`; id: number; rank: number }
  | { type: `hold` }
  // `keepHolding` leaves later loads held, so a history can settle one load
  // while the next stays pending. `newest` settles the most recently held
  // load instead of the oldest, so a later load can settle before an earlier
  // one, as independent provider requests may.
  | { type: `settle`; ok: boolean; keepHolding?: boolean; newest?: boolean }
  | { type: `truncate`; armAfterStart: boolean }
  | { type: `unloadThrows` }
  | { type: `window`; offset: 0 | 1; limit: 1 | 2 | 3 }
  | { type: `mark`; id: number; on: boolean }
  | { type: `truncateMarkers` }
  // The next marker load throws while it starts, as an adapter that fails
  // synchronously does, instead of returning a promise that rejects.
  | { type: `markerThrows` }

// The query's order and window, whether ranks may tie, and whether a second
// live query reads the same source.
type OrderedScenario = {
  direction: `asc` | `desc`
  offset: 0 | 1
  limit: 1 | 2 | 3
  ties: boolean
  peer: boolean
  // How the query joins a marker source: none, a LEFT join that keeps marked
  // rows (`some`) or unmarked rows (`none`), or an inner join. A LEFT join
  // filter makes the order source filtered by a joined source.
  joined: false | `some` | `none` | `inner`
  // Whether the marker source holds every marker or loads them on demand,
  // sharing the history's held and failing loads.
  markerMode: `eager` | `on-demand`
  // Whether each shown row includes its markers as a `toArray` child.
  includes: boolean
  // How a marker load whose request was aborted settles. The source contract
  // asks a source to reject it with `AbortError` once its accepted rows apply;
  // a source that cannot cancel may also resolve it without writing.
  abortedMarkerLoads: `resolve` | `reject`
  // Whether the history starts while the initial preload is still held.
  historyDuringPreload: boolean
}

const orderedScenario: fc.Arbitrary<OrderedScenario> = fc.record({
  direction: fc.constantFrom(`asc` as const, `desc` as const),
  offset: fc.constantFrom(0 as const, 1 as const),
  limit: fc.constantFrom(1 as const, 2 as const, 3 as const),
  ties: fc.boolean(),
  peer: fc.boolean(),
  joined: fc.constantFrom(
    false as const,
    `some` as const,
    `none` as const,
    `inner` as const,
  ),
  markerMode: fc.constantFrom(`eager` as const, `on-demand` as const),
  includes: fc.boolean(),
  abortedMarkerLoads: fc.constantFrom(`resolve` as const, `reject` as const),
  historyDuringPreload: fc.boolean(),
})

const orderedCommand: fc.Arbitrary<OrderedCommand> = fc.oneof(
  {
    weight: 3,
    arbitrary: fc.record({
      type: fc.constant(`move` as const),
      id: fc.integer({ min: 1, max: 5 }),
      rank: fc.integer({ min: 1, max: 60 }),
    }),
  },
  { weight: 2, arbitrary: fc.constant({ type: `hold` as const }) },
  {
    weight: 3,
    arbitrary: fc.record({
      type: fc.constant(`settle` as const),
      ok: fc.oneof(
        { weight: 3, arbitrary: fc.constant(true) },
        { weight: 1, arbitrary: fc.constant(false) },
      ),
      keepHolding: fc.boolean(),
      newest: fc.boolean(),
    }),
  },
  {
    weight: 2,
    arbitrary: fc.record({
      type: fc.constant(`truncate` as const),
      // Arm the next unload once the replay has started, so it can throw
      // while the replay settles.
      armAfterStart: fc.boolean(),
    }),
  },
  { weight: 2, arbitrary: fc.constant({ type: `unloadThrows` as const }) },
  {
    weight: 1,
    arbitrary: fc.constant({ type: `truncateMarkers` as const }),
  },
  { weight: 1, arbitrary: fc.constant({ type: `markerThrows` as const }) },
  {
    weight: 2,
    arbitrary: fc.record({
      type: fc.constant(`mark` as const),
      id: fc.integer({ min: 1, max: 5 }),
      on: fc.boolean(),
    }),
  },
  {
    weight: 1,
    arbitrary: fc.record({
      type: fc.constant(`window` as const),
      offset: fc.constantFrom(0 as const, 1 as const),
      limit: fc.constantFrom(1 as const, 2 as const, 3 as const),
    }),
  },
)

type OrderedReach = {
  settlementThrows: number
  throwsAfterReplay: number
  replayStartThrows: number
  heldAcrossTruncate: number
  failedLoads: number
  settledWindowChecks: number
  tiedWindows: number
  peerChecks: number
  windowMoves: number
  descendingRuns: number
  joinedRuns: number
  includeChecks: number
  markChanges: number
  antiJoinedRuns: number
  innerJoinedRuns: number
  markerLoads: number
  markerTruncates: number
  terminalErrors: number
  // A failed load after initial-query readiness left a request error on the
  // query's own node, and the query stayed ready (ARCHITECTURE.md law 16).
  requestErrors: number
  // Cuts where the request-error account owed a request error.
  requestErrorChecks: number
  // A subscription's load succeeds while a failure of that subscription is
  // still owed.
  successWhileSubscriptionOwes: number
  // Deferred window moves that rejected with a failure of a replay they
  // waited on.
  deferredMoveRejections: number
  ownReplayFailureComparisons: number
  siblingReplayFailureComparisons: number
  siblingSuccessfulCoverage: number
  replayLoads: number
  abortRejections: number
  preloadChecks: number
  heldPublicationChecks: number
  retainedFailedReplays: number
  participantDemandFailures: number
  includeDemandFailures: number
  siblingDemandFailures: number
  failedSiblingDemandFailures: number
  // Lazy demand whose load threw while it started, inside its replay.
  thrownReplayDemands: number
  // A failed demand retires while another failure still holds its barrier.
  partialFailureRetirements: number
  preloadReplayFailures: number
  discardedReplayMoves: number
}

const replayDemandStates = [
  `new-demand-failed-during-marker-replay`,
  `settled-marker-demand-replay-failed`,
] as const
type ReplayDemandState = (typeof replayDemandStates)[number]

// Two demand origins fail behind the marker source's replay barrier: new
// demand that the graph starts while the marker truncate commits, and a
// settled demand that the replay asks for again. After the first ready, the
// barrier keeps the last publication for both, so neither ends the query
// (ARCHITECTURE.md, "Replay participants and failure"). Reach checks
// separately prove each premise ran.
function checkReplayDemandFailure(
  reach: OrderedReach,
  entered: ReadonlySet<ReplayDemandState>,
) {
  if (entered.size > 0)
    expect(
      reach.terminalErrors,
      `a failure behind the replay barrier is nonterminal`,
    ).toBe(0)
  // New demand that fails is a request error on the query's node.
  if (entered.has(replayDemandStates[0]))
    expect(reach.requestErrors, `ordinary failure is a request error`).toBe(1)
}

const ordinaryOrderedScenario: OrderedScenario = {
  direction: `asc`,
  offset: 0,
  limit: 2,
  ties: false,
  peer: false,
  joined: false,
  markerMode: `eager`,
  includes: false,
  abortedMarkerLoads: `resolve`,
  historyDuringPreload: false,
}

async function checkOrderedReplay(
  history: Array<OrderedCommand>,
  scenario: OrderedScenario = ordinaryOrderedScenario,
  recordReach: (state: ReplayDemandState) => void = () => {},
  recordFailureReach?: (state: OrderedFailureState) => void,
): Promise<OrderedReach> {
  const sign = scenario.direction === `asc` ? 1 : -1
  let window = { offset: scenario.offset, limit: scenario.limit }
  // The newest window move wins: an older move that settles later does not
  // restore its window.
  let latestMove = 0
  // The newest call wins, so a superseded move resolves only after the
  // newest move settles: it then reflects the window that won. A superseded
  // move that fails still rejects with its own error.
  const settledMoves = new Set<number>([0])
  // A failed move leaves the window where it was, so the newest move that
  // resolved sets it.
  const failedMoves = new Set<number>()
  const newerMoveResolved = (move: number) => {
    for (let newer = move + 1; newer <= latestMove; newer++) {
      if (settledMoves.has(newer) && !failedMoves.has(newer)) return true
    }
    return false
  }
  let moveOrderViolation: string | undefined
  let moveErrorViolation: string | undefined
  const settleMove = (move: number) => {
    if (move !== latestMove && !settledMoves.has(latestMove)) {
      moveOrderViolation ??= `window move ${move} settled before the newest move ${latestMove}`
    }
    settledMoves.add(move)
  }
  const peerWindow = { offset: scenario.offset, limit: scenario.limit }
  const truth = new Map<number, OrderedRow>(
    [1, 2, 3, 4, 5].map((id) => [id, { id, rank: id * 10 }]),
  )
  // With a joined source, only marked rows qualify; row 2 starts unmarked.
  const marked = new Set([1, 3, 4, 5])
  const eligible = (id: number) =>
    !scenario.joined ||
    (scenario.joined === `none` ? !marked.has(id) : marked.has(id))
  // Ties leave the order among equal ranks open, so the model predicts the
  // window's rank sequence. Each shown row must also carry its current rank,
  // be eligible, and appear once, so a tie cannot hide a row the filter
  // rejects.
  const expectedRanks = (shown: { offset: number; limit: number }) =>
    [...truth.values()]
      .filter(({ id }) => eligible(id))
      .map(({ rank }) => rank)
      .sort((left, right) => sign * (left - right))
      .slice(shown.offset, shown.offset + shown.limit)
  const checkWindow = (
    label: string,
    rows: Array<OrderedRow>,
    shown: { offset: number; limit: number },
  ) => {
    expect(
      rows.map(({ rank }) => rank),
      label,
    ).toEqual(expectedRanks(shown))
    for (const row of rows) {
      expect(row.rank, `${label}: row ${row.id} rank`).toBe(
        truth.get(row.id)?.rank,
      )
      expect(eligible(row.id), `${label}: row ${row.id} is eligible`).toBe(true)
    }
    expect(
      new Set(rows.map(({ id }) => id)).size,
      `${label}: each row once`,
    ).toBe(rows.length)
    if (new Set(rows.map(({ rank }) => rank)).size < rows.length) {
      reach.tiedWindows++
    }
    if (!scenario.includes) return
    for (const row of rows as Array<OrderedRow & { markers?: Array<number> }>) {
      expect(row.markers, `${label}: row ${row.id} markers`).toEqual(
        marked.has(row.id) ? [row.id] : [],
      )
    }
    reach.includeChecks++
  }
  const installed = new Map<number, OrderedRow>()
  // Each load records the truncate count it was issued after, so a fault can
  // be placed before or after the replay's loads settle.
  type Load = {
    epoch: number
    outcome: `pending` | `ok` | `failed`
    // The error this history injected when the load failed.
    error?: Error
    // Its source, the keys it asked for, and whether it is an ordered read.
    source?: BarrierSource
    // Publication is shared, but each subscription owns its replay verdict.
    subscription: LoadSubsetOptions[`subscription`]
    keys?: Set<number>
    ordered?: boolean
  }
  const loads: Array<Load> = []
  // Retention model. Each source with an open or failed replay has a
  // barrier. `pending` holds the loads that still hold its publication: the
  // loads started while it is up, and work an older replay started. `own`
  // holds the loads this replay started, whose failure fails it. A failure
  // is scoped to its logical demand: once that demand retires, it no longer
  // fails the replay, and demand started meanwhile joins the replacement.
  type BarrierSource = `rows` | `markers`
  type Barrier = {
    failures: Map<Load, LoadSubsetOptions>
    // Every failure of this replay, in failure order, including failures
    // whose demand later retired.
    history: Array<Load>
    // When the barrier rose, on the request-error account's clock.
    raisedAt: number
    // A release threw while this replay started, which may fail it.
    ambiguous: boolean
    pending: Map<Load, LoadSubsetOptions>
    own: Set<Load>
  }
  const barriers = new Map<BarrierSource, Barrier>()
  // Every barrier this history raised, in raise order.
  const raisedBarriers: Array<Barrier> = []
  // The rows the query showed when the first barrier rose, if it had
  // published by then. Before the first ready there is no complete
  // publication to keep, and the initial-readiness law governs.
  let retainedRows: string | undefined
  let retainedAfterReady = false
  const raiseBarrier = (source: BarrierSource) => {
    lowerSettledBarriers()
    // A newer truncate discards the replay that a pending window move waits
    // behind.
    if (barriers.size > 0 && !settledMoves.has(latestMove)) {
      reach.discardedReplayMoves++
    }
    if (barriers.size === 0) {
      retainedRows = JSON.stringify(live.toArray)
      retainedAfterReady = live.status === `ready`
    }
    const barrier: Barrier = {
      failures: new Map(),
      history: [],
      raisedAt: ++requestClock,
      // The retained publication dates from the first barrier, so an
      // ambiguous barrier earlier in this episode leaves it ambiguous.
      ambiguous: [...barriers.values()].some(({ ambiguous }) => ambiguous),
      pending: new Map(barriers.get(source)?.pending),
      own: new Set(),
    }
    barriers.set(source, barrier)
    raisedBarriers.push(barrier)
  }
  // A replay whose participants all settled without a failure publishes.
  const lowerSettledBarriers = () => {
    for (const [source, barrier] of barriers) {
      if (barrier.failures.size === 0 && barrier.pending.size === 0) {
        barriers.delete(source)
        recoveries.push({ source, raisedAt: barrier.raisedAt })
      }
    }
    if (barriers.size === 0) retainedRows = undefined
  }
  // Returns whether the load joined a replay.
  const joinBarrier = (
    source: BarrierSource,
    load: Load,
    options: LoadSubsetOptions,
  ) => {
    const barrier = barriers.get(source)
    if (!barrier) return false
    barrier.pending.set(load, options)
    barrier.own.add(load)
    return true
  }
  let replayScopeViolation: string | undefined
  const settleParticipant = (
    source: BarrierSource,
    load: Load,
    options: LoadSubsetOptions,
    ok: boolean,
  ) => {
    const barrier = barriers.get(source)
    // The replay has not failed, and other participants still load.
    const replayLoading =
      barrier !== undefined &&
      barrier.failures.size === 0 &&
      barrier.pending.has(load) &&
      barrier.pending.size > 1
    // An aborted request is obsolete demand, and a released one no longer
    // participates, so neither fails the replay.
    if (
      !ok &&
      barrier?.pending.has(load) &&
      barrier.own.has(load) &&
      !options.signal?.aborted
    ) {
      barrier.failures.set(load, options)
      barrier.history.push(load)
    }
    // A later load of the replay that loads a failed load's keys, such as
    // the retry the query starts at once, decides those keys, so that
    // failure no longer fails the replay (ARCHITECTURE.md law 17: a failure
    // counts for a key no later held load loaded).
    if (ok && barrier?.pending.has(load) && !options.signal?.aborted) {
      // Calibration of the replay account: a successful sibling can supply the
      // same source keys without deciding another subscription's verdict.
      // Preserve those failure identities independently of the mutation below.
      const siblingFailures = [...barrier.failures.keys()].filter(
        (failed) => failed.subscription !== load.subscription,
      )
      for (const failed of barrier.failures.keys()) {
        if (
          failed.subscription !== load.subscription &&
          loads.indexOf(failed) < loads.indexOf(load) &&
          failed.ordered === load.ordered &&
          failed.keys !== undefined &&
          [...failed.keys].every((key) => load.keys?.has(key))
        )
          reach.siblingSuccessfulCoverage++
        if (
          loads.indexOf(failed) < loads.indexOf(load) &&
          failed.subscription === load.subscription &&
          failed.ordered === load.ordered &&
          failed.keys !== undefined &&
          [...failed.keys].every((key) => load.keys?.has(key))
        )
          barrier.failures.delete(failed)
      }
      if (siblingFailures.some((failed) => !barrier.failures.has(failed)))
        replayScopeViolation ??= `successful sibling removed another subscription's replay failure`
    }
    barrier?.pending.delete(load)
    // A replay completes when its last participant settles, so demand that
    // starts after it does not join it.
    lowerSettledBarriers()
    return replayLoading
  }
  const retireParticipants = (
    source: BarrierSource,
    options: LoadSubsetOptions,
  ) => {
    const barrier = barriers.get(source)
    if (!barrier) return
    const failures = barrier.failures.size
    for (const owned of [barrier.pending, barrier.failures]) {
      for (const [load, held] of owned) {
        if (held === options) owned.delete(load)
      }
    }
    // One failed demand retires while another still holds the barrier.
    if (barrier.failures.size > 0 && barrier.failures.size < failures) {
      reach.partialFailureRetirements++
    }
  }
  // A query's subscriptions to one source share one replay barrier, so a
  // load belongs to it whichever subscription issued it. A peer is another
  // query with its own barrier, and the adapter boundary cannot tell which
  // query issued a load.
  const oneSubscription = (_source: BarrierSource) => !scenario.peer
  const acquired = new Map<LoadSubsetOptions, number>()
  const held: Array<(ok: boolean) => void> = []
  let holding = false
  let truncates = 0
  let throwNextUnload = false
  // Window moves whose settlement waits on held loads.
  const pendingMoves: Array<Promise<void>> = []
  // The source truncate is committing.
  let truncating = false
  let anyLoadFailed = false
  let earlyThrowSinceTruncate = false
  // The marker truncate is committing, and how many marker truncates ran.
  let markerCommitting = false
  let markerTruncates = 0
  let markerThrowArmed = false
  // A failed initial load is fatal too (error 229). The queries are created
  // below; a load can only fail after they start.
  const queries: Array<{ status: string }> = []
  // The queries that were still loading when a load failed: each may end in
  // an initial load failure.
  const failedWhileLoading = new Set<{ status: string }>()
  const noteLoadingFailure = () => {
    for (const query of queries)
      if (query.status === `loading`) failedWhileLoading.add(query)
  }
  // The driver observes each initiating keyed snapshot request's result
  // receipt and matches only the exact errors this history injected into
  // loads, so it uses no replay state, callback timing, or predicate
  // identity. A request that asks again for an established demand issues no
  // new snapshot request. The two failure premises that the keyed-request
  // campaign declares are measured this way.
  const injectedLoadFaults = new WeakSet<Error>()
  // Exact acquisition receipts, used only to measure the two failure
  // premises; this needs no referential stability of predicate expressions.
  const snapshotAcquisitions = new WeakSet<LoadSubsetOptions>()
  const initiatingRequestRejected = (error: unknown) => {
    if (error instanceof Error && injectedLoadFaults.has(error)) {
      recordFailureReach?.(`initiating-keyed-request-failed`)
    }
  }
  const requestSnapshot = CollectionSubscription.prototype.requestSnapshot
  const snapshotRequests = vi
    .spyOn(CollectionSubscription.prototype, `requestSnapshot`)
    .mockImplementation(function (this: CollectionSubscription, options) {
      if (options?.where === undefined || options.orderBy !== undefined) {
        return requestSnapshot.call(this, options)
      }
      try {
        return requestSnapshot.call(this, {
          ...options,
          onLoadSubsetResult: (result, acquisition, release) => {
            snapshotAcquisitions.add(acquisition)
            if (result instanceof Promise) {
              void result.catch(initiatingRequestRejected)
            }
            options.onLoadSubsetResult?.(result, acquisition, release)
          },
        })
      } catch (error) {
        // A load that throws outside a replay rejects its request here.
        initiatingRequestRejected(error)
        throw error
      }
    })
  // Lazy join demand asks for keys; ordered and full-source loads do not.
  // An ordered tie request also has a `where` and no `orderBy`, but it asks
  // for rows by rank, so it is not demand.
  const readsRank = (expression: unknown): boolean =>
    Array.isArray(expression)
      ? expression.some(readsRank)
      : typeof expression === `object` && expression !== null
        ? Object.entries(expression).some(([field, value]) =>
            field === `path` && Array.isArray(value)
              ? value.includes(`rank`)
              : readsRank(value),
          )
        : false
  const isDemand = (options: LoadSubsetOptions) =>
    options.where !== undefined &&
    options.orderBy === undefined &&
    !readsRank(options.where)
  // Request-error account (ARCHITECTURE.md law 16; glossary, "request
  // error"). After initial-query readiness, a failed lazy demand load is a
  // request error on the query's own node. The error stays until one of these
  // meets it:
  // - its demand retires, which aborts its request and unloads it;
  // - a later load of the source asks for some of its keys: that newer
  //   request of the demand decides them, and keys it no longer asks for
  //   left the demand (ARCHITECTURE.md law 16: a lazy demand's error clears
  //   when that demand settles or is released; a key's latest load decides
  //   it);
  // - a later load of the same source covers its keys;
  // - a replay of its source that rose after the failure completes, since a
  //   replay asks again for every held demand.
  // A failure that joins a replay waits for its subscription's verdict,
  // which comes once that subscription's participants settled, so it owes
  // no error before then. The barrier that holds publication stays shared
  // across the query's subscriptions to the source. Keys come from evaluating the request's
  // `where` over a small key domain, independent of production's bookkeeping.
  // The account combines the production concepts of a failed request and the
  // replay verdict that decides it; it names no production structure.
  let requestClock = 0
  const keyDomain = Array.from({ length: 14 }, (_, index) => index - 2)
  const requestedKeys = (source: BarrierSource, options: LoadSubsetOptions) =>
    new Set(
      keyDomain.filter(
        (id) =>
          !options.where ||
          evaluateReferenceExpression(
            options.where,
            source === `markers` ? { id, rowId: id } : { id, rank: 0 },
          ) === true,
      ),
    )
  type RequestFailure = {
    // The failed load; its injected error is the failure the node lists.
    load: Load
    source: BarrierSource
    options: LoadSubsetOptions
    keys: Set<number>
    at: number
    // The replay the load joined, whose verdict decides it.
    barrier?: Barrier
  }
  const requestFailures: Array<RequestFailure> = []
  const loadedKeys: Array<{
    source: BarrierSource
    keys: Set<number>
    at: number
  }> = []
  const recoveries: Array<{ source: BarrierSource; raisedAt: number }> = []
  const unloaded = new WeakSet<LoadSubsetOptions>()
  const allReady = () => queries.every(({ status }) => status === `ready`)
  const recordLoaded = (
    source: BarrierSource,
    keys: Set<number>,
    options: LoadSubsetOptions,
  ) => {
    // A load of a subscription succeeds while a failure of that subscription
    // that it does not cover is still owed: the state in which a hold that
    // records no failed demand could complete early.
    if (
      requestFailures.some(
        (failure) =>
          failure.source === source &&
          failure.options.subscription === options.subscription &&
          requestErrorOwed(failure) &&
          [...failure.keys].some((key) => !keys.has(key)),
      )
    )
      reach.successWhileSubscriptionOwes++
    loadedKeys.push({ source, keys, at: ++requestClock })
  }
  const recordRequestFailure = (
    load: Load,
    source: BarrierSource,
    options: LoadSubsetOptions,
    startedReady: boolean,
    participant: boolean,
  ) => {
    if (!startedReady || !allReady() || !isDemand(options)) return
    if (options.signal?.aborted) return
    requestFailures.push({
      load,
      source,
      options,
      keys: requestedKeys(source, options),
      at: ++requestClock,
      barrier: participant ? barriers.get(source) : undefined,
    })
  }
  const requestErrorOwed = (failure: RequestFailure) => {
    if (failure.options.signal?.aborted || unloaded.has(failure.options))
      return false
    // A subscription's replay fails once its own participants settled
    // (ARCHITECTURE.md law 17); only a success also waits for the query's
    // other subscriptions to the source. Each load names the subscription
    // that issued it, so the verdict waits for that subscription's loads.
    const { barrier } = failure
    if (
      barrier &&
      barriers.get(failure.source) === barrier &&
      [...barrier.pending.values()].some(
        ({ subscription }) => subscription === failure.options.subscription,
      )
    )
      return false
    const at = loads.indexOf(failure.load)
    const askedLater = loads.some(
      (later, index) =>
        index > at &&
        later.source === failure.source &&
        !later.ordered &&
        [...failure.keys].some((key) => later.keys?.has(key)),
    )
    if (askedLater) return false
    const covered = loadedKeys.some(
      (loaded) =>
        loaded.source === failure.source &&
        loaded.at > failure.at &&
        [...failure.keys].every((key) => loaded.keys.has(key)),
    )
    const recovered = recoveries.some(
      (recovery) =>
        recovery.source === failure.source && recovery.raisedAt > failure.at,
    )
    return !covered && !recovered
  }
  // The truncate count of its source when each request was first issued. A
  // replay asks again for a held demand with the same request data, because
  // request data is immutable (ARCHITECTURE.md), and a new demand builds a
  // new `where`. So a load whose `where` was first issued before its source's
  // latest truncate is a replay load.
  const firstIssued = new WeakMap<object, number>()
  // A load belongs to a recovery when it is a replay load, or when the graph
  // starts it while its source's truncate commits.
  const belongsToRecovery = (
    options: LoadSubsetOptions,
    sourceTruncates: number,
    committing: boolean,
  ) => {
    const where = options.where
    if (!where) return committing
    if (!firstIssued.has(where)) firstIssued.set(where, sourceTruncates)
    const replay = firstIssued.get(where)! < sourceTruncates
    // The campaigns require replay loads, so production that rebuilt request
    // data for a replay fails this witness instead of making every replay
    // load look like new demand.
    if (replay && isDemand(options)) reach.replayLoads++
    return committing || replay
  }
  let violation: string | undefined
  // The faults this history injects. They may surface as rejected loads, as
  // thrown releases, or as errors the subscription rethrows from a microtask,
  // which is how it reports async subscriber errors. Any other escaped error
  // is a broken law.
  const injected = new WeakSet<Error>()
  // Release faults. A cleanup failure does not fail the load it follows
  // (ARCHITECTURE.md), so a window move rejected only by one still moved.
  const cleanupFaults = new WeakSet<Error>()
  const inject = (error: Error) => {
    injected.add(error)
    return error
  }
  const injectLoad = (error: Error, options: LoadSubsetOptions) => {
    injectedLoadFaults.add(error)
    if (
      options.where !== undefined &&
      options.orderBy === undefined &&
      !snapshotAcquisitions.has(options)
    ) {
      recordFailureReach?.(`keyed-reacquisition-failed`)
    }
    return inject(error)
  }
  let escaped: unknown
  const escapedError = () => escaped
  // Adapter callbacks set these flags, so read them through a call.
  const faultExcusesWindow = () => anyLoadFailed || earlyThrowSinceTruncate
  const anyLoadFailedNow = () => anyLoadFailed
  const reach: OrderedReach = {
    settlementThrows: 0,
    throwsAfterReplay: 0,
    replayStartThrows: 0,
    heldAcrossTruncate: 0,
    failedLoads: 0,
    settledWindowChecks: 0,
    tiedWindows: 0,
    peerChecks: 0,
    windowMoves: 0,
    descendingRuns: scenario.direction === `desc` ? 1 : 0,
    joinedRuns: scenario.joined ? 1 : 0,
    includeChecks: 0,
    markChanges: 0,
    antiJoinedRuns: scenario.joined === `none` ? 1 : 0,
    innerJoinedRuns: scenario.joined === `inner` ? 1 : 0,
    markerLoads: 0,
    markerTruncates: 0,
    terminalErrors: 0,
    requestErrors: 0,
    requestErrorChecks: 0,
    successWhileSubscriptionOwes: 0,
    deferredMoveRejections: 0,
    ownReplayFailureComparisons: 0,
    siblingReplayFailureComparisons: 0,
    siblingSuccessfulCoverage: 0,
    replayLoads: 0,
    abortRejections: 0,
    preloadChecks: 0,
    heldPublicationChecks: 0,
    retainedFailedReplays: 0,
    participantDemandFailures: 0,
    includeDemandFailures: 0,
    siblingDemandFailures: 0,
    failedSiblingDemandFailures: 0,
    thrownReplayDemands: 0,
    partialFailureRetirements: 0,
    preloadReplayFailures: 0,
    discardedReplayMoves: 0,
  }
  type Marker = { id: number; rowId: number }
  let markerSync!: Parameters<SyncConfig<Marker, number>[`sync`]>[0]
  const installedMarkers = new Set<number>()
  // The query reads the marker source through a join, an include, or both.
  const readsMarkers = scenario.joined !== false || scenario.includes
  const onDemandMarkers = readsMarkers && scenario.markerMode === `on-demand`
  const markers = createCollection<Marker, number>({
    getKey: (marker) => marker.id,
    ...(onDemandMarkers
      ? { syncMode: `on-demand` as const, autoIndex: `eager` as const }
      : {}),
    defaultIndexType: BTreeIndex,
    sync: {
      sync: (operations) => {
        markerSync = operations
        if (!onDemandMarkers) {
          operations.begin()
          for (const id of marked) {
            operations.write({ type: `insert`, value: { id, rowId: id } })
            installedMarkers.add(id)
          }
          operations.commit()
          operations.markReady()
          return
        }
        operations.markReady()
        return {
          // Marker loads share the history's held and failing loads, so
          // joined work can stay pending or fail. An armed load throws while
          // it starts: it joins its source's replay like any load, fails at
          // once, and is judged by the same recovery rule as a rejection.
          loadSubset: (options) => {
            if (markerThrowArmed) {
              markerThrowArmed = false
              // A throw is a rejection (ARCHITECTURE.md): the load holds its
              // owner, whose release unloads it.
              acquired.set(options, (acquired.get(options) ?? 0) + 1)
              const load: Load = {
                subscription: options.subscription,
                epoch: truncates,
                outcome: `failed`,
                source: `markers`,
                keys: requestedKeys(`markers`, options),
              }
              loads.push(load)
              reach.markerLoads++
              // The throw happens while the subscription registers the
              // demand, so the barrier here is the replay's state then. One
              // whose participants all retired or settled has completed, and
              // the demand does not join it. A replay that no participant
              // joined yet is still starting its loads, which hold
              // publication (ARCHITECTURE.md), so a throw then joins it.
              const open = barriers.get(`markers`)
              const participant =
                open !== undefined &&
                (open.pending.size > 0 ||
                  open.failures.size > 0 ||
                  open.own.size === 0) &&
                joinBarrier(`markers`, load, options)
              // A throw that joins a replay that is only loading.
              const strict =
                participant && !open.ambiguous && open.failures.size === 0
              const recovery =
                belongsToRecovery(options, markerTruncates, markerCommitting) ||
                (participant && oneSubscription(`markers`))
              settleParticipant(`markers`, load, options, false)
              // A load that threw acquired nothing, so the adapter never sees
              // its demand retire, and any graph run can retire it. The
              // marker barrier's retention is ambiguous from here to the end
              // of its episode (see Limits).
              if (open) open.ambiguous = true
              anyLoadFailed = true
              // A throw inside a replay that is only loading.
              if (recovery && strict && isDemand(options)) {
                reach.thrownReplayDemands++
              }
              noteLoadingFailure()
              reach.failedLoads++
              const thrown = inject(new Error(`marker load threw`))
              load.error = thrown
              injectedLoadFaults.add(thrown)
              throw thrown
            }
            return (async () => {
              const startedReady = allReady()
              acquired.set(options, (acquired.get(options) ?? 0) + 1)
              const load: Load = {
                subscription: options.subscription,
                epoch: truncates,
                outcome: `pending`,
                source: `markers`,
                keys: requestedKeys(`markers`, options),
              }
              loads.push(load)
              reach.markerLoads++
              const participant = joinBarrier(`markers`, load, options)
              // Records the request's first truncate count and replay reach.
              belongsToRecovery(options, markerTruncates, markerCommitting)
              // The two demand origins behind the marker barrier: a demand
              // asked for again, while every query is ready, and new demand
              // that the graph starts while the marker truncate commits.
              const reload =
                options.where !== undefined &&
                firstIssued.get(options.where)! < markerTruncates
              const settledReplay =
                reload &&
                isDemand(options) &&
                queries.length > 0 &&
                queries.every(({ status }) => status === `ready`)
              const newDemandDuringReplay =
                !reload && markerCommitting && isDemand(options)
              if (holding) {
                const ok = await new Promise<boolean>((resolve) =>
                  held.push(resolve),
                )
                if (!ok) {
                  // The source's replay had already failed and still holds
                  // publication when this load fails.
                  const barrierFailed =
                    (barriers.get(`markers`)?.failures.size ?? 0) > 0
                  const replayLoading = settleParticipant(
                    `markers`,
                    load,
                    options,
                    false,
                  )
                  load.outcome = `failed`
                  anyLoadFailed = true
                  // A demand the graph started after the commit fails inside
                  // the replay.
                  if (
                    participant &&
                    !options.signal?.aborted &&
                    oneSubscription(`markers`) &&
                    !markerCommitting &&
                    isDemand(options)
                  ) {
                    // While other participants still load.
                    if (replayLoading) {
                      reach.participantDemandFailures++
                      if (scenario.includes) reach.includeDemandFailures++
                    }
                    // The query both joins and includes the marker source, so
                    // two of its subscriptions share the barrier.
                    if (scenario.includes && scenario.joined) {
                      reach.siblingDemandFailures++
                      // After the shared replay failed: the subscription whose
                      // demand fails may have finished its own replay.
                      if (barrierFailed) reach.failedSiblingDemandFailures++
                    }
                  }
                  if (queries.some(({ status }) => status === `loading`)) {
                    // Lazy demand in a replay failed before the first ready.
                    if (participant && isDemand(options)) {
                      reach.preloadReplayFailures++
                    }
                  }
                  noteLoadingFailure()
                  recordRequestFailure(
                    load,
                    `markers`,
                    options,
                    startedReady,
                    participant,
                  )
                  if (!options.signal?.aborted) {
                    if (newDemandDuringReplay)
                      recordReach(`new-demand-failed-during-marker-replay`)
                    if (settledReplay)
                      recordReach(`settled-marker-demand-replay-failed`)
                  }
                  reach.failedLoads++
                  load.error = injectLoad(
                    new Error(`marker load failed`),
                    options,
                  )
                  throw load.error
                }
              } else await Promise.resolve()
              if (options.signal?.aborted) {
                load.outcome = `ok`
                settleParticipant(`markers`, load, options, true)
                if (scenario.abortedMarkerLoads === `resolve`) return
                reach.abortRejections++
                throw inject(
                  Object.assign(new Error(`marker load aborted`), {
                    name: `AbortError`,
                  }),
                )
              }
              operations.begin()
              for (const id of marked) {
                const value = { id, rowId: id }
                if (
                  options.where &&
                  evaluateReferenceExpression(options.where, value) !== true
                ) {
                  continue
                }
                operations.write({
                  type: markers.has(id) ? `update` : `insert`,
                  value,
                })
                installedMarkers.add(id)
              }
              await operations.commit()
              load.outcome = `ok`
              // The load settles once its rows apply.
              settleParticipant(`markers`, load, options, true)
              recordLoaded(
                `markers`,
                requestedKeys(`markers`, options),
                options,
              )
            })()
          },
          unloadSubset: (options) => {
            unloaded.add(options)
            retireParticipants(`markers`, options)
            const count = acquired.get(options) ?? 0
            if (count === 0) {
              violation ??= `marker unloadSubset released a demand it did not hold`
            }
            acquired.set(options, count - 1)
          },
        }
      },
    },
  })
  let sync!: Parameters<SyncConfig<OrderedRow, number>[`sync`]>[0]
  const source = createCollection<OrderedRow, number>({
    getKey: (row) => row.id,
    syncMode: `on-demand`,
    autoIndex: `eager`,
    defaultIndexType: BTreeIndex,
    sync: {
      sync: (operations) => {
        sync = operations
        sync.markReady()
        return {
          loadSubset: async (options) => {
            const startedReady = allReady()
            acquired.set(options, (acquired.get(options) ?? 0) + 1)
            const load: Load = {
              subscription: options.subscription,
              epoch: truncates,
              outcome: `pending`,
              source: `rows`,
              keys: requestedKeys(`rows`, options),
              ordered: options.orderBy !== undefined,
            }
            loads.push(load)
            const participant = joinBarrier(`rows`, load, options)
            belongsToRecovery(options, truncates, truncating)
            if (holding) {
              const ok = await new Promise<boolean>((resolve) =>
                held.push(resolve),
              )
              if (!ok) {
                const replayLoading = settleParticipant(
                  `rows`,
                  load,
                  options,
                  false,
                )
                load.outcome = `failed`
                anyLoadFailed = true
                // A demand the graph started after the commit, failing
                // while its replay still loads.
                if (
                  participant &&
                  replayLoading &&
                  !options.signal?.aborted &&
                  oneSubscription(`rows`) &&
                  !truncating &&
                  isDemand(options)
                ) {
                  reach.participantDemandFailures++
                }
                if (queries.some(({ status }) => status === `loading`)) {
                  // Lazy demand in a replay failed before the first ready.
                  if (participant && isDemand(options)) {
                    reach.preloadReplayFailures++
                  }
                }
                noteLoadingFailure()
                recordRequestFailure(
                  load,
                  `rows`,
                  options,
                  startedReady,
                  participant,
                )
                reach.failedLoads++
                load.error = injectLoad(new Error(`load failed`), options)
                throw load.error
              }
            } else await Promise.resolve()
            if (options.signal?.aborted) {
              load.outcome = `ok`
              settleParticipant(`rows`, load, options, true)
              return
            }
            const rows = [...truth.values()]
              .filter(
                (row) =>
                  (!options.where ||
                    evaluateReferenceExpression(options.where, row) === true) &&
                  (!options.cursor ||
                    evaluateReferenceExpression(
                      options.cursor.whereFrom,
                      row,
                    ) === true),
              )
              .sort((left, right) => {
                const direction =
                  options.orderBy?.[0]?.compareOptions.direction === `desc`
                    ? -1
                    : 1
                return (
                  direction * (left.rank - right.rank) || left.id - right.id
                )
              })
            const offset = options.cursor ? 0 : (options.offset ?? 0)
            const selected = rows.slice(
              offset,
              options.limit === undefined ? undefined : offset + options.limit,
            )
            sync.begin()
            // A provider answers a load with every row it selects; a replay
            // after a truncate must redeliver them.
            for (const value of selected) {
              sync.write({
                type: source.has(value.id) ? `update` : `insert`,
                value,
              })
              installed.set(value.id, value)
            }
            await sync.commit()
            load.outcome = `ok`
            // The load settles once its rows apply.
            settleParticipant(`rows`, load, options, true)
            // An ordered load covers the rows it selected; a keyed load, the
            // keys it asked for.
            recordLoaded(
              `rows`,
              options.orderBy
                ? new Set(selected.map(({ id }) => id))
                : requestedKeys(`rows`, options),
              options,
            )
          },
          unloadSubset: (options) => {
            unloaded.add(options)
            retireParticipants(`rows`, options)
            const count = acquired.get(options) ?? 0
            if (count === 0) {
              violation ??= `unloadSubset released a demand it did not hold`
            }
            acquired.set(options, count - 1)
            if (!throwNextUnload) return
            throwNextUnload = false
            // A release during the replay's start, while one of its loads is
            // unsettled, may fail the replay; one after they settle may not.
            const replayUnsettled =
              truncating ||
              (truncates > 0 &&
                loads.some(
                  ({ epoch, outcome }) =>
                    epoch === truncates && outcome === `pending`,
                ))
            if (replayUnsettled) {
              earlyThrowSinceTruncate = true
              const barrier = barriers.get(`rows`)
              if (barrier) barrier.ambiguous = true
              reach.replayStartThrows++
            } else if (truncates > 0) reach.throwsAfterReplay++
            else reach.settlementThrows++
            const failure = inject(new Error(`unload failed`))
            // One during a replay's start fails that replay instead.
            if (!replayUnsettled) cleanupFaults.add(failure)
            throw failure
          },
        }
      },
    },
  })
  const query = () =>
    createLiveQueryCollection((q) => {
      const from = q.from({ row: source })
      const filtered =
        scenario.joined === `inner`
          ? from.innerJoin({ marker: markers }, ({ row, marker }) =>
              eq(row.id, marker.rowId),
            )
          : scenario.joined
            ? from
                .leftJoin({ marker: markers }, ({ row, marker }) =>
                  eq(row.id, marker.rowId),
                )
                .where(({ marker }) =>
                  scenario.joined === `none`
                    ? isUndefined(marker.rowId)
                    : not(isUndefined(marker.rowId)),
                )
            : from
      return filtered
        .orderBy(({ row }) => row.rank, scenario.direction)
        .offset(scenario.offset)
        .limit(scenario.limit)
        .select(({ row }) =>
          scenario.includes
            ? {
                id: row.id,
                rank: row.rank,
                markers: toArray(
                  q
                    .from({ child: markers })
                    .where(({ child }) => eq(child.rowId, row.id))
                    .select(({ child }) => child.id),
                ),
              }
            : { id: row.id, rank: row.rank },
        )
    })
  const live = query()
  queries.push(live)
  // A peer reads the same source; its leases must survive the first
  // query's retirements, so its window obeys the same law.
  const peer = scenario.peer ? query() : undefined
  if (peer) queries.push(peer)
  // After initial-query readiness no load failure ends the query
  // (ARCHITECTURE.md law 16), so a terminal error needs a load that failed
  // while the query was still loading: an initial load failure.
  const checkTerminal = (label: string, shown: { status: string }) => {
    expect(failedWhileLoading.has(shown), `${label}: terminal error`).toBe(true)
  }
  // At a cut, a query that has not ended lists each failure the account
  // owes among its node's open request failures, by the injected error
  // object. With a peer, the adapter cannot tell which query issued a load,
  // so either query's node may list it.
  const checkRequestErrors = (label: string) => {
    if (queries.some(({ status }) => status !== `ready`)) return
    const owed = requestFailures.filter(requestErrorOwed)
    if (owed.length === 0) return
    reach.requestErrorChecks++
    for (const failure of owed) {
      expect(
        [live, peer].some((query) =>
          query?.health.error?.errors.some(
            ({ cause }) => cause === failure.load.error,
          ),
        ),
        `${label}: request error for "${failure.load.error?.message}" on keys ${[...failure.keys].join()}`,
      ).toBe(true)
    }
  }
  // Replay error identity (ARCHITECTURE.md, "Replay participants and
  // failure"; maintainer decision): a deferred window move whose replay
  // fails rejects with that replay's own error, its earliest failure that
  // still decides it. Law 17 decides which failures count: one whose demand
  // retired, one that a later failure of the same request replaced, as a
  // retry does, and one whose keys a later load of the replay covers without
  // failing, as a demand's replacement does, no longer count. A failure of a
  // load in no waited replay is the move's own window failure after it
  // resumed, which this law does not judge.
  // The source-wide barrier combines subscriptions only for publication.
  // Their verdicts remain separate: a sibling can fail while another replay
  // still loads. Only failures of the rejecting subscription compete for its
  // earliest error. Subscription identity comes from adapter request data.
  const covers = (later: Load, earlier: Load) =>
    later.subscription === earlier.subscription &&
    later.ordered === earlier.ordered &&
    later.keys !== undefined &&
    earlier.keys !== undefined &&
    [...earlier.keys].every((key) => later.keys!.has(key))
  const stillDecides = (barrier: Barrier, earlier: Load, at: number) =>
    barrier.failures.has(earlier) &&
    barrier.history.slice(at + 1).every((later) => !covers(later, earlier)) &&
    [...barrier.own].every(
      (later) =>
        loads.indexOf(later) < loads.indexOf(earlier) ||
        later === earlier ||
        later.outcome === `failed` ||
        !covers(later, earlier),
    )
  const checkReplayError = (
    move: number,
    error: Error,
    waitedReplays: Array<Barrier>,
  ) => {
    const candidates = waitedReplays.filter(({ history }) =>
      history.some((load) => load.error === error),
    )
    if (candidates.length === 0) return
    reach.deferredMoveRejections++
    const rejected = loads.find((load) => load.error === error)!
    for (const barrier of candidates) {
      if (
        barrier.history.filter(
          (load) => load.subscription === rejected.subscription,
        ).length > 1
      )
        reach.ownReplayFailureComparisons++
      if (
        barrier.history.some(
          (load) => load.subscription !== rejected.subscription,
        )
      )
        reach.siblingReplayFailureComparisons++
    }
    const earliest = candidates.some((barrier) =>
      barrier.history
        .slice(
          0,
          barrier.history.findIndex((load) => load.error === error),
        )
        .every(
          (earlier, at) =>
            earlier.subscription !== rejected.subscription ||
            !stillDecides(barrier, earlier, at),
        ),
    )
    if (!earliest)
      moveErrorViolation ??= `move ${move} rejected with "${error.message}", not its replay's earliest failure that still decides it`
  }
  // A subscriber keeps each live query from garbage collection while a
  // history waits on held loads.
  // A history during preload starts with every load held, including the
  // loads that the first subscriber starts.
  holding = scenario.historyDuringPreload
  const subscriptions = [live, peer].flatMap((collection) =>
    collection ? [collection.subscribeChanges(() => {})] : [],
  )
  const swallow = (error: unknown) => {
    if (!(error instanceof Error && injected.has(error))) escaped ??= error
  }
  process.on(`unhandledRejection`, swallow)
  const queueMicrotask = globalThis.queueMicrotask.bind(globalThis)
  const microtasks = vi
    .spyOn(globalThis, `queueMicrotask`)
    .mockImplementation((callback) =>
      queueMicrotask(() => {
        try {
          callback()
        } catch (error) {
          swallow(error)
        }
      }),
    )
  // Retention: while a barrier is up, the query shows the rows it showed when
  // the first one rose. A query in `error` is judged by the terminal-error
  // law instead.
  const checkRetention = (label: string) => {
    lowerSettledBarriers()
    if (retainedRows === undefined || !retainedAfterReady) return
    // A source with two subscriptions has two replays, which the adapter
    // boundary cannot tell apart.
    if ([...barriers.keys()].some((barrier) => !oneSubscription(barrier))) {
      return
    }
    const raised = [...barriers.values()]
    if (raised.some(({ ambiguous }) => ambiguous)) return
    if (live.status === `error`) return
    expect(JSON.parse(JSON.stringify(live.toArray)), label).toEqual(
      JSON.parse(retainedRows),
    )
    if (raised.some(({ failures }) => failures.size > 0)) {
      reach.retainedFailedReplays++
    } else reach.heldPublicationChecks++
  }
  const settleAll = async () => {
    // Each truncate replays every retained demand of each query, so a long
    // held history can hold hundreds of loads. A load that starts another
    // without end still fails.
    for (let round = 0; round < 1000; round++) {
      await flushPromises()
      const next = held.shift()
      if (!next) return
      next(true)
    }
    throw new Error(`held loads did not drain`)
  }
  const truncate = async () => {
    truncates++
    earlyThrowSinceTruncate = false
    if (held.length > 0) reach.heldAcrossTruncate++
    installed.clear()
    raiseBarrier(`rows`)
    truncating = true
    try {
      sync.begin()
      sync.truncate()
      await sync.commit()
    } catch (error) {
      swallow(error)
    } finally {
      truncating = false
    }
  }
  // An eager marker source rewrites its rows; an on-demand one replays the
  // demand it retains.
  const truncateMarkers = async () => {
    installedMarkers.clear()
    raiseBarrier(`markers`)
    markerSync.begin()
    markerSync.truncate()
    if (!onDemandMarkers) {
      for (const id of marked) {
        markerSync.write({ type: `insert`, value: { id, rowId: id } })
        installedMarkers.add(id)
      }
    }
    markerTruncates++
    markerCommitting = true
    let receipt: true | Promise<void>
    try {
      receipt = markerSync.commit()
    } finally {
      markerCommitting = false
    }
    if (receipt !== true) await receipt
  }
  // The history's commands can interleave with the initial loads.
  let preloadSettled = false
  const preload = Promise.allSettled([live.preload(), peer?.preload()]).then(
    () => (preloadSettled = true),
  )
  try {
    if (!scenario.historyDuringPreload) await preload
    let sawRequestError = false
    for (const command of history) {
      try {
        switch (command.type) {
          case `move`: {
            const ranks = new Set(
              [...truth.values()]
                .filter(({ id }) => id !== command.id)
                .map(({ rank }) => rank),
            )
            if (!scenario.ties && ranks.has(command.rank)) break
            // With ties, ranks come from the five starting ranks, so moved
            // rows often tie with others.
            const rank = scenario.ties
              ? 10 * (1 + (command.rank % 5))
              : command.rank
            const value = { id: command.id, rank }
            // The provider delivers every source change, as a live sync does.
            truth.set(command.id, value)
            sync.begin()
            sync.write({
              type: installed.has(command.id) ? `update` : `insert`,
              value,
            })
            installed.set(command.id, value)
            await sync.commit()
            break
          }
          case `hold`:
            holding = true
            break
          case `settle`: {
            holding = command.keepHolding === true && holding
            ;(command.newest === true ? held.pop() : held.shift())?.(command.ok)
            break
          }
          case `truncate`:
            await truncate()
            if (command.armAfterStart) throwNextUnload = true
            break
          case `unloadThrows`:
            throwNextUnload = true
            break
          // A row gains or loses its marker in the joined source.
          case `mark`: {
            if (!readsMarkers || marked.has(command.id) === command.on) {
              break
            }
            reach.markChanges++
            if (command.on) marked.add(command.id)
            else marked.delete(command.id)
            // The marker provider delivers every change, as a live sync does.
            markerSync.begin()
            if (command.on) {
              markerSync.write({
                type: `insert`,
                value: { id: command.id, rowId: command.id },
              })
              installedMarkers.add(command.id)
            } else if (installedMarkers.delete(command.id)) {
              markerSync.write({ type: `delete`, key: command.id })
            }
            markerSync.commit()
            break
          }
          // The joined source truncates. An eager source redelivers every
          // marker; an on-demand one replays its loaded demands.
          case `markerThrows`:
            markerThrowArmed = true
            break
          case `truncateMarkers`: {
            if (!readsMarkers) break
            reach.markerTruncates++
            await truncateMarkers()
            break
          }
          // An explicit window move on the first query, which also retries
          // its failed requests.
          // A move that rejects, as one does after a failed source recovery,
          // leaves the window where it was. A release failure never rejects
          // a move.
          case `window`: {
            const requested = { offset: command.offset, limit: command.limit }
            reach.windowMoves++
            const move = ++latestMove
            // A move that starts before a replay's verdict waits for it, and
            // for any replay that rises before it resumes. The identity law
            // judges a move that starts before any failure of the replays it
            // waits on. A move that starts after one already failed may meet
            // a failed replay of the source at once, and that rule
            // (ARCHITECTURE.md: a failed replay rejects the move) names no
            // particular failure.
            const waited = [...barriers.values()].filter(
              ({ pending }) => pending.size > 0,
            )
            // A peer is another query over the same sources, and the adapter
            // cannot tell which query a failed load served, so peer histories
            // are not judged (see Limits).
            const judged =
              !scenario.peer &&
              waited.every(({ failures }) => failures.size === 0)
            const raisedBefore = raisedBarriers.length
            // A load that throws while it starts is a rejection
            // (ARCHITECTURE.md), so a move never throws: a throw here is an
            // escaped error.
            let settled: true | Promise<void>
            try {
              settled = live.utils.setWindow(requested)
            } catch (error) {
              escaped ??= error
              throw error
            }
            if (settled === true) {
              settleMove(move)
              window = requested
              break
            }
            const applied = settled.then(
              () => {
                settleMove(move)
                if (!newerMoveResolved(move)) window = requested
              },
              (error: unknown) => {
                settledMoves.add(move)
                failedMoves.add(move)
                // A release failure does not fail the move, so it must not
                // reject it either.
                if (error instanceof Error && cleanupFaults.has(error)) {
                  escaped ??= error
                }
                if (error instanceof Error && injectedLoadFaults.has(error)) {
                  checkReplayError(
                    move,
                    error,
                    waited.length > 0 && judged
                      ? [...waited, ...raisedBarriers.slice(raisedBefore)]
                      : [],
                  )
                }
                // A truncate never aborts a move: the move waits for any
                // replay that holds publication and then applies
                // (ARCHITECTURE.md). Only cleanup rejects a waiting move with
                // `AbortError`, and cleanup runs after the checks, so any
                // other rejection here is an injected fault or a broken law.
                swallow(error)
              },
            )
            // A held load holds the move's settlement; the end settles it.
            if (!holding && held.length === 0) await applied
            else pendingMoves.push(applied)
            break
          }
        }
      } catch (error) {
        swallow(error)
      }
      await flushPromises()
      checkRetention(`retained publication after ${command.type}`)
      checkRequestErrors(`after ${command.type}`)
      // Judge a terminal error at the history cut where it appears, before
      // final recovery can hide an incorrect transition.
      for (const shown of [live, peer]) {
        if (shown?.status === `error`) checkTerminal(`history`, shown)
      }
      // A failed load after initial-query readiness shows as a request error
      // until a later load of its data succeeds.
      if (live.status === `ready` && live.health.error !== null)
        sawRequestError = true
    }
    if (sawRequestError) reach.requestErrors++
    holding = false
    throwNextUnload = false
    // The drain is the checkpoint, where recovery loads succeed, so an
    // armed throw that no history load consumed expires with the history.
    markerThrowArmed = false
    await settleAll()
    await Promise.all(pendingMoves.splice(0))
    await settleAll()
    await flushPromises()
    // Initial readiness: once loading is quiet, the initial preload has
    // settled. It resolves when the first window is covered and rejects when
    // an initial load fails; it does not wait for a later truncate.
    if (scenario.historyDuringPreload) {
      reach.preloadChecks++
      expect(preloadSettled, `initial preload settles`).toBe(true)
    }
    if (violation) throw new Error(`adapter release: ${violation}`)
    if (moveOrderViolation) {
      throw new Error(`newest move wins: ${moveOrderViolation}`)
    }
    if (replayScopeViolation)
      throw new Error(`replay account scope: ${replayScopeViolation}`)
    if (moveErrorViolation) {
      throw new Error(`replay error identity: ${moveErrorViolation}`)
    }
    if (escapedError() !== undefined) {
      throw new Error(`escaped error: only injected faults may surface`, {
        cause: escapedError(),
      })
    }
    checkRetention(`retained publication once loading is quiet`)
    // Status: a release that throws is reported, but it fails no load, so a
    // quiet query with no failed load stays ready.
    if (!anyLoadFailedNow()) {
      expect(live.status, `status`).toBe(`ready`)
      if (peer) expect(peer.status, `peer status`).toBe(`ready`)
    }
    if (!faultExcusesWindow()) {
      reach.settledWindowChecks++
      checkWindow(`settled window`, live.toArray, window)
      if (peer) {
        reach.peerChecks++
        checkWindow(`settled peer window`, peer.toArray, peerWindow)
      }
    }
    // A failed replay keeps the last complete publication until a later
    // authoritative replay of that source (ARCHITECTURE.md), so recovery
    // replays every source.
    await truncate()
    if (readsMarkers) await truncateMarkers()
    await settleAll()
    await flushPromises()
    if (violation) throw new Error(`adapter release: ${violation}`)
    if (escapedError() !== undefined) {
      throw new Error(`escaped error: only injected faults may surface`, {
        cause: escapedError(),
      })
    }
    // A failed window operation stays private until a later explicit move
    // revalidates it (ARCHITECTURE.md), so recovery ends with one.
    const revalidated = live.utils.setWindow(window)
    if (revalidated !== true) await revalidated.catch(swallow)
    await settleAll()
    for (const [shown, label, expected] of [
      [live, `convergence`, window],
      ...(peer ? [[peer, `peer convergence`, peerWindow] as const] : []),
    ] as const) {
      if (shown.status === `error`) {
        checkTerminal(label, shown)
        reach.terminalErrors++
      } else {
        checkWindow(label, shown.toArray, expected)
        // Recovery replayed every source and revalidated the window, and each
        // success decides the request errors before it, so none stays.
        expect(shown.health.error, `${label}: stale request error`).toBeNull()
      }
    }
  } finally {
    holding = false
    for (const resolve of held.splice(0)) resolve(true)
    for (const subscription of subscriptions) subscription.unsubscribe()
    await live.cleanup().catch(swallow)
    await peer?.cleanup().catch(swallow)
    await markers.cleanup().catch(swallow)
    await flushPromises()
    process.off(`unhandledRejection`, swallow)
    microtasks.mockRestore()
    snapshotRequests.mockRestore()
  }
  return reach
}

// The check is `checkOrderedReplay`: it runs each generated history of
// ordered-window commands and adapter faults through a live query, and compares
// the published window at each checkpoint with the expectation that the history
// implies. Its expectation is computed inside the function body, not by a named
// model part yet.
declareOracle({ check: [checkOrderedReplay] })

const orderedReplayProperty = `replay.ordered-window-faults`
const orderedReplayConfig = readOracleRunConfig()
const orderedReplayCampaigns =
  orderedReplayConfig.replayPath === undefined
    ? ([`fixed`, `random`] as const)
    : orderedReplayConfig.replayProperty === orderedReplayProperty
      ? ([`replay`] as const)
      : ([] as const)

const orderedFailureProperty = `replay.keyed-request-failures`
const orderedFailureCampaigns =
  orderedReplayConfig.replayPath === undefined
    ? ([`fixed`, `random`] as const)
    : orderedReplayConfig.replayProperty === orderedFailureProperty
      ? ([`replay`] as const)
      : ([] as const)

describe(`Ordered windows across truncate replays`, () => {
  // Traces the campaigns found, kept as replays. Each failed before its fix:
  // - an unload that throws while a successful repair retires an older
  //   lease (the rejected participant counted as a failed load, so the
  //   builder held the window on the old rows);
  // - an unload that throws while a truncate replay settles (the replay's
  //   graph run was never scheduled, so the window kept the old rows);
  // - an unload that throws during a window move whose load succeeded (the
  //   builder recorded the cleanup error as the move's failure, so the
  //   window stayed private until another move);
  // - an on-demand joined source that truncates while a marker load is held
  //   (its loads finished without delivering a new row, and nothing ran the
  //   graph that the pending joined work had held, so the window stayed on
  //   old rows until an unrelated write);
  // - a window move whose joined load a truncate aborts (the model counted
  //   the move's AbortError as an escaped fault; the move now waits for the
  //   newer replay and applies, so this replay checks the moved window);
  // - a window move that retires lazy joined demand whose release throws (the
  //   subscription reported the release failure as a load error, so the move
  //   rejected with it; core now reports it uncaught);
  // - a held marker demand load that fails (after initial-query readiness a
  //   failed lazy join demand is a request error on the query's node, and the
  //   window still converges; this replay keeps that branch reached);
  // - two window moves while a load is held (the model let the older move,
  //   which settled later, restore its window; the newest move wins);
  // - an inner join whose lazy root demand load fails (either side can be
  //   lazy, and either side's failure is a request error);
  // - a window move that a deferred newer move supersedes (it resolved when
  //   its own load settled, before the newer move resumed, so awaiting it
  //   showed neither window);
  // - two window moves that a pending source recovery defers (both resumed
  //   after recovery, the older one last, so it replaced the newer window).
  it.each([
    {
      name: `a release that throws after a successful repair`,
      history: [
        { type: `unloadThrows` },
        { type: `move`, id: 2, rank: 1 },
        { type: `unloadThrows` },
      ],
    },
    {
      name: `a release that throws while a replay settles`,
      history: [
        { type: `unloadThrows` },
        { type: `truncate`, armAfterStart: false },
        { type: `move`, id: 1, rank: 21 },
        { type: `truncate`, armAfterStart: true },
      ],
    },
    {
      name: `a release that throws during a successful window move`,
      history: [
        { type: `unloadThrows` },
        { type: `hold` },
        { type: `move`, id: 1, rank: 1 },
        { type: `window`, offset: 0, limit: 1 },
        { type: `settle`, ok: true },
        { type: `move`, id: 1, rank: 41 },
        { type: `settle`, ok: true },
      ],
      scenario: { ...ordinaryOrderedScenario, limit: 1 },
    },
    {
      name: `an on-demand joined source that truncates while a marker load is held`,
      history: [
        { type: `hold` },
        { type: `move`, id: 3, rank: 1 },
        { type: `truncateMarkers` },
      ],
      scenario: {
        ...ordinaryOrderedScenario,
        limit: 1,
        joined: `some`,
        markerMode: `on-demand`,
      },
    },
    {
      name: `a window move whose joined load a truncate aborts`,
      history: [
        { type: `hold` },
        { type: `truncateMarkers` },
        { type: `window`, offset: 0, limit: 1 },
        { type: `truncate`, armAfterStart: false },
        { type: `move`, id: 1, rank: 1 },
      ],
      scenario: {
        ...ordinaryOrderedScenario,
        limit: 1,
        joined: `none`,
        markerMode: `on-demand`,
      },
      reaches: `settledWindowChecks`,
    },
    {
      name: `a window move that retires lazy joined demand whose release throws`,
      history: [
        { type: `unloadThrows` },
        { type: `truncate`, armAfterStart: true },
        { type: `truncateMarkers` },
        { type: `window`, offset: 0, limit: 1 },
        { type: `truncate`, armAfterStart: false },
      ],
      scenario: {
        ...ordinaryOrderedScenario,
        limit: 1,
        joined: `inner`,
        markerMode: `on-demand`,
      },
    },
    {
      name: `a held marker demand load that fails`,
      history: [
        { type: `hold` },
        { type: `move`, id: 1, rank: 1 },
        { type: `move`, id: 5, rank: 1 },
        // A failure settles the demand and the query retries the data at
        // once; the held retry keeps the request error visible until it
        // settles.
        { type: `settle`, ok: false, keepHolding: true },
      ],
      scenario: {
        ...ordinaryOrderedScenario,
        direction: `desc`,
        limit: 1,
        ties: true,
        joined: `some`,
        markerMode: `on-demand`,
      },
      reaches: `requestErrors`,
    },
    {
      // The marker truncate's commit moves the private window, and the
      // include starts new demand inside the marker barrier, which then
      // fails. The barrier holds it, so the query keeps its last publication.
      name: `a new include demand during another subscription's replay`,
      history: [
        { type: `hold` },
        { type: `move`, id: 1, rank: 1 },
        { type: `truncateMarkers` },
        { type: `settle`, ok: true },
        { type: `settle`, ok: false },
      ],
      scenario: {
        ...ordinaryOrderedScenario,
        limit: 1,
        joined: `none`,
        markerMode: `on-demand`,
        includes: true,
      },
      failureState: replayDemandStates[0],
      recovers: true,
    },
    {
      name: `a failed replay of settled joined demand`,
      history: [
        { type: `hold` },
        { type: `truncateMarkers` },
        { type: `settle`, ok: false },
      ],
      scenario: {
        ...ordinaryOrderedScenario,
        limit: 1,
        joined: `some`,
        markerMode: `on-demand`,
      },
      failureState: replayDemandStates[1],
      recovers: true,
    },
    {
      name: `two window moves while a load is held`,
      history: [
        { type: `hold` },
        { type: `window`, offset: 1, limit: 2 },
        { type: `window`, offset: 0, limit: 1 },
      ],
      scenario: {
        ...ordinaryOrderedScenario,
        offset: 1,
        limit: 1,
        joined: `none`,
      },
    },
    {
      name: `an inner join whose lazy root demand load fails`,
      history: [
        { type: `hold` },
        { type: `mark`, id: 2, on: true },
        { type: `settle`, ok: false },
        { type: `move`, id: 1, rank: 1 },
      ],
      scenario: { ...ordinaryOrderedScenario, limit: 1, joined: `inner` },
      reaches: `requestErrors`,
    },
    {
      name: `a window move that a deferred newer move supersedes`,
      history: [
        { type: `hold` },
        { type: `move`, id: 1, rank: 1 },
        { type: `window`, offset: 0, limit: 1 },
        { type: `truncate`, armAfterStart: false },
        { type: `window`, offset: 0, limit: 1 },
      ],
      scenario: { ...ordinaryOrderedScenario, limit: 1 },
    },
    {
      name: `two window moves that a pending source recovery defers`,
      history: [
        { type: `hold` },
        { type: `truncate`, armAfterStart: false },
        { type: `window`, offset: 1, limit: 1 },
        { type: `move`, id: 1, rank: 1 },
        { type: `truncateMarkers` },
        { type: `window`, offset: 0, limit: 1 },
        { type: `truncateMarkers` },
      ],
      scenario: {
        ...ordinaryOrderedScenario,
        limit: 1,
        joined: `none`,
        markerMode: `on-demand`,
      },
    },
    {
      // The random campaign's trace from #2224 (also reported as #2239). With
      // includes and no joined source, the failed load is new include demand
      // that the marker truncate's commit starts inside the marker barrier.
      name: `a failed include demand that a marker truncate starts`,
      history: [
        { type: `hold` },
        { type: `truncateMarkers` },
        { type: `settle`, ok: false },
      ],
      scenario: {
        ...ordinaryOrderedScenario,
        limit: 1,
        joined: `none`,
        markerMode: `on-demand`,
        includes: true,
      },
      reaches: `failedLoads`,
      failureState: replayDemandStates[0],
      recovers: true,
    },
    {
      name: `a failed include demand started from no prior demand`,
      history: [
        { type: `mark`, id: 2, on: true },
        { type: `hold` },
        { type: `truncateMarkers` },
        { type: `settle`, ok: false },
      ],
      scenario: {
        ...ordinaryOrderedScenario,
        limit: 1,
        joined: `none`,
        markerMode: `on-demand`,
        includes: true,
      },
      reaches: `failedLoads`,
    },
    {
      name: `a failed include replay before the first ready`,
      history: [
        { type: `settle`, ok: true, keepHolding: true },
        { type: `truncateMarkers` },
        { type: `settle`, ok: true, keepHolding: true },
        { type: `settle`, ok: true, keepHolding: true },
        { type: `settle`, ok: false },
      ],
      scenario: {
        ...ordinaryOrderedScenario,
        limit: 1,
        markerMode: `on-demand`,
        includes: true,
        abortedMarkerLoads: `reject`,
        historyDuringPreload: true,
      },
      reaches: `abortRejections`,
    },
    {
      name: `an aborted marker load that rejects after its replay succeeds`,
      history: [
        { type: `settle`, ok: true, keepHolding: true },
        { type: `settle`, ok: true, keepHolding: false },
        { type: `truncateMarkers` },
        { type: `unloadThrows` },
      ],
      scenario: {
        ...ordinaryOrderedScenario,
        limit: 1,
        peer: true,
        joined: `some`,
        markerMode: `on-demand`,
        abortedMarkerLoads: `reject`,
        historyDuringPreload: true,
      },
      reaches: `abortRejections`,
    },
    {
      name: `a replaced include segment whose aborted load rejects`,
      history: [
        { type: `hold` },
        { type: `truncate`, armAfterStart: false },
        { type: `move`, id: 1, rank: 1 },
        { type: `move`, id: 2, rank: 31 },
      ],
      scenario: {
        ...ordinaryOrderedScenario,
        markerMode: `on-demand`,
        includes: true,
        abortedMarkerLoads: `reject`,
      },
      reaches: `abortRejections`,
    },
    {
      name: `an include demand that fails while its replay still loads`,
      history: [
        { type: `hold` },
        { type: `truncateMarkers` },
        { type: `move`, id: 3, rank: 1 },
        { type: `settle`, ok: false, newest: true },
      ],
      scenario: {
        ...ordinaryOrderedScenario,
        markerMode: `on-demand`,
        includes: true,
      },
      reaches: `failedLoads`,
      recovers: true,
    },
    {
      // A move during the initial load waits behind a marker replay that the
      // source truncate then discards. The newer move must wait for the
      // replay that still holds publication and then apply. Before the fix,
      // the discarded replay rejected it, so the older move's window won.
      name: `a newer window move deferred behind a discarded replay`,
      history: [
        { type: `move`, id: 1, rank: 1 },
        { type: `window`, offset: 0, limit: 2 },
        { type: `truncateMarkers` },
        { type: `window`, offset: 0, limit: 1 },
        { type: `truncate`, armAfterStart: false },
      ],
      scenario: {
        ...ordinaryOrderedScenario,
        limit: 1,
        markerMode: `on-demand`,
        includes: true,
        historyDuringPreload: true,
      },
      reaches: `settledWindowChecks`,
    },
    {
      // A query that joins and includes the marker source has two marker
      // subscriptions. The truncate's commit deletes the markers privately,
      // so the join filter drops row 1 and the graph demands markers for
      // the next rows. One subscription's replay loads settle first, and
      // the new demand then fails while the other's replay still loads.
      // With one replay per subscription, that demand fell outside every
      // replay and ended the query; the source's barrier owns it.
      name: `a demand that fails while a sibling subscription's replay still loads`,
      history: [
        { type: `hold` },
        { type: `truncateMarkers` },
        { type: `settle`, ok: true, keepHolding: true },
        { type: `settle`, ok: false, newest: true, keepHolding: true },
      ],
      scenario: {
        ...ordinaryOrderedScenario,
        limit: 1,
        joined: `some`,
        markerMode: `on-demand`,
        includes: true,
      },
      reaches: `siblingDemandFailures`,
      recovers: true,
    },
    {
      // Found by the failed-replay random campaign. One subscription's
      // replay fails, the other's finishes once it settles, and a rank move
      // starts demand on that other subscription, which then fails. Its own
      // replay had finished, so a per-subscription judgment ended the query,
      // while the source's shared barrier still held the failed replay.
      name: `a demand that fails after the sibling subscription's replay failed`,
      history: [
        { type: `hold` },
        { type: `truncateMarkers` },
        { type: `settle`, ok: true, keepHolding: true, newest: false },
        { type: `settle`, ok: false, newest: true, keepHolding: true },
        { type: `move`, id: 2, rank: 1 },
        { type: `settle`, ok: false, keepHolding: false, newest: false },
      ],
      scenario: {
        ...ordinaryOrderedScenario,
        limit: 1,
        joined: `some`,
        markerMode: `on-demand`,
        includes: true,
      },
      reaches: `failedSiblingDemandFailures`,
      recovers: true,
    },
    {
      // Found by the broad random campaign at five times its run count. A
      // window move's marker load throws while the move starts, after an
      // older move that still waits. The older move's settlement returned
      // the latest request, which was still itself: a chaining cycle. A
      // throw is now a rejection, so the newer move rejects instead.
      name: `a window move whose load throws while an older move waits`,
      history: [
        { type: `window`, offset: 0, limit: 1 },
        { type: `settle`, ok: true, keepHolding: true, newest: false },
        { type: `markerThrows` },
        { type: `window`, offset: 0, limit: 2 },
        { type: `mark`, id: 1, on: false },
      ],
      scenario: {
        ...ordinaryOrderedScenario,
        limit: 3,
        joined: false,
        markerMode: `on-demand`,
        includes: true,
        historyDuringPreload: true,
      },
      reaches: `failedLoads`,
    },
    {
      // Trace 2 from a comment on #2221. The window grows to three rows while
      // loads are held, shrinks to one behind a marker replay, and a source
      // truncate then discards that replay. The deferred one-row move was
      // dropped with it, so the settled window kept three rows.
      name: `a window shrink deferred behind a replay that a truncate discards`,
      history: [
        { type: `hold` },
        { type: `window`, offset: 0, limit: 3 },
        { type: `truncateMarkers` },
        { type: `window`, offset: 0, limit: 1 },
        { type: `truncate`, armAfterStart: false },
      ],
      scenario: {
        ...ordinaryOrderedScenario,
        limit: 1,
        joined: false,
        markerMode: `on-demand`,
        includes: true,
      },
    },
    {
      // A marker truncate replays the include's demand, and its load throws
      // while it starts. The throw fails the replay as a rejection does, so
      // it keeps the last publication; it used to end the query.
      name: `a replay load that throws while it starts`,
      history: [{ type: `markerThrows` }, { type: `truncateMarkers` }],
      scenario: {
        ...ordinaryOrderedScenario,
        limit: 1,
        joined: `none`,
        markerMode: `on-demand`,
        includes: true,
      },
      recovers: true,
    },
    {
      // A row move starts join demand inside an open marker replay, and its
      // load throws while it starts. The subscription dropped that demand,
      // so its failure did not fail the replay, and the query ended.
      name: `a demand whose load throws inside its open replay`,
      history: [
        { type: `hold` },
        { type: `truncateMarkers` },
        { type: `markerThrows` },
        { type: `move`, id: 3, rank: 1 },
      ],
      scenario: {
        ...ordinaryOrderedScenario,
        limit: 1,
        joined: `none`,
        markerMode: `on-demand`,
      },
      reaches: `thrownReplayDemands`,
      recovers: true,
    },
    {
      name: `a fresh include request that fails during marker truncate`,
      history: [
        { type: `hold` },
        { type: `truncateMarkers` },
        { type: `settle`, ok: false },
        { type: `move`, id: 1, rank: 1 },
      ],
      scenario: {
        ...ordinaryOrderedScenario,
        limit: 1,
        joined: `none`,
        markerMode: `on-demand`,
        includes: true,
      },
      reaches: `failedLoads`,
      failureState: replayDemandStates[0],
      recovers: true,
    },
    {
      name: `an established include replay that fails`,
      history: [
        { type: `hold` },
        { type: `truncateMarkers` },
        { type: `settle`, ok: false },
        { type: `move`, id: 1, rank: 1 },
      ],
      scenario: {
        ...ordinaryOrderedScenario,
        limit: 1,
        markerMode: `on-demand`,
        includes: true,
      },
      reaches: `failedLoads`,
    },
    {
      // A window move waits behind a source replay whose two loads then
      // fail. The move rejects with the replay's own error, its earliest
      // failure (maintainer decision). It rejected with the later failure,
      // which the query had last recorded.
      name: `a window move behind a replay with two failed loads`,
      history: [
        { type: `hold` },
        { type: `truncate`, armAfterStart: false },
        { type: `window`, offset: 0, limit: 1 },
        { type: `settle`, ok: false, newest: true },
        { type: `settle`, ok: false, keepHolding: false, newest: false },
      ],
      scenario: {
        ...ordinaryOrderedScenario,
        offset: 1,
        limit: 1,
        joined: `none`,
        markerMode: `eager`,
      },
      reaches: `deferredMoveRejections`,
    },
    {
      name: `an established marker replay after a fresh include succeeds`,
      history: [
        { type: `hold` },
        { type: `truncateMarkers` },
        { type: `settle`, ok: true },
        { type: `settle`, ok: false },
        { type: `move`, id: 1, rank: 1 },
      ],
      scenario: {
        ...ordinaryOrderedScenario,
        limit: 1,
        joined: `none`,
        markerMode: `on-demand`,
        includes: true,
      },
      reaches: `failedLoads`,
    },
    {
      name: `a pending include whose initiating load succeeds before replay fails`,
      history: [
        { type: `hold` },
        { type: `mark`, id: 1, on: false },
        { type: `truncateMarkers` },
        { type: `settle`, ok: true },
        { type: `settle`, ok: true },
        { type: `settle`, ok: true },
        { type: `settle`, ok: false },
      ],
      scenario: {
        ...ordinaryOrderedScenario,
        limit: 1,
        joined: `none`,
        markerMode: `on-demand`,
        includes: true,
      },
      reaches: `failedLoads`,
    },
  ] satisfies Array<{
    name: string
    history: Array<OrderedCommand>
    scenario?: OrderedScenario
    reaches?: keyof OrderedReach
    // A replay whose history the law places in a recovery. The pin also
    // holds where the model cannot tell which subscription issued a load
    // (see Limits).
    recovers?: true
    failureState?: ReplayDemandState
  }>)(
    `keeps the ordered window for $name (generated replay)`,
    async ({ history, scenario, ...replay }) => {
      const entered = new Set<ReplayDemandState>()
      const reach = await checkOrderedReplay(history, scenario, (state) =>
        entered.add(state),
      )
      checkReplayDemandFailure(reach, entered)
      if (`failureState` in replay)
        expect(entered).toContain(replay.failureState)
      const reaches: keyof OrderedReach | undefined =
        `reaches` in replay ? replay.reaches : undefined
      if (reaches) expect(reach[reaches], reaches).toBeGreaterThan(0)
      if (`recovers` in replay) {
        expect(reach.terminalErrors, `recovery failure ends the query`).toBe(0)
      }
    },
  )

  // Found by the failed-replay random campaign at five times its run count.
  // A join and an include share the marker source. One subscription's replay
  // fails; the other's finishes, and a row move starts demand on it whose
  // load fails too, which the shared barrier keeps from ending the query. A
  // marker change then retires the first replay's failed demand, which
  // discarded that replay and published an empty window while the second
  // failure held nothing; that failure now holds its own subscription.
  it(`keeps the last publication when a marker change follows two failed replay loads`, async () => {
    await checkOrderedReplay(
      [
        { type: `hold` },
        { type: `truncateMarkers` },
        { type: `settle`, ok: true, keepHolding: true, newest: false },
        { type: `settle`, ok: false, newest: true, keepHolding: true },
        { type: `move`, id: 1, rank: 1 },
        { type: `settle`, ok: false, newest: false },
        { type: `hold` },
        { type: `mark`, id: 4, on: false },
      ],
      {
        ...ordinaryOrderedScenario,
        direction: `desc`,
        offset: 1,
        limit: 1,
        joined: `some`,
        markerMode: `on-demand`,
        includes: true,
      },
    )
  })

  // This finite history grammar varies which source replays, the order of
  // two load failures, join form, direction and window width. Join plus include
  // gives sibling subscriptions; the root replay gives same-subscription
  // failures. The same comparison checks both, without an expected error
  // copied from production or a source-wide error order.
  it(`keeps replay error order within each subscription`, async () => {
    const declared = createOracleReach(
      `replay.subscription-error-order`,
      [
        `ownReplayFailureComparisons`,
        `siblingReplayFailureComparisons`,
      ] as const,
      { minimum: 5 },
    )
    for (const direction of [`asc`, `desc`] as const) {
      for (const joined of [false, `some`, `none`, `inner`] as const) {
        for (const limit of [1, 2, 3] as const) {
          for (const markers of [false, true]) {
            for (const newest of [false, true]) {
              declared.beginHistory()
              const observed = await checkOrderedReplay(
                [
                  { type: `hold` },
                  markers
                    ? { type: `truncateMarkers` }
                    : { type: `truncate`, armAfterStart: false },
                  { type: `window`, offset: 0, limit },
                  { type: `settle`, ok: false, newest },
                  {
                    type: `settle`,
                    ok: false,
                    newest: !newest,
                    keepHolding: false,
                  },
                ],
                {
                  ...ordinaryOrderedScenario,
                  direction,
                  joined,
                  limit,
                  markerMode: `on-demand`,
                  includes: true,
                },
              )
              for (const state of [
                `ownReplayFailureComparisons`,
                `siblingReplayFailureComparisons`,
              ] as const) {
                if (observed[state] > 0) declared.reach(state)
              }
            }
          }
        }
      }
    }
    console.info(
      `replay.subscription-error-order`,
      Object.fromEntries(declared.counts()),
    )
    declared.assertReached()
  }, 120_000)

  // Failure followed by successful coverage is the neighboring regime of
  // the two-failure grammar above. Real adapter subscriptions supply identity;
  // the shared account comparison requires a sibling's failure to survive.
  it(`retains sibling replay failures through successful coverage`, async () => {
    const declared = createOracleReach(
      `replay.subscription-success-scope`,
      [`siblingSuccessfulCoverage`] as const,
      { minimum: 1 },
    )
    for (const direction of [`asc`, `desc`] as const) {
      for (const joined of [false, `some`, `none`, `inner`] as const) {
        for (const limit of [1, 2, 3] as const) {
          for (const markers of [false, true]) {
            for (const newest of [false, true]) {
              declared.beginHistory()
              const observed = await checkOrderedReplay(
                [
                  { type: `hold` },
                  markers
                    ? { type: `truncateMarkers` }
                    : { type: `truncate`, armAfterStart: false },
                  { type: `window`, offset: 0, limit },
                  { type: `settle`, ok: false, newest, keepHolding: true },
                  {
                    type: `settle`,
                    ok: true,
                    newest: !newest,
                    keepHolding: false,
                  },
                ],
                {
                  ...ordinaryOrderedScenario,
                  direction,
                  joined,
                  limit,
                  markerMode: `on-demand`,
                  includes: true,
                },
              )
              if (observed.siblingSuccessfulCoverage > 0)
                declared.reach(`siblingSuccessfulCoverage`)
            }
          }
        }
      }
    }
    console.info(
      `replay.subscription-success-scope`,
      Object.fromEntries(declared.counts()),
    )
    declared.assertReached()
  }, 120_000)

  it.each(orderedReplayCampaigns)(
    `keeps the ordered window under load and release faults (%s campaign)`,
    async (campaign) => {
      const total: OrderedReach = {
        settlementThrows: 0,
        throwsAfterReplay: 0,
        replayStartThrows: 0,
        heldAcrossTruncate: 0,
        failedLoads: 0,
        settledWindowChecks: 0,
        tiedWindows: 0,
        peerChecks: 0,
        windowMoves: 0,
        descendingRuns: 0,
        joinedRuns: 0,
        includeChecks: 0,
        markChanges: 0,
        antiJoinedRuns: 0,
        innerJoinedRuns: 0,
        markerLoads: 0,
        markerTruncates: 0,
        terminalErrors: 0,
        requestErrors: 0,
        requestErrorChecks: 0,
        successWhileSubscriptionOwes: 0,
        deferredMoveRejections: 0,
        ownReplayFailureComparisons: 0,
        siblingReplayFailureComparisons: 0,
        siblingSuccessfulCoverage: 0,
        replayLoads: 0,
        abortRejections: 0,
        preloadChecks: 0,
        heldPublicationChecks: 0,
        retainedFailedReplays: 0,
        participantDemandFailures: 0,
        includeDemandFailures: 0,
        siblingDemandFailures: 0,
        failedSiblingDemandFailures: 0,
        thrownReplayDemands: 0,
        partialFailureRetirements: 0,
        preloadReplayFailures: 0,
        discardedReplayMoves: 0,
      }
      // Reach witnesses: releases throw without a truncate, while a replay
      // starts, and while it settles; loads fail and stay held across a
      // truncate; truncates ask again for held demand; and the settled-window
      // law is checked.
      // A terminal error needs a failed first load, and a request error a held
      // demand load that fails after readiness; the named replays above reach
      // both. A failed replay that the retention law can
      // judge, a demand that fails while its replay is open, a replay that
      // fails before the first ready, and a window move behind a discarded
      // replay are rare here; the campaigns below declare them.
      const ownedElsewhere = new Set<keyof OrderedReach>([
        `terminalErrors`,
        `requestErrors`,
        `retainedFailedReplays`,
        `participantDemandFailures`,
        `includeDemandFailures`,
        `siblingDemandFailures`,
        `failedSiblingDemandFailures`,
        `thrownReplayDemands`,
        `partialFailureRetirements`,
        `preloadReplayFailures`,
        `discardedReplayMoves`,
        `requestErrorChecks`,
        `deferredMoveRejections`,
        `ownReplayFailureComparisons`,
        `siblingReplayFailureComparisons`,
        `siblingSuccessfulCoverage`,
        `successWhileSubscriptionOwes`,
      ])
      // Counts are histories, rather than repeated events in one trace.
      const dimensions = (
        Object.keys(total) as Array<keyof OrderedReach>
      ).filter((dimension) => !ownedElsewhere.has(dimension))
      const declared = createOracleReach(orderedReplayProperty, dimensions)
      await fc.assert(
        fc.asyncProperty(
          fc.array(orderedCommand, { minLength: 1, maxLength: 12 }),
          orderedScenario,
          async (history, scenario) => {
            declared.beginHistory()
            const reach = await checkOrderedReplay(history, scenario)
            for (const key of dimensions) {
              if (reach[key] > 0) declared.reach(key)
            }
          },
        ),
        campaign === `fixed`
          ? { seed: 20261021, numRuns: oracleRuns(300) }
          : oraclePropertyOptions(300, orderedReplayProperty),
      )
      console.info(
        orderedReplayProperty,
        campaign,
        Object.fromEntries(declared.counts()),
      )
      declared.assertReached()
    },
    120_000,
  )

  // The retention law needs a replay that fails while the query holds its
  // last publication. Each history here starts by holding the next loads and
  // truncating a source, so the replay's loads stay held. It may then change
  // a rank, a marker, or the window, which starts demand while the replay is
  // open. It then fails a held load: the oldest is a replay load, and the
  // newest is the demand just started. Random commands follow, so later
  // moves, marks, window moves, and truncates act on a failed replay. Peers
  // stay out because the retention law does not judge them.
  const failedReplayTruncate = fc.constantFrom(
    { type: `truncate` as const, armAfterStart: false },
    { type: `truncateMarkers` as const },
  )
  const failedReplayHistory: fc.Arbitrary<Array<OrderedCommand>> = fc
    .tuple(
      failedReplayTruncate,
      fc.option(
        fc.oneof(
          fc.record({
            type: fc.constant(`move` as const),
            id: fc.integer({ min: 1, max: 5 }),
            rank: fc.integer({ min: 1, max: 60 }),
          }),
          fc.record({
            type: fc.constant(`mark` as const),
            id: fc.integer({ min: 1, max: 5 }),
            on: fc.boolean(),
          }),
          fc.record({
            type: fc.constant(`window` as const),
            offset: fc.constantFrom(0 as const, 1 as const),
            limit: fc.constantFrom(1 as const, 2 as const, 3 as const),
          }),
        ),
        { nil: undefined },
      ),
      fc.boolean(),
      fc.array(orderedCommand, { maxLength: 8 }),
    )
    .map(([truncate, change, keepHolding, rest]) => [
      { type: `hold` as const },
      truncate,
      ...(change
        ? [change, { type: `settle` as const, ok: false, newest: true }]
        : [{ type: `settle` as const, ok: false, keepHolding }]),
      ...rest,
    ])
  const failedReplayScenario = orderedScenario.map((scenario) => ({
    ...scenario,
    peer: false,
  }))
  // An include demand that fails while its replay still loads needs an
  // include over on-demand markers and a move that brings a row into the
  // window during the marker replay; this branch builds that start. The
  // window starts at offset 0 without ties, and the moved row starts past
  // it, so moving it before every other row shows it.
  const includeDemandCase = failedReplayScenario.chain((scenario) => {
    const included = {
      ...scenario,
      offset: 0 as const,
      ties: false,
      joined: false as const,
      includes: true,
      markerMode: `on-demand` as const,
    }
    const ascending = included.direction === `asc`
    return fc
      .tuple(
        fc.integer({ min: 1, max: 9 }),
        fc.array(orderedCommand, { maxLength: 8 }),
      )
      .map(([rank, rest]): [Array<OrderedCommand>, OrderedScenario] => [
        [
          { type: `hold` },
          { type: `truncateMarkers` },
          {
            type: `move`,
            id: ascending ? 5 : 1,
            rank: ascending ? rank : 61 - rank,
          },
          { type: `settle`, ok: false, newest: true },
          ...rest,
        ],
        included,
      ])
  })
  // A query that joins and includes the marker source has two marker
  // subscriptions under one barrier. Settling some held loads can finish one
  // subscription's own replay loads while the other's still load; the graph
  // then demands markers for rows the commit privately exposed, and the
  // newest load fails.
  // After the failing load, half the histories move a row, which starts
  // demand once the shared replay has failed, and then fail the oldest held
  // load: the other subscription may have finished its own replay by then.
  const siblingDemandCase = fc
    .tuple(
      failedReplayScenario,
      fc.constantFrom(`some` as const, `none` as const, `inner` as const),
      fc.integer({ min: 1, max: 2 }),
      fc.boolean(),
      fc.option(
        fc.record({
          type: fc.constant(`move` as const),
          id: fc.integer({ min: 1, max: 5 }),
          rank: fc.integer({ min: 1, max: 60 }),
        }),
      ),
      fc.array(orderedCommand, { maxLength: 6 }),
      // The failed demand's retry, which the query starts at once, may stay
      // held, so later commands act while that demand is still unloaded.
      fc.boolean(),
    )
    .map(
      ([scenario, joined, settles, newest, move, rest, retryHeld]): [
        Array<OrderedCommand>,
        OrderedScenario,
      ] => [
        [
          { type: `hold` },
          { type: `truncateMarkers` },
          ...Array.from({ length: settles }, () => ({
            type: `settle` as const,
            ok: true,
            keepHolding: true,
            newest,
          })),
          { type: `settle`, ok: false, newest: true, keepHolding: true },
          ...(move
            ? [
                move,
                {
                  type: `settle` as const,
                  ok: false,
                  newest: false,
                  keepHolding: retryHeld,
                },
              ]
            : []),
          ...rest,
        ],
        { ...scenario, joined, includes: true, markerMode: `on-demand` },
      ],
    )
  // A marker replay is open when a change starts marker demand whose load
  // throws while it starts. The throw fails the replay, like a rejection,
  // so it must not end the query.
  const thrownDemandCase = fc
    .tuple(
      failedReplayScenario,
      fc.boolean(),
      fc.oneof(
        fc.record({
          type: fc.constant(`move` as const),
          id: fc.integer({ min: 1, max: 5 }),
          rank: fc.integer({ min: 1, max: 60 }),
        }),
        fc.record({
          type: fc.constant(`mark` as const),
          id: fc.integer({ min: 1, max: 5 }),
          on: fc.boolean(),
        }),
      ),
      fc.array(orderedCommand, { maxLength: 6 }),
    )
    .map(
      ([scenario, settleFirst, change, rest]): [
        Array<OrderedCommand>,
        OrderedScenario,
      ] => [
        [
          { type: `hold` },
          { type: `truncateMarkers` },
          ...(settleFirst
            ? [{ type: `settle` as const, ok: true, keepHolding: true }]
            : []),
          { type: `markerThrows` },
          change,
          ...rest,
        ],
        { ...scenario, markerMode: `on-demand` },
      ],
    )
  // A demand fails behind a sibling's failed replay, and its retry stays
  // held. A later command starts another demand of the same source, whose
  // load then succeeds, so a replay's success, publication, and request
  // errors are judged while a failed demand is still unloaded. Declared
  // reach: a subscription's load succeeds while a failure of that
  // subscription is still owed.
  const heldRetryCase = fc
    .tuple(
      failedReplayScenario,
      fc.constantFrom(`some` as const, `none` as const, `inner` as const),
      fc.record({
        type: fc.constant(`move` as const),
        id: fc.integer({ min: 1, max: 5 }),
        rank: fc.integer({ min: 1, max: 60 }),
      }),
      fc.oneof(
        fc.record({
          type: fc.constant(`move` as const),
          id: fc.integer({ min: 1, max: 5 }),
          rank: fc.integer({ min: -5, max: 99 }),
        }),
        fc.record({
          type: fc.constant(`mark` as const),
          id: fc.integer({ min: 1, max: 5 }),
          on: fc.boolean(),
        }),
        fc.record({
          type: fc.constant(`window` as const),
          offset: fc.constantFrom(0 as const, 1 as const),
          limit: fc.constantFrom(1 as const, 2 as const, 3 as const),
        }),
      ) as fc.Arbitrary<OrderedCommand>,
      fc.array(orderedCommand, { maxLength: 3 }),
    )
    .map(
      ([scenario, joined, move, change, rest]): [
        Array<OrderedCommand>,
        OrderedScenario,
      ] => [
        [
          { type: `hold` },
          { type: `truncateMarkers` },
          { type: `settle`, ok: true, keepHolding: true, newest: false },
          { type: `settle`, ok: false, newest: true, keepHolding: true },
          move,
          { type: `settle`, ok: false, newest: false, keepHolding: true },
          change,
          { type: `settle`, ok: true, newest: true, keepHolding: true },
          ...rest,
        ],
        {
          ...scenario,
          limit: scenario.limit === 1 ? 2 : scenario.limit,
          joined,
          includes: true,
          markerMode: `on-demand`,
        },
      ],
    )
  const failedReplayCase = fc.oneof(
    {
      weight: 3,
      arbitrary: fc.tuple(failedReplayHistory, failedReplayScenario),
    },
    { weight: 1, arbitrary: includeDemandCase },
    { weight: 2, arbitrary: siblingDemandCase },
    { weight: 2, arbitrary: thrownDemandCase },
    { weight: 2, arbitrary: heldRetryCase },
  )
  const failedReplayProperty = `replay.ordered-failed-replay`
  const failedReplayCampaigns =
    orderedReplayConfig.replayPath === undefined
      ? ([`fixed`, `random`] as const)
      : orderedReplayConfig.replayProperty === failedReplayProperty
        ? ([`replay`] as const)
        : ([] as const)

  // Recovery during the initial preload. A history starts while the first
  // loads are held, over on-demand markers that the query includes or joins.
  // Its grammar settles held loads one at a time, truncates either source,
  // moves the window, and fails a held load, so replays start, fail, and are
  // discarded before the query first becomes ready, with window moves
  // waiting behind them.
  const preloadCommand: fc.Arbitrary<OrderedCommand> = fc.oneof(
    {
      weight: 4,
      arbitrary: fc.record({
        type: fc.constant(`settle` as const),
        ok: fc.oneof(
          { weight: 3, arbitrary: fc.constant(true) },
          { weight: 1, arbitrary: fc.constant(false) },
        ),
        keepHolding: fc.oneof(
          { weight: 3, arbitrary: fc.constant(true) },
          { weight: 1, arbitrary: fc.constant(false) },
        ),
        newest: fc.boolean(),
      }),
    },
    { weight: 2, arbitrary: fc.constant({ type: `truncateMarkers` as const }) },
    {
      weight: 1,
      arbitrary: fc.constant({
        type: `truncate` as const,
        armAfterStart: false,
      }),
    },
    {
      weight: 2,
      arbitrary: fc.record({
        type: fc.constant(`window` as const),
        offset: fc.constantFrom(0 as const, 1 as const),
        limit: fc.constantFrom(1 as const, 2 as const, 3 as const),
      }),
    },
    {
      weight: 1,
      arbitrary: fc.record({
        type: fc.constant(`move` as const),
        id: fc.integer({ min: 1, max: 5 }),
        rank: fc.integer({ min: 1, max: 60 }),
      }),
    },
    { weight: 1, arbitrary: fc.constant({ type: `hold` as const }) },
  )
  const preloadScenario = orderedScenario.map((scenario) => ({
    ...scenario,
    markerMode: `on-demand` as const,
    includes: scenario.includes || !scenario.joined,
    historyDuringPreload: true,
  }))
  // A replay of include demand that fails before the first ready: initial
  // loads settle one at a time, so the order source delivers rows and the
  // include demands them; the marker source truncates; more held loads
  // settle; and the oldest or newest held load fails. The oldest is often
  // a load the truncate aborted, and the newest a replay load.
  const settleHeld = { type: `settle` as const, ok: true, keepHolding: true }
  const preloadDemandFailure = fc
    .tuple(
      preloadScenario,
      fc.integer({ min: 1, max: 2 }),
      fc.integer({ min: 0, max: 3 }),
      fc.boolean(),
      fc.array(preloadCommand, { maxLength: 6 }),
    )
    .map(
      ([scenario, before, after, newest, rest]): [
        Array<OrderedCommand>,
        OrderedScenario,
      ] => [
        [
          ...Array.from({ length: before }, () => settleHeld),
          { type: `truncateMarkers` },
          ...Array.from({ length: after }, () => settleHeld),
          { type: `settle`, ok: false, newest },
          ...rest,
        ],
        { ...scenario, joined: false, includes: true },
      ],
    )
  const preloadCase = fc.oneof(
    {
      weight: 2,
      arbitrary: fc.tuple(
        fc.array(preloadCommand, { minLength: 1, maxLength: 12 }),
        preloadScenario,
      ),
    },
    { weight: 1, arbitrary: preloadDemandFailure },
  )
  const preloadProperty = `replay.ordered-preload-recovery`
  const preloadCampaigns =
    orderedReplayConfig.replayPath === undefined
      ? ([`fixed`, `random`] as const)
      : orderedReplayConfig.replayProperty === preloadProperty
        ? ([`replay`] as const)
        : ([] as const)

  it.each(preloadCampaigns)(
    `recovers replays that start during the initial preload (%s campaign)`,
    async (campaign) => {
      // Declared reach: a replay participant that fails before the first
      // ready, which must end the query or let the preload settle, and a
      // window move that waits behind a replay a newer truncate discards,
      // which must still apply.
      const reach = createOracleReach(
        preloadProperty,
        [
          `preloadReplayFailures`,
          `discardedReplayMoves`,
          `preloadChecks`,
        ] as const,
        { minimum: 5 },
      )
      await fc.assert(
        fc.asyncProperty(preloadCase, async ([history, scenario]) => {
          reach.beginHistory()
          const observed = await checkOrderedReplay(history, scenario)
          for (const state of [
            `preloadReplayFailures`,
            `discardedReplayMoves`,
            `preloadChecks`,
          ] as const) {
            if (observed[state] > 0) reach.reach(state)
          }
        }),
        // The fixed seed kills both mutants that the evidence names: a
        // builder that lets a discarded replay reject a deferred window move,
        // and one that keeps a failure before the first ready non-fatal. Each
        // dies in about half of 200-run seeds.
        campaign === `fixed`
          ? { seed: 20261027, numRuns: oracleRuns(300) }
          : oraclePropertyOptions(300, preloadProperty),
      )
      reach.assertReached()
    },
    120_000,
  )

  it.each(failedReplayCampaigns)(
    `keeps the last publication through a failed replay (%s campaign)`,
    async (campaign) => {
      // Declared reach: histories where the retention law judged a failed
      // replay, judged a replay that still held publication, and saw a
      // demand that the graph started after the commit fail while its replay
      // still loaded, on either source and for an include. An include
      // demand's rejection arrives before its replay records the failure, so
      // only there does the demand wait for the replay to decide it.
      const reach = createOracleReach(
        failedReplayProperty,
        [
          `retainedFailedReplays`,
          `heldPublicationChecks`,
          `participantDemandFailures`,
          `includeDemandFailures`,
          `siblingDemandFailures`,
          `failedSiblingDemandFailures`,
          `thrownReplayDemands`,
          `partialFailureRetirements`,
          `requestErrorChecks`,
          `deferredMoveRejections`,
          `successWhileSubscriptionOwes`,
        ] as const,
        { minimum: 5 },
      )
      await fc.assert(
        fc.asyncProperty(failedReplayCase, async ([history, scenario]) => {
          reach.beginHistory()
          const observed = await checkOrderedReplay(history, scenario)
          if (observed.retainedFailedReplays > 0) {
            reach.reach(`retainedFailedReplays`)
          }
          if (observed.heldPublicationChecks > 0) {
            reach.reach(`heldPublicationChecks`)
          }
          if (observed.participantDemandFailures > 0) {
            reach.reach(`participantDemandFailures`)
          }
          if (observed.includeDemandFailures > 0) {
            reach.reach(`includeDemandFailures`)
          }
          if (observed.siblingDemandFailures > 0) {
            reach.reach(`siblingDemandFailures`)
          }
          if (observed.failedSiblingDemandFailures > 0) {
            reach.reach(`failedSiblingDemandFailures`)
          }
          if (observed.thrownReplayDemands > 0) {
            reach.reach(`thrownReplayDemands`)
          }
          if (observed.partialFailureRetirements > 0) {
            reach.reach(`partialFailureRetirements`)
          }
          if (observed.requestErrorChecks > 0) {
            reach.reach(`requestErrorChecks`)
          }
          if (observed.deferredMoveRejections > 0) {
            reach.reach(`deferredMoveRejections`)
          }
          if (observed.successWhileSubscriptionOwes > 0) {
            reach.reach(`successWhileSubscriptionOwes`)
          }
        }),
        campaign === `fixed`
          ? { seed: 20261023, numRuns: oracleRuns(600) }
          : oraclePropertyOptions(600, failedReplayProperty),
      )
      reach.assertReached()
    },
    120_000,
  )
})

/**
 * The broad grammar can legally reach these states, but its normal campaigns
 * did not each reach both states in the audit. This process grammar keeps marker replay
 * and held failure adjacent while varying prior replay count, the moved row,
 * its rank and the failure origin. It uses the same driver,
 * independent classification and observation cuts as the broad property.
 *
 * An include may start new demand while the marker truncate commits, inside
 * the marker barrier; a settled joined owner renews its own demand. After the
 * first ready, the barrier keeps the last publication for both failures
 * (ARCHITECTURE.md, "Replay participants and failure"). The adapter must
 * witness each failed acquisition in normal fixed and random campaigns.
 * Aborted work does not count. Named neighbors above calibrate both witnesses.
 */
const replayDemandProperty = `replay.subscription-demand-origin`
const replayDemandCampaigns =
  orderedReplayConfig.replayPath === undefined
    ? ([`fixed`, `random`] as const)
    : orderedReplayConfig.replayProperty === replayDemandProperty
      ? ([`replay`] as const)
      : ([] as const)
const replayDemandHistory = fc.record({
  origin: fc.constantFrom(`new-demand` as const, `renewal` as const),
  previousReplays: fc.integer({ min: 0, max: 3 }),
  move: fc.record({
    id: fc.constantFrom(1, 3, 4, 5),
    rank: fc.integer({ min: 1, max: 9 }),
  }),
})

// Direct replay registers only the selected property campaign.
it.each(replayDemandCampaigns)(
  `distinguishes failed demand origins (%s campaign)`,
  async (campaign) => {
    const declared = createOracleReach(replayDemandProperty, replayDemandStates)
    await fc.assert(
      fc.asyncProperty(replayDemandHistory, async (generated) => {
        declared.beginHistory()
        const history: Array<OrderedCommand> = [
          ...Array.from({ length: generated.previousReplays }, () => ({
            type: `truncateMarkers` as const,
          })),
          { type: `hold` },
          ...(generated.origin === `new-demand`
            ? [{ type: `move` as const, ...generated.move }]
            : []),
          { type: `truncateMarkers` },
          ...Array.from(
            { length: generated.origin === `new-demand` ? 1 : 0 },
            () => ({
              type: `settle` as const,
              ok: true,
            }),
          ),
          { type: `settle`, ok: false },
        ]
        const entered = new Set<ReplayDemandState>()
        const reach = await checkOrderedReplay(
          history,
          {
            ...ordinaryOrderedScenario,
            limit: 1,
            joined: generated.origin === `new-demand` ? `none` : `some`,
            markerMode: `on-demand`,
            includes: generated.origin === `new-demand`,
          },
          (state) => {
            entered.add(state)
            declared.reach(state)
          },
        )
        // Neither failure may end the query: each fails behind the marker
        // barrier, which keeps the query available for a later replay.
        checkReplayDemandFailure(reach, entered)
      }),
      campaign === `fixed`
        ? { seed: 2233, numRuns: oracleRuns(75) }
        : oraclePropertyOptions(75, replayDemandProperty),
    )
    console.info(
      replayDemandProperty,
      campaign,
      Object.fromEntries(declared.counts()),
    )
    declared.assertReached()
  },
  120_000,
)

// The broad grammar may miss the low-frequency interaction between a
// truncate's private window change and fresh child demand. These generated
// histories vary the marked head's rank and two other markers before
// placing failure on either side of that boundary. Reacquisition failures
// additionally explore later rank, marker, window, replay, release, and
// settlement actions before recovery; fresh-failure histories need no suffix.
// A new include fails in the first prefix. In the second it succeeds, and
// failure instead reaches the already established marker reacquisition.
it.each(orderedFailureCampaigns)(
  `distinguishes keyed request failure from reacquisition (%s campaign)`,
  async (campaign) => {
    const failureReach = createOracleReach<OrderedFailureState>(
      orderedFailureProperty,
      [`initiating-keyed-request-failed`, `keyed-reacquisition-failed`],
    )
    await fc.assert(
      fc.asyncProperty(
        fc.array(orderedCommand, { minLength: 0, maxLength: 6 }),
        fc.constantFrom(`asc` as const, `desc` as const),
        fc.integer({ min: 1, max: 9 }),
        fc.boolean(),
        fc.boolean(),
        async (suffix, direction, rank, markThird, markFourth) => {
          for (const fresh of [true, false]) {
            failureReach.beginHistory()
            const history: Array<OrderedCommand> = [
              {
                type: `move`,
                id: direction === `asc` ? 1 : 5,
                rank: direction === `asc` ? -rank : 100 + rank,
              },
              { type: `mark`, id: 3, on: markThird },
              { type: `mark`, id: 4, on: markFourth },
              { type: `hold` },
              { type: `truncateMarkers` },
              ...(fresh ? [] : [{ type: `settle` as const, ok: true }]),
              { type: `settle`, ok: false },
              ...(fresh ? [] : suffix),
            ]
            const reach = await checkOrderedReplay(
              history,
              {
                ...ordinaryOrderedScenario,
                direction,
                limit: 1,
                joined: `none`,
                markerMode: `on-demand`,
                includes: true,
              },
              undefined,
              failureReach.reach,
            )
            // A fresh request that fails inside the marker barrier keeps the
            // query; a later suffix may legitimately end it, so only the
            // fresh history is pinned.
            if (fresh) {
              expect(reach.terminalErrors, `fresh request failure`).toBe(0)
              expect(reach.requestErrors, `fresh request failure`).toBe(1)
            }
          }
        },
      ),
      campaign === `fixed`
        ? { seed: 20261026, numRuns: oracleRuns(40) }
        : oraclePropertyOptions(40, orderedFailureProperty),
    )
    console.info(
      orderedFailureProperty,
      campaign,
      Object.fromEntries(failureReach.counts()),
    )
    failureReach.assertReached()
  },
  120_000,
)
