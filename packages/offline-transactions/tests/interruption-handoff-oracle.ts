import { queryObjects } from 'node:v8'
import fc from 'fast-check'
import { createCollection, createTransaction } from '@tanstack/db'
import { vi } from 'vitest'
import { startOfflineExecutor } from '../src/OfflineExecutor'
import { OutboxManager } from '../src/outbox/OutboxManager'
import { NonRetriableError } from '../src/types'
import { declareOracle } from '../../db/tests/oracle-declaration'
import {
  differs,
  oracleProperty,
  pass,
  violation,
} from '../../db/tests/oracle-property'
import { FakeStorageAdapter, gate, turn } from './harness'
import {
  captureUnhandledRejections,
  cleanupOfflineOracle,
} from './oracle-lifecycle'
import type { Transaction } from '@tanstack/db'
import type { Observation } from '../../db/tests/oracle-property'
import type {
  OfflineMutationFnParams,
  OnlineDetector,
  StorageAdapter,
} from '../src/types'

/**
 * Disposal retires an executor, not the durable transactions shown by surviving
 * Collections. A successor retaining the same configured Collection objects
 * in the same runtime owes the original callers their outcomes. Optimistic state remains visible
 * until provider settlement and acknowledged outbox cleanup decide that outcome.
 * Authority: the maintainer's 2026-11-10 decision for issue 2254; the README's
 * settlement boundary and core's optimistic-history contract supply the cuts.
 *
 * This extends the interruption owner's sequential restart grammar with retained
 * Collection identity. It checks manual commits, explicit/default auto-commit,
 * and actions; repeated replacements; live and restored optimism; multiple old
 * and successor waiters; new adapter objects over the same store; and provider
 * fulfillment/permanent rejection with successful or failed durable deletion.
 * Explicit old waiters range from zero to three. Restored optimistic state
 * still needs settlement when nobody registered an old completion waiter;
 * otherwise a pending caller can mask missing restoration ownership.
 * Replacing the affected Collection while retaining an unused ancillary
 * Collection does not authorize completion of old callers or snapshots.
 * An unrelated Collection waiting for the same ID must not receive the result.
 * A subscriber exception must leave the processing promise after every owner
 * receives its outcome. Authority: public Transaction.touchCollection() promises
 * that every Collection recomputes before the first error is thrown. The
 * executor's existing Collection refresh barrier receives that exception.
 *
 * Limits: one runtime/package copy, surviving Collection objects,
 * and one issued executor at a time. This is not cross-tab Promise transport or
 * exactly-once execution by independent leaders. Storage is controlled, so no
 * claim about native storage durability or browser scheduling follows.
 */

type Path = `manual` | `auto` | `default` | `action`
type HandoffHistory = {
  path: Path
  origin: `live` | `restored`
  outcomes: Array<`fulfil` | `reject`>
  replacements: number
  waiters: number
  facade: boolean
  deleteFailure: boolean
  shared: boolean
  subscriberThrows: boolean
  replaceCollection: boolean
  growRegistry: boolean
}
const paths: Array<Path> = [`manual`, `auto`, `default`, `action`]
const handoffFields = {
  path: fc.constantFrom(...paths),
  origin: fc.constantFrom(`live`, `restored`),
  outcomes: fc.array(fc.constantFrom(`fulfil`, `reject`), {
    minLength: 1,
    maxLength: 3,
  }),
  replacements: fc.integer({ min: 0, max: 3 }),
  waiters: fc.integer({ min: 0, max: 3 }),
  facade: fc.boolean(),
  deleteFailure: fc.boolean(),
  shared: fc.boolean(),
  subscriberThrows: fc.boolean(),
  replaceCollection: fc.boolean(),
  growRegistry: fc.boolean(),
}
const handoffHistory: fc.Arbitrary<HandoffHistory> = fc.record(handoffFields)
const rowKey = (plan: HandoffHistory, index: number) =>
  `row-${plan.shared ? 0 : index}`

type Result = `pending` | `fulfilled` | string
type Row = { id: string; value: string }
type Cut = {
  completed: number
  answered: number
  callers: Array<Array<Result>>
  rows: Array<Row>
  replaced: boolean
  retiredCallers: Array<Array<Result>>
  retiredRows: Array<Row>
  outbox: Array<string>
  calls: Array<number>
  late?: Array<Result>
  unrelated: Result
  unhandled: Array<string>
  subscriberCalls: number
  subscriberErrorReported: boolean
}

class HandoffDetector implements OnlineDetector {
  online = false
  private listeners = new Set<() => void>()
  isOnline() {
    return this.online
  }
  subscribe(callback: () => void) {
    this.listeners.add(callback)
    return () => this.listeners.delete(callback)
  }
  notifyOnline() {
    for (const callback of this.listeners) callback()
  }
  dispose() {
    this.listeners.clear()
  }
}

// Observation waits yield task turns, but never await a caller that may be
// orphaned. Missing setup premises are errors; a pending caller at a reached
// completion cut is data that the common refinement check must reject.
async function drainHandoff() {
  for (let i = 0; i < 10; i++) await turn()
}
async function reachHandoff(predicate: () => boolean, premise: string) {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return
    await turn()
  }
  throw new Error(`Handoff driver did not reach ${premise}`)
}

async function driveHandoff(
  plan: HandoffHistory,
  observe: (cut: string, value: unknown) => void,
  resources?: { createRetiredDetector: () => HandoffDetector },
) {
  const warn = vi.spyOn(console, `warn`).mockImplementation(() => {})
  const unhandled = captureUnhandledRejections()
  const providerGates = plan.outcomes.map(() => gate())
  const deletionGates = plan.outcomes.map(() => gate())
  const calls: Array<number> = []
  const deletions: Array<number> = []
  const ids: Array<string> = []
  const callers: Array<Array<{ result: Result }>> = plan.outcomes.map(() => [])
  const retiredCallers: Array<Array<{ result: Result }>> = []
  const transactions: Array<Transaction> = []
  let unsubscribe: (() => void) | undefined
  let subscriberCalls = 0
  const subscriberError = new Error(`subscriber failed`)
  let subscriberErrorReported = false
  let failedDeletion = false
  const storage = new (class extends FakeStorageAdapter {
    override async delete(key: string) {
      const index = ids.indexOf(key.slice(3))
      deletions.push(index)
      await deletionGates[index]!.promise
      if (plan.deleteFailure && !failedDeletion) {
        failedDeletion = true
        throw new Error(`deletion failed`)
      }
      return super.delete(key)
    }
  })()
  let writeServer!: (index: number) => void
  const createRows = () =>
    createCollection<Row, string>({
      id: `handoff-rows`,
      getKey: (row) => row.id,
      startSync: true,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          begin()
          for (const index of plan.outcomes.keys()) {
            if (plan.shared && index > 0) continue
            write({
              type: `insert`,
              value: { id: rowKey(plan, index), value: `base ${index}` },
            })
          }
          commit()
          markReady()
          writeServer = (index) => {
            begin()
            write({
              type: `update`,
              value: { id: rowKey(plan, index), value: `server ${index}` },
            })
            commit()
          }
        },
      },
    })
  let collection = createRows()
  const initialCollection = collection
  const rowCollections = [collection]
  let replaced = false
  // This configured Collection never carries a mutation. Its survival cannot
  // authorize completion for a different transaction-bearing Collection.
  const ancillary = createCollection<Row, string>({
    id: `handoff-ancillary`,
    getKey: (row) => row.id,
    sync: { sync: ({ markReady }) => markReady() },
  })
  // Reconfiguration may add Collections while keeping every previous entry.
  // These additions carry no mutation, so they cannot change modeled outcomes.
  const registrations: Record<string, typeof ancillary> = {}
  const unrelatedCollection = createCollection<Row, string>({
    id: `unrelated-handoff-rows`,
    getKey: (row) => row.id,
    sync: { sync: ({ markReady }) => markReady() },
  })
  const executors: Array<ReturnType<typeof startOfflineExecutor>> = []
  const detectors: Array<HandoffDetector> = []
  const record = (promise: Promise<unknown>, index: number) => {
    const result = { result: `pending` as Result }
    void promise.then(
      () => {
        result.result = `fulfilled`
      },
      (error: unknown) => {
        result.result = error instanceof Error ? error.message : String(error)
      },
    )
    callers[index]!.push(result)
    return result
  }
  const start = (unrelated = false) => {
    const detector =
      resources && executors.length === 0
        ? resources.createRetiredDetector()
        : new HandoffDetector()
    detectors.push(detector)
    // A new facade is a different adapter object over exactly the same store.
    const adapter: StorageAdapter = plan.facade
      ? {
          get: (key) => storage.get(key),
          set: (key, value) => storage.set(key, value),
          delete: (key) => storage.delete(key),
          keys: () => storage.keys(),
          clear: () => storage.clear(),
        }
      : storage
    const executor = startOfflineExecutor({
      collections: unrelated
        ? { rows: unrelatedCollection }
        : { rows: collection, ancillary, ...registrations },
      mutationFns: {
        save: async ({ transaction }: OfflineMutationFnParams) => {
          const index = ids.indexOf(transaction.id)
          calls.push(index)
          await providerGates[index]!.promise
          if (plan.outcomes[index] === `reject`)
            throw new NonRetriableError(`provider rejected ${index}`)
          writeServer(index)
        },
      },
      storage: unrelated ? new FakeStorageAdapter() : adapter,
      onlineDetector: detector,
      leaderElection: {
        requestLeadership: () => Promise.resolve(true),
        isLeader: () => true,
        releaseLeadership: () => {},
        onLeadershipChange: () => () => {},
      },
    })
    executors.push(executor)
    return executor
  }
  let unrelated = { result: `pending` as Result }
  const capture = (
    checkpoint: string,
    completed: number,
    late?: Array<Result>,
  ) =>
    observe(checkpoint, {
      completed,
      answered: checkpoint === `deletion held` ? completed + 1 : completed,
      callers: callers.map((entries) => entries.map((entry) => entry.result)),
      replaced,
      retiredCallers: retiredCallers.map((entries) =>
        entries.map((entry) => entry.result),
      ),
      retiredRows: replaced
        ? [...initialCollection.values()]
            .map((row) => ({ id: row.id, value: row.value }))
            .sort((a, b) => a.id.localeCompare(b.id))
        : [],
      // This law observes authored row values; virtual attribution is owned by
      // core's optimistic-history oracle. Keep every row and its exact value.
      rows: [...collection.values()]
        .map((row) => ({ id: row.id, value: row.value }))
        .sort((a, b) => a.id.localeCompare(b.id)),
      outbox: Object.keys(storage.snapshot())
        .map((key) => ids.indexOf(key.slice(3)))
        .sort()
        .map(String),
      calls: [...calls],
      unrelated: unrelated.result,
      unhandled: unhandled.rejections.map(String),
      subscriberCalls,
      subscriberErrorReported,
      ...(late ? { late } : {}),
    } satisfies Cut)
  let primaryFailure = false
  try {
    // A restored starting condition uses the real serializer and public mutation
    // capture, then retires the seed transaction before an executor reads it.
    if (plan.origin === `restored`) {
      const outbox = new OutboxManager(storage, { rows: collection })
      for (const index of plan.outcomes.keys()) {
        const seed = createTransaction({
          autoCommit: false,
          mutationFn: async () => {},
        })
        seed.mutate(() =>
          collection.update(rowKey(plan, index), (draft) => {
            draft.value = `optimistic ${index}`
          }),
        )
        ids.push(seed.id)
        await outbox.add({
          id: seed.id,
          mutations: seed.mutations,
          keys: seed.mutations.map((mutation) => mutation.globalKey),
          mutationFnName: `save`,
          idempotencyKey: seed.id,
          retryCount: 0,
          nextAttemptAt: 0,
          createdAt: new Date(1700000000000 + index),
          version: 1,
        })
        seed.rollback()
      }
    }
    let current = start()
    await current.waitForInit()
    if (plan.origin === `live`) {
      for (const index of plan.outcomes.keys()) {
        const mutate = () =>
          collection.update(rowKey(plan, index), (draft) => {
            draft.value = `optimistic ${index}`
          })
        let transaction: Transaction
        if (plan.path === `action`)
          transaction = current.createOfflineAction({
            mutationFnName: `save`,
            onMutate: mutate,
          })(undefined)
        else {
          const offline = current.createOfflineTransaction({
            mutationFnName: `save`,
            ...(plan.path === `default`
              ? {}
              : { autoCommit: plan.path !== `manual` }),
          })
          transaction = offline.mutate(mutate)
          if (plan.path === `manual`) record(offline.commit(), index)
        }
        ids.push(transaction.id)
        transactions.push(transaction)
        record(transaction.when(`settled`), index)
      }
    }
    await reachHandoff(
      () => Object.keys(storage.snapshot()).length === ids.length,
      `durable admission`,
    )
    for (const index of ids.keys())
      for (let waiter = 0; waiter < plan.waiters; waiter++)
        record(current.waitForTransactionCompletion(ids[index]!), index)
    const other = start(true)
    await other.waitForInit()
    unrelated = { result: `pending` }
    void other.waitForTransactionCompletion(ids[0]!).then(
      () => {
        unrelated.result = `fulfilled`
      },
      () => {
        unrelated.result = `rejected`
      },
    )
    for (let replacement = 0; replacement < plan.replacements; replacement++) {
      current.dispose()
      await drainHandoff()
      capture(`disposed`, 0)
      // Only the final replacement changes Collection identity. Every earlier
      // replacement remains a retained-Collection handoff control.
      if (plan.replaceCollection && replacement === plan.replacements - 1) {
        for (const index of ids.keys()) {
          retiredCallers[index] = callers[index]!
          callers[index] = []
        }
        collection = createRows()
        rowCollections.push(collection)
        replaced = true
      }
      if (plan.growRegistry) {
        registrations[`added-${replacement}`] = createCollection<Row, string>({
          id: `handoff-added-${replacement}`,
          getKey: (row) => row.id,
          sync: { sync: ({ markReady }) => markReady() },
        })
      }
      current = start()
      await current.waitForInit()
      if (Object.keys(registrations).length > 0)
        observe(`reach`, `grown registry`)
      for (const index of ids.keys())
        record(current.waitForTransactionCompletion(ids[index]!), index)
      capture(`restored`, 0)
    }
    const detector = detectors[executors.indexOf(current)]!
    detector.online = true
    detector.notifyOnline()
    // The public refresh barrier is the actual execution batch. Observe its
    // rejection without changing the caller's independently owed outcome or
    // requiring a particular diagnostic message or console sink.
    void collection.deferDataRefresh?.catch((error: unknown) => {
      if (error === subscriberError) subscriberErrorReported = true
    })
    for (const index of ids.keys()) {
      await reachHandoff(() => calls.includes(index), `provider ${index}`)
      capture(`provider held`, index)
      providerGates[index]!.resolve()
      await reachHandoff(() => deletions.includes(index), `deletion ${index}`)
      capture(`deletion held`, index)
      // Target restored-snapshot cleanup, at the final processing cut. Core's
      // live manual commit may itself throw a subscriber error while its receipt
      // fulfils; that separate publication contract belongs to core's oracle.
      if (
        plan.subscriberThrows &&
        plan.origin === `restored` &&
        (plan.deleteFailure || index === ids.length - 1)
      ) {
        const subscription = collection.subscribeChanges(() => {
          subscriberCalls++
          throw subscriberError
        })
        unsubscribe = () => subscription.unsubscribe()
      }
      deletionGates[index]!.resolve()
      await drainHandoff()
      capture(`completed`, index + 1)
      if (plan.deleteFailure) break
    }
    const late: Array<{ result: Result }> = []
    for (const index of ids.keys()) {
      if (plan.deleteFailure && index > 0) continue
      for (const executor of replaced ? [current] : [executors[0]!, current]) {
        const entry = { result: `pending` as Result }
        late.push(entry)
        void executor.waitForTransactionCompletion(ids[index]!).then(
          () => {
            entry.result = `fulfilled`
          },
          () => {
            entry.result = `rejected`
          },
        )
      }
    }
    await drainHandoff()
    capture(
      `final`,
      plan.deleteFailure ? 1 : ids.length,
      late.map((entry) => entry.result),
    )
    if (plan.origin === `live`) observe(`reach`, `path ${plan.path}`)
    observe(`reach`, `origin ${plan.origin}`)
    if (plan.origin === `restored` && plan.waiters === 0 && plan.replacements)
      observe(`reach`, `restored optimism without a waiter`)
    if (plan.replacements) observe(`reach`, `successor`)
    if (plan.replacements)
      observe(
        `reach`,
        replaced
          ? `replaced affected Collection`
          : `retained affected Collection`,
      )
    if (replaced && plan.origin === `live`)
      observe(`reach`, `replaced ${plan.path} path`)
    if (plan.facade) observe(`reach`, `new adapter`)
    if (plan.deleteFailure) observe(`reach`, `deletion failure`)
    if (plan.shared && plan.outcomes.length > 1) observe(`reach`, `shared keys`)
    if (subscriberCalls) observe(`reach`, `throwing settlement subscriber`)
    return [
      ...rowCollections,
      unrelatedCollection,
      ancillary,
      ...Object.values(registrations),
    ]
  } catch (error) {
    primaryFailure = true
    throw error
  } finally {
    unsubscribe?.()
    for (const release of [...providerGates, ...deletionGates])
      release.resolve()
    for (const executor of executors) executor.dispose()
    // Collection sync callbacks share this driver's closure. Release the
    // fixture's own references before the independent heap observation.
    executors.length = 0
    detectors.length = 0
    await drainHandoff()
    // A failing RED can leave live or restored transactions in core's scope.
    // Internal access here is cleanup only; no expected result reads it.
    for (const transaction of new Set([
      ...transactions,
      ...rowCollections.flatMap((rows) => [
        ...rows._state.transactions.values(),
      ]),
    ]))
      if (transaction.state === `persisting` || transaction.state === `pending`)
        transaction.rollback({ isSecondaryRollback: true })
    transactions.length = 0
    warn.mockRestore()
    unhandled.cleanup()
    if (!resources || primaryFailure)
      await cleanupOfflineOracle(
        [
          ...rowCollections,
          unrelatedCollection,
          ancillary,
          ...Object.values(registrations),
        ].map((rows) => () => rows.cleanup()),
        primaryFailure,
      )
  }
}

// The independent model folds authored rows in transaction order.
// Core's optimistic-history contract holds source writes while ANY transaction
// persists. A successful settled row stays held over its queued source write;
// rejection drops optimism. Once the last persisting peer settles, those writes
// apply. Restored transactions are pending, so they do not hold source writes.
// `completed` combines provider settlement and the deletion acknowledgement (or
// failure); it never denotes provider return alone. Its prefix and the origin
// suffice because this grammar has one ordered provider. Pending restored
// snapshots can cascade on a same-key failure (core rollback contract); their
// durable work and waiters still receive their independent provider outcomes.
// `replaced` records a fresh transaction-bearing Collection with the same
// registry key. That Collection restores pending snapshots, while the old
// Collection and its callers receive no outcome from this scope. An unchanged
// ancillary Collection cannot erase this distinction (README identity boundary).
// Core rollback still cascades by mutation globalKey. Restored pending snapshots
// retain those keys across deserialization, so a fresh snapshot's rejection can
// drop an old pending snapshot without settling that old executor's waiter.
// Live persisting transactions remain independent of that pending-peer cascade.
// Authority: Transaction.applyMutations defines same-item identity by globalKey;
// the public rollback contract and optimistic-history owner define the cascade.
function handoffModel(plan: HandoffHistory) {
  return (cut: Cut) => {
    const rows = new Map<string, Row>()
    const retiredRows = new Map<string, Row>()
    const retiredCancelled = new Set<string>()
    const cancelled = new Set<number>()
    const origin = cut.replaced ? `restored` : plan.origin
    for (const index of plan.outcomes.keys()) {
      const id = rowKey(plan, index)
      if (!rows.has(id)) rows.set(id, { id, value: `base ${index}` })
      if (cut.replaced && !retiredRows.has(id))
        retiredRows.set(id, { id, value: `base ${index}` })
    }
    for (const [index, outcome] of plan.outcomes.entries()) {
      const id = rowKey(plan, index)
      if (
        index < cut.answered &&
        outcome === `fulfil` &&
        (origin === `restored` || cut.completed === plan.outcomes.length)
      )
        rows.set(id, { id, value: `server ${index}` })
      if (
        origin === `restored` &&
        index < cut.completed &&
        (outcome === `reject` || plan.deleteFailure) &&
        !cancelled.has(index)
      ) {
        if (cut.replaced && plan.origin === `restored`) retiredCancelled.add(id)
        for (let peer = index; peer < plan.outcomes.length; peer++)
          if (rowKey(plan, peer) === id) cancelled.add(peer)
      }
    }
    for (const [index, outcome] of plan.outcomes.entries()) {
      const pending = index >= cut.completed && !cancelled.has(index)
      const held =
        origin === `live` &&
        index < cut.completed &&
        outcome === `fulfil` &&
        !plan.deleteFailure &&
        cut.completed < plan.outcomes.length
      if (pending || held) {
        const id = rowKey(plan, index)
        rows.set(id, { id, value: `optimistic ${index}` })
      }
      if (cut.replaced && !retiredCancelled.has(rowKey(plan, index))) {
        const id = rowKey(plan, index)
        retiredRows.set(id, { id, value: `optimistic ${index}` })
      }
    }
    return {
      results: plan.outcomes.map((outcome, index) =>
        index >= cut.completed
          ? `pending`
          : outcome === `reject`
            ? `provider rejected ${index}`
            : plan.deleteFailure
              ? `deletion failed`
              : `fulfilled`,
      ),
      rows: [...rows.values()].sort((a, b) => a.id.localeCompare(b.id)),
      retiredRows: [...retiredRows.values()].sort((a, b) =>
        a.id.localeCompare(b.id),
      ),
      outbox: plan.outcomes.flatMap((_, index) =>
        index < cut.completed && !plan.deleteFailure ? [] : [String(index)],
      ),
    }
  }
}
function checkHandoff(
  plan: HandoffHistory,
  trace: ReadonlyArray<Observation>,
  model: ReturnType<typeof handoffModel>,
) {
  for (const { checkpoint, value } of trace) {
    if (checkpoint === `reach`) continue
    if (checkpoint === `retired executor released`) {
      const difference = differs(checkpoint, `resource release`, value, 0)
      if (difference) return difference
      continue
    }
    if (checkpoint === `retired executor held`) {
      const difference = differs(checkpoint, `resource observer`, value, 1)
      if (difference) return difference
      continue
    }
    const cut = value as Cut
    const expected = model(cut)
    for (const [index, entries] of cut.callers.entries()) {
      for (const result of entries) {
        const difference = differs(
          checkpoint,
          `caller settlement`,
          result,
          expected.results[index],
          `caller ${index} lost its transaction outcome`,
        )
        if (difference) return difference
      }
    }
    for (const entries of cut.retiredCallers) {
      for (const result of entries) {
        const difference = differs(
          checkpoint,
          `scope isolation`,
          result,
          `pending`,
          `a shared ancillary Collection transferred an old caller`,
        )
        if (difference) return difference
      }
    }
    const error =
      differs(checkpoint, `optimistic lifetime`, cut.rows, expected.rows) ??
      differs(
        checkpoint,
        `scope isolation`,
        cut.retiredRows,
        expected.retiredRows,
      ) ??
      differs(checkpoint, `durable ownership`, cut.outbox, expected.outbox) ??
      differs(checkpoint, `scope isolation`, cut.unrelated, `pending`) ??
      differs(checkpoint, `unhandled`, cut.unhandled, []) ??
      (cut.subscriberCalls > 0
        ? differs(
            checkpoint,
            `subscriber error propagation`,
            cut.subscriberErrorReported,
            true,
          )
        : undefined)
    if (error) return error
    if (new Set(cut.calls).size !== cut.calls.length)
      return violation(
        checkpoint,
        `a sequential successor repeated provider work`,
        `once`,
      )
    if (cut.late?.some((result) => result !== `rejected`))
      return violation(
        checkpoint,
        `an old or successor executor forgot a settled ID`,
        `late waiter`,
      )
  }
  return pass
}

declareOracle({
  grammar: [handoffHistory],
  model: [handoffModel],
  check: [checkHandoff],
})
const states = [
  ...paths.map((path) => `path ${path}`),
  `origin live`,
  `origin restored`,
  `restored optimism without a waiter`,
  `successor`,
  `new adapter`,
  `deletion failure`,
  `shared keys`,
  `throwing settlement subscriber`,
  `retained affected Collection`,
  `replaced affected Collection`,
  `grown registry`,
  ...paths.map((path) => `replaced ${path} path`),
]
oracleProperty<HandoffHistory, ReturnType<typeof handoffModel>>({
  id: `offline.disposal-handoff`,
  law: {
    statement: `Disposal preserves durable work, pending callers and optimistic state; a sequential same-runtime successor retaining the configured Collection objects settles original callers. A fresh affected Collection cannot inherit callers through an unchanged ancillary Collection.`,
    authority: `Maintainer decision for issue 2254, 2026-11-10; offline-transactions README Tracking Submission Status; core optimistic-history contract.`,
    limits: `One runtime/package copy, surviving Collections, shared or disjoint keys, up to three transactions/replacements/waiters; controlled storage and provider; no overlapping issued executors or cross-tab Promise transport.`,
    owner: `Offline execution`,
  },
  histories: {
    arbitrary: handoffHistory,
    runs: 120,
    fixedSeeds: [20261110],
    states,
    constructed: states.map((state) => ({
      name: state,
      enters: [state],
      build: (generated) => ({
        ...generated,
        replacements: 2,
        facade: true,
        deleteFailure: true,
        replaceCollection: state.startsWith(`replaced `),
        growRegistry: state === `grown registry` || generated.growRegistry,
        ...(state === `shared keys`
          ? {
              shared: true,
              outcomes: [`fulfil`, `reject`] as HandoffHistory[`outcomes`],
            }
          : {}),
        ...(state === `throwing settlement subscriber`
          ? {
              origin: `restored` as const,
              outcomes: [`fulfil`] as HandoffHistory[`outcomes`],
              deleteFailure: false,
              subscriberThrows: true,
            }
          : {}),
        ...(state === `restored optimism without a waiter`
          ? {
              origin: `restored` as const,
              waiters: 0,
              outcomes: [`fulfil`] as HandoffHistory[`outcomes`],
              deleteFailure: false,
            }
          : {}),
        ...(state.startsWith(`path `)
          ? { path: state.slice(5) as Path, origin: `live` as const }
          : {}),
        ...(state.startsWith(`origin `)
          ? { origin: state.slice(7) as HandoffHistory[`origin`] }
          : {}),
        ...(state.startsWith(`replaced `) && state.endsWith(` path`)
          ? { path: state.slice(9, -5) as Path, origin: `live` as const }
          : {}),
      }),
    })),
    fixed: [
      {
        name: `restored optimism settles without an old waiter`,
        history: {
          path: `default`,
          origin: `restored`,
          outcomes: [`fulfil`],
          replacements: 2,
          waiters: 0,
          facade: true,
          deleteFailure: false,
          shared: false,
          subscriberThrows: false,
          replaceCollection: false,
          growRegistry: false,
        },
      },
      {
        name: `queued default auto-commit survives replacement`,
        history: {
          path: `default`,
          origin: `live`,
          outcomes: [`fulfil`],
          replacements: 1,
          waiters: 1,
          facade: false,
          deleteFailure: false,
          shared: false,
          subscriberThrows: false,
          replaceCollection: false,
          growRegistry: false,
        },
      },
      // Controls establish the neighboring settlement/visibility law without
      // disposal; replacements then change only completion ownership.
      ...paths.flatMap((path) =>
        [false, true].map((deleteFailure) => ({
          name: `control ${path}, deletion failure ${deleteFailure}`,
          history: {
            path,
            origin: `live` as const,
            outcomes: [
              `fulfil`,
              `reject`,
              `fulfil`,
            ] as HandoffHistory[`outcomes`],
            replacements: 0,
            waiters: 2,
            facade: true,
            deleteFailure,
            shared: true,
            subscriberThrows: false,
            replaceCollection: false,
            growRegistry: false,
          },
        })),
      ),
      ...paths.map((path) => ({
        name: `${path} hands off original callers`,
        history: {
          path,
          origin: `live` as const,
          outcomes: [`reject`, `fulfil`] as HandoffHistory[`outcomes`],
          replacements: 2,
          waiters: 2,
          facade: true,
          deleteFailure: false,
          shared: true,
          subscriberThrows: false,
          replaceCollection: false,
          growRegistry: false,
        },
      })),
      ...[0, 2].map((replacements) => ({
        name: `restored optimism with ${replacements} replacements`,
        history: {
          path: `default` as const,
          origin: `restored` as const,
          outcomes: [`fulfil`, `reject`] as HandoffHistory[`outcomes`],
          replacements,
          waiters: 2,
          facade: true,
          deleteFailure: false,
          shared: true,
          subscriberThrows: false,
          replaceCollection: false,
          growRegistry: false,
        },
      })),
      {
        name: `throwing subscriber cannot strand an intermediate executor`,
        history: {
          path: `default`,
          origin: `restored`,
          outcomes: [`fulfil`],
          replacements: 2,
          waiters: 2,
          facade: true,
          deleteFailure: false,
          shared: false,
          subscriberThrows: true,
          replaceCollection: false,
          growRegistry: false,
        },
      },
      ...paths.map((path) => ({
        name: `${path} keeps old callers isolated through an ancillary Collection`,
        history: {
          path,
          origin: `live` as const,
          outcomes: [`fulfil`] as HandoffHistory[`outcomes`],
          replacements: 1,
          waiters: 2,
          facade: true,
          deleteFailure: false,
          shared: false,
          subscriberThrows: false,
          replaceCollection: true,
          growRegistry: false,
        },
      })),
    ],
  },
  model: handoffModel,
  driver: async (plan, observe) => {
    await driveHandoff(plan, observe)
  },
  check: checkHandoff,
  calibrations: [
    {
      name: `a settlement subscriber exception disappears`,
      law: `subscriber error propagation`,
      corrupt: (trace) =>
        trace.some(
          (entry) =>
            entry.checkpoint === `completed` &&
            (entry.value as Cut).subscriberCalls > 0,
        )
          ? trace.map((entry) =>
              entry.checkpoint === `completed`
                ? {
                    ...entry,
                    value: {
                      ...(entry.value as Cut),
                      subscriberErrorReported: false,
                    },
                  }
                : entry,
            )
          : undefined,
    },
    {
      name: `a fresh Collection drops the old live optimistic state`,
      law: `scope isolation`,
      corrupt: (trace, plan) =>
        plan.origin !== `live` ||
        !plan.replaceCollection ||
        plan.replacements === 0
          ? undefined
          : trace.map((entry) =>
              entry.checkpoint === `completed` && (entry.value as Cut).replaced
                ? {
                    ...entry,
                    value: { ...(entry.value as Cut), retiredRows: [] },
                  }
                : entry,
            ),
    },
    {
      name: `success before deletion acknowledgement`,
      law: `caller settlement`,
      corrupt: (trace) =>
        trace.map((entry) =>
          entry.checkpoint === `deletion held`
            ? {
                ...entry,
                value: {
                  ...(entry.value as Cut),
                  callers: (entry.value as Cut).callers.map((results, index) =>
                    index === (entry.value as Cut).completed
                      ? results.map(() => `fulfilled`)
                      : results,
                  ),
                },
              }
            : entry,
        ),
    },
    {
      name: `one original caller remains pending after the successor completes`,
      law: `caller settlement`,
      corrupt: (trace, plan) =>
        plan.replacements === 0
          ? undefined
          : trace.map((entry) =>
              entry.checkpoint === `completed`
                ? {
                    ...entry,
                    value: {
                      ...(entry.value as Cut),
                      callers: (entry.value as Cut).callers.map(
                        (results, index) =>
                          index === 0
                            ? results.map((result, waiter) =>
                                waiter === 0 ? `pending` : result,
                              )
                            : results,
                      ),
                    },
                  }
                : entry,
            ),
    },
    {
      name: `disposal drops an optimistic row`,
      law: `optimistic lifetime`,
      corrupt: (trace, plan) =>
        plan.replacements === 0
          ? undefined
          : trace.map((entry) =>
              entry.checkpoint === `disposed`
                ? { ...entry, value: { ...(entry.value as Cut), rows: [] } }
                : entry,
            ),
    },
  ],
})

// The README promises executor resource release. Pending obligations justify
// retaining a disposed executor; once all outcomes arrive, surviving Collections
// must not retain it. A separate bounded campaign uses the same histories,
// production driver, model and check, with a real Node/V8 heap observation.
// queryObjects performs full GC: this judges reachability, not a GC deadline.
// The unique detector subclass is a public-config sentinel, held only by the
// retired executor after driveHandoff's frame returns. No registry is inspected.
// Collections remain strongly reachable and active through the observation.
// This receiving path establishes Node/V8 retention, not browser GC behavior.
const resourceHistory: fc.Arbitrary<HandoffHistory> = fc.record({
  ...handoffFields,
  replacements: fc.integer({ min: 1, max: 3 }),
  deleteFailure: fc.constant(false),
  replaceCollection: fc.constant(false),
})

async function driveHandoffResources(
  plan: HandoffHistory,
  observe: (cut: string, value: unknown) => void,
) {
  class RetiredDetector extends HandoffDetector {}
  const collections = await driveHandoff(plan, observe, {
    createRetiredDetector: () => {
      const detector = new RetiredDetector()
      observe(`retired executor held`, queryObjects(RetiredDetector))
      return detector
    },
  })
  let primaryFailure = false
  try {
    // Leave the setup task and its executor/detector arrays before collection.
    await turn()
    observe(`retired executor released`, queryObjects(RetiredDetector))
    observe(`reach`, `settled retained Collections`)
  } catch (error) {
    primaryFailure = true
    throw error
  } finally {
    await cleanupOfflineOracle(
      collections.map((collection) => () => collection.cleanup()),
      primaryFailure,
    )
  }
}

declareOracle({ grammar: [resourceHistory] })
const resourceStates = [
  ...paths.map((path) => `path ${path}`),
  `origin live`,
  `origin restored`,
  `settled retained Collections`,
]
oracleProperty<HandoffHistory, ReturnType<typeof handoffModel>>({
  id: `offline.disposal-handoff-resources`,
  law: {
    statement: `After disposal and settlement of every caller and restored snapshot, surviving Collections do not retain the retired executor's resources. Subscriber exceptions propagate through the processing promise after outcome delivery.`,
    authority: `offline-transactions README dispose() resource-release promise; core transaction publication error propagation.`,
    limits: `Node/V8 heap reachability of the first retired executor's configured detector after one to three sequential replacements and outcomes; same configured Collections and acknowledged deletion. This does not judge every possible retained object, browser GC, or unfinished-transaction release.`,
    owner: `Offline execution`,
  },
  histories: {
    arbitrary: resourceHistory,
    runs: 12,
    fixedSeeds: [20261110],
    states: resourceStates,
    measured: [
      `grown registry`,
      `successor`,
      `new adapter`,
      `shared keys`,
      `throwing settlement subscriber`,
      `restored optimism without a waiter`,
      `retained affected Collection`,
    ],
    constructed: resourceStates.map((state) => ({
      name: state,
      enters: [state],
      build: (plan) => ({
        ...plan,
        ...(state.startsWith(`path `)
          ? { path: state.slice(5) as Path, origin: `live` as const }
          : {}),
        ...(state.startsWith(`origin `)
          ? { origin: state.slice(7) as HandoffHistory[`origin`] }
          : {}),
      }),
    })),
  },
  model: handoffModel,
  driver: driveHandoffResources,
  check: checkHandoff,
  calibrations: [
    {
      name: `a retired executor remains reachable after every obligation settles`,
      law: `resource release`,
      corrupt: (trace) =>
        trace.map((entry) =>
          entry.checkpoint === `retired executor released`
            ? { ...entry, value: 1 }
            : entry,
        ),
    },
  ],
})
