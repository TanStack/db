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
 * - **Terminal error:** a failed lazy join demand load is fatal, because the
 *   join side can no longer be complete, so the query stays in `error` and
 *   convergence does not apply. Either side can be the lazy one: the planner
 *   loads an inner join's root by key when the marker source is eager. A
 *   demand load asks for keys (a `where` with no `orderBy`). A failed load
 *   that reacquires an established request after truncate is not fatal: it
 *   keeps the last publication until the next replay. A load that fails before
 *   the query first becomes ready is fatal too (an initial load failure), except on
 *   a lazy join source, which owns its demand. So a query may end in
 *   `error` only after a newly issued keyed snapshot request failed, or a
 *   load failed while the query was still loading. A truncate may change the
 *   private window and issue a new include request while it commits; that
 *   request still starts fresh lazy demand. Reacquisition of a previously
 *   settled request is an ordinary replay, even when it starts later.
 *   Replay renews demand held by its subscription before the truncate. A new
 *   subscription's first demand remains ordinary during another's replay.
 * - **Status:** with no failed load, a quiet live query and its peer are
 *   `ready`; a release that throws does not change status.
 * - **Reported faults:** an injected fault may surface as a rejected load, a
 *   thrown release, a window move rejected by a load failure, or an error the
 *   subscription rethrows from a microtask. A window move whose load a
 *   truncate aborts may also reject with an `AbortError`. A release failure never rejects a
 *   window move. No other error may escape.
 *
 * History grammar: rank moves, holding the next loads, settling the oldest
 * held load with success or failure, truncates (optionally arming the next
 * unload once the replay has started), and arming the next unload to throw. The driver uses a real on-demand Collection with an index and an
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
 * answers. The status check relates an observed initiating request rejection
 * to dependent query status; it does not independently establish correct
 * settlement of that request receipt. Peer scenarios share one history-level
 * failure allowance, so they do not establish receiver-specific fault ownership.
 */
type OrderedFailureState =
  `initiating-keyed-request-failed` | `keyed-reacquisition-failed`

type OrderedRow = { id: number; rank: number }
type OrderedCommand =
  | { type: `move`; id: number; rank: number }
  | { type: `hold` }
  | { type: `settle`; ok: boolean }
  | { type: `truncate`; armAfterStart: boolean }
  | { type: `unloadThrows` }
  | { type: `window`; offset: 0 | 1; limit: 1 | 2 | 3 }
  | { type: `mark`; id: number; on: boolean }
  | { type: `truncateMarkers` }

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
  abortedMoves: number
  terminalErrors: number
}

const replayDemandStates = [
  `new-demand-failed-during-marker-replay`,
  `settled-marker-demand-replay-failed`,
] as const
type ReplayDemandState = (typeof replayDemandStates)[number]

// The demand origin determines the terminal consequence for named replays and
// generated histories alike. Reach checks separately prove each premise ran.
function checkReplayDemandFailure(
  reach: OrderedReach,
  entered: ReadonlySet<ReplayDemandState>,
) {
  if (entered.has(replayDemandStates[0]))
    expect(reach.terminalErrors, `ordinary failure is terminal`).toBe(1)
  if (entered.has(replayDemandStates[1]))
    expect(reach.terminalErrors, `replay failure is nonterminal`).toBe(0)
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
  // Ties leave the order among equal ranks open, so the model predicts the
  // window's rank sequence. Each shown row must also carry its current rank.
  const expectedRanks = (shown: { offset: number; limit: number }) =>
    [...truth.values()]
      .filter(
        ({ id }) =>
          !scenario.joined ||
          (scenario.joined === `none` ? !marked.has(id) : marked.has(id)),
      )
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
    }
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
  type Load = { epoch: number; outcome: `pending` | `ok` | `failed` }
  const loads: Array<Load> = []
  const acquired = new Map<LoadSubsetOptions, number>()
  const markerRequests = new WeakSet<LoadSubsetOptions>()
  const held: Array<(ok: boolean) => void> = []
  let holding = false
  let truncates = 0
  let throwNextUnload = false
  // Window moves whose settlement waits on held loads.
  const pendingMoves: Array<Promise<void>> = []
  // Release-fault reach still distinguishes a throw while truncate commits.
  let truncating = false
  let anyLoadFailed = false
  let earlyThrowSinceTruncate = false
  // Replay renews the leases held at its boundary. The adapter's subscription
  // token identifies an owner; evaluating its immutable predicate on this
  // finite key domain identifies the demand independently of production replay
  // state. Consume each captured lease once, so a new owner or different keys
  // cannot inherit another demand's replay classification.
  const demandKey = (options: LoadSubsetOptions, marker: boolean) =>
    JSON.stringify(
      [1, 2, 3, 4, 5].filter((id) =>
        options.where
          ? evaluateReferenceExpression(
              options.where,
              marker ? { id, rowId: id } : truth.get(id)!,
            ) === true
          : true,
      ),
    )
  const replayDemands = {
    source: [] as Array<LoadSubsetOptions>,
    marker: [] as Array<LoadSubsetOptions>,
  }
  let markerTruncating = false
  let hadMarkerDemand = false
  const isReplayDemand = (options: LoadSubsetOptions, marker: boolean) => {
    const previous = marker ? replayDemands.marker : replayDemands.source
    const index = previous.findIndex(
      (previousOptions) =>
        previousOptions.subscription === options.subscription &&
        demandKey(previousOptions, marker) === demandKey(options, marker),
    )
    if (index < 0) return false
    previous.splice(index, 1)
    return true
  }
  let demandFailed = false
  let initiatingRequestFailed = false
  // A failed initial load is fatal too (error 229). The queries are created
  // below; a load can only fail after they start.
  const queries: Array<{ status: string }> = []
  let failedWhileLoading = false
  // Adapter callbacks set these flags, so read them through a call.
  // A terminal result must satisfy both the independent retained-demand
  // account and the initiating-request observation at each checked cut.
  const fatalLoadFailed = () => demandFailed || failedWhileLoading
  const initiatingFailure = () => initiatingRequestFailed || failedWhileLoading
  const isDemand = (options: LoadSubsetOptions) =>
    options.where !== undefined && options.orderBy === undefined
  // Observe the initiating snapshot request's result. A new lazy keyed
  // request may start while truncate commits, whereas reacquisition of an
  // established request does not issue another snapshot request. The receipt
  // connects an injected adapter failure to its initiating request without
  // using replay state, callback timing, or predicate identity.
  const injectedLoadFaults = new WeakSet<Error>()
  // Exact acquisition receipts are used only to measure the two failure
  // premises. This requires no referential stability of predicate expressions.
  const snapshotAcquisitions = new WeakSet<LoadSubsetOptions>()
  const requestSnapshot = CollectionSubscription.prototype.requestSnapshot
  const snapshotRequests = vi
    .spyOn(CollectionSubscription.prototype, `requestSnapshot`)
    .mockImplementation(function (this: CollectionSubscription, options) {
      if (options?.where === undefined || options.orderBy !== undefined) {
        return requestSnapshot.call(this, options)
      }
      return requestSnapshot.call(this, {
        ...options,
        onLoadSubsetResult: (result, acquisition, release) => {
          snapshotAcquisitions.add(acquisition)
          if (result instanceof Promise) {
            void result.catch((error: unknown) => {
              if (error instanceof Error && injectedLoadFaults.has(error)) {
                initiatingRequestFailed = true
                recordFailureReach?.(`initiating-keyed-request-failed`)
              }
            })
          }
          options.onLoadSubsetResult?.(result, acquisition, release)
        },
      })
    })
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
    abortedMoves: 0,
    terminalErrors: 0,
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
          // joined work can stay pending or fail.
          loadSubset: async (options) => {
            const replay = isReplayDemand(options, true)
            // These are adapter-entry witnesses, independent of the expected
            // terminal status. A new logical demand cannot renew a captured
            // demand merely because both use the same source or subscription.
            const newDemandDuringReplay =
              !replay &&
              isDemand(options) &&
              markerTruncating &&
              hadMarkerDemand
            const settledReplay =
              replay &&
              queries.length > 0 &&
              queries.every(({ status }) => status === `ready`)
            markerRequests.add(options)
            acquired.set(options, (acquired.get(options) ?? 0) + 1)
            const load: Load = { epoch: truncates, outcome: `pending` }
            loads.push(load)
            reach.markerLoads++
            const demand = !replay && isDemand(options)
            if (holding) {
              const ok = await new Promise<boolean>((resolve) =>
                held.push(resolve),
              )
              if (!ok) {
                if (!options.signal?.aborted) {
                  if (newDemandDuringReplay)
                    recordReach(`new-demand-failed-during-marker-replay`)
                  if (settledReplay)
                    recordReach(`settled-marker-demand-replay-failed`)
                }
                load.outcome = `failed`
                anyLoadFailed = true
                if (demand) demandFailed = true
                if (queries.some(({ status }) => status === `loading`)) {
                  failedWhileLoading = true
                }
                reach.failedLoads++
                throw injectLoad(new Error(`marker load failed`), options)
              }
            } else await Promise.resolve()
            if (options.signal?.aborted) {
              load.outcome = `ok`
              return
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
          },
          unloadSubset: (options) => {
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
            const replay = isReplayDemand(options, false)
            acquired.set(options, (acquired.get(options) ?? 0) + 1)
            const load: Load = { epoch: truncates, outcome: `pending` }
            loads.push(load)
            const demand = !replay && isDemand(options)
            if (holding) {
              const ok = await new Promise<boolean>((resolve) =>
                held.push(resolve),
              )
              if (!ok) {
                load.outcome = `failed`
                anyLoadFailed = true
                if (demand) demandFailed = true
                if (queries.some(({ status }) => status === `loading`)) {
                  failedWhileLoading = true
                }
                reach.failedLoads++
                throw injectLoad(new Error(`load failed`), options)
              }
            } else await Promise.resolve()
            if (options.signal?.aborted) {
              load.outcome = `ok`
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
          },
          unloadSubset: (options) => {
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
  // A subscriber keeps each live query from garbage collection while a
  // history waits on held loads.
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
    replayDemands.source = [...acquired].flatMap(([options, count]) =>
      count > 0 && !markerRequests.has(options)
        ? Array.from({ length: count }, () => options)
        : [],
    )
    truncates++
    earlyThrowSinceTruncate = false
    if (held.length > 0) reach.heldAcrossTruncate++
    installed.clear()
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
    replayDemands.marker = [...acquired].flatMap(([options, count]) =>
      count > 0 && markerRequests.has(options)
        ? Array.from({ length: count }, () => options)
        : [],
    )
    hadMarkerDemand = replayDemands.marker.length > 0
    installedMarkers.clear()
    markerSync.begin()
    markerSync.truncate()
    if (!onDemandMarkers) {
      for (const id of marked) {
        markerSync.write({ type: `insert`, value: { id, rowId: id } })
        installedMarkers.add(id)
      }
    }
    markerTruncating = true
    let receipt: true | Promise<void>
    try {
      receipt = markerSync.commit()
    } finally {
      markerTruncating = false
    }
    if (receipt !== true) await receipt
  }
  try {
    await live.preload()
    await peer?.preload()
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
            holding = false
            held.shift()?.(command.ok)
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
            const settled = live.utils.setWindow(requested)
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
                // A truncate aborts the load a move waits on (ARCHITECTURE.md);
                // the move then rejects and the window stays where it was.
                if (error instanceof Error && error.name === `AbortError`) {
                  reach.abortedMoves++
                  return
                }
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
      replayDemands.source = []
      replayDemands.marker = []
      // Classify terminal errors at the failing history cut, before final
      // recovery can hide an incorrect transition.
      for (const shown of queries) {
        if (shown.status === `error`) {
          expect(fatalLoadFailed(), `history: terminal error`).toBe(true)
          expect(initiatingFailure(), `history: initiating failure`).toBe(true)
        }
      }
    }
    holding = false
    throwNextUnload = false
    await settleAll()
    await Promise.all(pendingMoves.splice(0))
    await settleAll()
    await flushPromises()
    if (violation) throw new Error(`adapter release: ${violation}`)
    if (moveOrderViolation) {
      throw new Error(`newest move wins: ${moveOrderViolation}`)
    }
    if (escapedError() !== undefined) {
      throw new Error(`escaped error: only injected faults may surface`, {
        cause: escapedError(),
      })
    }
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
        expect(fatalLoadFailed(), `${label}: terminal error`).toBe(true)
        expect(initiatingFailure(), `${label}: initiating failure`).toBe(true)
        reach.terminalErrors++
      } else checkWindow(label, shown.toArray, expected)
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
  //   the move's AbortError as an escaped fault; it is a legal rejection, and
  //   this replay keeps the branch reached);
  // - a window move that retires lazy joined demand whose release throws (the
  //   subscription reported the release failure as a load error, so the move
  //   rejected with it; core now reports it uncaught);
  // - a held marker demand load that fails (the model expected convergence,
  //   but a failed lazy join demand is fatal by design; this replay keeps the
  //   terminal-error branch reached);
  // - two window moves while a load is held (the model let the older move,
  //   which settled later, restore its window; the newest move wins);
  // - an inner join whose lazy root demand load fails (the model allowed a
  //   terminal error only for marker loads; either side can be lazy);
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
      reaches: `abortedMoves`,
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
        { type: `settle`, ok: false },
      ],
      scenario: {
        ...ordinaryOrderedScenario,
        direction: `desc`,
        limit: 1,
        ties: true,
        joined: `some`,
        markerMode: `on-demand`,
      },
      reaches: `terminalErrors`,
    },
    {
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
      reaches: `terminalErrors`,
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
      reaches: `terminalErrors`,
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
    },
  )

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
        abortedMoves: 0,
        terminalErrors: 0,
      }
      // The broad property claims these dimensions, not the rare terminal
      // interaction owned by the subscription-specific property below.
      const dimensions = (
        Object.keys(total) as Array<keyof OrderedReach>
      ).filter(
        (dimension) =>
          dimension !== `abortedMoves` && dimension !== `terminalErrors`,
      )
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
      // Reach witnesses: releases throw without a truncate, while a replay
      // starts, and while it settles; loads fail and stay held across a
      // truncate; and the settled-window law is checked.
      // An aborted move needs a truncate to land inside a held move, and a
      // terminal error needs a held marker demand load to fail; the named
      // replays above reach both.
      // Counts above are histories, rather than repeated events in one trace.
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
 * An include may start new ordinary demand during another owner's
 * replacement; a settled joined owner renews its own demand. The adapter must
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
        // Ordinary failure must become terminal, not merely be permitted to.
        // A settled renewal must keep the query available for later replay.
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
// settlement actions before recovery; terminal histories need no suffix.
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
            if (fresh) {
              expect(reach.terminalErrors, `fresh request failure`).toBe(1)
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
