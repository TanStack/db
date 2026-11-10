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
import { withOracleCleanup } from '../../db/tests/oracle-cleanup'
import { sortedStartupRows, startupRows } from './persisted-startup-oracle'
import { untilStartup } from './persisted-startup-driver'
import type { CollectionConfig, SyncConfig } from '@tanstack/db'
import type { StartupRow } from './persisted-startup-oracle'
import type {
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
): Promise<EagerReloadObservation> {
  const sdk = await adapter.open(startupRows(h.previous, 1), id)
  const source = sdk.options.sync.sync
  let enter!: () => void
  let entered = false
  let actualCleanup: ReturnType<typeof source>
  let run = 0
  let submittedRows = 0
  let submittedCommits = 0
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
          // Calibration changes only the source's declaration at its public
          // sync boundary. With no persistence this inverts the retained-row
          // predicate, as the historical operand mutant does.
          begin: (options) =>
            params.begin(
              invertSnapshot ? { snapshot: !options?.snapshot } : options,
            ),
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
  return withOracleCleanup(async () => {
    if (h.start === `reload`) await collection.preload()
    let settled = false
    let error: string | undefined
    let atFulfillment: Array<StartupRow> = []
    let mutationReleasedBeforeFulfillment = false
    let mutationSettledBeforeFulfillment = false
    const pending = (
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
    await untilStartup(
      () =>
        settled ||
        (submittedCommits > 0 &&
          submittedRows >= startupRows(h.next, 2).length),
    )
    await Promise.all(receipts.map(whenSyncAccepted))
    reached()
    mutationReleased = true
    releaseMutation()
    await mutation?.when(`settled`)
    await pending
    await Promise.all(receipts.map(whenSyncAccepted))
    await Promise.all(receipts)
    return projectEagerReloadObservation(h, {
      before,
      beforeStatus,
      settledBeforeSource,
      submittedRows,
      submittedCommits,
      acceptedCommits: receipts.length,
      atFulfillment,
      mutationReleasedBeforeFulfillment,
      mutationSettledBeforeFulfillment,
      final: sortedStartupRows(collection.values()),
      ...(error === undefined ? {} : { error }),
    })
  }, [() => releaseMutation(), () => collection.cleanup(), () => sdk.dispose()])
}
