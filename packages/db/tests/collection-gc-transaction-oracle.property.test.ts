import fc from 'fast-check'
import { expect, it, vi } from 'vitest'
import { createCollection } from '../src/collection/index.js'
import { createDeferred } from '../src/deferred.js'
import { createTransaction } from '../src/transactions.js'
import { oraclePropertyOptions, readOracleRunConfig } from './oracle-config.js'
import { createOracleReach } from './oracle-reach.js'
import { resetCleanupQueue, withOracleCleanup } from './utils.js'
import type { Deferred } from '../src/deferred.js'

/**
 * # When may garbage collection retire a Collection?
 *
 * Law: automatic garbage collection becomes eligible once a Collection has
 * had no subscriber and no persisting transaction for `gcTime` milliseconds.
 * Cleanup runs at a host idle opportunity after eligibility.
 * A transaction that touches the Collection holds it while it persists, and
 * the `gcTime` delay starts again when the last such transaction settles,
 * whether it completes or fails. A transaction that touches several
 * Collections holds each of them. An explicit `cleanup()` retires the
 * Collection despite persisting transactions. This synchronous adapter fixture
 * collapses cleanup start and adapter settlement into one observation.
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
 * The model keeps an elapsed clock and, for each of two Collections, the
 * subscriber count, the set of persisting transactions that touch it, and
 * the deadline at which it becomes due. A deadline exists only while nothing
 * holds its Collection. It is set when the last hold ends: the sync start,
 * the last unsubscribe, or the last settlement. The model reads no production
 * state and does not copy the cleanup queue or idle scheduling; the
 * cleanup-queue oracle owns timer dispatch. The shared boundary model in
 * collection-gc-retention-oracle.ts owns startup, phase and delayed-idle laws;
 * collection-gc-retention-oracle.property.test.ts generates those histories.
 *
 * The history grammar, with `gcTime` 100: subscribe to either Collection,
 * unsubscribe one of its current subscribers, insert a row whose handler
 * stays pending, complete or fail the oldest pending handler, and advance the
 * clock by 20, 60, or 120 ms. An insert writes to one Collection through its
 * `onInsert` handler, or to both through `createTransaction` with a manual
 * commit. A subscribe after retirement restarts that Collection. A history
 * ends in one of two ways. It cleans up both Collections explicitly, or it
 * drains: it unsubscribes everyone, settles every pending handler with one
 * outcome, and advances past the deadlines, so each drained history ends
 * with retirements that follow its last settlement. Inserting into a retired
 * Collection is not generated: it would restart the sync, which is the
 * subscribe step's job. Unsubscribing more subscribers than exist is not
 * legal.
 *
 * The production driver uses two real Collections with a synchronous ready
 * sync, public `subscribeChanges`, `insert`, `createTransaction`, and
 * `cleanup()`, and controls each handler through a deferred. After each
 * step, on a fake clock whose pending timers and microtasks have run, the
 * comparison checks two public facts for each Collection: whether it is
 * `cleaned-up`, and the exact persisting rows in this empty-source fixture.
 *
 * Limits: paced mutations, offline transactions, live-query Collections, and
 * wall-clock corrections are not generated. A transaction that never settles
 * holds its Collections for as long as it persists.
 */

const GC_TIME_MS = 100
type Row = { id: number }
type Side = `a` | `b`
type Step =
  | { kind: `subscribe`; side: Side }
  | { kind: `unsubscribe`; side: Side }
  | { kind: `insert`; into: Side | `both` }
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
  | `retired-after-shared-settlement`
  | `settled-while-subscribed`
  | `cleanup-while-persisting`
  | `restarted-after-retirement`

type CollectionModel = {
  subscribers: number
  persisting: Array<number>
  deadline: number | undefined
  // Which hold's end set the deadline, for reach only.
  deadlineAfter: { outcome: `complete` | `fail`; shared: boolean } | undefined
  retired: boolean
  // When the Collection last lost its last subscriber, for reach only.
  unsubscribedAt: number | undefined
}
type Model = {
  now: number
  collections: Record<Side, CollectionModel>
  // Pending handlers in settlement order, with the Collections each touches.
  pendingHandlers: Array<{ id: number; sides: Array<Side> }>
}

const sides: Array<Side> = [`a`, `b`]

const held = (collection: CollectionModel) =>
  collection.subscribers > 0 || collection.persisting.length > 0

// A hold just ended: the Collection becomes due `gcTime` from now.
function release(
  model: Model,
  side: Side,
  after?: CollectionModel[`deadlineAfter`],
): void {
  const collection = model.collections[side]
  if (held(collection)) return
  collection.deadline = model.now + GC_TIME_MS
  collection.deadlineAfter = after
}

// The cleanup queue's timer adds one tick, so production retires the
// Collection just after its deadline, not at it. Clock steps are at least
// 20 ms, so a step that passes the deadline also passes that tick.
function advanceModel(model: Model, elapsedMs: number): void {
  model.now += elapsedMs
  for (const collection of Object.values(model.collections)) {
    if (collection.deadline !== undefined && collection.deadline < model.now) {
      collection.retired = true
      collection.deadline = undefined
    }
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
      `retired-after-shared-settlement`,
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
  const create = (side: Side) =>
    createCollection<Row, number>({
      id: `gc-persisting-transaction-${side}`,
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
  const collections = { a: create(`a`), b: create(`b`) }
  const subscriptions: Record<Side, Array<{ unsubscribe: () => void }>> = {
    a: [],
    b: [],
  }
  const startModel = (): CollectionModel => ({
    subscribers: 0,
    persisting: [],
    deadline: GC_TIME_MS,
    deadlineAfter: undefined,
    retired: false,
    unsubscribedAt: 0,
  })
  const model: Model = {
    now: 0,
    collections: { a: startModel(), b: startModel() },
    pendingHandlers: [],
  }
  let nextId = 1

  // Run every timer due by now, and the microtasks they start.
  const settle = () => vi.advanceTimersByTimeAsync(0)
  const check = (label: string) => {
    for (const side of sides) {
      const expected = model.collections[side]
      const collection = collections[side]
      expect(
        collection.status === `cleaned-up`,
        `${label}: ${side} cleaned up at ${model.now} ms`,
      ).toBe(expected.retired)
      expect(
        [...collection.keys()].sort((a, b) => a - b),
        `${label}: ${side} visible keys`,
      ).toEqual(
        expected.retired ? [] : [...expected.persisting].sort((a, b) => a - b),
      )
    }
  }

  const apply = async (step: Step, label: string) => {
    if (step.kind === `subscribe`) {
      const expected = model.collections[step.side]
      if (expected.retired) reach.reach(`restarted-after-retirement`)
      subscriptions[step.side].push(
        collections[step.side].subscribeChanges(() => {}),
      )
      expected.subscribers++
      expected.retired = false
      expected.deadline = undefined
      expected.unsubscribedAt = undefined
    } else if (step.kind === `unsubscribe`) {
      const subscription = subscriptions[step.side].pop()
      if (!subscription) return
      subscription.unsubscribe()
      const expected = model.collections[step.side]
      expected.subscribers--
      if (expected.subscribers === 0) expected.unsubscribedAt = model.now
      release(model, step.side)
    } else if (step.kind === `insert`) {
      const into = step.into === `both` ? sides : [step.into]
      if (into.some((side) => model.collections[side].retired)) return
      const id = nextId++
      const handler = createDeferred<void>()
      handlers.set(id, handler)
      if (step.into === `both`) {
        const transaction = createTransaction({
          autoCommit: false,
          mutationFn: () => handler.promise,
        })
        transaction.mutate(() => {
          collections.a.insert({ id })
          collections.b.insert({ id })
        })
        transaction.commit().catch(() => {})
      } else {
        collections[step.into]
          .insert({ id })
          .isPersisted.promise.catch(() => {})
      }
      model.pendingHandlers.push({ id, sides: into })
      for (const side of into) {
        model.collections[side].persisting.push(id)
        model.collections[side].deadline = undefined
      }
    } else if (step.kind === `settle`) {
      const settled = model.pendingHandlers.shift()
      if (!settled) return
      const handler = handlers.get(settled.id)!
      if (step.outcome === `complete`) handler.resolve()
      else handler.reject(new Error(`handler ${settled.id} failed`))
      for (const side of settled.sides) {
        const expected = model.collections[side]
        if (expected.subscribers > 0) reach.reach(`settled-while-subscribed`)
        expected.persisting = expected.persisting.filter(
          (id) => id !== settled.id,
        )
        release(model, side, {
          outcome: step.outcome,
          shared: settled.sides.length > 1,
        })
      }
    } else {
      const before = sides.map((side) => model.collections[side].retired)
      advanceModel(model, step.elapsedMs)
      await vi.advanceTimersByTimeAsync(step.elapsedMs)
      for (const [index, side] of sides.entries()) {
        const expected = model.collections[side]
        if (
          expected.persisting.length > 0 &&
          expected.unsubscribedAt !== undefined &&
          model.now - expected.unsubscribedAt >= GC_TIME_MS
        )
          reach.reach(`gc-due-while-persisting`)
        const after = expected.deadlineAfter
        if (before[index] || !expected.retired || !after) continue
        reach.reach(
          after.outcome === `complete`
            ? `retired-after-completion`
            : `retired-after-failure`,
        )
        if (after.shared) reach.reach(`retired-after-shared-settlement`)
      }
    }
    await settle()
    check(label)
  }

  await withOracleCleanup(async () => {
    await settle()
    check(`start`)
    for (const [index, step] of history.steps.entries())
      await apply(step, `step ${index} ${step.kind}`)
    if (history.end === `cleanup`) {
      if (model.pendingHandlers.length > 0)
        reach.reach(`cleanup-while-persisting`)
      for (const side of sides) {
        await collections[side].cleanup()
        expect(collections[side].status, `explicit cleanup of ${side}`).toBe(
          `cleaned-up`,
        )
        expect(
          [...collections[side].keys()],
          `explicit cleanup rows of ${side}`,
        ).toEqual([])
      }
    } else {
      const outcome = history.end === `drain-complete` ? `complete` : `fail`
      const drain: Array<Step> = [
        ...sides.flatMap((side) =>
          subscriptions[side].map((): Step => ({ kind: `unsubscribe`, side })),
        ),
        ...model.pendingHandlers.map((): Step => ({ kind: `settle`, outcome })),
        { kind: `advance`, elapsedMs: 120 },
      ]
      for (const step of drain) await apply(step, `drain ${step.kind}`)
    }
  }, [
    async () => {
      for (const handler of handlers.values()) handler.resolve()
      await settle()
    },
    ...sides.map((side) => () => collections[side].cleanup()),
    () => {
      resetCleanupQueue()
      vi.clearAllTimers()
      vi.useRealTimers()
    },
  ])
}

const sideArbitrary = fc.constantFrom(`a` as const, `b` as const)

// Clock steps and settlements are weighted up so that most histories reach a
// deadline after their last hold ends.
const stepArbitrary: fc.Arbitrary<Step> = fc.oneof(
  {
    arbitrary: fc.record({
      kind: fc.constant(`subscribe` as const),
      side: sideArbitrary,
    }),
    weight: 1,
  },
  {
    arbitrary: fc.record({
      kind: fc.constant(`unsubscribe` as const),
      side: sideArbitrary,
    }),
    weight: 2,
  },
  {
    arbitrary: fc.record({
      kind: fc.constant(`insert` as const),
      into: fc.constantFrom(`a` as const, `b` as const, `both` as const),
    }),
    weight: 2,
  },
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
    steps: fc.array(stepArbitrary, { minLength: 1, maxLength: 14 }),
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
it.each(
  runConfig.replaySeed === undefined ? [20261024, undefined] : [undefined],
)(
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
    console.info(
      `GC transaction reach: ${JSON.stringify(Object.fromEntries(reach.counts()))}`,
    )
  },
)
