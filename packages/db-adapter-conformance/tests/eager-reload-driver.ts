/**
 * Real SDK receiving composition. The second sync invocation is held before
 * adapter entry, after core retired the old run. Replacing provider rows in
 * that gap supplies the missed-live-change premise without a mock row answer.
 * The actual sync then reads the real SDK. The recorder observes commit
 * invocation, public rows before delivery, and rows inside load fulfillment.
 */
import {
  createCollection,
  createTransaction,
  whenSyncAccepted,
} from '@tanstack/db'
import { retainOracleCleanupObservation } from '../../db/tests/oracle-cleanup'
import { sortedStartupRows, startupRows } from './persisted-startup-oracle'
import { startupTurn, untilStartup } from './persisted-startup-driver'
import type { CollectionConfig, SyncConfig } from '@tanstack/db'
import type { StartupRow } from './persisted-startup-oracle'
import type {
  EagerGateHistory,
  EagerGateObservation,
  EagerReloadHistory,
  EagerReloadObservation,
} from './eager-reload-oracle'

export type EagerReloadSDK = {
  // Preserve each adapter's full runtime configuration. The receiver only
  // depends on these common fields; schema and utility generics stay private
  // to their adapter instead of requiring every SDK to share one schema type.
  options: Pick<
    CollectionConfig<StartupRow, string>,
    `id` | `getKey` | `sync` | `syncMode`
  >
  replace: (rows: Array<StartupRow>) => Promise<void>
  /**
   * Finish the complete provider result's delivery and SDK consumption without
   * awaiting Collection readiness or receipt visibility. This must finish for
   * an empty result even if the adapter omits commit() and markReady(). A
   * synchronous receiver supplies an already resolved Promise and explains its
   * synchronous source path. A task delay alone does not establish this cut.
   */
  propagate: () => Promise<void>
  dispose: () => Promise<unknown>
}
export type EagerReloadAdapter = {
  open: (initial: Array<StartupRow>, id: string) => Promise<EagerReloadSDK>
}

// With no optimistic transaction, the external gate's release order has no
// contract meaning. Canonicalize only that absent-mutation fact; every observed
// mutation=true flag remains available to the unchanged raw judgment.
export function projectEagerReloadObservation(
  history: EagerReloadHistory,
  observed: EagerReloadObservation,
): EagerReloadObservation {
  return history.mutation
    ? observed
    : { ...observed, mutationReleasedBeforeFulfillment: false }
}

export async function observeEagerReload(
  adapter: EagerReloadAdapter,
  h: EagerReloadHistory,
  id: string,
  reached: () => void = () => {},
  invertSnapshot = false,
  omitTruncate = false,
): Promise<EagerReloadObservation> {
  const sdk = await adapter.open(startupRows(h.previous, 1), id)
  const source = sdk.options.sync.sync
  let enter!: () => void
  let entered = false
  let actualCleanup: ReturnType<typeof source>
  let run = 0
  let submittedRows = 0
  let submittedCommits = 0
  let sourceReadyCalls = 0
  const receipts: Array<true | Promise<void>> = []
  let ended = false
  const targetRun = h.start === `fresh` ? 1 : 2
  const sync: SyncConfig<StartupRow, string> = {
    ...sdk.options.sync,
    sync: (params) => {
      run++
      if (run !== targetRun) return source(params)
      enter = () => {
        actualCleanup = source({
          ...params,
          markReady: () => {
            sourceReadyCalls++
            params.markReady()
          },
          // Calibration changes only the source's declaration at its public
          // sync boundary. With no persistence this inverts the retained-row
          // predicate, as the historical operand mutant does.
          begin: (options) =>
            params.begin(
              invertSnapshot ? { snapshot: !options?.snapshot } : options,
            ),
          truncate: (options) => {
            if (!omitTruncate) params.truncate(options)
          },
          write: (message) => {
            submittedRows++
            params.write(message)
          },
          commit: (signal) => {
            submittedCommits++
            const receipt = params.commit(signal)
            receipts.push(receipt)
            return receipt
          },
        })
      }
      entered = true
      return () => {
        ended = true
        if (typeof actualCleanup === `function`) return actualCleanup()
        return actualCleanup?.cleanup?.()
      }
    },
  }
  const collection = createCollection({ ...sdk.options, sync, startSync: true })
  let releaseMutation!: () => void
  const mutationGate = new Promise<void>((resolve) => {
    releaseMutation = resolve
  })
  let mutation: ReturnType<typeof createTransaction> | undefined
  let mutationReleased = false
  let mutationSettled = !h.mutation
  return retainOracleCleanupObservation<EagerReloadObservation>(async () => {
    if (h.start === `reload`) await collection.preload()
    let settled = false
    let error: string | undefined
    let atFulfillment: Array<StartupRow> = []
    let mutationReleasedBeforeFulfillment = false
    let mutationSettledBeforeFulfillment = false
    void (
      h.start === `reload` ? collection.reload() : collection.preload()
    ).then(
      () => {
        settled = true
        mutationReleasedBeforeFulfillment = mutationReleased
        mutationSettledBeforeFulfillment = mutationSettled
        atFulfillment = sortedStartupRows(collection.values())
      },
      (cause: unknown) => {
        settled = true
        error = String(cause)
      },
    )
    await untilStartup(() => entered)
    await sdk.replace(startupRows(h.next, 2))
    if (h.mutation) {
      mutation = createTransaction({ mutationFn: () => mutationGate })
      mutation.mutate(() => collection.insert({ id: `optimistic`, value: 99 }))
      void mutation.when(`settled`).then(() => {
        mutationSettled = true
      })
    }
    const before = sortedStartupRows(collection.values())
    const beforeStatus = collection.status
    const settledBeforeSource = settled
    if (ended) throw new Error(`Target sync ended before source entry`)
    enter()
    // Provider completion establishes the premise independently of the tested
    // Collection verdict and source callbacks. An empty source can omit both
    // commit and readiness; it still reaches the raw comparison at this cut.
    await sdk.propagate()
    await Promise.all(receipts.map(whenSyncAccepted))
    reached()
    mutationReleased = true
    releaseMutation()
    await mutation?.when(`settled`)
    await Promise.all(receipts.map(whenSyncAccepted))
    await Promise.all(receipts)
    // Application is the premise. Never await the verdict being tested: a
    // source that forgets readiness must produce a pending raw observation,
    // rather than prevent comparison and cleanup. Complete any source work
    // unblocked by application through the receiver's independent barrier.
    await sdk.propagate()
    // Provider completion may issue a final empty-page receipt after the
    // earlier row-bearing receipts. Drain that actual completed delivery.
    await Promise.all(receipts.map(whenSyncAccepted))
    await Promise.all(receipts)
    // These turns drain finite continuations after delivery and application;
    // they do not impose a provider latency limit or stand in for consumption.
    for (let turn = 0; turn < 4; turn++) await startupTurn()
    return projectEagerReloadObservation(h, {
      before,
      beforeStatus,
      settledBeforeSource,
      settledAfterSource: settled,
      submittedRows,
      submittedCommits,
      sourceReadyCalls,
      acceptedCommits: receipts.length,
      atFulfillment,
      mutationReleasedBeforeFulfillment,
      mutationSettledBeforeFulfillment,
      final: sortedStartupRows(collection.values()),
      ...(error === undefined ? {} : { error }),
    })
  }, [() => releaseMutation(), () => collection.cleanup(), () => sdk.dispose()])
}

/**
 * The generic failure driver owns public Collection operations and cuts. A
 * receiver supplies only provider operations and its error projection. Its
 * propagation step must consume the failure and run resulting continuations.
 * Pending is recorded as a wrong verdict at that cut, never a test timeout.
 */
export type EagerGateAdapter = {
  sources: ReadonlyArray<string>
  open: (source: string) => Promise<{
    options: (id: string) => EagerReloadSDK[`options`]
    hold: () => void
    deliver: (rows: Array<StartupRow>) => Promise<void>
    reject: (message: string, reconnect: boolean) => Promise<void>
    propagate: () => Promise<void>
    terminalEntries: () => number
    prepareRecovery: (rows: Array<StartupRow>) => Promise<void>
    matchesFailure: (error: unknown, message: string) => boolean
    dispose: () => Promise<unknown>
  }>
}

export async function observeEagerGateFailure(
  adapter: EagerGateAdapter,
  h: EagerGateHistory,
  id: string,
): Promise<EagerGateObservation> {
  const provider = await adapter.open(h.source)
  const targetOptions = provider.options(`${id}-target`)
  const targetSource = targetOptions.sync.sync
  let targetRuns = 0
  targetOptions.sync = {
    ...targetOptions.sync,
    sync: (params) => {
      targetRuns++
      return targetSource(params)
    },
  }
  const target = createCollection(targetOptions)
  const peer =
    h.entry === `shared`
      ? createCollection(provider.options(`${id}-peer`))
      : undefined
  const message = `terminal eager failure ${h.failure}`
  type Outcome = `pending` | `fulfilled` | `rejected`
  const watch = (promise: Promise<unknown>) => {
    const result: { outcome: Outcome; error?: unknown } = { outcome: `pending` }
    void promise.then(
      () => {
        result.outcome = `fulfilled`
      },
      (error: unknown) => {
        result.outcome = `rejected`
        result.error = error
      },
    )
    return result
  }
  const cut = (result: ReturnType<typeof watch>) => ({
    outcome: result.outcome,
    rows: sortedStartupRows(target.values()),
    status: target.status,
    reloading: target.health.reloading,
    errorMatches: provider.matchesFailure(result.error, message),
    stoppedErrorMatches: provider.matchesFailure(
      target.health.error?.cause,
      message,
    ),
    hasErrors: target.health.hasErrors,
  })
  return retainOracleCleanupObservation<EagerGateObservation>(async () => {
    if (h.entry !== `fresh`) {
      const baseline = (peer ?? target).preload()
      await provider.deliver(startupRows(h.previous, 1))
      await baseline
    }
    let sharedFailureBeforeTarget = false
    if (peer) {
      await provider.reject(message, true)
      await provider.propagate()
      sharedFailureBeforeTarget = provider.terminalEntries() > 0
    } else provider.hold()
    const beforeEntries = provider.terminalEntries()
    const result = watch(
      h.entry === `reload` ? target.reload() : target.preload(),
    )
    const before = {
      rows: sortedStartupRows(target.values()),
      status: target.status,
    }
    if (!peer) await provider.reject(message, false)
    await provider.propagate()
    const failureReached = provider.terminalEntries() > beforeEntries
    const failure = cut(result)
    let retry: ReturnType<typeof cut> | undefined
    let retryRunStarted = false
    if (h.retry) {
      await provider.prepareRecovery(startupRows(h.next, 2))
      const beforeRetryRun = targetRuns
      const recovery = watch(target.reload())
      await provider.propagate()
      retry = cut(recovery)
      retryRunStarted = targetRuns > beforeRetryRun
    }
    return {
      before,
      failureReached,
      sharedFailureBeforeTarget,
      failure,
      retryRunStarted,
      ...(retry ? { retry } : {}),
    }
  }, [() => target.cleanup(), () => peer?.cleanup(), () => provider.dispose()])
}
