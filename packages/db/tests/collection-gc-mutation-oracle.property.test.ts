import fc from 'fast-check'
import { expect, it, vi } from 'vitest'
import { createCollection } from '../src/collection/index.js'
import { createDeferred } from '../src/deferred.js'
import { createTransaction } from '../src/transactions.js'
import {
  checkGcObservation,
  createGcModel,
  gcDeadline,
  stepGcModel,
} from './collection-gc-retention-oracle.js'
import {
  oraclePropertyOptions,
  oracleReplayRequested,
  readOracleRunConfig,
} from './oracle-config.js'
import { createOracleReach } from './oracle-reach.js'
import { resetCleanupQueue, withOracleCleanup } from './utils.js'
import type { GcAction, GcModel } from './collection-gc-retention-oracle.js'
import type { IdleCallbackFunction } from '../src/utils/browser-polyfills.js'
import type * as BrowserPolyfills from '../src/utils/browser-polyfills'

/**
 * Every Collection touched by a persisting transaction retains its sync run,
 * including a Collection whose mutations merged away. BaseCollectionConfig's
 * gcTime promise owns retention; transaction-ownership-oracle's opening contract
 * owns the distinction between all tracking Collections and surviving writes.
 * This is another production driver of the shared GC oracle, not another
 * lifetime model. Its `mutate` admission represents an update, delete or shared
 * transaction; the shared model owns all phase, hold and deadline decisions.
 *
 * The extra row judgment starts from one independently known source row on each
 * Collection. An update changes its value, a delete removes it, and an
 * insert/delete pair on a fresh key leaves the source row unchanged. While the
 * transaction is active, that intent overlays the source. Settlement restores
 * the source because this fixture supplies no confirming sync transaction.
 * This tiny projection enacts intent, not production's mutation-merging logic.
 * The exact keys pass through the shared checker, and full row values are also
 * compared. Cleanup must empty every projection regardless of supplied keys.
 *
 * The constructive grammar chooses direct update/delete, shared update/delete,
 * or a shared transaction whose writes cancel on one Collection. A surviving
 * update on its peer keeps the latter transaction genuinely persisting: a fully
 * empty commit completes immediately and cannot witness a retention hold.
 * Both orientations, success/failure/rollback, last unsubscribe or no subscriber,
 * six configured delays and elapsed ages vary. All histories cross the deadline
 * that would collect an unheld Collection, then compare just before and at the
 * independently computed renewed deadline. Idle delivery is controlled.
 *
 * Removing the direct path loses handler admission; removing the cancelled
 * shape admits retaining/notifying only Collections in the final mutations.
 * Removing either orientation admits a first-Collection special case. Removing
 * failures/rollback admits success-only renewal. A delete of an absent source
 * key is illegal and is never generated. Queued sync writes, multiple local
 * transactions, restart, provider I/O and offline/paced mutations stay outside
 * this driver; their neighboring owners remain responsible for those laws.
 */
const idleHost = vi.hoisted(() => ({
  nextId: 1,
  callbacks: new Map<number, IdleCallbackFunction>(),
}))
vi.mock('../src/utils/browser-polyfills', async (importOriginal) => ({
  ...(await importOriginal<typeof BrowserPolyfills>()),
  safeRequestIdleCallback: (callback: IdleCallbackFunction) => {
    const id = idleHost.nextId++
    idleHost.callbacks.set(id, callback)
    return id
  },
  safeCancelIdleCallback: (id: number) => idleHost.callbacks.delete(id),
}))

const propertyName = `collection-lifecycle.gc-mutation-shapes`
const states = [
  `direct-update`,
  `direct-delete`,
  `shared-update-delete`,
  `shared-cancel`,
  `cancelled-a-retained`,
  `cancelled-b-retained`,
  `no-subscriber`,
  `last-unsubscribe`,
  `retired-after-complete`,
  `retired-after-fail`,
  `retired-after-rollback`,
] as const
let reach = createOracleReach(propertyName, states)
const runConfig = readOracleRunConfig()
type Side = `a` | `b`
type Row = { id: number; value: number }
type Shape = (typeof states)[0 | 1 | 2 | 3]
type History = {
  shape: Shape
  firstSide: Side
  outcome: `complete` | `fail` | `rollback`
  lastUnsubscribe: boolean
  gcTime: number
  age: number
  sourceValue: number
}
const sides: Array<Side> = [`a`, `b`]

async function runMutationHistory(history: History): Promise<void> {
  reach.beginHistory()
  vi.useFakeTimers()
  vi.setSystemTime(0)
  resetCleanupQueue()
  idleHost.callbacks.clear()
  const handler = createDeferred<void>()
  let handlerCalls = 0
  const mutationFn = () => {
    handlerCalls++
    return handler.promise
  }
  const create = () =>
    createCollection<Row, number>({
      getKey: (row) => row.id,
      gcTime: history.gcTime,
      startSync: true,
      onInsert: mutationFn,
      onUpdate: mutationFn,
      onDelete: mutationFn,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          begin()
          write({
            type: `insert`,
            value: { id: 1, value: history.sourceValue },
          })
          commit()
          markReady()
        },
      },
    })
  const collections = { a: create(), b: create() }
  const models = {
    a: createGcModel(history.gcTime),
    b: createGcModel(history.gcTime),
  }
  const shared = history.shape.startsWith(`shared`)
  const otherSide = history.firstSide === `a` ? `b` : `a`
  const touched = shared ? sides : [history.firstSide]
  const subscriptions: Array<{ unsubscribe: () => void }> = []
  const flush = () => vi.advanceTimersByTimeAsync(0)
  let transaction:
    | {
        state: string
        mutations: ReadonlyArray<{ collection: unknown }>
        rollback: () => unknown
        isPersisted: { promise: Promise<unknown> }
      }
    | undefined
  let receipt: `pending` | `fulfilled` | `rejected` = `pending`

  // Intent distinguishes source and optimistic state without consulting either
  // production rows or transaction.mutations for the expected answer.
  const expectedRows = (side: Side, model: GcModel): Array<Row> => {
    if (model.retired || model.cleaningUp) return []
    const phase = model.transactions[0]
    const active = phase === `pending` || phase === `persisting`
    if (!active) return [{ id: 1, value: history.sourceValue }]
    const deleted =
      history.shape === `direct-delete` ||
      (history.shape === `shared-update-delete` && side === otherSide)
    if (deleted) return []
    const cancelled =
      history.shape === `shared-cancel` && side === history.firstSide
    return [{ id: 1, value: history.sourceValue + (cancelled ? 0 : 1) }]
  }
  const check = (label: string) => {
    for (const side of sides) {
      const model = models[side]
      const expected = expectedRows(side, model)
      checkGcObservation(
        model,
        {
          retired: collections[side].status === `cleaned-up`,
          visibleKeys: [...collections[side].keys()],
          transactionStates:
            touched.includes(side) && transaction ? [transaction.state] : [],
        },
        `${label} ${side}`,
        [1],
        expected.map((row) => row.id),
      )
      expect(
        [...collections[side].values()].map(({ id, value }) => ({ id, value })),
        `${label} ${side}: full rows`,
      ).toEqual(expected)
      const tracked = [...collections[side]._state.transactions.values()]
      const active =
        model.transactions[0] === `pending` ||
        model.transactions[0] === `persisting`
      expect(tracked.length, `${label} ${side}: tracking count`).toBe(
        active ? 1 : 0,
      )
      if (active)
        expect(tracked[0], `${label} ${side}: tracking identity`).toBe(
          transaction,
        )
    }
  }
  const advance = async (elapsedMs: number) => {
    for (const side of sides)
      stepGcModel(models[side], { kind: `advance`, elapsedMs })
    await vi.advanceTimersByTimeAsync(elapsedMs)
  }
  const idle = async () => {
    for (const [id, callback] of [...idleHost.callbacks]) {
      idleHost.callbacks.delete(id)
      callback({ didTimeout: false, timeRemaining: () => 50 })
    }
    for (const side of sides)
      stepGcModel(models[side], {
        kind: `idle`,
        hasTime: true,
        didTimeout: false,
      })
    await flush()
  }
  await withOracleCleanup(async () => {
    await flush()
    check(`source ready`)
    if (history.lastUnsubscribe) {
      for (const side of touched) {
        subscriptions.push(collections[side].subscribeChanges(() => {}))
        stepGcModel(models[side], { kind: `subscribe` })
      }
    }
    const update = (side: Side) =>
      collections[side].update(1, (row) => {
        row.value++
      })
    if (!shared) {
      transaction =
        history.shape === `direct-update`
          ? update(history.firstSide)
          : collections[history.firstSide].delete(1)
    } else {
      const manual = createTransaction({ autoCommit: false, mutationFn })
      manual.mutate(() => {
        if (history.shape === `shared-cancel`) {
          collections[history.firstSide].insert({
            id: 2,
            value: history.sourceValue + 1,
          })
          collections[history.firstSide].delete(2)
          update(otherSide)
        } else {
          update(history.firstSide)
          collections[otherSide].delete(1)
        }
      })
      void manual.commit().catch(() => {})
      transaction = manual
    }
    void transaction.isPersisted.promise.then(
      () => {
        receipt = `fulfilled`
      },
      () => {
        receipt = `rejected`
      },
    )
    for (const side of touched)
      stepGcModel(models[side], { kind: `mutate`, commit: true })
    await flush()
    expect(transaction.state, `handler genuinely persists`).toBe(`persisting`)
    expect(handlerCalls, `one mutation handler starts`).toBe(1)
    check(`admitted`)
    if (history.lastUnsubscribe) {
      for (const subscription of subscriptions.splice(0))
        subscription.unsubscribe()
      for (const side of touched)
        stepGcModel(models[side], { kind: `unsubscribe` })
    }
    reach.reach(history.lastUnsubscribe ? `last-unsubscribe` : `no-subscriber`)
    await advance(Math.max(history.gcTime, 50) + history.age + 1)
    await idle()
    check(`past the unheld deadline while persisting`)
    expect(receipt, `caller still waits`).toBe(`pending`)
    reach.reach(history.shape)
    if (history.shape === `shared-cancel`) {
      expect(
        transaction.mutations.some(
          (mutation) => mutation.collection === collections[history.firstSide],
        ),
        `cancelled Collection has no surviving mutation`,
      ).toBe(false)
      expect(
        transaction.mutations.some(
          (mutation) => mutation.collection === collections[otherSide],
        ),
        `peer keeps a real mutation`,
      ).toBe(true)
      reach.reach(
        history.firstSide === `a`
          ? `cancelled-a-retained`
          : `cancelled-b-retained`,
      )
    }
    const action: GcAction =
      history.outcome === `rollback`
        ? { kind: `rollback`, slot: 0 }
        : { kind: `settle`, slot: 0, outcome: history.outcome }
    if (history.outcome === `rollback`) transaction.rollback()
    else if (history.outcome === `complete`) handler.resolve()
    else handler.reject(new Error(`mutation handler failed`))
    for (const side of touched) stepGcModel(models[side], action)
    await flush()
    check(`handler settled`)
    expect(receipt, `caller settlement`).toBe(
      history.outcome === `complete` ? `fulfilled` : `rejected`,
    )
    const deadline = gcDeadline(models[history.firstSide])
    await advance(deadline - models[history.firstSide].now - 1)
    await idle()
    check(`one millisecond before renewed deadline`)
    await advance(1)
    await idle()
    check(`at renewed deadline`)
    reach.reach(`retired-after-${history.outcome}`)
  }, [
    async () => {
      for (const subscription of subscriptions) subscription.unsubscribe()
      handler.resolve()
      await flush()
    },
    ...sides.map((side) => () => collections[side].cleanup()),
    () => {
      resetCleanupQueue()
      idleHost.callbacks.clear()
      vi.clearAllTimers()
      vi.useRealTimers()
    },
  ])
}

const historyArbitrary = fc.record({
  shape: fc.constantFrom<Shape>(
    `direct-update`,
    `direct-delete`,
    `shared-update-delete`,
    `shared-cancel`,
  ),
  firstSide: fc.constantFrom<Side>(`a`, `b`),
  outcome: fc.constantFrom(
    `complete` as const,
    `fail` as const,
    `rollback` as const,
  ),
  lastUnsubscribe: fc.boolean(),
  gcTime: fc.constantFrom(1, 10, 49, 50, 51, 100),
  age: fc.integer({ min: 0, max: 80 }),
  sourceValue: fc.integer({ min: -3, max: 3 }),
})
it.each(
  runConfig.replaySeed === undefined ? [20261026, undefined] : [undefined],
)(
  `retains every touched Collection across mutation shapes (seed %s)`,
  async (seed) => {
    reach = createOracleReach(propertyName, states)
    await fc.assert(fc.asyncProperty(historyArbitrary, runMutationHistory), {
      ...oraclePropertyOptions(150, propertyName),
      ...(seed === undefined ? {} : { seed }),
    })
    reach.assertReached()
    console.info(
      `GC mutation reach: ${JSON.stringify(Object.fromEntries(reach.counts()))}`,
    )
  },
)

// An independently supplied projection is still an exact membership obligation.
// It cannot waive missing, stale or extra keys, even when default insert-slot
// keys would differ from the update/delete driver's expected public rows.
it.skipIf(oracleReplayRequested())(
  `rejects corruption of a supplied mutation projection`,
  () => {
    const model = createGcModel(100)
    stepGcModel(model, { kind: `mutate`, commit: true })
    const observation = {
      retired: false,
      visibleKeys: [7],
      transactionStates: [`persisting`],
    }
    expect(() =>
      checkGcObservation(model, observation, `valid projection`, [], [7]),
    ).not.toThrow()
    for (const visibleKeys of [[], [1], [7, 8], [7, 7]])
      expect(() =>
        checkGcObservation(
          model,
          { ...observation, visibleKeys },
          `corrupt projection`,
          [],
          [7],
        ),
      ).toThrow(`visible keys expected [7]`)
    stepGcModel(model, { kind: `cleanup` })
    expect(() =>
      checkGcObservation(
        model,
        { ...observation, retired: true },
        `cleanup projection`,
        [],
        [7],
      ),
    ).toThrow(`cleanup left visible rows`)
  },
)
