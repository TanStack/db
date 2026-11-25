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
  trigger: `explicit` | `retirement` | `reload`
  holdJoined: boolean
  answer: `complete` | `refill` | `refill-rejection`
  initial: ReadonlyArray<Row>
  replacement: ReadonlyArray<Row>
  eligible: ReadonlyArray<number>
  literalRoot?: boolean
  move?: { offset: number; limit: number }
  laterReplay?: {
    rows: ReadonlyArray<Row>
    subsequentWrite?:
      { type: `update`; value: Row } | { type: `delete`; key: number }
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
  postReplayRequests: Array<{
    refetch: boolean
    cursor: boolean
    tie: boolean
    limit: number | undefined
  }>
  firstRefillReturnedTrue: boolean
  reportedError: `none` | `originating error` | `different error`
  rowsAtMoveFulfillment?: Array<Row>
  windowAtMoveFulfillment?: JoinedReplayHistory[`move`]
  laterReplay?: {
    held: Cut
    started: boolean
    obsoleteAborted: boolean
    obsoleteStillPending: boolean
    settledError: JoinedReplayTrace[`reportedError`]
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
    firstRefillReturnedTrue: false,
    nextRepairBounded: false,
    nextRepairUnbounded: false,
  }
  const postReplayRequests: JoinedReplayTrace[`postReplayRequests`] = []
  let refillSignal: AbortSignal | undefined
  let replacedReloadRows = false

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
        const deliver = (
          options: LoadSubsetOptions,
        ): ReturnType<Sync<Row>[`commit`]> => {
          if (options.signal?.aborted) return true
          const offset = options.cursor ? 0 : (options.offset ?? 0)
          const page = providerRows
            .filter((row) => queryMatches(options, row))
            .sort((left, right) => left.rank - right.rank)
            .slice(
              offset,
              options.limit === undefined ? undefined : offset + options.limit,
            )
          operations.begin()
          // Reload preserves rows across sync runs. The new provider applies
          // its removals together with its first replacement answer.
          if (
            history.trigger === `reload` &&
            requests.phase === `replay` &&
            !replacedReloadRows
          ) {
            replacedReloadRows = true
            for (const key of installed.keys())
              operations.write({ type: `delete`, key })
            installed.clear()
          }
          for (const value of page) {
            if (installed.get(value.id) === value) continue
            operations.write({
              type: installed.has(value.id) ? `update` : `insert`,
              value: { ...value },
            })
            installed.set(value.id, value)
          }
          return operations.commit(options.signal)
        }
        const acquire = async (
          options: LoadSubsetOptions,
          phase: typeof requests.phase,
          isReplayDemand: boolean,
        ) => {
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
            if (history.trigger !== `retirement`) await repair.promise
          }
          if (isReplayDemand) {
            requests.replay++
            await replay.promise
          } else if (phase === `replay` && history.answer !== `complete`) {
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
          await deliver(options)
          if (
            phase === `later replay` &&
            history.laterReplay?.outcome === `rejects` &&
            !options.signal?.aborted
          )
            throw laterFailure
        }
        return {
          loadSubset: (options) => {
            rootSubscription = options.subscription
            const phase = requests.phase
            const isReplayDemand = phase === `replay` && replay.isPending()
            if (phase === `replay` && !isReplayDemand) {
              postReplayRequests.push({
                refetch: options.refetch === true,
                cursor: options.cursor !== undefined,
                tie:
                  options.orderBy === undefined && options.where !== undefined,
                limit: options.limit,
              })
              if (history.literalRoot && postReplayRequests.length === 1) {
                const result = deliver(options)
                requests.firstRefillReturnedTrue = result === true
                return result
              }
            }
            return acquire(options, phase, isReplayDemand)
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
  const visible = () =>
    live
      ? live.toArray.map(({ id, rank }) => ({ id, rank }))
      : snapshot(effectRows.values())
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
  const reportedError = (): JoinedReplayTrace[`reportedError`] => {
    const error = live ? live.utils.lastSubsetError : errors[0]
    if (error === undefined) return `none`
    const originatingError =
      history.laterReplay?.outcome === `rejects` ? laterFailure : failure
    return error === originatingError ? `originating error` : `different error`
  }

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
      if (history.trigger !== `retirement`) {
        if (history.trigger === `reload`) {
          requests.phase = `replay`
          providerRows = history.replacement
          void source.reload()
        } else {
          await startReplay()
        }
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
        const settledError = reportedError()
        const obsoleteStillPending = requests.pendingRefill > 0
        refill.resolve()
        await flushPromises()
        laterReplayTrace = {
          held,
          started,
          obsoleteAborted,
          obsoleteStillPending,
          settledError,
          afterObsoleteSettlement: cut(),
        }
        // A subsequent valid ordering write exposes repair debt that a late
        // aborted rejection could have silently left behind.
        const write = history.laterReplay.subsequentWrite
        if (write) {
          requests.phase = `after replay`
          if (write.type === `delete`) {
            providerRows = providerRows.filter(({ id }) => id !== write.key)
            installed.delete(write.key)
          } else {
            providerRows = providerRows.map((row) =>
              row.id === write.value.id ? write.value : row,
            )
            installed.set(write.value.id, write.value)
          }
          rootSync.begin()
          rootSync.write(write)
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
        postReplayRequests,
        firstRefillReturnedTrue: requests.firstRefillReturnedTrue,
        rowsAtMoveFulfillment: move.rowsAtFulfillment,
        windowAtMoveFulfillment: move.windowAtFulfillment,
        laterReplay: laterReplayTrace,
        reportedError: reportedError(),
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
