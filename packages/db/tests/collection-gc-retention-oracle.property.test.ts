import fc from 'fast-check'
import { expect, it, vi } from 'vitest'
import { createCollection } from '../src/collection/index.js'
import { createDeferred } from '../src/deferred.js'
import { createTransaction } from '../src/transactions.js'
import {
  oraclePropertyOptions,
  oracleReplayRequested,
  readOracleRunConfig,
} from './oracle-config.js'
import { createOracleReach } from './oracle-reach.js'
import { resetCleanupQueue, withOracleCleanup } from './utils.js'
import {
  checkGcObservation,
  createGcModel,
  gcActionLegal,
  gcDeadline,
  stepGcModel,
} from './collection-gc-retention-oracle.js'
import type { GcAction } from './collection-gc-retention-oracle.js'
import type { IdleCallbackFunction } from '../src/utils/browser-polyfills.js'
import type { Deferred } from '../src/deferred.js'
import type * as BrowserPolyfills from '../src/utils/browser-polyfills'

const runConfig = readOracleRunConfig()
// The boundary driver splits
// elapsed timer delivery from host idle opportunities, including zero budget.
const idleHost = vi.hoisted(() => ({
  controlled: false,
  nextId: 1,
  callbacks: new Map<number, IdleCallbackFunction>(),
}))
vi.mock('../src/utils/browser-polyfills', async (importOriginal) => {
  const original = await importOriginal<typeof BrowserPolyfills>()
  return {
    ...original,
    safeRequestIdleCallback: (callback: IdleCallbackFunction) => {
      if (!idleHost.controlled)
        return original.safeRequestIdleCallback(callback)
      const id = idleHost.nextId++
      idleHost.callbacks.set(id, callback)
      return id
    },
    safeCancelIdleCallback: (id: number) => {
      if (!idleHost.callbacks.delete(id)) original.safeCancelIdleCallback(id)
    },
  }
})

/**
 * The shared companion owns the boundary law/model/checker. This constructive
 * grammar varies the release cause, startup age, configured delay, sibling
 * holds and idle budget. Pending rollback is distinct from handler failure.
 * Every generated case ends by draining eligible idle work and explicit cleanup.
 * It rejects settling a pending transaction or unsubscribing a missing owner;
 * arbitrary suffix commands are interpreted only when legal in the model.
 *
 * Removing idle renewal loses obsolete callback authority; fixing only success
 * loses failure/rollback. Removing small gcTime loses startup/last-unsubscribe
 * distinctions; removing startup age admits an always-50ms settlement patch.
 * Removing pending or preload loses the different kinds of non-handler release.
 * Warm preloads can renew queued idle work before or during persisting holds;
 * failed preloads can be the first or last release. Siblings settle in either
 * order with independent outcomes. Held adapter cleanup crosses transaction
 * settlement and elapsed eligibility without publishing retirement early.
 * Removing any of these crossings loses a legal timing, rather than merely a
 * new payload. Cleanup restart and pending-row restoration are not generated.
 */
type BoundaryHistory = {
  gcTime: number
  ready: boolean
  direct?: boolean
  asyncCleanup?: boolean
  cleanupRejects?: boolean
  automaticCleanup?: boolean
  interaction?: boolean
  actions: Array<GcAction>
}
const boundaryPropertyName = `collection-lifecycle.gc-retention-boundaries`
const boundaryStates = [
  `queued-idle-renewal`,
  `startup-release-before-floor`,
  `last-unsubscribe-short`,
  `pending-rollback`,
  `pending-does-not-hold`,
  `sibling-persisting`,
  `preload-last-release`,
  `disabled-gc`,
  `delayed-commit`,
  `write-started-sync`,
  `late-release-short`,
  `warm-preload-persisting`,
  `warm-preload-queued-idle`,
  `warm-preload-repeated`,
  `preload-failure-held`,
  `preload-failure-last`,
  `sibling-oldest-first`,
  `sibling-newest-first`,
  `async-cleanup-settlement`,
  `async-cleanup-pending-idle`,
  `retired-settlement`,
  `retired-sibling-held`,
  `pending-subscription-held`,
  `pending-last-unsubscribe`,
  `concurrent-preload`,
  `interaction-subscriber-multiplicity`,
  `interaction-delayed-commit`,
  `interaction-three-persisting`,
  `interaction-preload-between-settlements`,
  `interaction-nonfifo-settlement`,
  `automatic-cleanup-held`,
  `automatic-cleanup-pending-rollback`,
  `automatic-cleanup-rejected`,
] as const
let boundaryReach = createOracleReach(boundaryPropertyName, boundaryStates)

async function runBoundaryHistory(history: BoundaryHistory): Promise<void> {
  boundaryReach.beginHistory()
  vi.useFakeTimers()
  vi.setSystemTime(0)
  resetCleanupQueue()
  idleHost.controlled = true
  idleHost.callbacks.clear()
  const model = createGcModel(history.gcTime, history.ready)
  const transactions: Array<{
    state: string
    rollback: () => unknown
    commit: () => Promise<unknown>
  }> = []
  const handlers: Array<Deferred<void>> = []
  const subscriptions: Array<{ unsubscribe: () => void }> = []
  let markReady = () => {}
  let markError = (_error: Error) => {}
  const preloadFailure = new Error(`preload failed`)
  const cleanupGate = createDeferred<void>()
  const cleanupFailure = new Error(`adapter cleanup rejected`)
  let cleanupPromise: Promise<void> | undefined
  let cleanupStatus: string | undefined
  let cleanupSettled = false
  let cleanupError: unknown
  let adapterCleanupCalls = 0
  let transactionSettlements = 0
  const preloads: Array<{
    promise: Promise<void>
    expected: `pending` | `fulfilled` | `rejected`
    actual: `pending` | `fulfilled` | `rejected`
    reason?: unknown
  }> = []
  let warmPreloads = 0
  const observeCleanup = () => {
    cleanupPromise = collection.cleanup().then(
      () => {
        cleanupSettled = true
      },
      (error: unknown) => {
        cleanupSettled = true
        cleanupError = error
      },
    )
  }
  const collection = createCollection<{ id: number }, number>({
    getKey: (row) => row.id,
    gcTime: history.gcTime,
    startSync: !history.direct,
    onInsert: () => handlers[handlers.length - 1]!.promise,
    sync: {
      sync: (params) => {
        markReady = params.markReady
        markError = params.markError
        if (history.ready) markReady()
        return history.asyncCleanup
          ? () => {
              adapterCleanupCalls++
              return cleanupGate.promise
            }
          : undefined
      },
    },
  })
  const flush = () => vi.advanceTimersByTimeAsync(0)
  const check = (label: string) => {
    checkGcObservation(
      model,
      {
        retired: collection.status === `cleaned-up`,
        visibleKeys: [...collection.keys()],
        transactionStates: transactions.map((transaction) => transaction.state),
      },
      label,
    )
    // The optimistic-history owner requires tracked identities to be exactly
    // the unsettled transactions. Cleanup suppresses their row projection;
    // settlement still has to retire the completed tracking entry.
    const unsettled = transactions.filter(
      (_, slot) =>
        model.transactions[slot] === `pending` ||
        model.transactions[slot] === `persisting`,
    )
    const tracked = [...collection._state.transactions.values()]
    expect(
      tracked.length === unsettled.length &&
        tracked.every((transaction) => unsettled.includes(transaction)),
      `${label}: tracked transactions are exactly the unsettled identities`,
    ).toBe(true)
    // Promise outcomes follow controlled source evidence, independently of
    // production's pending-preload flag and cached promise. Concurrent cold
    // calls share one promise; a warm call is already fulfilled.
    for (const preload of preloads) {
      expect(preload.actual, `${label}: preload outcome`).toBe(preload.expected)
      if (preload.expected === `rejected`)
        expect(preload.reason, `${label}: preload rejection identity`).toBe(
          preloadFailure,
        )
    }
    if (model.cleaningUp) {
      expect(collection.status, `${label}: held cleanup public status`).toBe(
        cleanupStatus,
      )
      expect(cleanupSettled, `${label}: cleanup settlement is held`).toBe(false)
    }
    if (model.retired && cleanupPromise) {
      expect(cleanupSettled, `${label}: cleanup settled`).toBe(true)
      if (history.cleanupRejects) {
        // Sync cleanup exposes its public wrapper and retains the exact cause.
        expect(cleanupError, `${label}: public cleanup failure`).toMatchObject({
          name: `SyncCleanupError`,
        })
        expect(
          (cleanupError as Error).cause,
          `${label}: exact adapter cause`,
        ).toBe(cleanupFailure)
      } else
        expect(
          cleanupError,
          `${label}: successful adapter cleanup`,
        ).toBeUndefined()
    }
  }
  await withOracleCleanup(async () => {
    await flush()
    check(`start`)
    for (const [index, action] of history.actions.entries()) {
      if (history.interaction)
        expect(
          gcActionLegal(model, action),
          `constructive interaction action ${index}`,
        ).toBe(true)
      if (!gcActionLegal(model, action)) continue
      const deadlineBefore = gcDeadline(model)
      const phaseBefore =
        `slot` in action ? model.transactions[action.slot] : undefined
      if (
        history.interaction &&
        action.kind === `commit` &&
        model.transactions.filter(
          (phase) => phase === `pending` || phase === `persisting`,
        ).length >= 3
      )
        boundaryReach.reach(`interaction-delayed-commit`)
      if (
        history.interaction &&
        action.kind === `settle` &&
        model.transactions.some(
          (phase, slot) => slot < action.slot && phase === `persisting`,
        )
      )
        boundaryReach.reach(`interaction-nonfifo-settlement`)
      if (action.kind === `insert`) {
        if (idleHost.callbacks.size) boundaryReach.reach(`queued-idle-renewal`)
        const handler = createDeferred<void>()
        handlers.push(handler)
        if (history.direct && action.commit) {
          boundaryReach.reach(`write-started-sync`)
          transactions.push(collection.insert({ id: transactions.length + 1 }))
        } else {
          const transaction = createTransaction({
            autoCommit: false,
            mutationFn: () => handler.promise,
          })
          transactions.push(transaction)
          transaction.mutate(() =>
            collection.insert({ id: transactions.length }),
          )
          if (action.commit) void transaction.commit().catch(() => {})
        }
      } else if (action.kind === `commit`) {
        boundaryReach.reach(`delayed-commit`)
        void transactions[action.slot]!.commit().catch(() => {})
      } else if (action.kind === `settle`) {
        const handler = handlers[action.slot]!
        if (action.outcome === `complete`) handler.resolve()
        else handler.reject(new Error(`handler failed`))
      } else if (action.kind === `rollback`) {
        transactions[action.slot]!.rollback()
        if (phaseBefore === `pending`) boundaryReach.reach(`pending-rollback`)
      } else if (action.kind === `subscribe`) {
        subscriptions.push(collection.subscribeChanges(() => {}))
      } else if (action.kind === `unsubscribe`) {
        subscriptions.pop()!.unsubscribe()
        if (model.transactions.includes(`pending`))
          boundaryReach.reach(`pending-last-unsubscribe`)
        if (model.subscribers === 1 && model.gcTime < 50 && model.gcTime > 0)
          boundaryReach.reach(`last-unsubscribe-short`)
      } else if (action.kind === `preload`) {
        if (
          history.interaction &&
          transactionSettlements > 0 &&
          model.transactions.includes(`persisting`)
        )
          boundaryReach.reach(`interaction-preload-between-settlements`)
        if (model.ready) {
          warmPreloads++
          if (model.transactions.includes(`persisting`))
            boundaryReach.reach(`warm-preload-persisting`)
          if (idleHost.callbacks.size)
            boundaryReach.reach(`warm-preload-queued-idle`)
          if (warmPreloads > 1) boundaryReach.reach(`warm-preload-repeated`)
        }
        const promise = collection.preload()
        if (model.preload) {
          boundaryReach.reach(`concurrent-preload`)
          expect(promise, `concurrent preload shares its attempt`).toBe(
            preloads.at(-1)!.promise,
          )
        }
        const observation: (typeof preloads)[number] = {
          promise,
          expected: model.ready ? `fulfilled` : `pending`,
          actual: `pending`,
        }
        preloads.push(observation)
        void promise.then(
          () => {
            observation.actual = `fulfilled`
          },
          (reason: unknown) => {
            observation.actual = `rejected`
            observation.reason = reason
          },
        )
      } else if (action.kind === `ready`) {
        markReady()
        for (const preload of preloads)
          if (preload.expected === `pending`) preload.expected = `fulfilled`
        if (model.preload && !model.transactions.includes(`persisting`))
          boundaryReach.reach(`preload-last-release`)
      } else if (action.kind === `preload-failure`) {
        markError(preloadFailure)
        for (const preload of preloads)
          if (preload.expected === `pending`) preload.expected = `rejected`
        boundaryReach.reach(
          model.transactions.includes(`persisting`)
            ? `preload-failure-held`
            : `preload-failure-last`,
        )
      } else if (action.kind === `advance`) {
        await vi.advanceTimersByTimeAsync(action.elapsedMs)
      } else if (action.kind === `idle`) {
        const startsHeldCleanup =
          action.cleanupPending &&
          (action.hasTime || action.didTimeout) &&
          model.now >= deadlineBefore
        if (startsHeldCleanup) cleanupStatus = collection.status
        for (const [id, callback] of [...idleHost.callbacks]) {
          idleHost.callbacks.delete(id)
          callback({
            didTimeout: action.didTimeout,
            timeRemaining: () => (action.hasTime ? 50 : 0),
          })
        }
        if (startsHeldCleanup) {
          // Join the operation that the idle callback started. The callback,
          // not this observer, must have invoked adapter cleanup first.
          expect(adapterCleanupCalls, `GC started adapter cleanup`).toBe(1)
          observeCleanup()
          boundaryReach.reach(`automatic-cleanup-held`)
        }
        if (
          model.transactions.includes(`pending`) &&
          model.now >= deadlineBefore
        )
          boundaryReach.reach(`pending-does-not-hold`)
        if (model.cleaningUp) boundaryReach.reach(`async-cleanup-pending-idle`)
        if (
          model.subscribers > 0 &&
          model.transactions.includes(`pending`) &&
          model.now >= Math.max(model.gcTime, 50)
        )
          boundaryReach.reach(`pending-subscription-held`)
      } else if (action.kind === `cleanup-start`) {
        cleanupStatus = collection.status
        observeCleanup()
      } else if (action.kind === `cleanup-settle`) {
        if (history.cleanupRejects) cleanupGate.reject(cleanupFailure)
        else cleanupGate.resolve()
        await cleanupPromise
        if (history.cleanupRejects)
          boundaryReach.reach(`automatic-cleanup-rejected`)
      } else await collection.cleanup()
      stepGcModel(model, action)
      if (action.kind === `settle` || action.kind === `rollback`)
        transactionSettlements++
      if (history.interaction && model.subscribers >= 2)
        boundaryReach.reach(`interaction-subscriber-multiplicity`)
      if (
        history.interaction &&
        model.transactions.filter((phase) => phase === `persisting`).length >= 3
      )
        boundaryReach.reach(`interaction-three-persisting`)
      if (
        history.asyncCleanup &&
        action.kind === `rollback` &&
        model.cleaningUp &&
        history.automaticCleanup
      )
        boundaryReach.reach(`automatic-cleanup-pending-rollback`)
      if (
        action.kind === `cleanup-start` ||
        (action.kind === `idle` && model.cleaningUp)
      )
        check(`step ${index} cleanup-start synchronous row discard`)
      if (
        (action.kind === `settle` || action.kind === `rollback`) &&
        phaseBefore === `persisting`
      ) {
        if (
          model.now < model.handoffUntil &&
          model.gcTime > 0 &&
          model.gcTime < 50
        )
          boundaryReach.reach(`startup-release-before-floor`)
        if (model.now >= 50 && model.gcTime > 0 && model.gcTime < 50)
          boundaryReach.reach(`late-release-short`)
        if (model.transactions.includes(`persisting`))
          boundaryReach.reach(`sibling-persisting`)
        const peer = action.slot === 0 ? 1 : 0
        if (model.transactions[peer] === `persisting`)
          boundaryReach.reach(
            action.slot === 0 ? `sibling-oldest-first` : `sibling-newest-first`,
          )
        if (model.cleaningUp) boundaryReach.reach(`async-cleanup-settlement`)
        if (model.retired) {
          boundaryReach.reach(`retired-settlement`)
          if (
            model.transactions.some(
              (phase) => phase === `pending` || phase === `persisting`,
            )
          )
            boundaryReach.reach(`retired-sibling-held`)
        }
      }
      if (model.gcTime <= 0 || !Number.isFinite(model.gcTime))
        boundaryReach.reach(`disabled-gc`)
      await flush()
      check(`step ${index} ${action.kind}`)
    }
  }, [
    async () => {
      cleanupGate.resolve()
      for (const transaction of transactions)
        if (transaction.state === `pending`) transaction.rollback()
      for (const handler of handlers) handler.resolve()
      await flush()
    },
    () => collection.cleanup(),
    () => {
      resetCleanupQueue()
      idleHost.callbacks.clear()
      idleHost.controlled = false
      vi.clearAllTimers()
      vi.useRealTimers()
    },
  ])
}

const boundaryParameters = fc.record({
  gcTime: fc.constantFrom(1, 10, 49, 50, 51, 100),
  age: fc.integer({ min: 0, max: 80 }),
  outcome: fc.constantFrom(
    `complete` as const,
    `fail` as const,
    `rollback` as const,
  ),
  sibling: fc.boolean(),
  direct: fc.boolean(),
  disabledTime: fc.constantFrom(0, -1, Infinity, -Infinity, NaN),
  noTimePeriods: fc.integer({ min: 0, max: 2 }),
  timeout: fc.boolean(),
  oldestFirst: fc.boolean(),
  preloadCount: fc.integer({ min: 1, max: 3 }),
  releaseGap: fc.integer({ min: 0, max: 60 }),
  siblingOutcome: fc.constantFrom(
    `complete` as const,
    `fail` as const,
    `rollback` as const,
  ),
  siblingPending: fc.boolean(),
})
const boundaryLaneHistoryArbitrary: fc.Arbitrary<BoundaryHistory> = fc.oneof(
  ...[
    `startup`,
    `unsubscribe`,
    `idle`,
    `pending`,
    `pending-alone`,
    `pending-subscribed`,
    `delayed-commit`,
    `preload`,
    `disabled`,
    `warm-preload`,
    `failed-preload-held`,
    `failed-preload-last`,
    `async-cleanup-held`,
    `async-cleanup-retired`,
    `async-cleanup-single`,
  ].map((lane) =>
    boundaryParameters.map((parameters): BoundaryHistory => {
      const {
        gcTime,
        age,
        outcome,
        sibling,
        direct,
        disabledTime,
        noTimePeriods,
        timeout,
        oldestFirst,
        preloadCount,
        releaseGap,
        siblingOutcome,
        siblingPending,
      } = parameters
      const actions: Array<GcAction> = []
      const asyncCleanup = lane.startsWith(`async-cleanup`)
      // The two cleanup timing lanes always preserve a sibling. A separate
      // single-transaction lane keeps the nearby no-survivor boundary.
      const hasSibling = asyncCleanup
        ? lane !== `async-cleanup-single`
        : sibling
      const settleAfterCleanup = lane === `async-cleanup-retired`
      const failedPreload = lane.startsWith(`failed-preload`)
      const preloadLast = lane === `failed-preload-last`
      const settleTransaction = (slot: number, result = outcome): GcAction =>
        result === `rollback`
          ? { kind: `rollback`, slot }
          : { kind: `settle`, slot, outcome: result }
      const pendingSibling = asyncCleanup && siblingPending
      const firstSlot = hasSibling && !oldestFirst && !pendingSibling ? 1 : 0
      const lastSlot = firstSlot === 0 ? 1 : 0
      const preload = () => {
        for (let count = 0; count < preloadCount; count++) {
          if (count > 0)
            actions.push({ kind: `advance`, elapsedMs: releaseGap })
          actions.push({ kind: `preload` })
        }
      }
      if (lane === `warm-preload`)
        actions.push(
          { kind: `advance`, elapsedMs: Math.max(gcTime, 50) },
          { kind: `preload` },
        )
      if (lane === `unsubscribe`) actions.push({ kind: `subscribe` })
      if (lane === `idle`) {
        actions.push({ kind: `advance`, elapsedMs: Math.max(gcTime, 50) + 1 })
        for (let i = 0; i < noTimePeriods; i++)
          actions.push({ kind: `idle`, hasTime: false, didTimeout: false })
      }
      actions.push({
        kind: `insert`,
        commit: !lane.startsWith(`pending`) && lane !== `delayed-commit`,
      })
      if (lane === `pending-subscribed`) {
        actions.push(
          { kind: `subscribe` },
          { kind: `advance`, elapsedMs: Math.max(gcTime, 50) + age + 1 },
          { kind: `idle`, hasTime: true, didTimeout: false },
          { kind: `unsubscribe` },
          { kind: `advance`, elapsedMs: gcTime - 1 },
          { kind: `idle`, hasTime: true, didTimeout: false },
          { kind: `advance`, elapsedMs: 1 },
          { kind: `idle`, hasTime: true, didTimeout: false },
        )
      } else if (lane === `pending` || lane === `pending-alone`) {
        actions.push({ kind: `advance`, elapsedMs: Math.max(gcTime, 50) - 1 })
        if (lane === `pending`) actions.push({ kind: `rollback`, slot: 0 })
        actions.push({ kind: `advance`, elapsedMs: 2 })
      } else {
        if (lane === `delayed-commit`) {
          actions.push(
            { kind: `advance`, elapsedMs: age },
            { kind: `commit`, slot: 0 },
          )
        }
        if (lane === `preload` || failedPreload) preload()
        if (hasSibling)
          actions.push({ kind: `insert`, commit: !pendingSibling })
        if (lane === `unsubscribe`) actions.push({ kind: `unsubscribe` })
        actions.push({ kind: `advance`, elapsedMs: age })
        if (lane === `warm-preload`) preload()
        if (asyncCleanup) actions.push({ kind: `cleanup-start` })
        if (asyncCleanup && settleAfterCleanup)
          actions.push({ kind: `cleanup-settle` })
        if (failedPreload && !preloadLast)
          actions.push({ kind: `preload-failure` })
        actions.push(settleTransaction(firstSlot))
        if (hasSibling)
          actions.push(
            { kind: `advance`, elapsedMs: releaseGap },
            { kind: `idle`, hasTime: true, didTimeout: false },
            pendingSibling
              ? { kind: `rollback`, slot: lastSlot }
              : settleTransaction(lastSlot, siblingOutcome),
          )
        if (lane === `preload`) actions.push({ kind: `ready` })
        if (failedPreload && preloadLast)
          actions.push({ kind: `preload-failure` })
        if (asyncCleanup)
          actions.push(
            { kind: `advance`, elapsedMs: Math.max(gcTime, 50) + 1 },
            { kind: `idle`, hasTime: true, didTimeout: false },
            ...(!settleAfterCleanup
              ? ([{ kind: `cleanup-settle` }] as const)
              : []),
          )
      }
      actions.push({ kind: `idle`, hasTime: true, didTimeout: timeout })
      // Test just below the startup floor and after every finite deadline.
      if (lane === `startup` && age < 49)
        actions.push(
          { kind: `advance`, elapsedMs: 49 - age },
          { kind: `idle`, hasTime: true, didTimeout: false },
        )
      // Derive boundary cuts from the independent law, not production timers.
      const reference = createGcModel(
        lane === `disabled` ? disabledTime : gcTime,
        lane !== `preload` && !failedPreload,
      )
      for (const action of actions)
        if (gcActionLegal(reference, action)) stepGcModel(reference, action)
      const remaining = gcDeadline(reference) - reference.now
      if (!reference.retired && Number.isFinite(remaining)) {
        actions.push(
          { kind: `advance`, elapsedMs: Math.max(0, remaining - 1) },
          { kind: `idle`, hasTime: true, didTimeout: false },
          { kind: `advance`, elapsedMs: 1 },
          { kind: `idle`, hasTime: true, didTimeout: false },
        )
      }
      actions.push(
        { kind: `advance`, elapsedMs: 200 },
        { kind: `idle`, hasTime: !timeout, didTimeout: timeout },
        { kind: `cleanup` },
      )
      return {
        gcTime: lane === `disabled` ? disabledTime : gcTime,
        direct: direct && lane === `startup`,
        ready: lane !== `preload` && !failedPreload,
        asyncCleanup,
        actions,
      }
    }),
  ),
)

// These histories choose each next command from the reference's legal actions.
// The prefix establishes subscriber multiplicity, three persisting siblings,
// a delayed commit, non-FIFO settlement and a warm preload between releases.
// Generated suffixes then recombine those owners instead of only varying a
// predefined lane's parameters. A maximum of seven transaction slots and three
// subscribers keeps shrinking and exact-key observations small. Every emitted
// action is legal; the production driver rejects a skipped interaction action.
// Removing this arbitrary loses those crossings. Removing its suffix preserves
// the prefix witnesses but loses repeated ownership/release cycles in one run.
const interactionHistoryArbitrary: fc.Arbitrary<BoundaryHistory> = fc
  .record({
    gcTime: fc.constantFrom(1, 10, 49, 50, 51, 100),
    age: fc.integer({ min: 0, max: 80 }),
    firstSettlement: fc.constantFrom(1, 2),
    reverseDrain: fc.boolean(),
    commands: fc.array(
      fc.record({
        choice: fc.integer({ min: 0, max: 255 }),
        elapsedMs: fc.integer({ min: 0, max: 120 }),
        hasTime: fc.boolean(),
        didTimeout: fc.boolean(),
        outcome: fc.constantFrom(`complete` as const, `fail` as const),
      }),
      { minLength: 6, maxLength: 14 },
    ),
  })
  .map(({ gcTime, age, firstSettlement, reverseDrain, commands }) => {
    const model = createGcModel(gcTime)
    const actions: Array<GcAction> = []
    const emit = (action: GcAction) => {
      // This check belongs to construction, before the production driver can
      // silently skip an illegal command or turn a shrink into another path.
      if (!gcActionLegal(model, action))
        throw new Error(`Interaction grammar emitted ${JSON.stringify(action)}`)
      actions.push(action)
      stepGcModel(model, action)
    }
    emit({ kind: `subscribe` })
    emit({ kind: `subscribe` })
    emit({ kind: `unsubscribe` })
    emit({ kind: `advance`, elapsedMs: Math.max(gcTime, 50) + 1 })
    emit({ kind: `idle`, hasTime: true, didTimeout: false })
    emit({ kind: `subscribe` })
    emit({ kind: `insert`, commit: true })
    emit({ kind: `insert`, commit: true })
    emit({ kind: `insert`, commit: false })
    emit({ kind: `advance`, elapsedMs: age })
    emit({ kind: `commit`, slot: 2 })
    emit({ kind: `unsubscribe` })
    emit({ kind: `advance`, elapsedMs: Math.max(gcTime, 50) + 1 })
    emit({ kind: `idle`, hasTime: true, didTimeout: false })
    emit({ kind: `unsubscribe` })
    emit({
      kind: `settle`,
      slot: firstSettlement,
      outcome: commands[0]!.outcome,
    })
    emit({ kind: `preload` })
    for (const command of commands) {
      const candidates: Array<GcAction> = [
        { kind: `advance`, elapsedMs: command.elapsedMs },
        {
          kind: `idle`,
          hasTime: command.hasTime,
          didTimeout: command.didTimeout,
        },
      ]
      if (!model.retired) {
        if (model.subscribers < 3) candidates.push({ kind: `subscribe` })
        if (model.subscribers > 0) candidates.push({ kind: `unsubscribe` })
        if (model.transactions.length < 7)
          candidates.push(
            { kind: `insert`, commit: false },
            { kind: `insert`, commit: true },
          )
        candidates.push({ kind: `preload` })
      }
      for (const [slot, state] of model.transactions.entries()) {
        if (state === `pending`) {
          if (!model.retired) candidates.push({ kind: `commit`, slot })
          candidates.push({ kind: `rollback`, slot })
        } else if (state === `persisting`)
          candidates.push(
            { kind: `settle`, slot, outcome: command.outcome },
            { kind: `rollback`, slot },
          )
      }
      emit(candidates[command.choice % candidates.length]!)
    }
    const slots = model.transactions.map((_, slot) => slot)
    if (reverseDrain) slots.reverse()
    for (const slot of slots) {
      if (model.transactions[slot] === `pending`)
        emit({ kind: `rollback`, slot })
      else if (model.transactions[slot] === `persisting`)
        emit({ kind: `settle`, slot, outcome: commands.at(-1)!.outcome })
    }
    while (model.subscribers > 0) {
      emit({ kind: `unsubscribe` })
      if (model.subscribers > 0) {
        emit({ kind: `advance`, elapsedMs: gcTime + 1 })
        emit({ kind: `idle`, hasTime: true, didTimeout: false })
      }
    }
    if (!model.retired) {
      const remaining = Math.max(0, gcDeadline(model) - model.now)
      emit({ kind: `advance`, elapsedMs: Math.max(0, remaining - 1) })
      emit({ kind: `idle`, hasTime: true, didTimeout: false })
      emit({ kind: `advance`, elapsedMs: 1 })
      emit({ kind: `idle`, hasTime: true, didTimeout: false })
    }
    emit({ kind: `cleanup` })
    return { gcTime, ready: true, interaction: true, actions }
  })

// GC may discard pending drafts, but adapter cleanup still has two cuts.
// Keep two drafts so rollback during automatic cleanup can reveal a stale
// sibling overlay. Rejection finalizes the same run and preserves its error.
const automaticCleanupHistoryArbitrary: fc.Arbitrary<BoundaryHistory> = fc
  .record({
    gcTime: fc.constantFrom(1, 10, 49, 50, 51, 100),
    age: fc.integer({ min: 0, max: 80 }),
    gap: fc.integer({ min: 0, max: 60 }),
    cleanupRejects: fc.boolean(),
    subscribed: fc.boolean(),
    outcome: fc.constantFrom(`complete` as const, `fail` as const),
  })
  .map(({ gcTime, age, gap, cleanupRejects, subscribed, outcome }) => {
    const model = createGcModel(gcTime)
    const actions: Array<GcAction> = []
    const emit = (action: GcAction) => {
      stepGcModel(model, action)
      actions.push(action)
    }
    if (subscribed) emit({ kind: `subscribe` })
    emit({ kind: `insert`, commit: true })
    emit({ kind: `insert`, commit: false })
    emit({ kind: `insert`, commit: false })
    emit({ kind: `advance`, elapsedMs: age })
    emit({ kind: `settle`, slot: 0, outcome })
    if (subscribed) emit({ kind: `unsubscribe` })
    const remaining = gcDeadline(model) - model.now
    emit({ kind: `advance`, elapsedMs: remaining - 1 })
    emit({
      kind: `idle`,
      hasTime: true,
      didTimeout: false,
      cleanupPending: true,
    })
    emit({ kind: `advance`, elapsedMs: 1 })
    emit({
      kind: `idle`,
      hasTime: false,
      didTimeout: false,
      cleanupPending: true,
    })
    emit({
      kind: `idle`,
      hasTime: true,
      didTimeout: false,
      cleanupPending: true,
    })
    emit({ kind: `rollback`, slot: 1 })
    emit({ kind: `advance`, elapsedMs: gap })
    emit({
      kind: `idle`,
      hasTime: true,
      didTimeout: false,
      cleanupPending: true,
    })
    emit({ kind: `cleanup-settle` })
    emit({ kind: `rollback`, slot: 2 })
    return {
      gcTime,
      ready: true,
      asyncCleanup: true,
      automaticCleanup: true,
      cleanupRejects,
      interaction: true,
      actions,
    }
  })

const boundaryHistoryArbitrary: fc.Arbitrary<BoundaryHistory> = fc.oneof(
  { arbitrary: boundaryLaneHistoryArbitrary, weight: 5 },
  { arbitrary: interactionHistoryArbitrary, weight: 1 },
  { arbitrary: automaticCleanupHistoryArbitrary, weight: 1 },
)

it.each(
  runConfig.replaySeed === undefined ? [20261026, undefined] : [undefined],
)(
  `preserves retention across transaction phases and idle delivery (seed %s)`,
  async (seed) => {
    boundaryReach = createOracleReach(boundaryPropertyName, boundaryStates)
    await fc.assert(
      fc.asyncProperty(boundaryHistoryArbitrary, runBoundaryHistory),
      {
        ...oraclePropertyOptions(250, boundaryPropertyName),
        ...(seed === undefined ? {} : { seed }),
      },
    )
    boundaryReach.assertReached()
    console.info(
      `GC boundary reach: ${JSON.stringify(Object.fromEntries(boundaryReach.counts()))}`,
    )
  },
)

// Reconstruction witnesses use the same model, production driver and comparison
// as the generated property; they preserve the three review traces for diagnosis.
const boundaryExamples: Array<{ name: string; history: BoundaryHistory }> = [
  {
    name: `idle work queued before a transaction settles`,
    history: {
      gcTime: 100,
      ready: true,
      actions: [
        { kind: `advance`, elapsedMs: 101 },
        { kind: `idle`, hasTime: false, didTimeout: false },
        { kind: `insert`, commit: true },
        { kind: `advance`, elapsedMs: 20 },
        { kind: `settle`, slot: 0, outcome: `complete` },
        { kind: `idle`, hasTime: true, didTimeout: false },
      ],
    },
  },
  {
    name: `fast settlement before startup grace expires`,
    history: {
      gcTime: 1,
      ready: true,
      actions: [
        { kind: `insert`, commit: true },
        { kind: `settle`, slot: 0, outcome: `complete` },
        { kind: `advance`, elapsedMs: 10 },
        { kind: `idle`, hasTime: true, didTimeout: false },
      ],
    },
  },
  {
    name: `rollback without a persisting hold`,
    history: {
      gcTime: 100,
      ready: true,
      actions: [
        { kind: `insert`, commit: false },
        { kind: `advance`, elapsedMs: 90 },
        { kind: `rollback`, slot: 0 },
        { kind: `advance`, elapsedMs: 20 },
        { kind: `idle`, hasTime: true, didTimeout: false },
      ],
    },
  },
  {
    name: `repeated warm preloads overlap a persisting hold`,
    history: {
      gcTime: 1,
      ready: true,
      actions: [
        { kind: `advance`, elapsedMs: 50 },
        { kind: `preload` },
        { kind: `insert`, commit: true },
        { kind: `advance`, elapsedMs: 25 },
        { kind: `preload` },
        { kind: `advance`, elapsedMs: 20 },
        { kind: `preload` },
        { kind: `advance`, elapsedMs: 20 },
        { kind: `settle`, slot: 0, outcome: `complete` },
        { kind: `advance`, elapsedMs: 29 },
        { kind: `idle`, hasTime: true, didTimeout: false },
        { kind: `advance`, elapsedMs: 1 },
        { kind: `idle`, hasTime: true, didTimeout: false },
      ],
    },
  },
  {
    name: `preload failure releases the last hold`,
    history: {
      gcTime: 10,
      ready: false,
      actions: [
        { kind: `insert`, commit: true },
        { kind: `preload` },
        { kind: `preload` },
        { kind: `advance`, elapsedMs: 75 },
        { kind: `settle`, slot: 0, outcome: `fail` },
        { kind: `advance`, elapsedMs: 100 },
        { kind: `idle`, hasTime: true, didTimeout: false },
        { kind: `preload-failure` },
        { kind: `advance`, elapsedMs: 49 },
        { kind: `idle`, hasTime: true, didTimeout: false },
        { kind: `advance`, elapsedMs: 1 },
        { kind: `idle`, hasTime: true, didTimeout: false },
      ],
    },
  },
  {
    name: `settlement cannot restore a sibling during asynchronous cleanup`,
    history: {
      gcTime: 1,
      ready: true,
      asyncCleanup: true,
      actions: [
        { kind: `insert`, commit: true },
        { kind: `insert`, commit: true },
        { kind: `cleanup-start` },
        { kind: `settle`, slot: 1, outcome: `complete` },
        { kind: `idle`, hasTime: true, didTimeout: false },
        { kind: `settle`, slot: 0, outcome: `complete` },
        { kind: `cleanup-settle` },
      ],
    },
  },
  {
    name: `settlement cannot restore a sibling after cleanup settles`,
    history: {
      gcTime: 1,
      ready: true,
      asyncCleanup: true,
      actions: [
        { kind: `insert`, commit: true },
        { kind: `insert`, commit: false },
        { kind: `cleanup-start` },
        { kind: `cleanup-settle` },
        { kind: `settle`, slot: 0, outcome: `complete` },
        { kind: `idle`, hasTime: true, didTimeout: false },
        { kind: `rollback`, slot: 1 },
      ],
    },
  },
]
it.skipIf(oracleReplayRequested()).each(boundaryExamples)(
  `reconstructs $name`,
  async ({ history }) => runBoundaryHistory(history),
)

// Calibrate failure fidelity separately from the product law: every release
// runs, and secondary teardown errors retain the original checkpoint as cause.
it.skipIf(oracleReplayRequested())(
  `preserves the mismatch when cleanup fails`,
  async () => {
    const primary = new Error(`retention checkpoint mismatch`)
    const secondary = new Error(`adapter cleanup failed`)
    const released: Array<number> = []
    const result = await withOracleCleanup(() => {
      throw primary
    }, [
      () => {
        released.push(1)
        throw secondary
      },
      () => {
        released.push(2)
      },
    ]).catch((error: unknown) => error)
    expect(result).toBeInstanceOf(AggregateError)
    expect((result as AggregateError).cause).toBe(primary)
    expect((result as AggregateError).errors).toEqual([primary, secondary])
    expect(released).toEqual([1, 2])
  },
)
