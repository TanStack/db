/**
 * Public built-in CRUD handlers run through the installed TrailBase SDK. HTTP
 * response consumption and actual source commits supply the two premises. The
 * driver records public rows and transaction settlement after either alone and
 * after both; provider delivery does not supply expected observations.
 */
import { createCollection, createLiveQueryCollection } from '@tanstack/db'
import {
  describeOracleCleanupError,
  withOracleCleanup,
} from '../../db/tests/oracle-cleanup'
import { trailBaseCollectionOptions } from '../src/trailbase'
import { TrailBaseSdkService, untilSdk } from './sdk-service'
import {
  mutationEventInputs,
  mutationEventRows,
} from './mutation-events-sdk-oracle'
import type { MutationConfirmationRow } from '../../db/tests/mutation-confirmation-oracle'
import type {
  MutationEventCut,
  MutationEventHistory,
  MutationEventResult,
  MutationEventState,
} from './mutation-events-sdk-oracle'

export async function observeMutationEvent(
  h: MutationEventHistory,
  lateCleanupFailure = false,
  awaitOwnAppliedReceipt = false,
): Promise<MutationEventResult> {
  const service = new TrailBaseSdkService<MutationConfirmationRow>()
  service.rows = mutationEventRows(h, `initial`)
  let consumed = false
  // These wrappers acknowledge completion of the actual installed SDK CRUD
  // methods. They forward its values and failures and supply no source event.
  const createBulk = service.api.createBulk.bind(service.api)
  service.api.createBulk = async (rows) => {
    const ids = await createBulk(rows)
    consumed = true
    return ids
  }
  const update = service.api.update.bind(service.api)
  service.api.update = async (id, row) => {
    await update(id, row)
    consumed = true
  }
  const remove = service.api.delete.bind(service.api)
  service.api.delete = async (id) => {
    await remove(id)
    consumed = true
  }
  const inputs = mutationEventInputs(h)
  const options = trailBaseCollectionOptions({
    recordApi: service.api,
    getKey: (row: MutationConfirmationRow) => row.id,
    syncMode: h.mode,
    parse: {},
    serialize: {},
  })
  let commits = 0
  let lastAppliedReceipt: true | Promise<void> = true
  const upstream = options.sync
  options.sync = {
    ...upstream,
    sync: (params) =>
      upstream.sync({
        ...params,
        commit: (signal) => {
          commits++
          lastAppliedReceipt = params.commit(signal)
          return lastAppliedReceipt
        },
      }),
  }
  // Checker calibration installs the plausible deadlocking repair at the
  // actual handler boundary: wait for the accepted source receipt that its
  // persisting transaction itself holds. The bounded recorder below must see
  // pending rather than hang before comparison or cleanup.
  if (awaitOwnAppliedReceipt) {
    const onInsert = options.onInsert!
    options.onInsert = async (params) => {
      await onInsert(params)
      await lastAppliedReceipt
    }
    const onUpdate = options.onUpdate!
    options.onUpdate = async (params) => {
      await onUpdate(params)
      await lastAppliedReceipt
    }
    const onDelete = options.onDelete!
    options.onDelete = async (params) => {
      await onDelete(params)
      await lastAppliedReceipt
    }
  }
  const collection = createCollection(options)
  const query =
    h.mode === `on-demand`
      ? createLiveQueryCollection((q) => q.from({ row: collection }))
      : undefined
  let transaction: ReturnType<typeof collection.insert> | undefined
  let delivered = false
  let responded = false
  const deliver = () => {
    delivered = true
    service.emit(
      h.operation === `delete`
        ? { Delete: inputs.before }
        : h.operation === `insert`
          ? { Insert: inputs.confirmed }
          : { Update: inputs.confirmed },
    )
  }
  const respond = () => {
    responded = true
    service.writes[0]!.resolve([inputs.confirmed.id])
  }
  let completed: MutationEventResult | undefined
  const originalNow = Date.now
  const recordHistory = async (): Promise<MutationEventResult> => {
    // Event identity cannot depend on wall-clock advancement. The service's
    // premise deadline uses performance.now(), so freezing this clock cannot
    // turn a missing request into an unbounded driver wait.
    if (h.clockMode === `fixed`) Date.now = () => h.coordinate
    await collection.preload()
    await query?.preload()
    const beforePriming = commits
    if (h.previousEvent) {
      service.emit(
        h.operation === `insert`
          ? { Insert: inputs.before }
          : { Update: inputs.before },
      )
      if (h.operation === `insert`) service.emit({ Delete: inputs.before })
      await service.propagate()
    }
    const primed = commits > beforePriming
    const previousCommits = commits
    let settlement = `pending`
    transaction =
      h.operation === `insert`
        ? collection.insert(inputs.optimistic)
        : h.operation === `delete`
          ? collection.delete(inputs.before.id)
          : collection.update(inputs.before.id, (draft) => {
              draft.name = inputs.optimistic.name
            })
    void transaction.when(`settled`).then(
      () => {
        settlement = `fulfilled`
      },
      () => {
        settlement = `rejected`
      },
    )
    await untilSdk(
      () => service.writes.length > 0,
      `built-in handler issued CRUD HTTP`,
    )
    const cuts: Array<MutationEventCut> = []
    const record = (name: MutationEventCut['name']) =>
      cuts.push({
        name,
        rows: collection.toArray
          .map(({ id, name: value, stable }) => ({ id, name: value, stable }))
          .sort((a, b) => a.id - b.id),
        state: transaction!.state,
        settlement,
        responseConsumed: consumed,
        sourceAccepted: commits > previousCommits,
      })
    record(`entered`)
    if (h.first === `response`) respond()
    else deliver()
    await service.propagate()
    record(`first-obligation`)
    if (h.first === `response`) deliver()
    else respond()
    await untilSdk(
      () => consumed && commits > previousCommits,
      `both backend completion and source acceptance`,
    )
    await service.propagate()
    record(`both-obligations`)
    const reached: Array<MutationEventState> = [
      h.operation,
      h.mode,
      h.first === `response` ? `response-first` : `event-first`,
      h.clockMode === `fixed` ? `fixed-clock` : `system-clock`,
    ]
    if (h.first === `response` && consumed && (!h.previousEvent || primed))
      reached.push(
        h.previousEvent
          ? `old-event-response-first`
          : `fresh-event-response-first`,
      )
    if (
      h.clockMode === `fixed` &&
      h.previousEvent &&
      primed &&
      h.first === `response`
    )
      reached.push(`same-clock-prior-event`)
    completed = { cuts, reached }
    return completed
  }
  const cleanups = [
    async () => {
      if (transaction) {
        if (!responded && service.writes.length) respond()
        if (!delivered) deliver()
        await service.propagate()
        // Rescue occurs only after the public cuts were captured. A hostile
        // handler that awaits its own receipt must not prevent subsequent
        // Collection and SDK cleanup from releasing resources.
        if (
          transaction.state === `persisting` ||
          transaction.state === `pending`
        )
          transaction.rollback()
        await service.propagate()
      }
    },
    () => query?.cleanup(),
    () => collection.cleanup(),
    () => {
      service.dispose()
      if (lateCleanupFailure) throw new Error(`Injected TrailBase late cleanup`)
    },
    () => {
      Date.now = originalNow
    },
  ]
  // Comparisons happen in the shared registrar after the host returns. Retain
  // completed public cuts if teardown fails, and return its separate diagnostic
  // so that it cannot replace the earlier semantic mismatch. A setup failure
  // still escapes through the generic failure-preserving cleanup helper.
  return withOracleCleanup(
    recordHistory,
    cleanups.map((cleanup) => async () => {
      try {
        await cleanup()
      } catch (error) {
        if (!completed) throw error
        ;(completed.cleanupErrors ??= []).push(
          describeOracleCleanupError(error),
        )
      }
    }),
  )
}
