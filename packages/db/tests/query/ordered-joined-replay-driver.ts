import { createCollection } from '../../src/collection/index.js'
import { createDeferred } from '../../src/deferred.js'
import { BTreeIndex } from '../../src/indexes/btree-index.js'
import { eq, gte } from '../../src/query/builder/functions.js'
import { createEffect } from '../../src/query/effect.js'
import { createLiveQueryCollection } from '../../src/query/live-query-collection.js'
import { withHistoryCleanup } from '../optimistic-history-oracle.js'
import { evaluateReferenceExpression } from '../reference-expression-oracle.js'
import { flushPromises } from '../utils.js'
import type { InitialQueryBuilder } from '../../src/query/builder/index.js'
import type {
  LoadSubsetOptions,
  Subscription,
  SyncConfig,
} from '../../src/types.js'

type Row = { id: number; rank: number }
type Marker = { id: number; rowId: number }

export type JoinedReplayHistory = {
  receiver: `collection` | `effect`
  limit: 1 | 2
  indexed: boolean
  trigger: `explicit` | `retirement`
  holdJoined: boolean
  answer: `complete` | `refill` | `refill-rejection`
  initial: ReadonlyArray<Row>
  replacement: ReadonlyArray<Row>
  eligible: ReadonlyArray<number>
  move?: { offset: number; limit: number }
  laterReplay?: {
    rows: ReadonlyArray<Row>
    subsequentWrite: Row
    outcome: `fulfills` | `rejects`
    obsoleteRefill: `fulfills` | `rejects`
  }
}

type MoveOutcome = `pending` | `fulfilled` | `rejected` | `different error`

type Cut = {
  rows: Array<Row>
  publications: Array<Array<Row>>
  installed: Array<Row>
  window?: JoinedReplayHistory[`move`]
  moveOutcome?: MoveOutcome
}

export type JoinedReplayTrace = {
  initial: Array<Row>
  waitingForReplay: Cut
  afterReplayAnswers: Cut
  waitingForRefill: Cut
  settled: Cut
  repairStarted: boolean
  replayRequests: number
  joinedDemandHeld: boolean
  rootReadyWhileJoined: boolean
  heldRefill: boolean
  refillRevalidates: boolean | undefined
  reportedError: `none` | `originating error` | `different error`
  rowsAtMoveFulfillment?: Array<Row>
  windowAtMoveFulfillment?: JoinedReplayHistory[`move`]
  laterReplay?: {
    held: Cut
    started: boolean
    obsoleteAborted: boolean
    obsoleteStillPending: boolean
    afterObsoleteSettlement: Cut
    nextRepair?: {
      rows: Array<Row>
      bounded: boolean
      unbounded: boolean
    }
  }
}

type Sync<T extends object> = Parameters<SyncConfig<T, number>[`sync`]>[0]

function queryMatches(options: LoadSubsetOptions, row: Row | Marker): boolean {
  return (
    (options.where === undefined ||
      evaluateReferenceExpression(options.where, row) === true) &&
    (options.cursor === undefined ||
      evaluateReferenceExpression(options.cursor.whereFrom, row) === true)
  )
}

function snapshot(rows: Iterable<Row>): Array<Row> {
  return Array.from(rows, ({ id, rank }) => ({ id, rank })).sort(
    (left, right) => left.rank - right.rank,
  )
}

// Both query receivers use the same provider history. The adapter applies each
// exact demand independently of the query's local join. It can hold the
// original repair, replay, joined acquisition, and subsequent root refill at
// different cuts. The root subscription is supplied by the public adapter API.
export async function receiveJoinedReplay(
  history: JoinedReplayHistory,
): Promise<JoinedReplayTrace> {
  let rootSync!: Sync<Row>
  let rootSubscription: Subscription | undefined
  let providerRows = history.initial
  const installed = new Map<number, Row>()
  const installedMarkers = new Set<number>()
  const markers = history.eligible.map((id) => ({ id, rowId: id }))
  const repair = createDeferred<void>()
  const replay = createDeferred<void>()
  const laterReplay = createDeferred<void>()
  const joined = createDeferred<void>()
  const refill = createDeferred<void>()
  const failure = new Error(`root refill rejected`)
  const laterFailure = new Error(`second root replay rejected`)
  const requests = {
    phase: `initial` as
      `initial` | `repair` | `replay` | `later replay` | `after replay`,
    repairStarted: false,
    replay: 0,
    laterReplay: 0,
    pendingJoined: 0,
    pendingRefill: 0,
    refillRevalidates: undefined as boolean | undefined,
    nextRepairBounded: false,
    nextRepairUnbounded: false,
  }
  let refillSignal: AbortSignal | undefined

  const truncateTo = (rows: ReadonlyArray<Row>) => {
    providerRows = rows
    installed.clear()
    rootSync.begin()
    rootSync.truncate()
    return rootSync.commit()
  }
  const startReplay = () => {
    requests.phase = `replay`
    return truncateTo(history.replacement)
  }

  const source = createCollection<Row, number>({
    getKey: (row) => row.id,
    syncMode: `on-demand`,
    autoIndex: history.indexed ? `eager` : `off`,
    defaultIndexType: BTreeIndex,
    sync: {
      sync: (operations) => {
        rootSync = operations
        operations.markReady()
        return {
          loadSubset: async (options) => {
            rootSubscription = options.subscription
            const phase = requests.phase
            if (phase === `after replay`) {
              requests.nextRepairUnbounded ||=
                options.orderBy === undefined && options.where === undefined
              requests.nextRepairBounded ||=
                options.refetch === true &&
                options.orderBy !== undefined &&
                options.limit !== undefined &&
                options.cursor === undefined
            }
            if (phase === `later replay`) {
              requests.laterReplay++
              await laterReplay.promise
            }
            if (phase === `repair`) {
              requests.repairStarted ||=
                options.refetch === true &&
                options.orderBy !== undefined &&
                options.limit === history.limit &&
                options.cursor === undefined
              if (history.trigger === `explicit`) await repair.promise
            }
            if (phase === `replay` && replay.isPending()) {
              requests.replay++
              await replay.promise
            } else if (phase === `replay` && history.answer !== `complete`) {
              requests.refillRevalidates ??= options.refetch === true
              refillSignal ??= options.signal
              requests.pendingRefill++
              await refill.promise
              requests.pendingRefill--
              if (
                history.answer === `refill-rejection` ||
                history.laterReplay?.obsoleteRefill === `rejects`
              )
                throw failure
            }
            if (options.signal?.aborted) return
            const offset = options.cursor ? 0 : (options.offset ?? 0)
            const page = providerRows
              .filter((row) => queryMatches(options, row))
              .sort((left, right) => left.rank - right.rank)
              .slice(
                offset,
                options.limit === undefined
                  ? undefined
                  : offset + options.limit,
              )
            operations.begin()
            for (const value of page) {
              if (installed.get(value.id) === value) continue
              operations.write({
                type: installed.has(value.id) ? `update` : `insert`,
                value: { ...value },
              })
              installed.set(value.id, value)
            }
            await operations.commit(options.signal)
            if (
              phase === `later replay` &&
              history.laterReplay?.outcome === `rejects` &&
              !options.signal?.aborted
            )
              throw laterFailure
          },
          unloadSubset: () => {
            if (requests.phase === `repair` && history.trigger === `retirement`)
              void startReplay()
          },
        }
      },
    },
  })
  const markerSource = createCollection<Marker, number>({
    getKey: (marker) => marker.id,
    syncMode: `on-demand`,
    sync: {
      sync: (operations) => {
        operations.markReady()
        return {
          loadSubset: (options) => {
            const deliver = () => {
              if (options.signal?.aborted) return true
              operations.begin()
              for (const value of markers) {
                if (
                  installedMarkers.has(value.id) ||
                  !queryMatches(options, value)
                )
                  continue
                installedMarkers.add(value.id)
                operations.write({ type: `insert`, value })
              }
              return operations.commit(options.signal)
            }
            if (!history.holdJoined) return deliver()
            return (async () => {
              if (requests.phase === `replay` && joined.isPending()) {
                requests.pendingJoined++
                await joined.promise
                requests.pendingJoined--
              }
              await deliver()
            })()
          },
          unloadSubset: () => {},
        }
      },
    },
  })
  const query = (q: InitialQueryBuilder) =>
    q
      .from({ row: source })
      .leftJoin({ marker: markerSource }, ({ row, marker }) =>
        eq(row.id, marker.rowId),
      )
      .where(({ marker }) => gte(marker.rowId, 0))
      .orderBy(({ row }) => row.rank)
      .limit(history.limit)
      .select(({ row }) => ({ id: row.id, rank: row.rank }))

  const effectRows = new Map<number, Row>()
  const errors: Array<unknown> = []
  const publications: Array<Array<Row>> = []
  const live =
    history.receiver === `collection`
      ? createLiveQueryCollection(query)
      : undefined
  const visible = () => snapshot(live?.values() ?? effectRows.values())
  const subscription = live?.subscribeChanges(() =>
    publications.push(visible()),
  )
  const effect =
    history.receiver === `effect`
      ? createEffect<Row, number>({
          query,
          onBatch: (events) => {
            for (const event of events) {
              if (event.type === `exit`) effectRows.delete(event.key)
              else effectRows.set(event.key, event.value)
            }
            publications.push(visible())
          },
          onSourceError: (error) => errors.push(error),
        })
      : undefined
  const move: {
    outcome?: MoveOutcome
    rowsAtFulfillment?: Array<Row>
    windowAtFulfillment?: JoinedReplayHistory[`move`]
  } = {}
  const cut = (): Cut => ({
    rows: visible(),
    publications: [...publications],
    installed: snapshot(source.values()),
    window: live?.utils.getWindow(),
    moveOutcome: move.outcome,
  })

  return withHistoryCleanup(
    async () => {
      await live?.preload()
      await flushPromises()
      const initial = visible()
      publications.length = 0

      requests.phase = `repair`
      const moved = { ...history.initial[0]!, rank: history.initial.length + 1 }
      providerRows = [moved, ...history.initial.slice(1)]
      installed.set(moved.id, moved)
      rootSync.begin()
      rootSync.write({ type: `update`, value: moved })
      await rootSync.commit()
      await flushPromises()
      if (history.trigger === `explicit`) {
        await startReplay()
        repair.resolve()
      }
      await flushPromises()
      const waitingForReplay = cut()

      if (history.move && live) {
        move.outcome = `pending`
        const fulfilled = () => {
          move.outcome = `fulfilled`
          move.rowsAtFulfillment = visible()
          move.windowAtFulfillment = live.utils.getWindow()
        }
        const result = live.utils.setWindow(history.move)
        if (result === true) fulfilled()
        else
          void result.then(fulfilled, (error: unknown) => {
            move.outcome = error === failure ? `rejected` : `different error`
          })
      }

      replay.resolve()
      await flushPromises()
      const afterReplayAnswers = cut()
      const joinedDemandHeld = requests.pendingJoined > 0
      const rootReadyWhileJoined =
        requests.replay > 0 &&
        joinedDemandHeld &&
        rootSubscription?.status === `ready` &&
        requests.pendingRefill === 0

      joined.resolve()
      await flushPromises()
      const waitingForRefill = cut()
      const heldRefill = requests.pendingRefill > 0

      let settled: Cut
      let laterReplayTrace: JoinedReplayTrace[`laterReplay`]
      if (history.laterReplay) {
        requests.phase = `later replay`
        await truncateTo(history.laterReplay.rows)
        await flushPromises()
        const held = cut()
        const started = requests.laterReplay > 0
        const obsoleteAborted = refillSignal?.aborted === true
        laterReplay.resolve()
        await flushPromises()
        settled = cut()
        const obsoleteStillPending = requests.pendingRefill > 0
        refill.resolve()
        await flushPromises()
        laterReplayTrace = {
          held,
          started,
          obsoleteAborted,
          obsoleteStillPending,
          afterObsoleteSettlement: cut(),
        }
        // A subsequent valid ordering write exposes repair debt that a late
        // aborted rejection could have silently left behind.
        if (history.laterReplay.outcome === `fulfills`) {
          requests.phase = `after replay`
          const moved = history.laterReplay.subsequentWrite
          providerRows = providerRows.map((row) =>
            row.id === moved.id ? moved : row,
          )
          installed.set(moved.id, moved)
          rootSync.begin()
          rootSync.write({ type: `update`, value: moved })
          await rootSync.commit()
          await flushPromises()
          laterReplayTrace.nextRepair = {
            rows: visible(),
            bounded: requests.nextRepairBounded,
            unbounded: requests.nextRepairUnbounded,
          }
        }
      } else {
        refill.resolve()
        await flushPromises()
        settled = cut()
      }
      const error = live ? live.utils.lastSubsetError : errors[0]
      const originatingError =
        history.laterReplay?.outcome === `rejects` ? laterFailure : failure
      return {
        initial,
        waitingForReplay,
        afterReplayAnswers,
        waitingForRefill,
        settled,
        repairStarted: requests.repairStarted,
        replayRequests: requests.replay,
        joinedDemandHeld,
        rootReadyWhileJoined,
        heldRefill,
        refillRevalidates: requests.refillRevalidates,
        rowsAtMoveFulfillment: move.rowsAtFulfillment,
        windowAtMoveFulfillment: move.windowAtFulfillment,
        laterReplay: laterReplayTrace,
        reportedError:
          error === undefined
            ? `none`
            : error === originatingError
              ? `originating error`
              : `different error`,
      }
    },
    () => {
      repair.resolve()
      replay.resolve()
      laterReplay.resolve()
      joined.resolve()
      refill.resolve()
      return [
        () => subscription?.unsubscribe(),
        () => effect?.dispose(),
        () => live?.cleanup(),
        () => markerSource.cleanup(),
        () => source.cleanup(),
      ]
    },
  )
}
