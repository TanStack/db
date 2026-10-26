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
 */
type BoundaryHistory = {
  gcTime: number
  ready: boolean
  direct?: boolean
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
  const collection = createCollection<{ id: number }, number>({
    getKey: (row) => row.id,
    gcTime: history.gcTime,
    startSync: !history.direct,
    onInsert: () => handlers[handlers.length - 1]!.promise,
    sync: {
      sync: (params) => {
        markReady = params.markReady
        if (history.ready) markReady()
      },
    },
  })
  const flush = () => vi.advanceTimersByTimeAsync(0)
  const check = (label: string) =>
    checkGcObservation(
      model,
      {
        retired: collection.status === `cleaned-up`,
        visibleKeys: [...collection.keys()],
        transactionStates: transactions.map((transaction) => transaction.state),
      },
      label,
    )
  await withOracleCleanup(async () => {
    await flush()
    check(`start`)
    for (const [index, action] of history.actions.entries()) {
      if (!gcActionLegal(model, action)) continue
      const deadlineBefore = gcDeadline(model)
      const phaseBefore =
        `slot` in action ? model.transactions[action.slot] : undefined
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
        if (model.subscribers === 1 && model.gcTime < 50 && model.gcTime > 0)
          boundaryReach.reach(`last-unsubscribe-short`)
      } else if (action.kind === `preload`) {
        void collection.preload().catch(() => {})
      } else if (action.kind === `ready`) {
        markReady()
        if (model.preload && !model.transactions.includes(`persisting`))
          boundaryReach.reach(`preload-last-release`)
      } else if (action.kind === `advance`) {
        await vi.advanceTimersByTimeAsync(action.elapsedMs)
      } else if (action.kind === `idle`) {
        for (const [id, callback] of [...idleHost.callbacks]) {
          idleHost.callbacks.delete(id)
          callback({
            didTimeout: action.didTimeout,
            timeRemaining: () => (action.hasTime ? 50 : 0),
          })
        }
        if (
          model.transactions.includes(`pending`) &&
          model.now >= deadlineBefore
        )
          boundaryReach.reach(`pending-does-not-hold`)
      } else await collection.cleanup()
      stepGcModel(model, action)
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
      }
      if (model.gcTime <= 0 || !Number.isFinite(model.gcTime))
        boundaryReach.reach(`disabled-gc`)
      await flush()
      check(`step ${index} ${action.kind}`)
    }
  }, [
    async () => {
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
})
const boundaryHistoryArbitrary: fc.Arbitrary<BoundaryHistory> = fc.oneof(
  ...[
    `startup`,
    `unsubscribe`,
    `idle`,
    `pending`,
    `pending-alone`,
    `delayed-commit`,
    `preload`,
    `disabled`,
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
      } = parameters
      const actions: Array<GcAction> = []
      const settleTransaction = (slot: number): GcAction =>
        outcome === `rollback`
          ? { kind: `rollback`, slot }
          : { kind: `settle`, slot, outcome }
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
      if (lane === `pending` || lane === `pending-alone`) {
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
        if (lane === `preload`) actions.push({ kind: `preload` })
        if (sibling) actions.push({ kind: `insert`, commit: true })
        if (lane === `unsubscribe`) actions.push({ kind: `unsubscribe` })
        actions.push({ kind: `advance`, elapsedMs: age })
        actions.push(settleTransaction(sibling ? 1 : 0))
        if (sibling)
          actions.push(
            { kind: `idle`, hasTime: true, didTimeout: false },
            settleTransaction(0),
          )
        if (lane === `preload`) actions.push({ kind: `ready` })
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
        lane !== `preload`,
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
        ready: lane !== `preload`,
        actions,
      }
    }),
  ),
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
        ...oraclePropertyOptions(150, boundaryPropertyName),
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
