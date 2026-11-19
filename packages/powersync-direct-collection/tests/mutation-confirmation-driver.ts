/**
 * The same actual Collection/SDK production path runs in Node and Chromium.
 * This module records facts only. The shared mutation-confirmation owner and
 * the cancellation projection judge its trace in the receiving runner.
 */
import {
  createCollection,
  createLiveQueryCollection,
  createTransaction,
} from '@tanstack/db'
import { withOracleCleanup } from '../../db/tests/oracle-cleanup'
import { PowerSyncClient, powerSyncCollectionOptions } from '../src'
import {
  MutationService,
  atCheckpoint,
  deferred,
} from './mutation-confirmation-service'
import type {
  MutationConfirmationCut,
  MutationConfirmationHistory,
  MutationConfirmationInputs,
  MutationConfirmationObservation,
} from '../../db/tests/mutation-confirmation-oracle'

export type DirectMutationRow = { id: string; name: string; stable: string }
export type DirectMutationHistory = Omit<
  MutationConfirmationHistory,
  `adapter` | `confirmation` | `returned`
> & {
  adapter: `powersync-direct`
  confirmation: `none` | `checkpoint`
  returned: `void`
  syncMode: `eager` | `on-demand`
  responseOrder: `response-first` | `checkpoint-first`
  entry: `handler` | `transaction`
  text: string
  cancel?: `signal` | `cleanup`
}
export type DirectMutationCut =
  | MutationConfirmationCut
  | `settlement-waiter`
  | `checkpoint-response-received`
  | `checkpoint-downloaded`
export type DirectMutationTrace = {
  browserErrors?: ReadonlyArray<string>
  failure: Error
  cuts: Array<{
    cut: DirectMutationCut
    observation: MutationConfirmationObservation<DirectMutationRow>
  }>
  publications: Array<Array<DirectMutationRow>>
  reached: Array<string>
  cancellation?: { confirmation: boolean; rejectionName: string | undefined }
}

type TransportError =
  | { kind: `none` }
  | { kind: `handler` }
  | { kind: `other`; name: string; message: string }
export type TransportMutationTrace = Omit<
  DirectMutationTrace,
  `failure` | `cuts`
> & {
  failure: { name: string; message: string }
  cuts: Array<{
    cut: DirectMutationCut
    observation: Omit<
      MutationConfirmationObservation<DirectMutationRow>,
      `error`
    > & { error: TransportError }
  }>
}

/** Preserve the observed identity relation when a browser trace crosses JSON. */
export function transportMutationTrace(
  trace: DirectMutationTrace,
): TransportMutationTrace {
  return {
    ...trace,
    failure: { name: trace.failure.name, message: trace.failure.message },
    cuts: trace.cuts.map(({ cut, observation }) => ({
      cut,
      observation: {
        ...observation,
        error:
          observation.error === undefined
            ? { kind: `none` }
            : observation.error === trace.failure
              ? { kind: `handler` }
              : {
                  kind: `other`,
                  name:
                    observation.error instanceof Error
                      ? observation.error.name
                      : typeof observation.error,
                  message:
                    observation.error instanceof Error
                      ? observation.error.message
                      : String(observation.error),
                },
      },
    })),
  }
}

/** Restore that relation for the exact shared Error-identity comparison. */
export function receiveMutationTrace(
  trace: TransportMutationTrace,
): DirectMutationTrace {
  const failure = new Error(trace.failure.message)
  failure.name = trace.failure.name
  return {
    ...trace,
    failure,
    cuts: trace.cuts.map(({ cut, observation }) => ({
      cut,
      observation: {
        ...observation,
        error:
          observation.error.kind === `none`
            ? undefined
            : observation.error.kind === `handler`
              ? failure
              : Object.assign(new Error(observation.error.message), {
                  name: observation.error.name,
                }),
      },
    })),
  }
}

export function directMutationInputs(
  text: string,
): MutationConfirmationInputs<DirectMutationRow> {
  return {
    before: { id: `1`, name: `before:${text}`, stable: `initial` },
    optimistic: { id: `1`, name: `optimistic:${text}`, stable: `initial` },
    confirmed: { id: `1`, name: `confirmed:${text}`, stable: `server` },
    peer: { id: `2`, name: `peer:${text}`, stable: `untouched` },
  }
}

export async function runDirectMutationConfirmation(
  history: DirectMutationHistory,
): Promise<DirectMutationTrace> {
  const inputs = directMutationInputs(history.text)
  const service = new MutationService()
  const client = new PowerSyncClient({
    endpoint: `http://localhost:8080`,
    getToken: () => `token`,
    fetch: service.fetch,
    retryDelayMs: 1,
  })
  const enterRelease = deferred<void>()
  const backendCommitted = deferred<void>()
  const requestRelease = deferred<void>()
  const confirmationAccepted = deferred<void>()
  const settleRelease = deferred<void>()
  const entered = deferred<void>()
  const abort = new AbortController()
  const failure = new Error(`handler:${history.outcome}:${history.text}`)
  failure.name = history.cancel ? `AbortError` : `Error`
  const result: DirectMutationTrace = {
    failure,
    cuts: [],
    publications: [],
    reached: [],
  }
  let handlerWrites = 0
  let confirmationCalls = 0
  let confirmationStatus: MutationConfirmationObservation[`confirmationStatus`] = `not-requested`
  let settlement: MutationConfirmationObservation[`settlement`] = `pending`
  let error: unknown
  let cancelConfirmation = false
  let transaction!: {
    state: string
    when: (state: `settled`) => Promise<unknown>
  }
  let waiter:
    Promise<MutationConfirmationObservation<DirectMutationRow>> | undefined

  // These holds separate backend commit, actual HTTP request, source download,
  // handler return and publication. No hold supplies the confirmation itself.
  const handler = async () => {
    entered.resolve()
    await enterRelease.promise
    if (history.outcome === `reject-before-write`) throw failure
    handlerWrites++
    backendCommitted.resolve()
    await requestRelease.promise
    if (history.confirmation === `checkpoint`) {
      confirmationCalls++
      confirmationStatus = `pending`
      await collection.utils.confirmWrites({ signal: abort.signal })
      confirmationStatus = `accepted`
      cancelConfirmation = true
    }
    confirmationAccepted.resolve()
    await settleRelease.promise
    if (history.outcome === `reject-after-write`) throw failure
  }
  const collection = createCollection(
    powerSyncCollectionOptions<DirectMutationRow>({
      client,
      table: `tasks`,
      ...(history.syncMode === `on-demand`
        ? { getSubscriptions: () => [{ name: `tasks` }] }
        : { streams: [{ name: `tasks` }] }),
      parse: (row) => row as DirectMutationRow,
      onInsert: handler,
      onUpdate: handler,
      onDelete: handler,
    }),
  )
  // A real query owns the on-demand acquisition for the whole mutation.
  const query =
    history.syncMode === `on-demand`
      ? createLiveQueryCollection((q) => q.from({ task: collection }))
      : undefined
  // The shared law judges ordinary authored row fields, not virtual metadata.
  const rows = () =>
    collection.toArray
      .map(({ id, name, stable }) => ({ id, name, stable }))
      .sort((a, b) => a.id.localeCompare(b.id))
  const observe = (): MutationConfirmationObservation<DirectMutationRow> => ({
    rows: rows(),
    handlerWrites,
    confirmationCalls,
    confirmationStatus,
    fetches: 0,
    providerRequests: service.checkpointRequests,
    state: transaction.state,
    settlement,
    error,
  })
  const cut = (name: DirectMutationCut) =>
    result.cuts.push({ cut: name, observation: observe() })
  let subscription: ReturnType<typeof collection.subscribeChanges> | undefined
  const deliverConfirmation = () =>
    service.deliver(
      history.operation === `delete` ? [] : [inputs.confirmed],
      history.operation === `delete` ? [`1`] : [],
      `1`,
    )
  const deliveredConfirmation = async () => {
    const delivered = deferred<void>()
    let initial = true
    const release = client.listen(`tasks`, {
      onChanges: () => {
        if (initial) initial = false
        else delivered.resolve()
      },
    })
    try {
      deliverConfirmation()
      await atCheckpoint(delivered.promise, `source rows delivered by SDK`)
    } finally {
      release()
    }
  }
  return withOracleCleanup(async () => {
    const ready = query ? query.preload() : collection.preload()
    await atCheckpoint(service.connected.promise, `initial sync request`)
    service.deliver([
      ...(history.operation === `insert` ? [] : [inputs.before]),
      ...(history.peer ? [inputs.peer] : []),
    ])
    await atCheckpoint(ready, `initial collection ready`)
    subscription = collection.subscribeChanges(() =>
      result.publications.push(rows()),
    )
    const mutate = () => {
      if (history.operation === `insert`)
        return collection.insert({ ...inputs.optimistic })
      if (history.operation === `delete`) return collection.delete(`1`)
      return collection.update(`1`, (draft) => {
        draft.name = inputs.optimistic.name
      })
    }
    if (history.entry === `transaction`) {
      const manual = createTransaction<DirectMutationRow>({
        mutationFn: handler,
      })
      manual.mutate(() => {
        mutate()
      })
      transaction = manual
    } else transaction = mutate()
    waiter = transaction.when(`settled`).then(
      () => {
        settlement = `fulfilled`
        return observe()
      },
      (reason: unknown) => {
        settlement = `rejected`
        error = reason
        return observe()
      },
    )
    await atCheckpoint(entered.promise, `authored handler entry`)
    result.reached.push(
      `entry:${history.entry}`,
      `operation:${history.operation}`,
      `mode:${history.syncMode}`,
    )
    if (!history.cancel)
      result.reached.push(
        `path:${history.syncMode}:${history.operation}:${history.entry}`,
      )
    cut(`entered`)
    enterRelease.resolve()
    if (history.outcome !== `reject-before-write`) {
      await atCheckpoint(backendCommitted.promise, `backend commit`)
      cut(`server-written`)
      requestRelease.resolve()
      if (history.confirmation === `checkpoint`) {
        await atCheckpoint(service.requested.promise, `real checkpoint POST`)
        cut(`confirmation-requested`)
        result.reached.push(`requested-after-backend`)
        if (history.cancel) {
          service.requestResponse.resolve()
          await atCheckpoint(
            service.responseRead.promise,
            `SDK read checkpoint response`,
          )
          // Let the already consumed response's SDK/handler continuations run.
          await new Promise((resolve) => setTimeout(resolve, 0))
          cut(`checkpoint-response-received`)
          if (history.cancel === `signal`) abort.abort(failure)
          else await collection.cleanup({ dependents: true })
          const atWaiter = await atCheckpoint(
            waiter,
            `cancelled handler settlement`,
          )
          result.cuts.push({ cut: `settlement-waiter`, observation: atWaiter })
          cut(`settled`)
          result.reached.push(
            `cancel:${history.cancel}`,
            `cancel-path:${history.syncMode}:${history.cancel}:${history.entry}`,
          )
          result.cancellation = {
            confirmation: cancelConfirmation,
            rejectionName: error instanceof Error ? error.name : undefined,
          }
          return result
        }
        if (history.responseOrder === `checkpoint-first`) {
          await deliveredConfirmation()
          // The real SDK listener saw these rows; allow a wrongly early
          // confirmation continuation to run while the POST remains held.
          await new Promise((resolve) => setTimeout(resolve, 0))
          cut(`checkpoint-downloaded`)
          result.reached.push(`pending:checkpoint-downloaded`)
          service.requestResponse.resolve()
        } else {
          service.requestResponse.resolve()
          await atCheckpoint(
            service.responseRead.promise,
            `SDK read checkpoint response`,
          )
          // The SDK consumed the body. Drain its continuations while source
          // delivery is still held, so response-only acknowledgement is seen.
          await new Promise((resolve) => setTimeout(resolve, 0))
          cut(`checkpoint-response-received`)
          result.reached.push(`pending:checkpoint-response-received`)
          deliverConfirmation()
        }
        await atCheckpoint(
          confirmationAccepted.promise,
          `utility accepted checkpoint`,
        )
        result.reached.push(`order:${history.responseOrder}`)
        cut(`confirmation-accepted`)
      } else
        await atCheckpoint(confirmationAccepted.promise, `unconfirmed handler`)
      settleRelease.resolve()
    }
    const atWaiter = await atCheckpoint(waiter, `handler settlement`)
    result.cuts.push({ cut: `settlement-waiter`, observation: atWaiter })
    cut(`settled`)
    result.reached.push(`outcome:${history.outcome}`)
    if (
      history.confirmation === `none` &&
      history.outcome !== `reject-before-write`
    ) {
      await deliveredConfirmation()
      cut(`late-confirmed`)
      result.reached.push(`late-confirmation`)
    }
    return result
  }, [
    () => {
      enterRelease.resolve()
      requestRelease.resolve()
      settleRelease.resolve()
      service.requestResponse.resolve()
      abort.abort()
    },
    () => subscription?.unsubscribe(),
    () => query?.cleanup(),
    () => collection.cleanup(),
    () => waiter && atCheckpoint(waiter, `cleanup handler settlement`),
  ])
}
