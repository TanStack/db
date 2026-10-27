import { createCollection } from '../../src/collection/index'
import { createDeferred } from '../../src/deferred'
import { createTransaction } from '../../src/transactions'
import {
  checkGcObservation,
  createGcModel,
  stepGcModel,
} from '../../tests/collection-gc-retention-oracle'
import type { GcAction } from '../../tests/collection-gc-retention-oracle'

/**
 * Native receiving driver for the shared retention model. Playwright controls
 * elapsed timers, but native requestIdleCallback/cancelIdleCallback are saved
 * before clock installation and restored afterward. They supply actual idle
 * delivery and cancellation. The request wrapper can start a write in the same
 * task that queues cleanup: its settlement microtasks precede native idle.
 * This proves pending host work, rather than assuming a fixed wait reached it.
 */
const nativeRequest = window.requestIdleCallback.bind(window)
const nativeCancel = window.cancelIdleCallback.bind(window)

declare global {
  interface Window {
    gcReceiver: {
      start: (scenario: `idle` | `startup` | `pending`) => Promise<void>
      rollback: () => void
      finish: () => Promise<{
        requested: number
        delivered: number
        cancelled: number
      }>
      cleanup: () => Promise<void>
    }
  }
}

let cleanup = async () => {}
let rollback = () => {}
let finish = () => Promise.resolve({ requested: 0, delivered: 0, cancelled: 0 })
window.gcReceiver = {
  async start(scenario) {
    let requested = 0
    let delivered = 0
    let cancelled = 0
    const pendingIdle = new Set<number>()
    let callbackFailure: unknown
    let queuedWrite = false
    const handler = createDeferred<void>()
    const gcTime = scenario === `startup` ? 1 : 100
    const model = createGcModel(gcTime)
    const startedAt = performance.now()
    const now = () => performance.now() - startedAt
    const transactions: Array<{
      state: string
      rollback: () => unknown
      commit: () => Promise<unknown>
    }> = []
    const updateTime = () =>
      stepGcModel(model, { kind: `advance`, elapsedMs: now() - model.now })
    const apply = (action: GcAction) => {
      updateTime()
      stepGcModel(model, action)
    }
    const collection = createCollection<{ id: number }, number>({
      getKey: (row) => row.id,
      gcTime,
      startSync: true,
      sync: { sync: ({ markReady }) => markReady() },
      onInsert: () => handler.promise,
    })
    const check = (checkpoint: string) =>
      checkGcObservation(
        model,
        {
          retired: collection.status === `cleaned-up`,
          visibleKeys: [...collection.keys()],
          transactionStates: transactions.map(
            (transaction) => transaction.state,
          ),
        },
        checkpoint,
      )
    let settlement = Promise.resolve()
    const insert = () => {
      const transaction = collection.insert({ id: 1 })
      transactions.push(transaction)
      if (transaction.state !== `persisting`)
        throw new Error(`write never persisted`)
      apply({ kind: `insert`, commit: true })
      handler.resolve()
      settlement = transaction
        .when(`settled`)
        .then(() => apply({ kind: `settle`, slot: 0, outcome: `complete` }))
    }
    window.requestIdleCallback = (callback, options) => {
      requested++
      const id = nativeRequest((deadline) => {
        delivered++
        pendingIdle.delete(id)
        let hasTime = false
        const didTimeout = deadline.didTimeout
        try {
          callback({
            didTimeout,
            timeRemaining: () => {
              const remaining = deadline.timeRemaining()
              hasTime ||= remaining > 0
              return remaining
            },
          })
          updateTime()
          stepGcModel(model, { kind: `idle`, hasTime, didTimeout })
          check(`native ${scenario} core idle`)
        } catch (error) {
          callbackFailure ??= error
        }
      }, options)
      pendingIdle.add(id)
      if (scenario === `idle` && !queuedWrite) {
        queuedWrite = true
        insert()
      }
      return id
    }
    window.cancelIdleCallback = (id) => {
      cancelled++
      pendingIdle.delete(id)
      nativeCancel(id)
    }
    if (scenario === `startup`) {
      insert()
      await settlement
    }
    if (scenario === `pending`) {
      const transaction = createTransaction({
        autoCommit: false,
        mutationFn: async () => {},
      })
      transaction.mutate(() => collection.insert({ id: 1 }))
      transactions.push(transaction)
      apply({ kind: `insert`, commit: false })
      rollback = () => {
        transaction.rollback()
        apply({ kind: `rollback`, slot: 0 })
      }
    }
    finish = async () => {
      await settlement
      if (scenario === `idle` && (!queuedWrite || requested === 0))
        throw new Error(`native idle request premise not reached`)
      // A separate native opportunity observes the result even when core
      // correctly cancelled its stale callback. It cannot run before this
      // task's settlement microtasks finish.
      const opportunity = await new Promise<{
        hasTime: boolean
        didTimeout: boolean
      }>((resolve) => {
        const observe = (deadline: IdleDeadline) => {
          if (
            pendingIdle.size === 0 &&
            (deadline.timeRemaining() > 0 || deadline.didTimeout)
          )
            resolve({
              hasTime: deadline.timeRemaining() > 0,
              didTimeout: deadline.didTimeout,
            })
          else nativeRequest(observe, { timeout: 1000 })
        }
        nativeRequest(observe, { timeout: 1000 })
      })
      if (callbackFailure) throw callbackFailure
      if (!model.retired) {
        updateTime()
        stepGcModel(model, {
          kind: `idle`,
          hasTime: opportunity.hasTime,
          didTimeout: opportunity.didTimeout,
        })
      }
      check(`native ${scenario} available idle`)
      if (scenario === `idle` && delivered + cancelled === 0)
        throw new Error(`native cleanup idle neither delivered nor cancelled`)
      return { requested, delivered, cancelled }
    }
    cleanup = async () => {
      handler.resolve()
      await collection.cleanup()
    }
  },
  rollback: () => rollback(),
  finish: () => finish(),
  cleanup: () => cleanup(),
}
