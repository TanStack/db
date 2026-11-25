/**
 * Actual SDK HTTP/SSE supplies response and accepted-event facts separately.
 * Terminal histories compare after native turns and before invoking production's
 * captured deadline callback. Buffered EOF is delivered without an intervening
 * turn. Cleanup/restart records the original handler independently of current
 * Collection rows, so a replacement event cannot hide adoption by that handler.
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
  if (h.reentrantEntry) {
    // The trigger leaves the normal initial rows, but must change the seed so
    // its public callback runs. A delete frees the key for a reentrant insert.
    service.rows =
      h.operation === `insert`
        ? [...service.rows, inputs.before]
        : service.rows.map((row) =>
            row.id === inputs.before.id
              ? { ...row, name: `seed-${row.id}` }
              : row,
          )
  }
  const options = trailBaseCollectionOptions({
    recordApi: service.api,
    getKey: (row: MutationConfirmationRow) => row.id,
    syncMode: h.mode,
    parse: {},
    serialize: {},
  })
  let syncRuns = 0
  const commits: Array<number> = []
  const confirmationAccepted: Array<boolean> = []
  let lastAppliedReceipt: true | Promise<void> = true
  const upstream = options.sync
  options.sync = {
    ...upstream,
    sync: (params) => {
      const run = syncRuns++
      commits[run] = 0
      let wroteConfirmation = false
      return upstream.sync({
        ...params,
        write: (message) => {
          if (
            message.type === `delete`
              ? (`key` in message && message.key === inputs.before.id) ||
                (`value` in message && message.value.id === inputs.before.id)
              : `value` in message &&
                message.value.name === inputs.confirmed.name
          )
            wroteConfirmation = true
          params.write(message)
        },
        commit: (signal) => {
          lastAppliedReceipt = params.commit(signal)
          commits[run] = (commits[run] ?? 0) + 1
          if (wroteConfirmation) confirmationAccepted[run] = true
          wroteConfirmation = false
          return lastAppliedReceipt
        },
      })
    },
  }
  let handlerSettlement = `pending`
  const recordHandler =
    <T>(handler: (params: T) => unknown) =>
    async (params: T) => {
      try {
        await handler(params)
        handlerSettlement = `fulfilled`
      } catch (error) {
        handlerSettlement = `rejected`
        throw error
      }
    }
  options.onInsert = recordHandler(options.onInsert!)
  options.onUpdate = recordHandler(options.onUpdate!)
  options.onDelete = recordHandler(options.onDelete!)
  // This wrong driver waits for the applied receipt its own handler holds.
  // Its public pending cut is compared before cleanup rescues that transaction.
  if (awaitOwnAppliedReceipt) {
    const onInsert = options.onInsert
    options.onInsert = async (params) => {
      await onInsert(params)
      await lastAppliedReceipt
    }
    const onUpdate = options.onUpdate
    options.onUpdate = async (params) => {
      await onUpdate(params)
      await lastAppliedReceipt
    }
    const onDelete = options.onDelete
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
  let reentrantStarted = false
  let reentrantSubscription:
    ReturnType<typeof collection.subscribeChanges> | undefined
  let responded = false
  let clockOffset = 0
  let pruneCallbacksInvoked = 0
  const replacementReadiness = { source: `absent`, query: `absent` }
  const originalNow = Date.now
  const originalSetTimeout = globalThis.setTimeout
  const originalClearTimeout = globalThis.clearTimeout
  const originalSetInterval = globalThis.setInterval
  const originalClearInterval = globalThis.clearInterval
  type ControlledTimer = { active: boolean; fire: () => void }
  const confirmationTimers = new Map<
    ReturnType<typeof setTimeout>,
    ControlledTimer
  >()
  const pruningTimers = new Map<
    ReturnType<typeof setInterval>,
    ControlledTimer
  >()
  // Keep the real callbacks and native timer handles. Only the explicit driver
  // deadline/prune actions invoke them early; SDK I/O retains its native clock.
  globalThis.setTimeout = ((...args: Parameters<typeof setTimeout>) => {
    const timer = originalSetTimeout(...args)
    if (args[1] === 120_000) {
      const record: ControlledTimer = {
        active: true,
        fire: () => {
          if (!record.active) return
          record.active = false
          originalClearTimeout(timer)
          args[0](...args.slice(2))
        },
      }
      confirmationTimers.set(timer, record)
    }
    return timer
  }) as typeof setTimeout
  globalThis.clearTimeout = ((timer: Parameters<typeof clearTimeout>[0]) => {
    const record = confirmationTimers.get(
      timer as ReturnType<typeof setTimeout>,
    )
    if (record) record.active = false
    originalClearTimeout(timer)
  }) as typeof clearTimeout
  globalThis.setInterval = ((...args: Parameters<typeof setInterval>) => {
    const timer = originalSetInterval(...args)
    if (args[1] === 120_000)
      pruningTimers.set(timer, {
        active: true,
        fire: () => args[0](...args.slice(2)),
      })
    return timer
  }) as typeof setInterval
  globalThis.clearInterval = ((timer: Parameters<typeof clearInterval>[0]) => {
    const record = pruningTimers.get(timer as ReturnType<typeof setInterval>)
    if (record) record.active = false
    originalClearInterval(timer)
  }) as typeof clearInterval
  const activeConfirmationTimers = () =>
    [...confirmationTimers.values()].filter((timer) => timer.active).length
  const end = () => {
    if (h.endKind === `eof` || h.streamEnd === `buffered-event`) service.close()
    else service.fail(new Error(`Source ended`))
  }
  const unconfirmed =
    h.missingEvent ||
    h.streamEnd === `before-request` ||
    h.streamEnd === `pending-confirmation` ||
    h.streamEnd === `retired-unconfirmed`
  const retired = h.streamEnd?.startsWith(`retired-`) === true
  const sourceEvent = () =>
    h.operation === `delete`
      ? { Delete: inputs.before }
      : h.operation === `insert`
        ? { Insert: inputs.confirmed }
        : { Update: inputs.confirmed }
  let bufferedBeforeAcceptance = false
  const deliver = () => {
    delivered = true
    if (unconfirmed) return
    const before = commits[0] ?? 0
    service.emit(sourceEvent())
    if (h.streamEnd === `buffered-event`) {
      bufferedBeforeAcceptance = commits[0] === before
      end()
    }
  }
  const respond = () => {
    responded = true
    service.writes[0]?.resolve([inputs.confirmed.id])
  }
  let completed: MutationEventResult | undefined
  const recordHistory = async (): Promise<MutationEventResult> => {
    Date.now = () =>
      (h.clockMode === `fixed` ? h.coordinate : originalNow()) + clockOffset
    await collection.preload()
    await query?.preload()
    const beforePriming = commits[0] ?? 0
    if (h.previousEvent) {
      service.emit(
        h.operation === `insert`
          ? { Insert: inputs.before }
          : { Update: inputs.before },
      )
      if (h.operation === `insert`) service.emit({ Delete: inputs.before })
      await service.propagate()
    }
    const primed = (commits[0] ?? 0) > beforePriming
    let previousCommits = commits[0] ?? 0
    const sourceAccepted = () => (commits[0] ?? 0) > previousCommits
    const waitForTerminal = () =>
      untilSdk(
        () => collection.health.error !== null,
        `terminal source reached public health after listener drain`,
      )
    const endAfterAcceptedEvent = async () => {
      if (
        h.streamEnd !== `after-event` ||
        !delivered ||
        service.streams.at(-1)?.ended
      )
        return
      await untilSdk(
        sourceAccepted,
        `fresh source event accepted before terminal stream`,
      )
      end()
      await waitForTerminal()
    }
    if (h.streamEnd === `before-request`) {
      end()
      await waitForTerminal()
    }
    let settlement = `pending`
    const startMutation = () => {
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
    }
    if (h.reentrantEntry) {
      reentrantSubscription = collection.subscribeChanges(
        (changes) => {
          if (
            reentrantStarted ||
            !changes.some(
              ({ key, value, type }) =>
                key === inputs.before.id &&
                value.name === inputs.before.name &&
                type === (h.operation === `insert` ? `delete` : `update`),
            )
          )
            return
          reentrantStarted = true
          startMutation()
        },
        { includeInitialState: false },
      )
      service.emit(
        h.operation === `insert`
          ? { Delete: inputs.before }
          : { Update: inputs.before },
      )
      await untilSdk(
        () => reentrantStarted,
        `public source change callback entered mutation`,
      )
      await service.propagate()
      // The triggering commit is older than the handler, including its final
      // return from synchronous publication. It supplies no confirmation fact.
      previousCommits = commits[0] ?? 0
    } else startMutation()
    await untilSdk(
      () => service.writes.length > 0 || settlement !== `pending`,
      `handler issued real CRUD HTTP or refused terminal source`,
    )
    const cuts: Array<MutationEventCut> = []
    const timerLeaksAtCuts: Array<string> = []
    const record = (name: MutationEventCut[`name`]) => {
      cuts.push({
        name,
        rows: collection.toArray
          .map(({ id, name: value, stable }) => ({ id, name: value, stable }))
          .sort((a, b) => a.id - b.id),
        state: transaction!.state,
        settlement,
        handlerSettlement,
        responseConsumed: consumed,
        sourceAccepted: sourceAccepted(),
      })
      if (handlerSettlement !== `pending` && activeConfirmationTimers())
        timerLeaksAtCuts.push(name)
    }
    record(`entered`)
    if (h.first === `response`) respond()
    else deliver()
    await endAfterAcceptedEvent()
    await service.propagate()
    let registeredBeforeEnd = false
    if (
      h.streamEnd === `pending-confirmation` ||
      h.streamEnd === `buffered-event`
    ) {
      await untilSdk(
        () =>
          consumed &&
          (activeConfirmationTimers() > 0 || handlerSettlement !== `pending`),
        `HTTP consumed and real confirmation wait registered`,
      )
      registeredBeforeEnd =
        consumed &&
        activeConfirmationTimers() > 0 &&
        handlerSettlement === `pending`
    }
    record(`first-obligation`)
    if (h.proofExpiry) {
      await untilSdk(
        sourceAccepted,
        `fresh confirmation accepted while HTTP remains held`,
      )
      if (consumed)
        throw new Error(`Proof-retention premise lost held HTTP response`)
      clockOffset = 300_001
      // A repair may remove this private cache and its interval altogether.
      // The law is proof retention, not existence of a pruning timer.
      for (const timer of pruningTimers.values())
        if (timer.active) {
          pruneCallbacksInvoked++
          timer.fire()
        }
      await service.propagate()
      record(`proof-retention`)
    }
    if (retired) {
      await query?.cleanup()
      await collection.cleanup()
      // The old HTTP-held transaction can park replacement source receipts.
      // Readiness is an observation, so do not await it before old settlement.
      replacementReadiness.source = `pending`
      void collection.preload().then(
        () => {
          replacementReadiness.source = `fulfilled`
        },
        () => {
          replacementReadiness.source = `rejected`
        },
      )
      if (query) {
        replacementReadiness.query = `pending`
        void query.preload().then(
          () => {
            replacementReadiness.query = `fulfilled`
          },
          () => {
            replacementReadiness.query = `rejected`
          },
        )
      }
      await untilSdk(
        () =>
          service.streams.length === 2 &&
          service.lists.some((list) => list.subscription === 2),
        `replacement SDK subscription and list entered`,
      )
      service.emit(sourceEvent())
      await untilSdk(
        () => confirmationAccepted[1] === true,
        `replacement event commit accepted before old HTTP response`,
      )
      await service.propagate()
      record(`replacement-event`)
    }
    if (h.streamEnd === `pending-confirmation`) {
      end()
      await waitForTerminal()
    }
    if (h.first === `response`) deliver()
    else respond()
    await endAfterAcceptedEvent()
    if (h.streamEnd === `buffered-event`) await waitForTerminal()
    await untilSdk(
      () =>
        unconfirmed
          ? consumed || handlerSettlement !== `pending`
          : consumed && sourceAccepted(),
      `HTTP consumed or known-terminal refusal reached comparison cut`,
    )
    await service.propagate()
    record(unconfirmed ? `response-without-confirmation` : `both-obligations`)
    const healthyWaitReached =
      h.missingEvent &&
      consumed &&
      !sourceAccepted() &&
      activeConfirmationTimers() > 0 &&
      handlerSettlement === `pending`
    if (unconfirmed) {
      for (const timer of confirmationTimers.values()) timer.fire()
      await service.propagate()
      record(`confirmation-deadline`)
    }
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
    if (
      h.streamEnd === `before-request` &&
      collection.health.error &&
      !sourceAccepted()
    )
      reached.push(
        `terminal-stream-unconfirmed`,
        h.endKind === `eof` ? `terminal-entry-eof` : `terminal-entry-error`,
      )
    if (
      h.streamEnd === `after-event` &&
      collection.health.error &&
      sourceAccepted() &&
      consumed
    )
      reached.push(`terminal-stream-confirmed`)
    if (
      h.streamEnd === `pending-confirmation` &&
      registeredBeforeEnd &&
      collection.health.error &&
      !sourceAccepted()
    )
      reached.push(
        `terminal-stream-waiting`,
        h.endKind === `eof` ? `terminal-eof` : `terminal-error`,
      )
    if (
      h.streamEnd === `buffered-event` &&
      registeredBeforeEnd &&
      bufferedBeforeAcceptance &&
      sourceAccepted()
    )
      reached.push(`buffered-event-before-close`)
    if (retired && service.streams.length === 2)
      reached.push(
        h.streamEnd === `retired-confirmed`
          ? `retired-confirmed-response`
          : `retired-unconfirmed-response`,
      )
    if (h.proofExpiry && clockOffset > 300_000 && sourceAccepted() && consumed)
      reached.push(`accepted-proof-survives-pruning`)
    if (healthyWaitReached) reached.push(`healthy-unconfirmed-deadline`)
    if (reentrantStarted)
      reached.push(
        h.operation === `insert`
          ? `reentrant-insert`
          : h.operation === `update`
            ? `reentrant-update`
            : `reentrant-delete`,
      )
    completed = {
      cuts,
      reached,
      lifecycle: {
        status: collection.status,
        stopped: collection.health.error !== null,
        subscriptions: service.streams.length,
      },
      timerLeaksAtCuts,
      pruneCallbacksCaptured: pruningTimers.size,
      pruneCallbacksInvoked,
      ...(retired ? { replacementReadiness: { ...replacementReadiness } } : {}),
    }
    return completed
  }
  const cleanups = [
    async () => {
      for (const timer of confirmationTimers.values()) timer.fire()
      if (transaction) {
        if (!responded && service.writes.length) respond()
        if (!delivered && !retired) deliver()
        await service.propagate()
        if (
          transaction.state === `persisting` ||
          transaction.state === `pending`
        )
          transaction.rollback()
        await service.propagate()
      }
    },
    () => reentrantSubscription?.unsubscribe(),
    () => query?.cleanup(),
    () => collection.cleanup(),
    () => {
      service.dispose()
      if (lateCleanupFailure) throw new Error(`Injected TrailBase late cleanup`)
    },
    () => {
      for (const timer of confirmationTimers.keys()) originalClearTimeout(timer)
      for (const timer of pruningTimers.keys()) originalClearInterval(timer)
      Date.now = originalNow
      globalThis.setTimeout = originalSetTimeout
      globalThis.clearTimeout = originalClearTimeout
      globalThis.setInterval = originalSetInterval
      globalThis.clearInterval = originalClearInterval
    },
  ]
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
