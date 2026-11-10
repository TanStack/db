import fc from 'fast-check'
import { createCollection } from '@tanstack/db'
import { vi } from 'vitest'
import { startOfflineExecutor } from '../src/OfflineExecutor'
import { declareOracle } from '../../db/tests/oracle-declaration'
import { differs, oracleProperty, pass } from '../../db/tests/oracle-property'
import { driveQueryBarrier } from '../../query-db-collection/tests/offline-executor-refresh-driver'
import { FakeStorageAdapter, gate, turn } from './harness'
import { cleanupOfflineOracle } from './oracle-lifecycle'
import type { Transaction } from '@tanstack/db'
import type { Observation } from '../../db/tests/oracle-property'
import type { LeaderElection, OnlineDetector } from '../src/types'

/**
 * An executor owns the coordination subscriptions it acquires. Disposal releases
 * those subscriptions and its detector resources. Optional callbacks and leader
 * cleanup may be absent. Actual leadership changes report their new value;
 * repeated reports and callbacks delivered after disposal report no new change.
 * Authority: README public dispose() resource release and OfflineConfig's
 * onLeadershipChange callback; the leadership owner's distinct-change law.
 *
 * A Collection's public deferDataRefresh promise protects pending writes while a
 * reconnect batch runs. A completed old batch cannot remove a newer batch's
 * barrier. At the core Promise projection, null and settled promises both let
 * an awaiting consumer proceed. The real QueryDB receiving path additionally
 * owes refetch completion with fresh rows; an installed fulfilled promise can
 * still fail that law. Authority: Collection.deferDataRefresh's public JSDoc,
 * offline replay/disposal contracts, and QueryDB's offline-refresh e2e contract.
 * Disposal stops new processing while an already-issued call may finish.
 *
 * The two small models below judge separate laws. They use configured public
 * collaborators, the public entry point, real storage admission and provider
 * execution, and public callbacks/barriers/caller outcomes. Limits: controlled
 * Node-hosted collaborators and in-memory storage; no native browser event or
 * storage durability claim, and no exactly-once guarantee across leaders.
 */

// A custom detector may own host resources separately from subscription leases.
// dispose releases the former; the returned unsubscribe releases each lease.
// Retained callbacks represent events already queued before unsubscription.
class LifecycleDetector implements OnlineDetector {
  online = false
  resource = true
  active = new Set<() => void>()
  retained: Array<() => void> = []
  isOnline() {
    return this.online
  }
  subscribe(callback: () => void) {
    this.active.add(callback)
    this.retained.push(callback)
    return () => this.active.delete(callback)
  }
  notifyOnline() {
    for (const callback of this.active) callback()
  }
  dispose() {
    this.resource = false
  }
}

async function settleLifecycle() {
  for (let index = 0; index < 12; index++) await turn()
}

type LifecycleHistory = {
  initial: boolean
  reports: Array<boolean>
  callback: boolean
  leaderCleanup: boolean
  disposeAt: `constructor` | `election` | `ready`
  repeatDispose: boolean
}
// Reports are legal values, including duplicate and alternating sequences.
// Disposal before/within/after initialization distinguishes nullable resources.
// Removing any axis loses an optional feature or a lifecycle observation cut.
// Arbitrary callback invocation before subscription is excluded from this grammar.
const lifecycleHistory: fc.Arbitrary<LifecycleHistory> = fc.record({
  initial: fc.boolean(),
  reports: fc.array(fc.boolean(), { minLength: 0, maxLength: 6 }),
  callback: fc.boolean(),
  leaderCleanup: fc.boolean(),
  disposeAt: fc.constantFrom(`constructor`, `election`, `ready`),
  repeatDispose: fc.boolean(),
})
type LifecycleCut = {
  reports: number
  disposed: boolean
  callbacks: Array<boolean>
  errors: Array<string>
  init: string
  leaderRequested: boolean
  onlineLeases: number
  leaderLeases: number
  detectorResource: boolean
  leaderResource: boolean
}

// Only a change in the elector's value contributes a callback. The model needs
// the last value: a next identical report distinguishes it from the other value.
// Disposal is separate because the same next report then contributes nothing.
function lifecycleModel(plan: LifecycleHistory) {
  return (cut: LifecycleCut) => {
    const callbacks: Array<boolean> = []
    let previous = plan.initial
    if (plan.disposeAt === `ready` && plan.callback) {
      callbacks.push(previous)
      for (const value of plan.reports.slice(0, cut.reports)) {
        if (value !== previous) callbacks.push(value)
        previous = value
      }
    }
    return {
      callbacks,
      onlineLeases: cut.disposed || plan.disposeAt !== `ready` ? 0 : 1,
      leaderLeases: cut.disposed || plan.disposeAt !== `ready` ? 0 : 1,
      detectorResource: !cut.disposed,
      leaderResource:
        !cut.disposed || !cut.leaderRequested || !plan.leaderCleanup,
    }
  }
}

async function driveLifecycle(
  plan: LifecycleHistory,
  observe: (checkpoint: string, value: unknown) => void,
) {
  const warning = vi.spyOn(console, `warn`).mockImplementation(() => {})
  const electionGate = gate()
  const detector = new LifecycleDetector()
  const active = new Set<(value: boolean) => void>()
  const retained: Array<(value: boolean) => void> = []
  const callbacks: Array<boolean> = []
  const errors: Array<string> = []
  let leaderRequested = false
  let leaderResource = true
  let currentLeader = plan.initial
  let init = `pending`
  let disposed = false
  let reports = 0
  const recordError = (error: unknown) =>
    errors.push(error instanceof Error ? error.message : String(error))
  const safely = (action: () => void) => {
    try {
      action()
    } catch (error) {
      recordError(error)
    }
  }
  const leader: LeaderElection & { dispose?: () => void } = {
    requestLeadership: async () => {
      leaderRequested = true
      if (plan.disposeAt === `election`) await electionGate.promise
      return currentLeader
    },
    releaseLeadership: () => {
      currentLeader = false
      for (const callback of active) callback(false)
    },
    isLeader: () => currentLeader,
    onLeadershipChange: (callback) => {
      active.add(callback)
      retained.push(callback)
      return () => active.delete(callback)
    },
    ...(plan.leaderCleanup
      ? {
          dispose: () => {
            leaderResource = false
          },
        }
      : {}),
  }
  const executor = startOfflineExecutor({
    storage: new FakeStorageAdapter(),
    collections: {},
    mutationFns: {},
    onlineDetector: detector,
    leaderElection: leader,
    ...(plan.callback
      ? { onLeadershipChange: (value: boolean) => callbacks.push(value) }
      : {}),
  })
  void executor.waitForInit().then(
    () => {
      init = `fulfilled`
    },
    (error: unknown) => {
      init = `rejected`
      recordError(error)
    },
  )
  const capture = (checkpoint: string) =>
    observe(checkpoint, {
      reports,
      disposed,
      callbacks: [...callbacks],
      errors: [...errors],
      init,
      leaderRequested,
      onlineLeases: detector.active.size,
      leaderLeases: active.size,
      detectorResource: detector.resource,
      leaderResource,
    } satisfies LifecycleCut)
  const dispose = () => {
    disposed = true
    safely(() => executor.dispose())
  }
  let primaryFailure = false
  try {
    if (plan.disposeAt === `constructor`) dispose()
    else {
      await settleLifecycle()
      if (plan.disposeAt === `election`) dispose()
    }
    electionGate.resolve()
    await settleLifecycle()
    capture(`initialization settled`)
    if (plan.disposeAt === `ready`) {
      for (const value of plan.reports) {
        currentLeader = value
        for (const callback of active) safely(() => callback(value))
        reports++
        await settleLifecycle()
        capture(`leadership report`)
      }
      dispose()
    }
    capture(`disposed`)
    for (const callback of retained) {
      safely(() => callback(true))
      safely(() => callback(false))
    }
    for (const callback of detector.retained) safely(callback)
    if (plan.repeatDispose) dispose()
    await settleLifecycle()
    capture(`stale callbacks`)
    observe(`reach`, `dispose ${plan.disposeAt}`)
    observe(`reach`, plan.callback ? `callback present` : `callback absent`)
    observe(
      `reach`,
      plan.leaderCleanup ? `leader cleanup present` : `leader cleanup absent`,
    )
    if (
      plan.disposeAt === `ready` &&
      plan.reports.some(
        (value, index) => value === (plan.reports[index - 1] ?? plan.initial),
      )
    )
      observe(`reach`, `duplicate report`)
    if (retained.length) observe(`reach`, `stale report`)
  } catch (error) {
    primaryFailure = true
    throw error
  } finally {
    electionGate.resolve()
    // A faulty production dispose is an observed result above. Test-owned
    // collaborator release still runs and cannot replace that law verdict.
    await cleanupOfflineOracle(
      [
        () => {
          safely(() => executor.dispose())
        },
        () => {
          detector.active.clear()
          active.clear()
          detector.dispose()
        },
      ],
      primaryFailure,
    )
    warning.mockRestore()
  }
}

function checkLifecycle(
  _plan: LifecycleHistory,
  trace: ReadonlyArray<Observation>,
  model: ReturnType<typeof lifecycleModel>,
) {
  for (const { checkpoint, value } of trace) {
    if (checkpoint === `reach`) continue
    const cut = value as LifecycleCut
    const expected = model(cut)
    const error =
      differs(checkpoint, `coordination errors`, cut.errors, []) ??
      differs(checkpoint, `initialization completion`, cut.init, `fulfilled`) ??
      differs(
        checkpoint,
        `leadership reports`,
        cut.callbacks,
        expected.callbacks,
      ) ??
      differs(
        checkpoint,
        `subscription release`,
        cut.onlineLeases,
        expected.onlineLeases,
      ) ??
      differs(
        checkpoint,
        `subscription release`,
        cut.leaderLeases,
        expected.leaderLeases,
      ) ??
      differs(
        checkpoint,
        `detector resource release`,
        cut.detectorResource,
        expected.detectorResource,
      ) ??
      differs(
        checkpoint,
        `leader resource release`,
        cut.leaderResource,
        expected.leaderResource,
      )
    if (error) return error
  }
  return pass
}

const lifecycleStates = [
  `dispose constructor`,
  `dispose election`,
  `dispose ready`,
  `callback present`,
  `callback absent`,
  `leader cleanup present`,
  `leader cleanup absent`,
  `duplicate report`,
  `stale report`,
]
declareOracle({
  grammar: [lifecycleHistory],
  model: [lifecycleModel],
  check: [checkLifecycle],
})
oracleProperty<LifecycleHistory, ReturnType<typeof lifecycleModel>>({
  id: `offline.executor-coordination-lifecycle`,
  law: {
    statement: `Disposal releases acquired coordination resources; optional callbacks remain optional and report actual leadership changes only before disposal.`,
    authority: `README dispose() resource release, OfflineConfig.onLeadershipChange and the leadership oracle's distinct-change contract.`,
    limits: `Custom Node-hosted collaborators; zero to six reports; disposal before init, during election or after init; no native event-delivery claim.`,
    owner: `Offline execution`,
  },
  histories: {
    arbitrary: lifecycleHistory,
    runs: 36,
    fixedSeeds: [20261110],
    states: lifecycleStates,
    constructed: lifecycleStates.map((state) => ({
      name: state,
      enters: [state],
      build: (plan) => ({
        ...plan,
        disposeAt: `ready` as const,
        callback: true,
        leaderCleanup: true,
        repeatDispose: true,
        reports: [plan.initial, !plan.initial, !plan.initial, plan.initial],
        ...(state.startsWith(`dispose `)
          ? { disposeAt: state.slice(8) as LifecycleHistory[`disposeAt`] }
          : {}),
        ...(state === `callback absent` ? { callback: false } : {}),
        ...(state === `leader cleanup absent` ? { leaderCleanup: false } : {}),
      }),
    })),
  },
  model: lifecycleModel,
  driver: driveLifecycle,
  check: checkLifecycle,
  calibrations: [
    {
      name: `disposal leaks a detector lease`,
      law: `subscription release`,
      corrupt: (trace) =>
        trace.map((entry) =>
          entry.checkpoint === `disposed`
            ? {
                ...entry,
                value: { ...(entry.value as LifecycleCut), onlineLeases: 1 },
              }
            : entry,
        ),
    },
    {
      name: `a duplicate report invokes the configured callback`,
      law: `leadership reports`,
      corrupt: (trace, plan) =>
        !plan.callback || plan.disposeAt !== `ready`
          ? undefined
          : trace.map((entry) =>
              entry.checkpoint === `initialization settled`
                ? {
                    ...entry,
                    value: {
                      ...(entry.value as LifecycleCut),
                      callbacks: [plan.initial, plan.initial],
                    },
                  }
                : entry,
            ),
    },
  ],
})

export type BarrierHistory = {
  count: number
  overlap: boolean
  retire: boolean
  notifications: number
}
// Zero writes exercises idle reconnect. Two or more writes permit an old batch
// to finish offline, then its public completion callback starts a new batch.
// Retirement keeps only the already-issued call eligible to finish. Counts
// zero/one/two/three distinguish idle, one owner, overlap and a queued suffix.
const barrierHistory: fc.Arbitrary<BarrierHistory> = fc.record({
  count: fc.integer({ min: 0, max: 3 }),
  overlap: fc.boolean(),
  retire: fc.boolean(),
  notifications: fc.integer({ min: 1, max: 3 }),
})
export type BarrierCut = {
  barrier: `none` | `pending` | `settled`
  calls: Array<number>
  callers: Array<string>
  outbox: Array<number>
  errors: Array<string>
  completed: number
  query?: {
    receipt: string
    rows: Array<{ id: string; value: string }>
    staleDelivered: boolean
    deferredScheduled: boolean
  }
}
// The JSDoc's Promise projection distinguishes pending from none/settled. It
// does not independently owe null field identity. The same model also predicts
// a real receiving consumer's public receipt and rows, which can distinguish an
// installed fulfilled promise from a completed, usable QueryDB refresh.
function barrierModel(plan: BarrierHistory) {
  return (checkpoint: string, completed: number) => ({
    callers: Array.from({ length: plan.count }, (_, index) =>
      index < completed ? `fulfilled` : `pending`,
    ),
    outbox: Array.from(
      { length: plan.count - completed },
      (_, index) => index + completed,
    ),
    blocking:
      checkpoint === `provider held` ||
      checkpoint === `newer provider held` ||
      checkpoint === `stale refetch held`,
    queryReceipt: checkpoint === `batch completed` ? `fulfilled` : `pending`,
    rows: [
      { id: `base`, value: `base` },
      ...Array.from({ length: plan.count }, (_, index) => ({
        id: String(index),
        value: `insert ${index}`,
      })),
    ].sort((left, right) => left.id.localeCompare(right.id)),
  })
}

async function driveBarrier(
  plan: BarrierHistory,
  observe: (checkpoint: string, value: unknown) => void,
) {
  const warning = vi.spyOn(console, `warn`).mockImplementation(() => {})
  const detector = new LifecycleDetector()
  const gates = Array.from({ length: plan.count }, () => gate())
  const ids: Array<string> = []
  const callers = Array.from({ length: plan.count }, () => `pending`)
  const calls: Array<number> = []
  const errors: Array<string> = []
  const transactions: Array<Transaction> = []
  const barrierStates = new WeakMap<Promise<void>, `pending` | `settled`>()
  const storage = new FakeStorageAdapter()
  const collection = createCollection<{ id: string }, string>({
    id: `lifecycle-barrier`,
    getKey: (row) => row.id,
    startSync: true,
    sync: { sync: ({ markReady }) => markReady() },
  })
  const executor = startOfflineExecutor({
    storage,
    collections: { rows: collection },
    onlineDetector: detector,
    leaderElection: {
      requestLeadership: () => Promise.resolve(true),
      releaseLeadership: () => {},
      isLeader: () => true,
      onLeadershipChange: () => () => {},
    },
    mutationFns: {
      save: async ({ transaction }) => {
        const index = ids.indexOf(transaction.id)
        calls.push(index)
        await gates[index]!.promise
      },
    },
  })
  const notify = (retained = false) => {
    for (let index = 0; index < plan.notifications; index++) {
      try {
        if (retained) for (const callback of detector.retained) callback()
        else detector.notifyOnline()
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error))
      }
      const barrier = collection.deferDataRefresh
      if (barrier && !barrierStates.has(barrier)) {
        barrierStates.set(barrier, `pending`)
        void barrier.then(
          () => {
            barrierStates.set(barrier, `settled`)
          },
          () => {
            barrierStates.set(barrier, `settled`)
          },
        )
      }
    }
  }
  const capture = async (checkpoint: string, completed: number) => {
    const barrier = collection.deferDataRefresh
    observe(checkpoint, {
      completed,
      barrier: barrier ? (barrierStates.get(barrier) ?? `pending`) : `none`,
      calls: [...calls],
      callers: [...callers],
      errors: [...errors],
      outbox: (await executor.peekOutbox())
        .map((item) => ids.indexOf(item.id))
        .sort(),
    } satisfies BarrierCut)
  }
  let primaryFailure = false
  try {
    await executor.waitForInit()
    for (let index = 0; index < plan.count; index++) {
      const pending = executor.createOfflineTransaction({
        mutationFnName: `save`,
        autoCommit: false,
      })
      ids.push(pending.id)
      transactions.push(
        pending.mutate(() => collection.insert({ id: String(index) })),
      )
      void pending.commit().then(
        () => {
          callers[index] = `fulfilled`
        },
        () => {
          callers[index] = `rejected`
        },
      )
    }
    await settleLifecycle()
    await capture(`queued offline`, 0)
    detector.online = true
    notify()
    await settleLifecycle()
    if (plan.count === 0) {
      await capture(`idle reconnect`, 0)
      observe(`reach`, `idle reconnect`)
      return
    }
    await capture(`provider held`, 0)
    observe(`reach`, `pending refresh barrier`)
    let completed = 0
    if (plan.retire) {
      executor.dispose()
      notify(true)
      await capture(`retired callback`, 0)
      gates[0]!.resolve()
      await settleLifecycle()
      await capture(`retired issued call completed`, 1)
      observe(`reach`, `retired callback`)
      return
    }
    if (plan.overlap && plan.count > 1) {
      const oldBarrier = collection.deferDataRefresh
      detector.online = false
      // This reaction runs before the old batch's chained finally. The newer
      // batch holds its own provider, so an erased barrier is observable now.
      void oldBarrier?.then(() => {
        detector.online = true
        notify()
      })
      gates[0]!.resolve()
      await settleLifecycle()
      if (!oldBarrier) {
        detector.online = true
        notify()
        await settleLifecycle()
      }
      completed = 1
      await capture(`newer provider held`, completed)
      observe(`reach`, `older completion over newer barrier`)
    }
    for (let index = completed; index < plan.count; index++) {
      gates[index]!.resolve()
      await settleLifecycle()
    }
    await capture(`batch completed`, plan.count)
    observe(`reach`, `own barrier released`)
  } catch (error) {
    primaryFailure = true
    throw error
  } finally {
    for (const entry of gates) entry.resolve()
    executor.dispose()
    await settleLifecycle()
    // Retirement deliberately leaves an unissued suffix pending. Release core
    // test scope without treating rollback as the transaction's tested outcome.
    for (const transaction of transactions)
      if (transaction.state === `pending` || transaction.state === `persisting`)
        transaction.rollback({ isSecondaryRollback: true })
    detector.active.clear()
    await cleanupOfflineOracle([() => collection.cleanup()], primaryFailure)
    warning.mockRestore()
  }
}
function checkBarrier(
  _plan: BarrierHistory,
  trace: ReadonlyArray<Observation>,
  model: ReturnType<typeof barrierModel>,
) {
  for (const { checkpoint, value } of trace) {
    if (checkpoint === `reach`) continue
    const cut = value as BarrierCut
    const expected = model(checkpoint, cut.completed)
    const error =
      differs(checkpoint, `connectivity errors`, cut.errors, []) ??
      differs(
        checkpoint,
        `refresh barrier`,
        cut.barrier === `pending`,
        expected.blocking,
      ) ??
      differs(checkpoint, `caller settlement`, cut.callers, expected.callers) ??
      differs(checkpoint, `durable ownership`, cut.outbox, expected.outbox) ??
      (cut.query
        ? (differs(
            checkpoint,
            `query refresh settlement`,
            cut.query.receipt,
            expected.queryReceipt,
          ) ??
          differs(
            checkpoint,
            `query refresh rows`,
            cut.query.rows,
            expected.rows,
          ) ??
          differs(
            checkpoint,
            `query receiving premise`,
            cut.query.staleDelivered,
            true,
          ) ??
          differs(
            checkpoint,
            `query receiving premise`,
            cut.query.deferredScheduled,
            true,
          ))
        : undefined) ??
      (checkpoint === `provider held`
        ? differs(checkpoint, `provider progress`, cut.calls, [0])
        : undefined) ??
      (checkpoint === `newer provider held`
        ? differs(checkpoint, `provider progress`, cut.calls, [0, 1])
        : undefined) ??
      (checkpoint === `retired issued call completed`
        ? differs(checkpoint, `disposal execution fence`, cut.calls, [0])
        : undefined) ??
      (checkpoint === `batch completed`
        ? differs(
            checkpoint,
            `provider progress`,
            cut.calls,
            Array.from({ length: cut.completed }, (_, index) => index),
          )
        : undefined)
    if (error) return error
  }
  return pass
}
declareOracle({
  grammar: [barrierHistory],
  model: [barrierModel],
  check: [checkBarrier],
})

// QueryDB consumes the same barrier through a real refetch receipt. Promise
// settlement alone can leave that consumer waiting if the executor retains a
// field the adapter still treats as active. This receiving path therefore feeds
// public refetch settlement and rows into the same independent judgment above.
// The established offline-refresh e2e contract supplies the stale-read premise.
// It uses controlled Node/jsdom scheduling, not native browser online events.
const queryBarrierHistory: fc.Arbitrary<BarrierHistory> = fc.record({
  count: fc.integer({ min: 1, max: 3 }),
  overlap: fc.constant(false),
  retire: fc.constant(false),
  notifications: fc.integer({ min: 1, max: 3 }),
})
declareOracle({ grammar: [queryBarrierHistory] })
const queryBarrierStates = [
  `pending refresh barrier`,
  `stale refetch delivered`,
  `query deferred by barrier`,
  `query refresh settled`,
]
oracleProperty<BarrierHistory, ReturnType<typeof barrierModel>>({
  id: `offline.executor-connectivity-query-db`,
  law: {
    statement: `A real QueryDB refetch that receives stale data during restored durable replay remains pending while provider work is held, then fulfills with fresh rows after provider settlement and acknowledged outbox cleanup.`,
    authority: `Collection.deferDataRefresh public JSDoc; QueryDB external refetch settlement owner and offline-refresh e2e stale-read premise. Persisting local mutations have a separate fetch-settlement exception.`,
    limits: `Real QueryClient and QueryDB Collection in Node/jsdom, one to three restored offline inserts with per-ID waiters, controlled query backend and provider; no native browser event or remote durability claim. Local persisting-mutation refetches may settle at fetch; overlap and retirement remain with the core receiving path.`,
    owner: `Offline execution`,
  },
  histories: {
    arbitrary: queryBarrierHistory,
    runs: 12,
    fixedSeeds: [20261110],
    states: queryBarrierStates,
    constructed: queryBarrierStates.map((state) => ({
      name: state,
      enters: [state],
      build: (plan) => plan,
    })),
  },
  model: barrierModel,
  driver: driveQueryBarrier,
  check: checkBarrier,
  calibrations: [
    {
      name: `a settled core barrier leaves the public refetch pending`,
      law: `query refresh settlement`,
      corrupt: (trace) =>
        trace.map((entry) =>
          entry.checkpoint === `batch completed`
            ? {
                ...entry,
                value: {
                  ...(entry.value as BarrierCut),
                  query: {
                    ...(entry.value as BarrierCut).query!,
                    receipt: `pending`,
                  },
                },
              }
            : entry,
        ),
    },
    {
      name: `a stale refetch settles before the held provider`,
      law: `query refresh settlement`,
      corrupt: (trace) =>
        trace.map((entry) =>
          entry.checkpoint === `stale refetch held`
            ? {
                ...entry,
                value: {
                  ...(entry.value as BarrierCut),
                  query: {
                    ...(entry.value as BarrierCut).query!,
                    receipt: `fulfilled`,
                  },
                },
              }
            : entry,
        ),
    },
  ],
})
const barrierStates = [
  `idle reconnect`,
  `pending refresh barrier`,
  `older completion over newer barrier`,
  `own barrier released`,
  `retired callback`,
]
oracleProperty<BarrierHistory, ReturnType<typeof barrierModel>>({
  id: `offline.executor-connectivity-barrier`,
  law: {
    statement: `A reconnect batch protects pending writes with a public refresh barrier and unblocks refreshes after completion. Older completion cannot remove a newer pending barrier; callbacks after disposal cannot block refreshes again. A settled promise and a null field both leave refreshes unblocked.`,
    authority: `Collection.deferDataRefresh public JSDoc; README replay and dispose() processing/resource contract.`,
    limits: `Zero to three real admitted transactions, controlled provider completion, one to three online notifications, Node Promise ordering; no browser event-delivery claim.`,
    owner: `Offline execution`,
  },
  histories: {
    arbitrary: barrierHistory,
    runs: 30,
    fixedSeeds: [20261110],
    states: barrierStates,
    constructed: barrierStates.map((state) => ({
      name: state,
      enters: [state],
      build: (plan) => ({
        ...plan,
        count: state === `idle reconnect` ? 0 : 3,
        overlap: state === `older completion over newer barrier`,
        retire: state === `retired callback`,
      }),
    })),
  },
  model: barrierModel,
  driver: driveBarrier,
  check: checkBarrier,
  calibrations: [
    {
      name: `old completion removes a newer pending barrier`,
      law: `refresh barrier`,
      corrupt: (trace) =>
        trace.some((entry) => entry.checkpoint === `newer provider held`)
          ? trace.map((entry) =>
              entry.checkpoint === `newer provider held`
                ? {
                    ...entry,
                    value: { ...(entry.value as BarrierCut), barrier: `none` },
                  }
                : entry,
            )
          : undefined,
    },
    {
      name: `completion leaves refreshes blocked by a pending barrier`,
      law: `refresh barrier`,
      corrupt: (trace) =>
        trace.some((entry) => entry.checkpoint === `batch completed`)
          ? trace.map((entry) =>
              entry.checkpoint === `batch completed`
                ? {
                    ...entry,
                    value: {
                      ...(entry.value as BarrierCut),
                      barrier: `pending`,
                    },
                  }
                : entry,
            )
          : undefined,
    },
  ],
})
