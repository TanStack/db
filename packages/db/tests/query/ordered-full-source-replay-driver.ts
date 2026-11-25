import { vi } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import { createDeferred } from '../../src/deferred.js'
import { createLiveQueryCollection } from '../../src/query/live-query-collection.js'
import { evaluateReferenceExpression } from '../reference-expression-oracle.js'
import type { LoadSubsetOptions, SyncConfig } from '../../src/types.js'

type Row = { id: number; rank: number }
type Sync = Parameters<SyncConfig<Row, number>[`sync`]>[0]

export type FullSourceRetryReplayHistory = {
  width: 2 | 3
  truncateOn: `superseded finite demand` | `failed full-source demand`
  initial: ReadonlyArray<Row>
  replacement: ReadonlyArray<Row>
}

// A real Collection grows its finite window, then a source ordering change
// supersedes that read. Its late failure makes the bounded repair start a
// covering read. A retry unload starts replay either while that failed
// covering demand is still retained or when the retry releases it.
export async function receiveFullSourceRetryReplay(
  history: FullSourceRetryReplayHistory,
) {
  vi.useFakeTimers({ toFake: [`setTimeout`, `clearTimeout`] })
  const finite = createDeferred<void>()
  const bounded = createDeferred<void>()
  const full = createDeferred<void>()
  const replay = createDeferred<void>()
  const finiteFailure = new Error(`superseded finite demand failed`)
  const fullFailure = new Error(`full-source demand failed`)
  let phase: `initial` | `finite` | `repair` | `replay` | `after replay` =
    `initial`
  let finiteDemand: LoadSubsetOptions | undefined
  let boundedDemand: LoadSubsetOptions | undefined
  let fullDemand: LoadSubsetOptions | undefined
  const replayFullDemands: Array<LoadSubsetOptions> = []
  let releasedReplayFullDemands = 0
  let loadsAfterReplay = 0
  let retryUnloaded: FullSourceRetryReplayHistory[`truncateOn`] | undefined
  let sync!: Sync
  let providerRows = history.initial
  const installed = new Set<number>()
  const source = createCollection<Row, number>({
    getKey: (row) => row.id,
    syncMode: `on-demand`,
    autoIndex: `off`,
    sync: {
      sync: (operations) => {
        sync = operations
        operations.markReady()
        return {
          loadSubset: (options) => {
            const isFullSource =
              options.orderBy === undefined &&
              options.where === undefined &&
              options.cursor === undefined &&
              options.limit === undefined
            const deliver = () => {
              if (options.signal?.aborted) return true
              const rows = providerRows
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
                .slice(0, options.limit)
              operations.begin()
              for (const value of rows) {
                if (installed.has(value.id)) continue
                installed.add(value.id)
                operations.write({ type: `insert`, value })
              }
              return operations.commit(options.signal)
            }
            const deliverAfter = (gate: typeof finite) =>
              gate.promise.then(() => {
                const receipt = deliver()
                return receipt === true ? undefined : receipt
              })
            if (phase === `finite` && finiteDemand === undefined) {
              finiteDemand = options
              return deliverAfter(finite)
            }
            if (
              phase === `repair` &&
              options.refetch &&
              options.orderBy &&
              boundedDemand === undefined
            ) {
              boundedDemand = options
              return deliverAfter(bounded)
            }
            if (
              phase === `repair` &&
              isFullSource &&
              fullDemand === undefined
            ) {
              fullDemand = options
              return deliverAfter(full)
            }
            if (phase === `replay` && isFullSource) {
              replayFullDemands.push(options)
              return deliverAfter(replay)
            }
            if (phase === `after replay`) loadsAfterReplay++
            return deliver()
          },
          unloadSubset: (options) => {
            if (replayFullDemands.includes(options)) releasedReplayFullDemands++
            const unloaded =
              options === finiteDemand
                ? `superseded finite demand`
                : options === fullDemand
                  ? `failed full-source demand`
                  : undefined
            if (phase !== `repair` || unloaded !== history.truncateOn) return
            retryUnloaded = unloaded
            phase = `replay`
            providerRows = history.replacement
            installed.clear()
            operations.begin()
            operations.truncate()
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
      .limit(1),
  )
  const visible = () => live.toArray.map(({ id }) => id)
  const publications: Array<Array<number>> = []
  const subscription = live.subscribeChanges(() => publications.push(visible()))
  const flush = () => vi.advanceTimersByTimeAsync(0)
  try {
    await live.preload()
    const initial = visible()
    phase = `finite`
    const growth = live.utils.setWindow({ offset: 0, limit: history.width })
    let growthFailedWithOriginal = false
    if (growth !== true) {
      void growth.catch((error) => {
        growthFailedWithOriginal = error === finiteFailure
      })
    }
    await flush()

    phase = `repair`
    const value = { ...providerRows[0]!, rank: providerRows.length + 1 }
    providerRows = [...providerRows.slice(1), value]
    sync.begin()
    sync.write({ type: `update`, value })
    await sync.commit()
    await flush()
    finite.reject(finiteFailure)
    await flush()
    bounded.resolve()
    await flush()
    full.reject(fullFailure)
    await flush()

    const originalFullFailure = live.utils.lastSubsetError === fullFailure
    publications.length = 0
    await vi.advanceTimersByTimeAsync(250)
    await flush()
    const held = {
      rows: visible(),
      publications: [...publications],
      fullLoads: replayFullDemands.length,
    }
    replay.resolve()
    await flush()
    const settled = {
      rows: visible(),
      publications: [...publications],
      clearedFailure: !live.health.hasErrors,
    }
    phase = `after replay`
    const move = live.utils.setWindow({ offset: 0, limit: history.width + 1 })
    if (move !== true) await move
    await flush()
    return {
      initial,
      growthFailedWithOriginal,
      originalFullFailure,
      retryUnloaded,
      held,
      settled,
      moved: visible(),
      loadsAfterReplay,
      releasedReplayFullDemands,
      boundedRepair: boundedDemand !== undefined,
    }
  } finally {
    for (const gate of [finite, bounded, full, replay]) gate.resolve()
    subscription.unsubscribe()
    await live.cleanup()
    await source.cleanup()
    vi.useRealTimers()
  }
}
