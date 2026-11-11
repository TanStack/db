import { fc } from '@fast-check/vitest'
import { afterAll, beforeEach, describe, expect } from 'vitest'
import { createCollection } from '../src/collection/index.js'
import { createDeferred } from '../src/deferred.js'
import { Func, PropRef, Value } from '../src/query/ir.js'
import {
  abortReplayHistory,
  abortedRestartHistory,
  changeRetiresReplacementHistory,
  cleanedRestartDemandCases,
  compoundLifecycleCoverageHistories,
  createLifecycleModel,
  demandChangeLifecycleHistoryArbitrary,
  expectedCleanedRestartDemand,
  expectedParkedReloadDemand,
  greenLifecycleHistories,
  greenLifecycleHistoryArbitrary,
  lifecycleCommandArbitrary,
  lifecycleRowLabels,
  mixedAbortedRestartHistory,
  parkedReloadDemandCases,
  pendingSupersessionHistory,
  reduceLifecycle,
  settle,
  syncLifecycleHistory,
  syncLifecycleHistoryArbitrary,
} from './collection-subscription-lifecycle-grammar-oracle.js'
import { flushPromises, withOracleCleanup } from './utils.js'
import { oracleProperty } from './oracle-property.js'
import { subscriptionComparison } from './collection-subscription-property-registration.js'
import {
  forwardAssertionJudgment,
  oracleAssertion,
  recordAssertionJudgment,
  rejectAt,
} from './oracle-assertion-adapter.js'
import {
  oraclePropertyOptions,
  oracleReplayRequested,
  readOracleRunConfig,
} from './oracle-config.js'
import type { LoadSubsetOptions, SyncConfig } from '../src/types.js'
import type {
  DemandName,
  LifecycleCommand,
  LifecycleLoadEvent,
  LifecycleModel,
  LifecycleResultEvent,
  LifecycleTraceEvent,
  LifecycleUnloadEvent,
} from './collection-subscription-lifecycle-grammar-oracle.js'

const { multiplier } = readOracleRunConfig()

/**
 * # What settles a demand created while a Collection is cleaned up?
 *
 * Collection lifecycle and the live-query architecture require the next sync
 * run to serve this waiting logical owner. Eager readiness is the complete
 * source evidence and starts no physical acquisition. On-demand readiness is
 * insufficient; one settled acquisition supplies the evidence instead.
 *
 * The independent model in the lifecycle grammar crosses explicit eager,
 * default eager, and on-demand configuration with empty and nonempty
 * replacements and with or without an eager loader. Eager histories may also
 * truncate the loading replacement, or fail their first load and reload.
 * The production driver publishes an old row, creates a direct subscription,
 * cleans up its source, requests a snapshot, and restarts the real Collection.
 * It holds eager readiness to prove the cleanup-detached
 * `onLoadSubsetResult` promise cannot fulfill early. At every cut, the returned
 * promise's settlement, acquisition count, subscription and Collection status,
 * and subscriber-applied rows must match the model. Public preload failure and
 * demands first admitted after restart remain outside this focused matrix.
 */
async function runCleanedRestartDemandCase(
  history: (typeof cleanedRestartDemandCases)[number],
): Promise<void> {
  const expected = expectedCleanedRestartDemand(history)
  let syncRuns = 0
  let physicalAcquisitions = 0
  let releaseEagerReady: (() => void) | undefined
  let operations!: Parameters<SyncConfig<{ id: string }>[`sync`]>[0]

  const publishRow = (id: string) => {
    operations.begin()
    operations.write({ type: `insert`, value: { id } })
    operations.commit()
  }
  const publishReplacement = () => {
    if (history.replacement === `row`) publishRow(`replacement`)
  }
  const collection = createCollection<{ id: string }>({
    id: `cleaned-restart-${history.syncMode}-${history.loader}-${history.replacement}`,
    getKey: ({ id }) => id,
    ...(history.syncMode === `default-eager`
      ? {}
      : { syncMode: history.syncMode }),
    sync: {
      sync: (next) => {
        const syncRun = syncRuns++
        // Keep the current run's public adapter boundary for the history
        // commands below; the model does not read this object.
        operations = next
        if (syncRun === 0) {
          next.markReady()
        } else if (history.syncMode !== `on-demand`) {
          releaseEagerReady = () => {
            publishReplacement()
            next.markReady()
          }
        } else {
          next.markReady()
        }
        if (history.loader === `absent`) return
        return {
          loadSubset: () => {
            physicalAcquisitions++
            publishReplacement()
            return true
          },
        }
      },
    },
  })
  const visible = new Map<string | number, { id: string }>()
  const subscription = collection.subscribeChanges(
    (changes) => {
      for (const change of changes) {
        if (change.type === `delete`) visible.delete(change.key)
        else visible.set(change.key, { id: change.value.id })
      }
    },
    { includeInitialState: false },
  )

  await withOracleCleanup(async () => {
    publishRow(`old`)
    oracleAssertion(`lifecycle history comparison at 148`, () =>
      expect([...visible.values()]).toEqual([{ id: `old` }]),
    )
    await collection.cleanup()
    let resultState: `pending` | `fulfilled` | `rejected` = `pending`
    let result: unknown
    subscription.requestSnapshot({
      onLoadSubsetResult: (returned) => {
        result = returned
        if (returned instanceof Promise) {
          void returned.then(
            () => {
              resultState = `fulfilled`
            },
            () => {
              resultState = `rejected`
            },
          )
        } else {
          resultState = `fulfilled`
        }
      },
    })

    oracleAssertion(`lifecycle history comparison at 170`, () =>
      expect(result).toBeInstanceOf(Promise),
    )
    oracleAssertion(`lifecycle history comparison at 171`, () =>
      expect(resultState).toBe(`pending`),
    )

    collection.startSyncImmediate()
    await flushPromises()

    if (expected.beforeEagerReady) {
      oracleAssertion(`lifecycle history comparison at 177`, () =>
        expect({
          physicalAcquisitions,
          result: resultState,
          status: subscription.status,
          collectionStatus: collection.status,
        }).toEqual(expected.beforeEagerReady),
      )

      if (history.interruption === `truncate`) {
        operations.begin()
        operations.truncate({ markReady: false })
        const receipt = operations.commit()
        if (receipt !== true) await receipt
      } else if (history.interruption === `failed-then-reload`) {
        operations.fail(new Error(`restart failure`))
      }
      if (expected.afterInterruption) {
        await flushPromises()
        oracleAssertion(`lifecycle history comparison at 194`, () =>
          expect({
            physicalAcquisitions,
            result: resultState,
            status: subscription.status,
            collectionStatus: collection.status,
          }).toEqual(expected.afterInterruption),
        )
      }

      // A failed first load ends its sync run; only a reload starts the
      // run that can serve the waiting demand.
      if (history.interruption === `failed-then-reload`) {
        void collection.reload().catch(() => undefined)
        await flushPromises()
      }
      releaseEagerReady!()
      await flushPromises()
    }

    oracleAssertion(`lifecycle history comparison at 212`, () =>
      expect({
        physicalAcquisitions,
        result: resultState,
        status: subscription.status,
        rows: [...visible.values()],
        collectionStatus: collection.status,
      }).toEqual(expected.settled),
    )
  }, [() => subscription.unsubscribe(), () => collection.cleanup()])
}

describe(`demand created while its Collection is cleaned up`, () => {
  oracleProperty({
    id: `subscription-lifecycle.cleaned-restart-demand`,
    law: {
      statement: `A demand created while its Collection is cleaned up settles from the next sync run's evidence, as the independent cleaned-restart model predicts at every cut.`,
      authority: `Collection lifecycle and the live-query architecture, as the contract above and the lifecycle grammar's cleanedRestartDemandCases model state them.`,
      limits: `The finite cleaned-restart matrix; public preload failure and demands first admitted after restart remain outside it.`,
    },
    owns: [`src/collection/subscription.ts`],
    histories: cleanedRestartDemandCases,
    label: ({ syncMode, loader, replacement, interruption }) =>
      `${syncMode} source with ${loader} loader, ${replacement} replacement, and ${interruption}`,
    ...subscriptionComparison<(typeof cleanedRestartDemandCases)[number]>(
      `subscription-lifecycle.cleaned-restart-demand`,
      runCleanedRestartDemandCase,
    ),
    check: forwardAssertionJudgment,
  })
})

/**
 * The driver of `parkedReloadDemandCases` (see the model in the lifecycle
 * grammar). A real on-demand Collection's first sync run calls `fail()`
 * before readiness, a direct subscription then requests a snapshot, which
 * parks, and `reload()` starts the run that `newRun` describes. Its adapter
 * counts every `loadSubset` and `unloadSubset` call and serves each load in
 * a later microtask. After the history settles, the counts, the parked
 * request's promise, and both statuses must match the model.
 */
async function runParkedReloadDemandCase(
  history: (typeof parkedReloadDemandCases)[number],
): Promise<void> {
  const expected = expectedParkedReloadDemand(history)
  let syncRuns = 0
  let loads = 0
  let unloads = 0
  let failFirstRun!: () => void
  let laterSnapshot: (() => void) | undefined
  const collection = createCollection<{ id: string }>({
    id: `parked-reload-${history.newRun}`,
    getKey: ({ id }) => id,
    syncMode: `on-demand`,
    sync: {
      sync: (next) => {
        const syncRun = syncRuns++
        const snapshot = () => {
          next.begin({ snapshot: true })
          next.commit()
        }
        if (syncRun === 0) {
          failFirstRun = () => next.fail(new Error(`first load failed`))
        } else if (history.newRun === `snapshot-then-ready`) {
          snapshot()
          next.markReady()
        } else {
          next.markReady()
          if (history.newRun === `ready-then-snapshot`) snapshot()
          if (history.newRun === `ready-then-later-snapshot`)
            laterSnapshot = snapshot
        }
        return {
          loadSubset: () => {
            loads++
            return Promise.resolve()
          },
          unloadSubset: () => {
            unloads++
          },
        }
      },
    },
  })
  const subscription = collection.subscribeChanges(() => {}, {
    includeInitialState: false,
  })
  await withOracleCleanup(async () => {
    collection.startSyncImmediate()
    failFirstRun()
    await flushPromises()
    let result: `pending` | `fulfilled` | `rejected` = `pending`
    subscription.requestSnapshot({
      onLoadSubsetResult: (returned) => {
        void Promise.resolve(returned).then(
          () => (result = `fulfilled`),
          () => (result = `rejected`),
        )
      },
    })
    await flushPromises()
    void collection.reload().catch(() => undefined)
    await flushPromises()
    if (laterSnapshot) {
      laterSnapshot()
      await flushPromises()
    }
    oracleAssertion(`lifecycle history comparison at 299`, () =>
      expect({
        loads,
        unloads,
        result,
        status: subscription.status,
        collectionStatus: collection.status,
      }).toEqual(expected),
    )
  }, [() => subscription.unsubscribe(), () => collection.cleanup()])
}

describe(`demand parked behind a failed first load across a reload`, () => {
  oracleProperty({
    id: `subscription-lifecycle.parked-reload-demand`,
    law: {
      statement: `A demand parked behind a failed first load is served by the reload's sync run exactly as the independent parked-reload model predicts.`,
      authority: `Collection lifecycle and the lifecycle grammar's parkedReloadDemandCases model.`,
      limits: `The four bounded new-run shapes after one failed first load.`,
    },
    owns: [`src/collection/subscription.ts`],
    histories: parkedReloadDemandCases,
    label: ({ newRun }) => `new run: ${newRun}`,
    ...subscriptionComparison<(typeof parkedReloadDemandCases)[number]>(
      `subscription-lifecycle.parked-reload-demand`,
      runParkedReloadDemandCase,
    ),
    check: forwardAssertionJudgment,
  })
})

/**
 * # Does the runtime follow the subscription lifecycle grammar?
 *
 * The Collection subscription API and the sync adapter lifecycle in
 * `docs/guides/collection-options-creator.md` establish the ownership law.
 * The shared grammar models logical owners, acquisition attempts, sync runs,
 * and the publication barrier. This driver gives the same command history to a
 * real on-demand Collection and compares the exact lifecycle trace: loads,
 * unloads, returned results, readiness, and reported errors.
 *
 * Returned promises need their own observation rule. They belong to the
 * acquisition attempt that created them, while a caller waiting for publication
 * belongs to a cancellable logical owner. A retired attempt may still settle;
 * it must not revive its old owner or replace a newer result.
 *
 * Generated commands cover the state after each command. The fixed retired
 * delivery cases separately settle an acquisition attempt after unsubscribe; the
 * generated grammar cannot select that obsolete attempt after unsubscribe.
 *
 * A demand change is one step (ARCHITECTURE law 9). The driver gives a
 * `change` to production as one `releaseSnapshot()` call with every retired
 * owner's predicate, and a `replace` as `replaceSnapshots()`, the internal
 * call a lazy join's fragmented-churn replacement makes. The comparison runs
 * after the whole change, the checkpoint at which the model judged the
 * replay: a replay judged between the releases publishes early, so a later
 * snapshot request publishes where the model keeps it private, and a waiting
 * caller settles differently.
 *
 * Row contents and real-provider behavior are outside this controlled adapter
 * driver. The publication oracle checks row contents separately.
 */

type RuntimeAttempt = {
  id: number
  ownerId: number
  demand: DemandName
  options: LoadSubsetOptions
  deferred?: ReturnType<typeof createDeferred<void>>
  failure: Error
  settled: boolean
  current: boolean
}
type RuntimeOwner = {
  id: number
  demand: DemandName
  controller: AbortController
  aborted: boolean
  attemptId?: number
}
type ReturnedResult = {
  attemptId: number | `unacquired`
  result: unknown
  outcome:
    | { status: `synchronous` | `pending` }
    | { status: `fulfilled`; value: unknown }
    | { status: `rejected`; error: unknown }
}
type CallerFault = `early` | `pending` | `wrong-value` | `wrong-error`
type ExpectedCaller = {
  ownerId: number
  attemptId: number | `unacquired`
  outcome:
    | ReturnedResult[`outcome`]
    | { status: `aborted` }
    | { status: `normalized-rejection`; source: unknown }
}

// An adapter Promise belongs to its original acquisition attempt after retirement.
// A caller waiting for a loader instead owns a cancellable publication wait.
// These expectations come from the caller contract, not subscription status.
function updateCallerOutcomes(
  callers: Array<ExpectedCaller>,
  model: LifecycleModel,
  command: LifecycleCommand,
  failedAttempts: ReadonlyMap<number, unknown>,
): void {
  for (const caller of callers) {
    if (caller.outcome.status !== `pending`) continue
    if (caller.attemptId !== `unacquired`) {
      const attempt = model.attempts[caller.attemptId]!
      if (attempt.outcome === `resolve`) {
        caller.outcome = { status: `fulfilled`, value: undefined }
      } else if (attempt.outcome === `reject`) {
        caller.outcome = {
          status: `rejected`,
          error: failedAttempts.get(attempt.id),
        }
      }
      continue
    }
    const owner = model.owners.find(({ id }) => id === caller.ownerId)
    if (
      command.type === `cleanup` ||
      model.unsubscribed ||
      !owner ||
      owner.aborted
    ) {
      caller.outcome = { status: `aborted` }
      continue
    }
    if (owner.attemptId === undefined) continue
    // Even this caller's successful acquisition cannot bypass an unfinished
    // peer or overlapping replay acquisition attempt.
    if (
      model.attempts.some(
        ({ inReplacement, gating }) => inReplacement && gating,
      )
    )
      continue
    // A failed owner that a held replacement covers does not fail the
    // replay (law 10): the replacement loaded the whole key union. One that
    // an abort ended before it settled loaded nothing.
    const loaded = ({ attemptId }: (typeof model.owners)[number]) =>
      attemptId === undefined ||
      (!failedAttempts.has(attemptId) &&
        !model.attempts[attemptId]!.endedByAbort)
    const current = new Set(
      model.owners
        .filter(
          (failed) =>
            !model.owners.some(
              (replacement) =>
                replacement.replaces?.includes(failed.id) &&
                loaded(replacement),
            ),
        )
        .map(({ attemptId }) => attemptId),
    )
    // A rejection after the abort decides nothing: the abort ended the load.
    const failure = [...failedAttempts.keys()].find(
      (attemptId) =>
        current.has(attemptId) && !model.attempts[attemptId]!.endedByAbort,
    )
    if (failure !== undefined) {
      const error = failedAttempts.get(failure)
      // Replay exposes one normalized Error. Some hosts' DOMException is not
      // an Error instance; the acquisition Promise preserves that raw reason.
      caller.outcome =
        error instanceof Error
          ? { status: `rejected`, error }
          : { status: `normalized-rejection`, source: error }
    } else if (!model.publicationBarrierOpen) {
      caller.outcome = { status: `fulfilled`, value: undefined }
    }
  }
}

const replacementPendingReachLabel = `replacement-load-replaces-pending-attempt`

async function runHistory(
  history: ReadonlyArray<LifecycleCommand>,
  runOptions: {
    acquisitionMode?: `async-pending` | `sync-success`
    cancellation?: `manual` | `reject`
    continueAfterMismatch?: boolean
    retiredDelivery?: `resolve` | `reject`
    callerFault?: CallerFault
    cleanupFault?: () => void
    onResultCheckpoint?: (
      command: LifecycleCommand,
      results: ReadonlyArray<ReturnedResult>,
      failures: ReadonlyMap<number, Error>,
    ) => void
  } = {},
): Promise<Set<string>> {
  const acquisitionMode = runOptions.acquisitionMode ?? `async-pending`
  const check = runOptions.continueAfterMismatch ? expect.soft : expect
  const failures = new Map<number, Error>()
  const abortFailures = new Map<number, Error>()
  // Judged at each checkpoint, not inside the adapter: a throw from
  // loadSubset would reject the acquisition instead of failing the oracle.
  const replacementAbortViolations: Array<string> = []
  const driverReach = new Set<string>()
  // Attempts the model had already aborted before the current command.
  let abortedBeforeStep = new Set<number>()
  const abortFailureForAttempt = (attemptId: number): Error => {
    let failure = abortFailures.get(attemptId)
    if (!failure) {
      failure = new DOMException(
        `acquisition ${attemptId} aborted`,
        `AbortError`,
      )
      abortFailures.set(attemptId, failure)
    }
    return failure
  }
  const failureForAttempt = (attemptId: number): Error => {
    const existing = failures.get(attemptId)
    if (existing) return existing
    const failure = new Error(`attempt ${attemptId} failed`)
    failures.set(attemptId, failure)
    return failure
  }
  const cancellation = runOptions.cancellation ?? `manual`
  const model = createLifecycleModel(
    acquisitionMode,
    failureForAttempt,
    cancellation,
  )
  const where = {
    a: new Func(`eq`, [new PropRef([`id`]), new Value(`a`)]),
    b: new Func(`eq`, [new PropRef([`id`]), new Value(`b`)]),
    c: new Func(`eq`, [new PropRef([`id`]), new Value(`c`)]),
  }
  const demandForWhere = new Map<unknown, DemandName>([
    [where.a, `a`],
    [where.b, `b`],
    [where.c, `c`],
  ])
  const runtimeAttempts = new Map<number, RuntimeAttempt>()
  const runtimeOwners: Array<RuntimeOwner> = []
  const attemptByOptions = new Map<LoadSubsetOptions, number>()
  const observedLoads: Array<LifecycleLoadEvent> = []
  const observedUnloads: Array<
    | LifecycleUnloadEvent
    | {
        attemptId: `unacquired`
        handlerSyncRunGeneration: number
      }
  > = []
  const observedErrors: Array<{
    attemptId: number | `unacquired`
    error: unknown
  }> = []
  const observedResults: Array<
    LifecycleResultEvent | { attemptId: `unacquired`; resultKind: string }
  > = []
  const returnedResults: Array<ReturnedResult> = []
  const expectedCallers: Array<ExpectedCaller> = []
  // A later abort cannot change an acquisition attempt's rejection reason.
  const failedAttempts = new Map<number, unknown>()
  const normalizedRejections = new Map<unknown, unknown>()
  const terminalReach = new Set<string>()
  const observedStatuses: Array<string> = []
  const observedTrace: Array<
    | LifecycleTraceEvent
    | {
        type: `unload`
        attemptId: `unacquired`
        handlerSyncRunGeneration: number
      }
    | { type: `error`; attemptId: `unacquired` }
    | { type: `result`; attemptId: `unacquired`; resultKind: string }
  > = []
  let nextObservedAttemptId = 0
  let nextObservedOwnerId = 0
  let observedReplayGeneration = 0
  let observedSyncRunGeneration = -1
  let observedActive = true
  let observedUnsubscribed = false
  let syncOps:
    Parameters<SyncConfig<{ id: string }, string>[`sync`]>[0] | undefined
  // Law 13 (space): state does not scale with settled historical attempts.
  // A listener on an acquisition's abort signal keeps what its closure
  // holds, such as a replay's private rows, for as long as the acquisition
  // lives. So once an attempt settled without an abort, core keeps no abort
  // listener on its signal. The driver counts the listeners core adds after
  // the adapter's `loadSubset` call, by attempt; an abort removes them all,
  // since core adds each with `once`.
  const coreAbortListeners = new Map<number, Set<unknown>>()
  const watchCoreAbortListeners = (
    attemptId: number,
    signal: AbortSignal | undefined,
  ) => {
    if (!signal) return
    const listeners = new Set<unknown>()
    coreAbortListeners.set(attemptId, listeners)
    const add = signal.addEventListener.bind(signal)
    const remove = signal.removeEventListener.bind(signal)
    add(`abort`, () => listeners.clear())
    signal.addEventListener = ((
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: AddEventListenerOptions | boolean,
    ) => {
      if (type === `abort`) listeners.add(listener)
      add(type, listener, options)
    }) as AbortSignal[`addEventListener`]
    signal.removeEventListener = ((
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: EventListenerOptions | boolean,
    ) => {
      listeners.delete(listener)
      remove(type, listener, options)
    }) as AbortSignal[`removeEventListener`]
  }

  const collection = createCollection<{ id: string }, string>({
    id: `generated-async-demand-lifecycle`,
    getKey: ({ id }) => id,
    syncMode: `on-demand`,
    sync: {
      sync: (operations) => {
        const handlerSyncRunGeneration = ++observedSyncRunGeneration
        syncOps = operations
        operations.markReady()
        return {
          loadSubset: (options) => {
            const demand = demandForWhere.get(options.where)
            if (!demand) throw new Error(`adapter load lost its demand`)
            const owner = runtimeOwners.find(
              (candidate) =>
                candidate.demand === demand &&
                !candidate.aborted &&
                candidate.attemptId === undefined,
            )
            if (!owner) throw new Error(`adapter load has no runtime owner`)
            const observed: LifecycleLoadEvent = {
              id: nextObservedAttemptId++,
              demand,
              syncRunGeneration: handlerSyncRunGeneration,
              replayGeneration: observedReplayGeneration,
            }
            const deferred =
              acquisitionMode === `async-pending`
                ? createDeferred<void>()
                : undefined
            void deferred?.promise.catch(() => undefined)
            runtimeAttempts.set(observed.id, {
              id: observed.id,
              ownerId: owner.id,
              demand,
              options,
              deferred,
              failure: failureForAttempt(observed.id),
              settled: acquisitionMode === `sync-success`,
              current: true,
            })
            if (deferred && cancellation === `reject`) {
              options.signal?.addEventListener(
                `abort`,
                () => {
                  const attempt = runtimeAttempts.get(observed.id)!
                  if (attempt.settled) return
                  attempt.settled = true
                  deferred.reject(abortFailureForAttempt(observed.id))
                },
                { once: true },
              )
            }
            watchCoreAbortListeners(observed.id, options.signal)
            // Law (header: "A replay that replaces an attempt aborts it
            // too"): every attempt that this command's replay replaces, one
            // the model aborts in this step, is aborted before its
            // replacement loads. Attempts aborted in earlier steps were
            // judged in those steps. The model has already reduced this
            // command, so the check reads the aborts it recorded.
            for (const earlier of runtimeAttempts.values()) {
              if (earlier.id === observed.id) continue
              const replaced = model.attempts[earlier.id]
              if (!replaced?.aborted || abortedBeforeStep.has(earlier.id))
                continue
              // Reach: the replaced attempt had no settled outcome in the
              // model when its replacement loaded.
              if (replaced.outcome === undefined)
                driverReach.add(replacementPendingReachLabel)
              if (!earlier.options.signal?.aborted)
                replacementAbortViolations.push(
                  `replaced attempt ${earlier.id} is not aborted before replacement ${observed.id} loads`,
                )
            }
            owner.attemptId = observed.id
            attemptByOptions.set(options, observed.id)
            observedLoads.push(observed)
            observedTrace.push({ type: `load`, ...observed })
            return deferred?.promise ?? true
          },
          unloadSubset: (options) => {
            const unload = {
              attemptId: attemptByOptions.get(options) ?? `unacquired`,
              handlerSyncRunGeneration,
            } as const
            observedUnloads.push(unload)
            observedTrace.push({ type: `unload`, ...unload })
          },
        }
      },
    },
  })
  const publications: Array<unknown> = []
  const subscription = collection.subscribeChanges(
    (changes) => {
      publications.push(changes)
      observedTrace.push({ type: `publication` })
    },
    { includeInitialState: false },
  )
  subscription.on(`status:change`, ({ status }) => {
    observedStatuses.push(status)
    observedTrace.push({ type: `status`, status })
  })
  subscription.on(`loadSubset:error`, ({ options, error }) => {
    const attemptId = attemptByOptions.get(options) ?? `unacquired`
    observedErrors.push({ attemptId, error })
    observedTrace.push({ type: `error`, attemptId })
  })

  const assertState = (command: LifecycleCommand) => {
    const context = JSON.stringify({
      history,
      command,
      observedTrace,
      expectedTrace: model.trace,
    })
    oracleAssertion(`lifecycle history comparison at 715`, () =>
      check(observedLoads, context).toEqual(model.loads),
    )
    oracleAssertion(`lifecycle history comparison at 716`, () =>
      check(observedUnloads, context).toEqual(model.unloads),
    )
    oracleAssertion(`lifecycle history comparison at 717`, () =>
      check(
        observedErrors.map(({ attemptId }) => attemptId),
        context,
      ).toEqual(model.errors.map(({ attemptId }) => attemptId)),
    )
    for (const [index, { error }] of observedErrors.entries()) {
      oracleAssertion(`lifecycle history comparison at 722`, () =>
        check(error, context).toBe(model.errors[index]?.error),
      )
    }
    for (const { result } of returnedResults) {
      oracleAssertion(`lifecycle history comparison at 725`, () =>
        check(result === true || result instanceof Promise, context).toBe(true),
      )
    }
    oracleAssertion(`lifecycle history comparison at 727`, () =>
      check(returnedResults.length, `caller outcome count: ${context}`).toBe(
        expectedCallers.length,
      ),
    )
    for (const [index, expected] of expectedCallers.entries()) {
      const actual = returnedResults[index]!.outcome
      const expectedOutcome = expected.outcome
      const message = `caller outcome ${index}: ${context}`
      if (expectedOutcome.status === `aborted`) {
        oracleAssertion(`lifecycle history comparison at 734`, () =>
          check(actual.status, message).toBe(`rejected`),
        )
        if (actual.status === `rejected`)
          oracleAssertion(`lifecycle history comparison at 736`, () =>
            check(actual.error, message).toMatchObject({ name: `AbortError` }),
          )
      } else if (expectedOutcome.status === `normalized-rejection`) {
        oracleAssertion(`lifecycle history comparison at 738`, () =>
          check(actual.status, message).toBe(`rejected`),
        )
        if (actual.status === `rejected`) {
          oracleAssertion(`lifecycle history comparison at 740`, () =>
            check(actual.error, message).toBeInstanceOf(Error),
          )
          oracleAssertion(`lifecycle history comparison at 741`, () =>
            check(actual.error, message).toMatchObject({
              message: String(expectedOutcome.source),
            }),
          )
          if (!normalizedRejections.has(expectedOutcome.source))
            normalizedRejections.set(expectedOutcome.source, actual.error)
          oracleAssertion(`lifecycle history comparison at 746`, () =>
            check(actual.error, message).toBe(
              normalizedRejections.get(expectedOutcome.source),
            ),
          )
        }
      } else {
        oracleAssertion(`lifecycle history comparison at 751`, () =>
          check(actual, message).toEqual(expectedOutcome),
        )
        if (
          actual.status === `rejected` &&
          expectedOutcome.status === `rejected`
        ) {
          oracleAssertion(`lifecycle history comparison at 756`, () =>
            check(actual.error, message).toBe(expectedOutcome.error),
          )
        }
      }
    }
    oracleAssertion(`lifecycle history comparison at 760`, () =>
      check(observedResults, context).toEqual(model.results),
    )
    oracleAssertion(`lifecycle history comparison at 761`, () =>
      check(observedStatuses, context).toEqual(model.statuses),
    )
    oracleAssertion(`lifecycle history comparison at 762`, () =>
      check(subscription.status, context).toBe(model.status),
    )
    oracleAssertion(`lifecycle history comparison at 763`, () =>
      check(subscription.lastError, context).toBe(model.lastError),
    )
    oracleAssertion(`lifecycle history comparison at 764`, () =>
      check(collection.status, context).toBe(model.collectionStatus),
    )
    oracleAssertion(`lifecycle history comparison at 765`, () =>
      check(publications, context).toEqual(
        Array.from({ length: model.publications }, () => []),
      ),
    )
    oracleAssertion(`lifecycle history comparison at 768`, () =>
      check(observedTrace, context).toEqual(model.trace),
    )
    oracleAssertion(`lifecycle history comparison at 769`, () =>
      check(
        replacementAbortViolations,
        `replaced attempts are aborted before their replacements load (header: "A replay that replaces an attempt aborts it too"): ${context}`,
      ).toEqual([]),
    )
    for (const attempt of model.attempts)
      if (attempt.outcome !== undefined && !attempt.aborted)
        oracleAssertion(`lifecycle history comparison at 775`, () =>
          check(
            coreAbortListeners.get(attempt.id)?.size ?? 0,
            `abort listeners kept by settled attempt ${attempt.id}: ${context}`,
          ).toBe(0),
        )
    for (const attempt of model.attempts) {
      oracleAssertion(`lifecycle history comparison at 780`, () =>
        check(
          runtimeAttempts.get(attempt.id)?.options.signal?.aborted,
          context,
        ).toBe(attempt.aborted),
      )
    }
  }

  const selectRuntimeAttempt = (
    command: Extract<LifecycleCommand, { type: `settle` }>,
  ): RuntimeAttempt | undefined => {
    if (observedUnsubscribed) return undefined
    const candidates = [...runtimeAttempts.values()].filter(
      (attempt) =>
        !attempt.settled &&
        attempt.demand === command.demand &&
        attempt.current === (command.scope === `current`),
    )
    return command.age === `oldest` ? candidates[0] : candidates.at(-1)
  }

  let primaryFailure: unknown
  let primaryFailed = false
  const cleanupFailures: Array<Error> = []
  const cleanup = async (
    boundary: string,
    action: () => void | Promise<unknown>,
  ): Promise<void> => {
    try {
      await action()
    } catch (error) {
      cleanupFailures.push(new Error(`${boundary} failed`, { cause: error }))
    }
  }

  try {
    for (const command of history) {
      const runtimeOwner =
        command.type === `request`
          ? {
              id: nextObservedOwnerId++,
              demand: command.demand,
              controller: new AbortController(),
              aborted: false,
            }
          : command.type === `abort`
            ? runtimeOwners.find(
                ({ demand, aborted }) => demand === command.demand && !aborted,
              )
            : command.type === `release`
              ? runtimeOwners.find(({ demand }) => demand === command.demand)
              : undefined
      if (command.type === `request` && !model.unsubscribed) {
        runtimeOwners.push(runtimeOwner!)
      }
      const runtimeAttempt =
        command.type === `settle` ? selectRuntimeAttempt(command) : undefined
      abortedBeforeStep = new Set(
        model.attempts.flatMap(({ id, aborted }) => (aborted ? [id] : [])),
      )
      const effect = reduceLifecycle(model, command)
      if (command.type === `request` && effect.ownerId !== undefined) {
        const result = model.results.at(-1)!
        expectedCallers.push({
          ownerId: effect.ownerId,
          attemptId: result.attemptId,
          outcome: {
            status: result.resultKind === `true` ? `synchronous` : `pending`,
          },
        })
      }
      for (const attempt of model.attempts) {
        if (attempt.outcome === `reject` && !failedAttempts.has(attempt.id)) {
          failedAttempts.set(
            attempt.id,
            attempt.aborted && cancellation === `reject`
              ? abortFailureForAttempt(attempt.id)
              : attempt.failure,
          )
        }
      }
      updateCallerOutcomes(expectedCallers, model, command, failedAttempts)
      if (command.type === `request`) {
        oracleAssertion(`lifecycle history comparison at 862`, () =>
          check(effect.ownerId).toBe(
            model.unsubscribed ? undefined : runtimeOwner?.id,
          ),
        )
        const result = subscription.requestSnapshot({
          where: where[command.demand],
          signal: runtimeOwner?.controller.signal,
          onLoadSubsetResult: (loadResult, requestOptions) => {
            // Challenge the caller-result observer without altering source work,
            // subscription status, or ownership: all are distinct observations.
            const callerResult =
              loadResult instanceof Promise && runOptions.callerFault
                ? runOptions.callerFault === `early`
                  ? Promise.resolve()
                  : runOptions.callerFault === `pending`
                    ? new Promise<void>(() => {})
                    : loadResult.then(
                        (value) =>
                          runOptions.callerFault === `wrong-value`
                            ? `wrong value`
                            : value,
                        (error: unknown) => {
                          throw runOptions.callerFault === `wrong-error`
                            ? new Error(`wrong error`)
                            : error
                        },
                      )
                : loadResult
            const attemptId =
              attemptByOptions.get(requestOptions) ?? `unacquired`
            const returned: ReturnedResult = {
              attemptId,
              result: callerResult,
              outcome: {
                status: callerResult === true ? `synchronous` : `pending`,
              },
            }
            returnedResults.push(returned)
            // Keep malformed values observable instead of classifying every
            // non-true value as a Promise. Both handlers attach at capture.
            if (callerResult !== true && !(callerResult instanceof Promise))
              return
            if (callerResult instanceof Promise) {
              void callerResult.then(
                (value) => {
                  returned.outcome = { status: `fulfilled`, value }
                },
                (error: unknown) => {
                  returned.outcome = { status: `rejected`, error }
                },
              )
            }
            const resultKind = loadResult === true ? `true` : `promise`
            observedResults.push({ attemptId, resultKind })
            observedTrace.push({ type: `result`, attemptId, resultKind })
          },
        })
        oracleAssertion(`lifecycle history comparison at 918`, () =>
          check(result).toBe(effect.requestResult),
        )
      } else if (command.type === `abort`) {
        oracleAssertion(`lifecycle history comparison at 920`, () =>
          check(effect.ownerId).toBe(runtimeOwner?.id),
        )
        if (runtimeOwner) {
          runtimeOwner.aborted = true
          runtimeOwner.controller.abort()
        }
      } else if (command.type === `release`) {
        oracleAssertion(`lifecycle history comparison at 926`, () =>
          check(effect.ownerId).toBe(runtimeOwner?.id),
        )
        if (runtimeOwner) {
          if (runtimeOwner.attemptId !== undefined) {
            runtimeAttempts.get(runtimeOwner.attemptId)!.current = false
          }
          runtimeOwners.splice(runtimeOwners.indexOf(runtimeOwner), 1)
        }
        subscription.releaseSnapshot(where[command.demand])
      } else if (command.type === `change`) {
        const retired: Array<number> = []
        for (const demand of command.release) {
          const owner = runtimeOwners.find(
            (candidate) => candidate.demand === demand,
          )
          if (!owner) continue
          retired.push(owner.id)
          if (owner.attemptId !== undefined) {
            runtimeAttempts.get(owner.attemptId)!.current = false
          }
          runtimeOwners.splice(runtimeOwners.indexOf(owner), 1)
        }
        oracleAssertion(`lifecycle history comparison at 947`, () =>
          check(effect.ownerIds ?? []).toEqual(retired),
        )
        // One demand change is one release call.
        subscription.releaseSnapshot(
          ...command.release.map((demand) => where[demand]),
        )
      } else if (command.type === `replace`) {
        subscription.replaceSnapshots(where[command.demand], [
          where[command.replaced],
        ])
      } else if (command.type === `settle`) {
        oracleAssertion(`lifecycle history comparison at 957`, () =>
          check(effect.attemptId).toBe(runtimeAttempt?.id),
        )
        if (effect.attemptId === undefined) {
          // Neither model found an effective settlement.
        } else if (!runtimeAttempt?.deferred) {
          throw new Error(`model selected an already settled acquisition`)
        } else {
          runtimeAttempt.settled = true
          if (command.outcome === `resolve`) runtimeAttempt.deferred.resolve()
          else runtimeAttempt.deferred.reject(runtimeAttempt.failure)
        }
      } else if (command.type === `truncate`) {
        if (observedActive) {
          observedReplayGeneration++
          for (const owner of runtimeOwners) {
            if (owner.attemptId !== undefined) {
              runtimeAttempts.get(owner.attemptId)!.current = false
            }
            owner.attemptId = undefined
          }
        }
        syncOps?.begin()
        syncOps?.truncate()
        const receipt = syncOps?.commit()
        if (observedActive && !observedUnsubscribed && model.owners.length) {
          oracleAssertion(`lifecycle history comparison at 981`, () =>
            check(subscription.status).toBe(`loadingSubset`),
          )
        }
        if (receipt !== true) await receipt
      } else if (command.type === `cleanup`) {
        if (observedActive) {
          for (const owner of runtimeOwners) {
            if (owner.attemptId !== undefined) {
              runtimeAttempts.get(owner.attemptId)!.current = false
            }
            owner.attemptId = undefined
          }
        }
        await collection.cleanup()
        observedActive = false
      } else if (command.type === `restart`) {
        const queuesReplay =
          !observedActive && !observedUnsubscribed && model.owners.length > 0
        if (!observedActive) {
          observedReplayGeneration = 0
          observedActive = true
        }
        collection.startSyncImmediate()
        if (queuesReplay)
          oracleAssertion(`lifecycle history comparison at 1003`, () =>
            check(subscription.status).toBe(`loadingSubset`),
          )
      } else {
        for (const attempt of runtimeAttempts.values()) attempt.current = false
        subscription.unsubscribe()
        observedUnsubscribed = true
        runtimeOwners.length = 0
      }
      await flushPromises()
      assertState(command)
      runOptions.onResultCheckpoint?.(command, returnedResults, failures)
    }
    if (runOptions.retiredDelivery) {
      oracleAssertion(`lifecycle history comparison at 1015`, () =>
        check(observedUnsubscribed).toBe(true),
      )
      oracleAssertion(`lifecycle history comparison at 1016`, () =>
        check(collection.subscriberCount).toBe(0),
      )
      oracleAssertion(`lifecycle history comparison at 1017`, () =>
        check(runtimeAttempts.size).toBe(1),
      )
      const attempt = runtimeAttempts.get(0)
      if (!attempt?.deferred)
        throw new Error(`Missing retired acquisition attempt`)
      oracleAssertion(`lifecycle history comparison at 1021`, () =>
        check(attempt.settled).toBe(false),
      )
      oracleAssertion(`lifecycle history comparison at 1022`, () =>
        check(attempt.options.signal?.aborted).toBe(true),
      )
      oracleAssertion(`lifecycle history comparison at 1023`, () =>
        check(returnedResults).toHaveLength(1),
      )
      oracleAssertion(`lifecycle history comparison at 1024`, () =>
        check(returnedResults[0]?.outcome.status).toBe(`pending`),
      )

      const observeTerminal = () => ({
        loads: observedLoads.map((load) => ({ ...load })),
        unloads: observedUnloads.map((unload) => ({ ...unload })),
        errors: observedErrors.map((error) => ({ ...error })),
        results: observedResults.map((result) => ({ ...result })),
        statuses: [...observedStatuses],
        trace: observedTrace.map((event) => ({ ...event })),
        publications: structuredClone(publications),
        signals: [...runtimeAttempts.values()].map(({ id, options }) => ({
          id,
          aborted: options.signal?.aborted,
        })),
        subscriberCount: collection.subscriberCount,
        status: subscription.status,
        lastError: subscription.lastError,
        collectionStatus: collection.status,
      })
      const retired = observeTerminal()
      attempt.settled = true
      if (runOptions.retiredDelivery === `resolve`) attempt.deferred.resolve()
      else attempt.deferred.reject(attempt.failure)
      await flushPromises()
      const delivered = observeTerminal()
      oracleAssertion(`lifecycle history comparison at 1049`, () =>
        check(delivered).toEqual(retired),
      )
      oracleAssertion(`lifecycle history comparison at 1050`, () =>
        check(delivered.lastError).toBe(retired.lastError),
      )
      for (const [index, { error }] of delivered.errors.entries()) {
        oracleAssertion(`lifecycle history comparison at 1052`, () =>
          check(error).toBe(retired.errors[index]?.error),
        )
      }
      const outcome = returnedResults[0]!.outcome
      if (runOptions.retiredDelivery === `resolve`) {
        oracleAssertion(`lifecycle history comparison at 1056`, () =>
          check(outcome).toEqual({ status: `fulfilled`, value: undefined }),
        )
      } else {
        oracleAssertion(`lifecycle history comparison at 1058`, () =>
          check(outcome.status).toBe(`rejected`),
        )
        if (outcome.status !== `rejected`)
          throw new Error(`Missing late rejection`)
        oracleAssertion(`lifecycle history comparison at 1061`, () =>
          check(outcome.error).toBe(attempt.failure),
        )
      }
      terminalReach.add(
        `retired-attempt-delivery:${runOptions.retiredDelivery}`,
      )
    }
  } catch (error) {
    primaryFailure = error
    primaryFailed = true
  } finally {
    if (runOptions.cleanupFault) {
      await cleanup(`injected cleanup`, runOptions.cleanupFault)
    }
    for (const { id, deferred } of runtimeAttempts.values()) {
      await cleanup(`attempt ${id} settlement`, () => deferred?.resolve())
    }
    await cleanup(`pending callback drain`, flushPromises)
    await cleanup(`subscription unsubscribe`, () => subscription.unsubscribe())
    await cleanup(`Collection cleanup`, () => collection.cleanup())
  }
  if (cleanupFailures.length > 0) {
    throw new AggregateError(
      cleanupFailures,
      primaryFailed
        ? `lifecycle refinement and cleanup failed`
        : `lifecycle cleanup failed`,
      { cause: primaryFailed ? primaryFailure : undefined },
    )
  }
  if (primaryFailed) throw primaryFailure
  return new Set([...model.reach, ...terminalReach, ...driverReach])
}

if (
  !oracleReplayRequested() &&
  process.env.TANSTACK_DB_ORACLE_STATISTICS === `1`
) {
  fc.statistics(
    greenLifecycleHistoryArbitrary,
    (history) => {
      const model = createLifecycleModel()
      for (const command of history) reduceLifecycle(model, command)
      return [...model.reach]
    },
    oraclePropertyOptions(1_000, `subscription-lifecycle.history-statistics`),
  )
}

// The fixed and enumerated histories below replay the shared driver
// `runHistory` and its independent lifecycle model. Each entry is data: its
// commands and the data options of each `runHistory` call, in order. An entry
// without `runs` makes one call with the default options.
type HistoryRunOptions = {
  acquisitionMode?: `async-pending` | `sync-success`
  cancellation?: `manual` | `reject`
  continueAfterMismatch?: boolean
}
type NamedLifecycleHistory = {
  name: string
  history: ReadonlyArray<LifecycleCommand>
  runs?: ReadonlyArray<HistoryRunOptions>
}

async function runNamedHistory({
  history,
  runs = [{}],
}: NamedLifecycleHistory): Promise<void> {
  for (const options of runs) await runHistory(history, options)
}

// Named regressions that the generated command grammars cannot take back:
// their arbitraries map and chain without an unmapper.
const lifecycleFixedHistories: ReadonlyArray<NamedLifecycleHistory> = [
  {
    name: `shares one normalized replay rejection among surviving detached callers`,
    history: [
      { type: `cleanup` },
      { type: `request`, demand: `a` },
      { type: `request`, demand: `a` },
      { type: `request`, demand: `b` },
      { type: `restart` },
      settle(`a`, `current`, `oldest`, `resolve`),
      settle(`a`, `current`, `newest`, `resolve`),
      { type: `abort`, demand: `b` },
    ],
    runs: [{ cancellation: `reject` }],
  },
  {
    name: `does not revive a discarded caller when its logical demand restarts`,
    history: [
      { type: `cleanup` },
      { type: `request`, demand: `a` },
      { type: `restart` },
      { type: `cleanup` },
      { type: `restart` },
      settle(`a`, `obsolete`, `oldest`, `resolve`),
      settle(`a`, `current`, `oldest`, `resolve`),
      { type: `request`, demand: `b` },
      settle(`b`, `current`, `oldest`, `resolve`),
    ],
  },
  {
    name: `releases exact ownership while older replay work is pending`,
    history: [
      ...pendingSupersessionHistory,
      { type: `cleanup` },
      { type: `restart` },
      { type: `release`, demand: `a` },
      { type: `unsubscribe` },
    ],
    runs: [{ continueAfterMismatch: true }],
  },
  {
    name: `does not release an unacquired replacement after an aborted demand replays`,
    history: [
      ...abortReplayHistory,
      { type: `cleanup` },
      { type: `restart` },
      { type: `unsubscribe` },
    ],
    runs: [{ continueAfterMismatch: true }],
  },
  {
    name: `replays a live peer without reacquiring an aborted demand`,
    history: [
      { type: `request`, demand: `a` },
      { type: `request`, demand: `b` },
      { type: `abort`, demand: `a` },
      {
        type: `settle`,
        demand: `a`,
        scope: `current`,
        age: `oldest`,
        outcome: `reject`,
      },
      { type: `truncate` },
      {
        type: `settle`,
        demand: `b`,
        scope: `current`,
        age: `oldest`,
        outcome: `resolve`,
      },
      { type: `release`, demand: `a` },
      { type: `release`, demand: `b` },
    ],
  },
  {
    name: `restarts a live peer without reacquiring an aborted demand and completes teardown`,
    history: mixedAbortedRestartHistory,
    runs: [{ continueAfterMismatch: true }],
  },
  {
    name: `preserves acquisition lease ownership across queued synchronous replay`,
    history: syncLifecycleHistory,
    runs: [{ acquisitionMode: `sync-success`, continueAfterMismatch: true }],
  },
  {
    // Seed 1413322355, path 757:13:15:15:9:9:9. This checks an empty snapshot
    // notification: initial readiness is not a replacement publication gate.
    name: `publishes a new snapshot while canceled initial work still holds readiness`,
    history: [
      { type: `request`, demand: `b` },
      { type: `truncate` },
      {
        type: `settle`,
        demand: `b`,
        scope: `current`,
        age: `oldest`,
        outcome: `resolve`,
      },
      { type: `request`, demand: `a` },
      {
        type: `settle`,
        demand: `a`,
        scope: `current`,
        age: `oldest`,
        outcome: `resolve`,
      },
      {
        type: `settle`,
        demand: `b`,
        scope: `obsolete`,
        age: `oldest`,
        outcome: `resolve`,
      },
      { type: `release`, demand: `a` },
      { type: `release`, demand: `b` },
      { type: `unsubscribe` },
    ],
    runs: [{ continueAfterMismatch: true }],
  },
  {
    // Minimized from seed 317005625 at 100×. The mismatch is an empty
    // notification, not lost rows: failed replacement must keep reads private.
    name: `keeps a new snapshot private after failed restart`,
    history: [
      { type: `request`, demand: `b` },
      { type: `cleanup` },
      { type: `restart` },
      {
        type: `settle`,
        demand: `b`,
        scope: `current`,
        age: `oldest`,
        outcome: `reject`,
      },
      { type: `request`, demand: `a` },
      {
        type: `settle`,
        demand: `a`,
        scope: `current`,
        age: `oldest`,
        outcome: `resolve`,
      },
      { type: `release`, demand: `a` },
      { type: `release`, demand: `b` },
      { type: `cleanup` },
      { type: `restart` },
      { type: `unsubscribe` },
    ],
    runs: [{ continueAfterMismatch: true }],
  },
  // Two owners across a truncate: each replacement load judges the attempts
  // this command's replay replaces. These replay the shared driver and model.
  ...(
    [
      {
        name: `an aborted peer and a pending owner`,
        history: [
          { type: `request`, demand: `a` },
          { type: `request`, demand: `b` },
          { type: `abort`, demand: `a` },
          { type: `truncate` },
        ],
      },
      {
        name: `an abort after the first replay`,
        history: [
          { type: `request`, demand: `a` },
          { type: `request`, demand: `b` },
          { type: `truncate` },
          { type: `abort`, demand: `a` },
          { type: `truncate` },
        ],
      },
    ] satisfies Array<{ name: string; history: Array<LifecycleCommand> }>
  ).map(({ name, history }) => ({
    name: `replaces each owner's pending attempt before its replacement loads for ${name}`,
    history,
    runs: [{}, { cancellation: `reject` as const }],
  })),
  // Prompt cancellation of the replaced owner's replay load is a settlement:
  // the held replacement covers it, so the replay publishes.
  {
    name: `publishes a replay when a covered owner's replay load is canceled`,
    history: [
      { type: `request`, demand: `c` },
      { type: `request`, demand: `a` },
      { type: `request`, demand: `b` },
      { type: `replace`, demand: `b`, replaced: `a` },
      { type: `truncate` },
      settle(`b`, `current`, `oldest`, `resolve`),
      settle(`c`, `current`, `oldest`, `resolve`),
      { type: `abort`, demand: `a` },
      { type: `request`, demand: `a` },
    ],
    runs: [{ cancellation: `reject` }],
  },
]

const syncReplayScenarios = ([`truncate`, `restart`] as const).flatMap(
  (transition) =>
    ([1, 2] as const).flatMap((ownerCount) =>
      ([false, true] as const).map((abortFirst) => {
        const history: Array<LifecycleCommand> = [
          { type: `request`, demand: `a` },
          ...(ownerCount === 2
            ? ([{ type: `request`, demand: `b` }] as const)
            : []),
          ...(abortFirst ? ([{ type: `abort`, demand: `a` }] as const) : []),
          ...(transition === `truncate`
            ? ([{ type: `truncate` }] as const)
            : ([{ type: `cleanup` }, { type: `restart` }] as const)),
        ]
        return { transition, ownerCount, abortFirst, history }
      }),
    ),
)

// Bounded case tables over the same driver and model.
const lifecycleCaseHistories: ReadonlyArray<NamedLifecycleHistory> = [
  ...([`resolve`, `reject`] as const).map((outcome): NamedLifecycleHistory => ({
    name: `retains an earlier peer failure after aborting it while another peer will ${outcome}`,
    history: [
      { type: `cleanup` },
      { type: `request`, demand: `a` },
      { type: `request`, demand: `b` },
      { type: `restart` },
      settle(`a`, `current`, `oldest`, `reject`),
      { type: `abort`, demand: `a` },
      settle(`b`, `current`, `oldest`, outcome),
    ],
    runs: [{ cancellation: `reject` }],
  })),
  ...[
    {
      name: `one demand after one replay`,
      history: [
        { type: `request`, demand: `a` },
        { type: `truncate` },
        {
          type: `settle`,
          demand: `a`,
          scope: `current`,
          age: `oldest`,
          outcome: `resolve`,
        },
      ] satisfies Array<LifecycleCommand>,
    },
    {
      name: `duplicate owners after overlapping replay`,
      history: pendingSupersessionHistory,
    },
  ].map(({ name, history }) => ({
    name: `does not wait for an aborted load to settle for ${name}`,
    history,
  })),
  ...([`manual`, `reject`] as const).flatMap((cancellation) =>
    ([1, 2] as const).flatMap((replays) =>
      ([`resolve`, `reject`] as const).map(
        (outcome): NamedLifecycleHistory => ({
          name: `tracks ${cancellation} cancellation across ${replays} replay(s) ending in ${outcome}`,
          history: [
            { type: `request`, demand: `a` },
            ...Array.from({ length: replays }, (): LifecycleCommand => ({
              type: `truncate`,
            })),
            {
              type: `settle`,
              demand: `a`,
              scope: `current`,
              age: `oldest`,
              outcome,
            },
            ...Array.from(
              { length: replays },
              (_, index): LifecycleCommand => ({
                type: `settle`,
                demand: `a`,
                scope: `obsolete`,
                age: `oldest`,
                outcome: index % 2 === 0 ? `reject` : `resolve`,
              }),
            ),
            { type: `release`, demand: `a` },
            { type: `cleanup` },
            { type: `restart` },
            { type: `unsubscribe` },
          ],
          runs: [{ cancellation }],
        }),
      ),
    ),
  ),
  ...[
    { name: `truncate replay`, history: abortReplayHistory },
    { name: `cleanup restart`, history: abortedRestartHistory },
  ].map(({ name, history }) => ({
    name: `queues replay without reacquiring an aborted demand on ${name}`,
    history,
  })),
  ...syncReplayScenarios.map(
    ({
      transition,
      ownerCount,
      abortFirst,
      history,
    }): NamedLifecycleHistory => ({
      name: `settles queued synchronous ${transition} with ${ownerCount} owner(s), abort=${abortFirst}`,
      history,
      runs: [{ acquisitionMode: `sync-success` }],
    }),
  ),
  ...(
    [
      {
        name: `same-key owners across truncate`,
        history: [
          { type: `request`, demand: `a` },
          { type: `request`, demand: `a` },
          { type: `truncate` },
          { type: `release`, demand: `a` },
          { type: `release`, demand: `a` },
          { type: `cleanup` },
          { type: `restart` },
          { type: `unsubscribe` },
        ],
      },
      {
        name: `same-key owners across restart`,
        history: [
          { type: `request`, demand: `a` },
          { type: `request`, demand: `a` },
          { type: `cleanup` },
          { type: `restart` },
          { type: `release`, demand: `a` },
          { type: `release`, demand: `a` },
          { type: `unsubscribe` },
        ],
      },
      {
        name: `aborted owner across repeated truncate`,
        history: [
          { type: `request`, demand: `a` },
          { type: `abort`, demand: `a` },
          { type: `truncate` },
          { type: `truncate` },
          { type: `release`, demand: `a` },
          { type: `unsubscribe` },
        ],
      },
      {
        name: `detached last-owner abort across restart`,
        history: [
          { type: `request`, demand: `a` },
          { type: `cleanup` },
          { type: `abort`, demand: `a` },
          { type: `restart` },
          { type: `release`, demand: `a` },
          { type: `unsubscribe` },
        ],
      },
    ] satisfies ReadonlyArray<{
      name: string
      history: ReadonlyArray<LifecycleCommand>
    }>
  ).map(({ name, history }) => ({
    name: `continues through the full synchronous replay suffix for ${name}`,
    history,
    runs: [
      { acquisitionMode: `sync-success` as const, continueAfterMismatch: true },
    ],
  })),
]

// The uncorrupted caller-outcome histories that the calibrations below
// corrupt: an initial or cleanup-detached request whose acquisition resolves
// or rejects. Each runs clean through the shared driver first.
const callerOutcomeHistories: ReadonlyArray<NamedLifecycleHistory> = (
  [`initial`, `detached`] as const
).flatMap((origin) =>
  ([`resolve`, `reject`] as const).map((outcome) => ({
    name: `delivers the caller outcome: ${JSON.stringify({ origin, outcome })}`,
    history: [
      ...(origin === `detached` ? [{ type: `cleanup` } as const] : []),
      { type: `request`, demand: `a` },
      ...(origin === `detached` ? [{ type: `restart` } as const] : []),
      settle(`a`, `current`, `oldest`, outcome),
    ],
  })),
)
const callerOutcomeLaw = `subscription-lifecycle.caller-outcome`
const callerOutcomeHistoryName = (
  origin: `initial` | `detached`,
  outcome: `resolve` | `reject`,
) => `delivers the caller outcome: ${JSON.stringify({ origin, outcome })}`

// A corrupted caller outcome must fail the shared driver's caller comparison.
// The mutant applies to the history the old witness ran; it records no
// judgment change for any other candidate. Only a rejection that names the
// caller outcome counts as the check rejecting the wrong answer.
const corruptedCallerOutcomeCalibrations = ([`initial`, `detached`] as const)
  .flatMap((origin) =>
    ([`early`, `pending`, `wrong-value`, `wrong-error`] as const).map(
      (fault) => ({ origin, fault }),
    ),
  )
  .map(({ origin, fault }) => {
    const target = callerOutcomeHistoryName(
      origin,
      fault === `wrong-error` ? `reject` : `resolve`,
    )
    return {
      name: `checks corrupted caller outcomes: ${JSON.stringify({ origin, fault })}`,
      law: callerOutcomeLaw,
      driver: async (
        plan: { history: NamedLifecycleHistory },
        observe: (checkpoint: string, value: unknown) => void,
      ) =>
        recordAssertionJudgment(callerOutcomeLaw, plan, observe, async () => {
          if (plan.history.name !== target) return
          try {
            await runHistory(plan.history.history, { callerFault: fault })
          } catch (error) {
            if (
              error instanceof Error &&
              error.message.includes(`caller outcome`)
            )
              rejectAt(`calibration ${fault}`, error)
            throw new Error(
              `calibration ${fault} rejected without naming the caller outcome: ${String(error)}`,
            )
          }
        }),
    }
  })

// A caller mismatch and a separate cleanup failure must both survive: the
// driver reports an AggregateError whose cause is the caller mismatch and
// whose one error carries the cleanup failure.
const cleanupFailureCalibration = {
  name: `retains the caller mismatch and a separate cleanup failure`,
  law: callerOutcomeLaw,
  driver: async (
    plan: { history: NamedLifecycleHistory },
    observe: (checkpoint: string, value: unknown) => void,
  ) =>
    recordAssertionJudgment(callerOutcomeLaw, plan, observe, async () => {
      if (plan.history.name !== callerOutcomeHistoryName(`initial`, `resolve`))
        return
      const cleanupFailure = new Error(`cleanup sentinel`)
      let reported: unknown
      try {
        await runHistory(plan.history.history, {
          callerFault: `wrong-value`,
          cleanupFault: () => {
            throw cleanupFailure
          },
        })
      } catch (error) {
        reported = error
      }
      if (
        reported instanceof AggregateError &&
        reported.cause instanceof Error &&
        reported.cause.message.includes(`caller outcome`) &&
        reported.errors.length === 1 &&
        (reported.errors[0] as Error | undefined)?.cause === cleanupFailure
      )
        rejectAt(`calibration cleanup failure`, reported)
      throw new Error(
        `the driver did not retain the caller mismatch and the cleanup failure: ${String(reported)}`,
      )
    }),
}

async function runDetachedCallerCase(
  finish:
    `resolve` | `reject` | `release` | `abort` | `cleanup` | `unsubscribe`,
): Promise<void> {
  const history: Array<LifecycleCommand> = [
    { type: `cleanup` },
    { type: `request`, demand: `a` },
    { type: `request`, demand: `b` },
    { type: `restart` },
    settle(`a`, `current`, `oldest`, `resolve`),
    ...(finish === `resolve` || finish === `reject`
      ? [settle(`b`, `current`, `oldest`, finish)]
      : finish === `release` || finish === `abort`
        ? [{ type: finish, demand: `b` } as const]
        : [{ type: finish } as const]),
  ]
  let checkpoints = 0
  await runHistory(history, {
    cancellation: `reject`,
    onResultCheckpoint: (_command, callers) => {
      if (checkpoints++ === 4) {
        oracleAssertion(`lifecycle history comparison at 1174`, () =>
          expect(callers.map(({ outcome }) => outcome.status)).toEqual([
            `pending`,
            `pending`,
          ]),
        )
      }
    },
  })
  oracleAssertion(`lifecycle history comparison at 1181`, () =>
    expect(checkpoints).toBe(6),
  )
}

async function runRetiredDeliveryCase(
  outcome: `resolve` | `reject`,
): Promise<void> {
  const reach = await runHistory(
    [{ type: `request`, demand: `a` }, { type: `unsubscribe` }],
    { retiredDelivery: outcome },
  )
  oracleAssertion(`lifecycle history comparison at 1258`, () =>
    expect(reach).toContain(`retired-attempt-delivery:${outcome}`),
  )
}

async function runReturnedResultsCase(
  firstOutcome: `resolve` | `reject`,
): Promise<void> {
  const secondOutcome = firstOutcome === `resolve` ? `reject` : `resolve`
  const history: Array<LifecycleCommand> = [
    { type: `request`, demand: `a` },
    { type: `request`, demand: `b` },
    {
      type: `settle`,
      demand: `a`,
      scope: `current`,
      age: `oldest`,
      outcome: firstOutcome,
    },
    {
      type: `settle`,
      demand: `b`,
      scope: `current`,
      age: `oldest`,
      outcome: secondOutcome,
    },
  ]
  const expectedStatuses = [
    [`pending`],
    [`pending`, `pending`],
    [firstOutcome === `resolve` ? `fulfilled` : `rejected`, `pending`],
    [
      firstOutcome === `resolve` ? `fulfilled` : `rejected`,
      secondOutcome === `resolve` ? `fulfilled` : `rejected`,
    ],
  ]
  const identities: Array<unknown> = []
  let cut = 0
  await runHistory(history, {
    onResultCheckpoint: (_command, results, failures) => {
      oracleAssertion(`lifecycle history comparison at 1297`, () =>
        expect(results.map(({ outcome }) => outcome.status)).toEqual(
          expectedStatuses[cut++],
        ),
      )
      for (const [index, returned] of results.entries()) {
        oracleAssertion(`lifecycle history comparison at 1301`, () =>
          expect(returned.attemptId).toBe(index),
        )
        oracleAssertion(`lifecycle history comparison at 1302`, () =>
          expect(returned.result).toBeInstanceOf(Promise),
        )
        if (identities.length === index) identities.push(returned.result)
        oracleAssertion(`lifecycle history comparison at 1304`, () =>
          expect(returned.result).toBe(identities[index]),
        )
        const outcome = returned.outcome
        if (outcome.status === `fulfilled`) {
          oracleAssertion(`lifecycle history comparison at 1306`, () =>
            expect(outcome.value).toBeUndefined(),
          )
        } else if (outcome.status === `rejected`) {
          oracleAssertion(`lifecycle history comparison at 1308`, () =>
            expect(outcome.error).toBe(failures.get(index)),
          )
        }
      }
    },
  })
  oracleAssertion(`lifecycle history comparison at 1313`, () =>
    expect(cut).toBe(4),
  )
}

async function runRequiredCoverage(): Promise<void> {
  const reach = new Set<string>()
  for (const history of [
    ...greenLifecycleHistories,
    ...compoundLifecycleCoverageHistories,
  ]) {
    for (const label of await runHistory(history)) reach.add(label)
  }
  const commands = [
    `request`,
    `abort`,
    `release`,
    `settle`,
    `truncate`,
    `cleanup`,
    `restart`,
    `unsubscribe`,
  ]
  const required = new Set([
    ...commands.map((type) => `command:${type}`),
    ...commands.map((type) => `effective:${type}`),
    ...commands.map((type) => `noop:${type}`),
    `settle-scope:current`,
    `settle-scope:obsolete`,
    `settle-age:oldest`,
    `settle-age:newest`,
    `settle-outcome:resolve`,
    `settle-outcome:reject`,
    ...([`current`, `obsolete`] as const).flatMap((scope) =>
      ([`oldest`, `newest`] as const).flatMap((age) =>
        ([`resolve`, `reject`] as const).map(
          (outcome) => `settle:${scope}:${age}:${outcome}`,
        ),
      ),
    ),
    `attempt-sync-run:initial`,
    `attempt-sync-run:restarted`,
    `attempt-replay:initial`,
    `attempt-replay:replayed`,
    `attempt-location:initial:initial`,
    `attempt-location:initial:replayed`,
    `attempt-location:restarted:initial`,
    `attempt-location:restarted:replayed`,
    `duplicate-owner`,
    `request-while-cleaned`,
    `partial-generation-supersession`,
  ])
  oracleAssertion(`lifecycle history comparison at 1365`, () =>
    expect([...required].filter((label) => !reach.has(label))).toEqual([]),
  )
}

async function runChangeRetirementCase(): Promise<void> {
  const reached = await runHistory(changeRetiresReplacementHistory)
  oracleAssertion(`lifecycle history comparison at 1724`, () =>
    expect(reached).toContain(`change:between-releases-would-publish`),
  )
}

describe(`CollectionSubscription async lifecycle history oracle`, () => {
  oracleProperty({
    id: `subscription-lifecycle.history-fixed`,
    law: {
      statement: `Logical demand, physical acquisition, caller outcomes, and replacement authority follow the independent lifecycle history.`,
      authority: `The shared lifecycle grammar and this file's contract prose; Collection lifecycle and ARCHITECTURE laws 9 and 10.`,
      limits: `Named regressions that the generated command grammars cannot take back; each is replayed through the same driver and comparison.`,
    },
    owns: [`src/collection/subscription.ts`],
    histories: lifecycleFixedHistories,
    label: ({ name }) => name,
    ...subscriptionComparison<NamedLifecycleHistory>(
      `subscription-lifecycle.history-fixed`,
      runNamedHistory,
    ),
    check: forwardAssertionJudgment,
  })

  oracleProperty({
    id: `subscription-lifecycle.history-cases`,
    law: {
      statement: `Logical demand, physical acquisition, caller outcomes, and replacement authority follow the independent lifecycle history.`,
      authority: `The shared lifecycle grammar and this file's contract prose; Collection lifecycle and ARCHITECTURE laws 9 and 10.`,
      limits: `The bounded peer-failure, aborted-load, cancellation, aborted-replay, and synchronous-replay case tables; each is replayed through the same driver and comparison.`,
    },
    owns: [`src/collection/subscription.ts`],
    histories: lifecycleCaseHistories,
    label: ({ name }) => name,
    ...subscriptionComparison<NamedLifecycleHistory>(
      `subscription-lifecycle.history-cases`,
      runNamedHistory,
    ),
    check: forwardAssertionJudgment,
  })

  oracleProperty({
    id: `subscription-lifecycle.caller-outcome`,
    law: {
      statement: `A caller receives the outcome of the acquisition attempt or publication wait it owns, as the independent lifecycle history predicts.`,
      authority: `The shared lifecycle grammar and this file's caller-outcome contract.`,
      limits: `Initial and cleanup-detached requests whose acquisition resolves or rejects; the calibrations corrupt the caller outcome and the cleanup path.`,
    },
    owns: [`src/collection/subscription.ts`],
    histories: callerOutcomeHistories,
    label: ({ name }) => name,
    ...subscriptionComparison<NamedLifecycleHistory>(
      callerOutcomeLaw,
      runNamedHistory,
    ),
    check: forwardAssertionJudgment,
    calibrations: [
      ...corruptedCallerOutcomeCalibrations,
      cleanupFailureCalibration,
    ],
  })

  oracleProperty({
    id: `subscription-lifecycle.detached-callers`,
    law: {
      statement: `Detached callers wait for their peer's replay until it finishes, as the independent lifecycle history predicts.`,
      authority: `The shared lifecycle grammar and this file's caller-outcome contract.`,
      limits: `The six ways the peer's replay finishes after one detached caller resolves.`,
    },
    owns: [`src/collection/subscription.ts`],
    histories: [
      `resolve`,
      `reject`,
      `release`,
      `abort`,
      `cleanup`,
      `unsubscribe`,
    ] as const,
    label: (finish) => `holds detached callers for their peer until ${finish}`,
    ...subscriptionComparison<
      `resolve` | `reject` | `release` | `abort` | `cleanup` | `unsubscribe`
    >(`subscription-lifecycle.detached-callers`, runDetachedCallerCase),
    check: forwardAssertionJudgment,
  })

  oracleProperty({
    id: `subscription-lifecycle.retired-delivery`,
    law: {
      statement: `A retired acquisition attempt that settles after unsubscribe leaves terminal observations unchanged and delivers its own outcome.`,
      authority: `The shared lifecycle grammar and this file's returned-promise contract.`,
      limits: `The retired delivery cases that the generated grammar cannot select after unsubscribe.`,
    },
    owns: [`src/collection/subscription.ts`],
    histories: [`resolve`, `reject`] as const,
    label: (outcome) =>
      `keeps terminal observations unchanged when a retired acquisition attempt ${outcome}s`,
    ...subscriptionComparison<`resolve` | `reject`>(
      `subscription-lifecycle.retired-delivery`,
      runRetiredDeliveryCase,
    ),
    check: forwardAssertionJudgment,
  })

  oracleProperty({
    id: `subscription-lifecycle.returned-results`,
    law: {
      statement: `Each returned acquisition promise settles only with its own attempt's outcome and keeps its identity.`,
      authority: `The shared lifecycle grammar and this file's returned-promise contract.`,
      limits: `Two concurrent demands whose first acquisition resolves or rejects.`,
    },
    owns: [`src/collection/subscription.ts`],
    histories: [`resolve`, `reject`] as const,
    label: (firstOutcome) =>
      `settles only the corresponding returned result when the first acquisition ${firstOutcome}s`,
    ...subscriptionComparison<`resolve` | `reject`>(
      `subscription-lifecycle.returned-results`,
      runReturnedResultsCase,
    ),
    check: forwardAssertionJudgment,
  })

  oracleProperty({
    id: `subscription-lifecycle.required-coverage`,
    law: {
      statement: `The canonical green and compound lifecycle histories refine the independent model and together reach every required command and cross-phase transition.`,
      authority: `The shared lifecycle grammar and this file's contract prose.`,
      limits: `The canonical green and compound coverage histories, replayed in order through the shared driver.`,
    },
    owns: [`src/collection/subscription.ts`],
    histories: [
      `covers every required command and cross-phase transition`,
    ] as const,
    label: (name) => name,
    ...subscriptionComparison<string>(
      `subscription-lifecycle.required-coverage`,
      runRequiredCoverage,
    ),
    check: forwardAssertionJudgment,
  })

  // Law 9: a demand change is one step. The states below are where judging
  // the replay between a change's releases would differ from judging it once
  // after the change (ORC-015). The model names them; this property records
  // them for the histories the demand-change grammar generates.
  const demandChangeReachStates = {
    'change:several-owners-during-replay': `a change retires several owners during a replay`,
    'replacement-decides-failed-owner': `a held replacement covers a failed owner`,
    'change:between-releases-would-publish': `judging between releases would publish a replay the change fails`,
    'change:between-releases-would-fail': `judging between releases would fail a replay the change publishes`,
  } as const
  const demandChangeReached = new Set<string>()
  // Preserve the old aggregate minimum-one census across the same campaigns.
  // Native determinism probes and the added constructed random campaign do
  // not supply reach to the original campaigns' aggregate gate. The named
  // replay-failed histories counted as plain tests before they became an
  // enumerated property, so their property still counts.
  let countingCampaign = true
  beforeEach(({ task }) => {
    countingCampaign =
      (task.name === `random seed` &&
        task.suite?.name !== `subscription-lifecycle.constructed-history`) ||
      task.name.startsWith(`fixed seed `) ||
      task.suite?.name === `subscription-lifecycle.replay-failed` ||
      !task.suite?.name.startsWith(`subscription-lifecycle.`)
  })
  let demandChangeHistoriesRan = false
  afterAll(() => {
    if (demandChangeHistoriesRan && !oracleReplayRequested())
      oracleAssertion(`lifecycle history comparison at 1708`, () =>
        expect(
          Object.values(demandChangeReachStates).filter(
            (state) => !demandChangeReached.has(state),
          ),
        ).toEqual([]),
      )
  })
  const runDemandChangeHistory = async (
    history: ReadonlyArray<LifecycleCommand>,
    cancellation: `manual` | `reject` = `manual`,
  ) => {
    const reached = await runHistory(history, { cancellation })
    if (!countingCampaign) return
    markLifecycleRows(reached)
    for (const [label, state] of Object.entries(demandChangeReachStates))
      if (reached.has(label)) demandChangeReached.add(state)
  }

  oracleProperty({
    id: `subscription-lifecycle.change-retirement`,
    law: {
      statement: `A demand change is one step: the replay is judged once, after the change that retires a replacement and a pending owner.`,
      authority: `ARCHITECTURE law 9 and the shared lifecycle grammar.`,
      limits: `The one named change that retires a held replacement and a pending owner.`,
    },
    owns: [`src/collection/subscription.ts`],
    histories: [
      `judges a replay once after a change that retires a replacement and a pending owner`,
    ] as const,
    label: (name) => name,
    ...subscriptionComparison<string>(
      `subscription-lifecycle.change-retirement`,
      runChangeRetirementCase,
    ),
    check: forwardAssertionJudgment,
  })

  // An abort ends the load (maintainer decision), so an aborted
  // replacement decides nothing: it never applied, so it covers none of the
  // owners it replaces (law 10: a failed or obsolete replacement cannot
  // retire established coverage). The replaced owner's failure stays, and
  // the replay keeps its publication private. 30-times counterexamples of
  // production, which counted the aborted replacement as covering.
  const replayFailedHistories = [
    {
      name: `a replacement aborted after its replaced owner failed`,
      history: [
        { type: `request`, demand: `c` },
        { type: `request`, demand: `b` },
        { type: `request`, demand: `a` },
        { type: `replace`, demand: `a`, replaced: `c` },
        { type: `truncate` },
        settle(`c`, `current`, `oldest`, `reject`),
        settle(`b`, `current`, `oldest`, `resolve`),
        { type: `abort`, demand: `a` },
        { type: `request`, demand: `a` },
      ],
    },
    {
      name: `a replacement aborted after a peer loaded and its replaced owner failed`,
      history: [
        { type: `request`, demand: `c` },
        { type: `request`, demand: `b` },
        { type: `request`, demand: `a` },
        { type: `replace`, demand: `b`, replaced: `c` },
        { type: `truncate` },
        settle(`a`, `current`, `oldest`, `resolve`),
        settle(`c`, `current`, `oldest`, `reject`),
        { type: `abort`, demand: `b` },
        { type: `request`, demand: `a` },
      ],
    },
  ] satisfies Array<{ name: string; history: Array<LifecycleCommand> }>
  oracleProperty({
    id: `subscription-lifecycle.replay-failed`,
    law: {
      statement: `An aborted replacement covers none of the owners it replaces, so the replaced owner's failure keeps the replay failed.`,
      authority: `ARCHITECTURE law 10, the maintainer decision that an abort ends the load, and the shared lifecycle grammar.`,
      limits: `The two named aborted-replacement histories; they also feed the demand-change and lifecycle-row reach census above.`,
    },
    owns: [`src/collection/subscription.ts`],
    histories: replayFailedHistories,
    label: ({ name }) => `keeps a replay failed when ${name}`,
    ...subscriptionComparison<(typeof replayFailedHistories)[number]>(
      `subscription-lifecycle.replay-failed`,
      ({ history }) => runDemandChangeHistory(history),
    ),
    check: forwardAssertionJudgment,
  })

  const cancellationArbitrary = fc.constantFrom(
    `manual` as const,
    `reject` as const,
  )

  // A replacement load that replaces a pending attempt is the state the
  // replacement-abort law judges. The campaigns must reach it.
  const replacementReachStates = {
    [replacementPendingReachLabel]: `a replacement load while its replaced attempt is pending`,
  } as const
  const replacementReached = new Set<string>()
  const lifecycleRowsReached = new Set<string>()
  const markLifecycleRows = (reached: ReadonlySet<string>) => {
    for (const row of lifecycleRowLabels)
      if (reached.has(row)) lifecycleRowsReached.add(row)
  }
  let greenHistoriesRan = false
  afterAll(() => {
    if (oracleReplayRequested()) return
    if (greenHistoriesRan)
      oracleAssertion(`lifecycle history comparison at 1841`, () =>
        expect(
          Object.values(replacementReachStates).filter(
            (state) => !replacementReached.has(state),
          ),
        ).toEqual([]),
      )
    if (greenHistoriesRan || demandChangeHistoriesRan)
      oracleAssertion(`lifecycle history comparison at 1843`, () =>
        expect(
          lifecycleRowLabels.filter((row) => !lifecycleRowsReached.has(row)),
        ).toEqual([]),
      )
  })
  const runGreenHistory = async (
    history: ReadonlyArray<LifecycleCommand>,
    cancellation: `manual` | `reject`,
  ) => {
    const reached = await runHistory(history, { cancellation })
    if (!countingCampaign) return
    greenHistoriesRan = true
    if (reached.has(replacementPendingReachLabel))
      replacementReached.add(
        replacementReachStates[replacementPendingReachLabel],
      )
    markLifecycleRows(reached)
  }

  // Constructed prefixes reach the two pairs that no generated history
  // produced: a replacement followed by a change that names no owned demand,
  // and a replacement after a restart. Each prefix is the shortest legal path
  // the lifecycle table search found, followed by a random tail.
  const constructedPrefixes: ReadonlyArray<ReadonlyArray<LifecycleCommand>> = [
    [
      { type: `request`, demand: `a` },
      { type: `request`, demand: `b` },
      { type: `replace`, demand: `a`, replaced: `b` },
      { type: `change`, release: [`c`] },
    ],
    [
      { type: `request`, demand: `a` },
      { type: `request`, demand: `b` },
      { type: `cleanup` },
      { type: `restart` },
      { type: `replace`, demand: `a`, replaced: `b` },
    ],
  ]
  const constructedPrefixArbitrary = fc
    .tuple(
      fc.constantFrom(...constructedPrefixes),
      fc.array(lifecycleCommandArbitrary, { maxLength: 8 }),
    )
    .map(([prefix, tail]) => [...prefix, ...tail])
  // Each registration retains its former grammar and fixed-seed draw sequence.
  // Constructed prefixes also receive the native API's fresh campaign.
  oracleProperty({
    id: `subscription-lifecycle.constructed-history`,
    law: {
      statement: `Logical demand, physical acquisition, caller outcomes, and replacement authority follow the independent lifecycle history.`,
      authority: `The shared lifecycle grammar and this file's contract prose; Collection lifecycle and ARCHITECTURE laws 9 and 10.`,
      limits: `The unchanged controlled adapter command grammar and post-command observations; row contents and real provider behavior remain separately owned.`,
    },
    // What this oracle owns: the gap report judges the subscription's logical
    // demand and physical acquisition bookkeeping in subscription.ts, as the
    // histories below drive it, by this file's tests. The lifecycle model lives in
    // the grammar companion, which declares it.
    owns: [`src/collection/subscription.ts`],
    histories: {
      arbitrary: fc.tuple(constructedPrefixArbitrary, cancellationArbitrary),
      runs: 80,
      fixedSeeds: [1657011],
    },
    ...subscriptionComparison<[Array<LifecycleCommand>, `manual` | `reject`]>(
      `subscription-lifecycle.constructed-history`,
      async ([history, cancellation]) => {
        await runGreenHistory(history, cancellation)
      },
    ),
    check: forwardAssertionJudgment,
    timeout: 120_000,
  })
  oracleProperty({
    id: `subscription-lifecycle.async-history`,
    law: {
      statement: `Logical demand, physical acquisition, caller outcomes, and replacement authority follow the independent lifecycle history.`,
      authority: `The shared lifecycle grammar and this file's contract prose; Collection lifecycle and ARCHITECTURE laws 9 and 10.`,
      limits: `The unchanged controlled adapter command grammar and post-command observations; row contents and real provider behavior remain separately owned.`,
    },
    owns: [`src/collection/subscription.ts`],
    histories: {
      arbitrary: fc.tuple(
        greenLifecycleHistoryArbitrary,
        cancellationArbitrary,
      ),
      runs: 80,
      fixedSeeds: [1657003],
    },
    ...subscriptionComparison<[Array<LifecycleCommand>, `manual` | `reject`]>(
      `subscription-lifecycle.async-history`,
      async ([history, cancellation]) => {
        await runGreenHistory(history, cancellation)
      },
    ),
    check: forwardAssertionJudgment,
    timeout: 120_000,
  })
  oracleProperty({
    id: `subscription-lifecycle.demand-change`,
    law: {
      statement: `Logical demand, physical acquisition, caller outcomes, and replacement authority follow the independent lifecycle history.`,
      authority: `The shared lifecycle grammar and this file's contract prose; Collection lifecycle and ARCHITECTURE laws 9 and 10.`,
      limits: `The unchanged controlled adapter command grammar and post-command observations; row contents and real provider behavior remain separately owned.`,
    },
    owns: [`src/collection/subscription.ts`],
    histories: {
      arbitrary: fc.tuple(
        demandChangeLifecycleHistoryArbitrary,
        cancellationArbitrary,
      ),
      runs: 400,
      fixedSeeds: [1657005],
    },
    ...subscriptionComparison<[Array<LifecycleCommand>, `manual` | `reject`]>(
      `subscription-lifecycle.demand-change`,
      async ([history, cancellation]) => {
        if (countingCampaign) demandChangeHistoriesRan = true
        await runDemandChangeHistory(history, cancellation)
      },
    ),
    check: forwardAssertionJudgment,
    timeout: 120_000 * multiplier,
  })
  oracleProperty({
    id: `subscription-lifecycle.sync-history`,
    law: {
      statement: `Synchronous acquisitions refine the same independent lifecycle history.`,
      authority: `The shared lifecycle grammar and this file's synchronous acquisition contract.`,
      limits: `The unchanged synchronous success grammar; asynchronous outcomes use the adjacent owners.`,
    },
    owns: [`src/collection/subscription.ts`],
    histories: {
      arbitrary: syncLifecycleHistoryArbitrary,
      runs: 80,
      fixedSeeds: [1_657_004],
    },
    ...subscriptionComparison<Array<LifecycleCommand>>(
      `subscription-lifecycle.sync-history`,
      async (history) => {
        await runHistory(history, { acquisitionMode: `sync-success` })
      },
    ),
    check: forwardAssertionJudgment,
    timeout: 120_000,
  })
})
