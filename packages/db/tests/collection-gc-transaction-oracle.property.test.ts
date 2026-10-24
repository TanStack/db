import fc from 'fast-check'
import { expect, it, vi } from 'vitest'
import { createCollection } from '../src/collection/index.js'
import { createDeferred } from '../src/deferred.js'
import { oraclePropertyOptions, readOracleRunConfig } from './oracle-config.js'
import { createOracleReach } from './oracle-reach.js'
import { resetCleanupQueue } from './utils.js'
import type { Deferred } from '../src/deferred.js'

/**
 * # When may garbage collection retire a Collection?
 *
 * Law: automatic garbage collection retires a Collection once it has had no
 * subscriber and no persisting transaction for `gcTime` elapsed milliseconds.
 * A transaction that touches the Collection holds it while it persists, and
 * the `gcTime` delay starts again when the last such transaction settles,
 * whether it completes or fails. An explicit `cleanup()` retires the
 * Collection at once, persisting transactions or not.
 *
 * Authority: `gcTime` is the time a Collection with no subscribers waits
 * before it is collected (`BaseCollectionConfig.gcTime`), and collecting it
 * clears its optimistic state. A persisting transaction is local work whose
 * optimistic rows the Collection shows until the transaction settles, and
 * which an adapter's mutation handler may still be waiting on through the
 * Collection (Electric's `awaitTxId`, for example). Collecting the Collection
 * in that window drops rows the user just wrote and fails the handler's wait.
 * Explicit cleanup is a caller's decision, so it keeps its current contract.
 *
 * The model is an elapsed clock, the subscriber count, the set of persisting
 * transactions, and the deadline at which the Collection becomes due. The
 * deadline exists only while nothing holds the Collection. It is set when the
 * last hold ends: the sync start, the last unsubscribe, or the last
 * settlement. The model reads no production state and does not copy the
 * cleanup queue or idle scheduling; the cleanup-queue oracle owns those.
 *
 * The history grammar: subscribe, unsubscribe a current subscriber, insert a
 * row whose handler stays pending, complete or fail a pending handler, and
 * advance the clock by 20, 60, or 120 ms, with `gcTime` 100. A subscribe after
 * retirement restarts the Collection. A history ends in one of two ways. It
 * cleans up explicitly, or it drains: it unsubscribes everyone, settles every
 * pending handler with one outcome, and advances past the deadline, so each
 * drained history ends with a retirement that follows its last settlement.
 * Inserting into a retired Collection is not generated: it would
 * restart the sync, which is the subscribe step's job. Unsubscribing more
 * subscribers than exist is not legal.
 *
 * The production driver uses a real Collection with a synchronous ready sync,
 * public `subscribeChanges`, `insert`, and `cleanup()`, and controls each
 * handler through a deferred. After each step, on a fake clock whose pending
 * timers and microtasks have run, the comparison checks two public facts:
 * whether the Collection is `cleaned-up`, and that each persisting
 * transaction's row is still visible.
 *
 * Limits: one Collection; transactions that touch several Collections,
 * `createTransaction` with a manual commit, paced mutations, live-query
 * Collections, and wall-clock corrections are not generated. A transaction
 * that never settles holds its Collection for as long as it persists.
 */

const GC_TIME_MS = 100
type Row = { id: number }
type Step =
  | { kind: `subscribe` }
  | { kind: `unsubscribe` }
  | { kind: `insert` }
  | { kind: `settle`; outcome: `complete` | `fail` }
  | { kind: `advance`; elapsedMs: 20 | 60 | 120 }
type History = {
  steps: Array<Step>
  end: `cleanup` | `drain-complete` | `drain-fail`
}
type ReachState =
  | `gc-due-while-persisting`
  | `retired-after-completion`
  | `retired-after-failure`
  | `settled-while-subscribed`
  | `cleanup-while-persisting`
  | `restarted-after-retirement`

type Model = {
  now: number
  subscribers: number
  persisting: Array<number>
  deadline: number | undefined
  // Which hold's end set the deadline, for reach only.
  deadlineAfter: `complete` | `fail` | undefined
  retired: boolean
  // When the Collection last lost its last subscriber, for reach only.
  unsubscribedAt: number | undefined
}

const held = (model: Model) =>
  model.subscribers > 0 || model.persisting.length > 0

// A hold just ended: the Collection becomes due `gcTime` from now.
function release(model: Model, after?: `complete` | `fail`): void {
  if (held(model)) return
  model.deadline = model.now + GC_TIME_MS
  model.deadlineAfter = after
}

// The cleanup queue's timer adds one tick, so production retires the
// Collection just after its deadline, not at it. Clock steps are at least
// 20 ms, so a step that passes the deadline also passes that tick.
function advanceModel(model: Model, elapsedMs: number): void {
  model.now += elapsedMs
  if (model.deadline !== undefined && model.deadline < model.now) {
    model.retired = true
    model.deadline = undefined
  }
}

const runConfig = readOracleRunConfig()
let reach = createReach()
function createReach() {
  return createOracleReach<ReachState>(
    `collection-lifecycle.gc-persisting-transaction`,
    [
      `gc-due-while-persisting`,
      `retired-after-completion`,
      `retired-after-failure`,
      `settled-while-subscribed`,
      `cleanup-while-persisting`,
      `restarted-after-retirement`,
    ],
  )
}

async function runHistory(history: History): Promise<void> {
  reach.beginHistory()
  vi.useFakeTimers()
  vi.setSystemTime(0)
  resetCleanupQueue()
  const handlers = new Map<number, Deferred<void>>()
  const collection = createCollection<Row, number>({
    id: `gc-persisting-transaction`,
    getKey: (row) => row.id,
    gcTime: GC_TIME_MS,
    startSync: true,
    sync: {
      sync: ({ markReady }) => {
        markReady()
        return () => {}
      },
    },
    onInsert: ({ transaction }) =>
      handlers.get(transaction.mutations[0].key)!.promise,
  })
  const subscriptions: Array<{ unsubscribe: () => void }> = []
  const model: Model = {
    now: 0,
    subscribers: 0,
    persisting: [],
    deadline: GC_TIME_MS,
    deadlineAfter: undefined,
    retired: false,
    unsubscribedAt: 0,
  }
  let nextId = 1

  // Run every timer due by now, and the microtasks they start.
  const settle = () => vi.advanceTimersByTimeAsync(0)
  const check = (label: string) => {
    expect(
      collection.status === `cleaned-up`,
      `${label}: cleaned up at ${model.now} ms`,
    ).toBe(model.retired)
    for (const id of model.persisting) {
      expect(collection.has(id), `${label}: row ${id} visible`).toBe(true)
    }
  }

  const apply = async (step: Step, label: string) => {
    if (step.kind === `subscribe`) {
      if (model.retired) reach.reach(`restarted-after-retirement`)
      subscriptions.push(collection.subscribeChanges(() => {}))
      model.subscribers++
      model.retired = false
      model.deadline = undefined
      model.unsubscribedAt = undefined
    } else if (step.kind === `unsubscribe`) {
      const subscription = subscriptions.pop()
      if (!subscription) return
      subscription.unsubscribe()
      model.subscribers--
      if (model.subscribers === 0) model.unsubscribedAt = model.now
      release(model)
    } else if (step.kind === `insert`) {
      if (model.retired) return
      const id = nextId++
      handlers.set(id, createDeferred<void>())
      collection.insert({ id }).isPersisted.promise.catch(() => {})
      model.persisting.push(id)
      model.deadline = undefined
    } else if (step.kind === `settle`) {
      const id = model.persisting.shift()
      if (id === undefined) return
      if (model.subscribers > 0) reach.reach(`settled-while-subscribed`)
      const handler = handlers.get(id)!
      if (step.outcome === `complete`) handler.resolve()
      else handler.reject(new Error(`handler ${id} failed`))
      release(model, step.outcome)
    } else {
      const before = model.retired
      const after = model.deadlineAfter
      advanceModel(model, step.elapsedMs)
      await vi.advanceTimersByTimeAsync(step.elapsedMs)
      if (
        model.persisting.length > 0 &&
        model.unsubscribedAt !== undefined &&
        model.now - model.unsubscribedAt >= GC_TIME_MS
      )
        reach.reach(`gc-due-while-persisting`)
      if (!before && model.retired && after)
        reach.reach(
          after === `complete`
            ? `retired-after-completion`
            : `retired-after-failure`,
        )
    }
    await settle()
    check(label)
  }

  try {
    await settle()
    check(`start`)
    for (const [index, step] of history.steps.entries())
      await apply(step, `step ${index} ${step.kind}`)
    if (history.end === `cleanup`) {
      if (model.persisting.length > 0) reach.reach(`cleanup-while-persisting`)
      await collection.cleanup()
      expect(collection.status, `explicit cleanup`).toBe(`cleaned-up`)
    } else {
      const outcome = history.end === `drain-complete` ? `complete` : `fail`
      const drain: Array<Step> = [
        ...subscriptions.map(() => ({ kind: `unsubscribe` as const })),
        ...model.persisting.map(() => ({ kind: `settle` as const, outcome })),
        { kind: `advance`, elapsedMs: 120 },
      ]
      for (const step of drain) await apply(step, `drain ${step.kind}`)
    }
  } finally {
    for (const handler of handlers.values()) handler.resolve()
    await settle()
    await collection.cleanup()
    resetCleanupQueue()
    vi.clearAllTimers()
    vi.useRealTimers()
  }
}

// Clock steps and settlements are weighted up so that most histories reach a
// deadline after their last hold ends.
const stepArbitrary: fc.Arbitrary<Step> = fc.oneof(
  { arbitrary: fc.constant({ kind: `subscribe` as const }), weight: 1 },
  { arbitrary: fc.constant({ kind: `unsubscribe` as const }), weight: 2 },
  { arbitrary: fc.constant({ kind: `insert` as const }), weight: 2 },
  {
    arbitrary: fc.record({
      kind: fc.constant(`settle` as const),
      outcome: fc.constantFrom(`complete` as const, `fail` as const),
    }),
    weight: 2,
  },
  {
    arbitrary: fc.record({
      kind: fc.constant(`advance` as const),
      elapsedMs: fc.constantFrom(20 as const, 60 as const, 120 as const),
    }),
    weight: 3,
  },
)

const property = fc.asyncProperty(
  fc.record({
    steps: fc.array(stepArbitrary, { minLength: 1, maxLength: 12 }),
    end: fc.constantFrom(
      `cleanup` as const,
      `drain-complete` as const,
      `drain-fail` as const,
    ),
  }),
  (history) => runHistory(history),
)

// Replay one history with TANSTACK_DB_ORACLE_SEED, TANSTACK_DB_ORACLE_PATH,
// and TANSTACK_DB_ORACLE_PROPERTY=collection-lifecycle.gc-persisting-transaction.
it.each([20261024, undefined])(
  `retires a Collection only after gcTime with no subscriber and no persisting transaction (seed %s)`,
  async (seed) => {
    reach = createReach()
    await fc.assert(property, {
      ...oraclePropertyOptions(
        100,
        `collection-lifecycle.gc-persisting-transaction`,
      ),
      ...(seed === undefined || runConfig.replayPath !== undefined
        ? {}
        : { seed }),
    })
    reach.assertReached()
  },
)
