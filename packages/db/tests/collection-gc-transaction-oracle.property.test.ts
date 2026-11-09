import fc from 'fast-check'
import { vi } from 'vitest'
import { createCollection } from '../src/collection/index.js'
import { createDeferred } from '../src/deferred.js'
import { createTransaction } from '../src/transactions.js'
import { declareOracle } from './oracle-declaration.js'
import { differs, oracleProperty, pass, violation } from './oracle-property.js'
import { resetCleanupQueue, withOracleCleanup } from './utils.js'
import type { Verdict } from './oracle-property.js'
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
 * legal. `resolve` drops those steps, so the plan the driver runs is legal.
 *
 * Constructed histories make each reach state happen in every campaign. A
 * constructed history opens with the steps that enter its states, then keeps
 * the generated steps, so the steps after each state stay random. Its
 * builder never changes the end of a generated history, except that the
 * explicit-cleanup state needs a `cleanup` end. The opening steps come first,
 * so the state is entered whatever the generated steps are. The one state that
 * is entered at the end, a cleanup while a transaction persists, also drops
 * the generated settlements, so the opening insert is still pending at the
 * cleanup. Every builder's output stays inside the grammar, so its failures
 * shrink like generated ones. Half of a campaign's histories are constructed.
 *
 * The production driver uses two real Collections with a synchronous ready
 * sync, public `subscribeChanges`, `insert`, `createTransaction`, and
 * `cleanup()`, and controls each handler through a deferred. After each
 * action, on a fake clock whose pending timers and microtasks have run, it
 * records two public facts for each Collection: whether it is `cleaned-up`,
 * and the exact persisting rows in this empty-source fixture. The model
 * computes the same facts for each checkpoint from the plan alone, and the
 * check compares them, so the driver decides nothing.
 *
 * Limits: paced mutations, offline transactions, live-query Collections, and
 * wall-clock corrections are not generated. A transaction that never settles
 * holds its Collections for as long as it persists.
 */

const GC_TIME_MS = 100
const MAX_STEPS = 14
type Row = { id: number }
type Side = `a` | `b`
const sides: Array<Side> = [`a`, `b`]

// The history as the grammar generates it.
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

// The plan `resolve` produces: legal actions that name their handlers by id.
// It holds no expected observations.
type Action =
  | { kind: `subscribe`; side: Side }
  | { kind: `unsubscribe`; side: Side }
  | { kind: `insert`; into: Side | `both`; id: number }
  | { kind: `settle`; id: number; outcome: `complete` | `fail` }
  | { kind: `advance`; elapsedMs: number }
  | { kind: `cleanup`; side: Side }

const reachStates = [
  `gc-due-while-persisting`,
  `retired-after-completion`,
  `retired-after-failure`,
  `retired-after-shared-settlement`,
  `settled-while-subscribed`,
  `cleanup-while-persisting`,
  `restarted-after-retirement`,
] as const
type ReachState = (typeof reachStates)[number]

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

// What the two Collections show after an action: cleaned up, and the rows
// they hold. Both the model and the driver produce this shape.
type Visible = { cleanedUp: boolean; keys: Array<number> }
type Snapshot = Record<Side, Visible>
type Checkpoint = { checkpoint: string; value: Snapshot }
type Expected = { checkpoints: Array<Checkpoint>; reached: Array<ReachState> }

const byId = (a: number, b: number) => a - b

const held = (collection: CollectionModel) =>
  collection.subscribers > 0 || collection.persisting.length > 0

const startModel = (): CollectionModel => ({
  subscribers: 0,
  persisting: [],
  deadline: GC_TIME_MS,
  deadlineAfter: undefined,
  retired: false,
  unsubscribedAt: 0,
})
const freshModel = (): Model => ({
  now: 0,
  collections: { a: startModel(), b: startModel() },
  pendingHandlers: [],
})

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

// Applies one legal action to the model and returns the reach states it
// enters. The model's rules are the ones the oracle has always enforced.
function applyModel(model: Model, action: Action): Array<ReachState> {
  const reached: Array<ReachState> = []
  if (action.kind === `subscribe`) {
    const expected = model.collections[action.side]
    if (expected.retired) reached.push(`restarted-after-retirement`)
    expected.subscribers++
    expected.retired = false
    expected.deadline = undefined
    expected.unsubscribedAt = undefined
  } else if (action.kind === `unsubscribe`) {
    const expected = model.collections[action.side]
    expected.subscribers--
    if (expected.subscribers === 0) expected.unsubscribedAt = model.now
    release(model, action.side)
  } else if (action.kind === `insert`) {
    const into = action.into === `both` ? sides : [action.into]
    model.pendingHandlers.push({ id: action.id, sides: into })
    for (const side of into) {
      model.collections[side].persisting.push(action.id)
      model.collections[side].deadline = undefined
    }
  } else if (action.kind === `settle`) {
    const settled = model.pendingHandlers.shift()!
    for (const side of settled.sides) {
      const expected = model.collections[side]
      if (expected.subscribers > 0) reached.push(`settled-while-subscribed`)
      expected.persisting = expected.persisting.filter(
        (id) => id !== settled.id,
      )
      release(model, side, {
        outcome: action.outcome,
        shared: settled.sides.length > 1,
      })
    }
  } else if (action.kind === `advance`) {
    const before = sides.map((side) => model.collections[side].retired)
    advanceModel(model, action.elapsedMs)
    for (const [index, side] of sides.entries()) {
      const expected = model.collections[side]
      if (
        expected.persisting.length > 0 &&
        expected.unsubscribedAt !== undefined &&
        model.now - expected.unsubscribedAt >= GC_TIME_MS
      )
        reached.push(`gc-due-while-persisting`)
      const after = expected.deadlineAfter
      if (before[index] || !expected.retired || !after) continue
      reached.push(
        after.outcome === `complete`
          ? `retired-after-completion`
          : `retired-after-failure`,
      )
      if (after.shared) reached.push(`retired-after-shared-settlement`)
    }
  } else {
    // An explicit cleanup retires the Collection whatever persists in it.
    if (model.pendingHandlers.length > 0)
      reached.push(`cleanup-while-persisting`)
    model.collections[action.side].retired = true
    model.collections[action.side].deadline = undefined
  }
  return reached
}

function owedSnapshot(model: Model): Snapshot {
  const view = (side: Side): Visible => {
    const collection = model.collections[side]
    return {
      cleanedUp: collection.retired,
      keys: collection.retired ? [] : [...collection.persisting].sort(byId),
    }
  }
  return { a: view(`a`), b: view(`b`) }
}

// The plan: each step that the grammar allows, with its handler named by id,
// then the history's end. A drain unsubscribes everyone, settles every pending
// handler with one outcome, and advances past the deadlines.
function resolve(history: History): Array<Action> {
  const model = freshModel()
  const plan: Array<Action> = []
  let nextId = 1
  const take = (action: Action) => {
    applyModel(model, action)
    plan.push(action)
  }
  for (const step of history.steps) {
    if (step.kind === `subscribe`) {
      take({ kind: `subscribe`, side: step.side })
    } else if (step.kind === `unsubscribe`) {
      if (model.collections[step.side].subscribers > 0)
        take({ kind: `unsubscribe`, side: step.side })
    } else if (step.kind === `insert`) {
      const into = step.into === `both` ? sides : [step.into]
      if (into.every((side) => !model.collections[side].retired))
        take({ kind: `insert`, into: step.into, id: nextId++ })
    } else if (step.kind === `settle`) {
      const first = model.pendingHandlers[0]
      if (first) take({ kind: `settle`, id: first.id, outcome: step.outcome })
    } else {
      take({ kind: `advance`, elapsedMs: step.elapsedMs })
    }
  }
  if (history.end === `cleanup`) {
    for (const side of sides) take({ kind: `cleanup`, side })
    return plan
  }
  for (const side of sides)
    while (model.collections[side].subscribers > 0)
      take({ kind: `unsubscribe`, side })
  const outcome = history.end === `drain-complete` ? `complete` : `fail`
  while (model.pendingHandlers.length > 0)
    take({ kind: `settle`, id: model.pendingHandlers[0]!.id, outcome })
  take({ kind: `advance`, elapsedMs: 120 })
  return plan
}

// Each action is one checkpoint, after the action and its macrotask.
const checkpointOf = (index: number, action: Action) =>
  `step ${index} ${action.kind}`

const expectedOf = (plan: ReadonlyArray<Action>): Expected => {
  const state = freshModel()
  const checkpoints: Array<Checkpoint> = [
    { checkpoint: `start`, value: owedSnapshot(state) },
  ]
  const reached = new Set<ReachState>()
  for (const [index, action] of plan.entries()) {
    for (const entered of applyModel(state, action)) reached.add(entered)
    checkpoints.push({
      checkpoint: checkpointOf(index, action),
      value: owedSnapshot(state),
    })
  }
  return { checkpoints, reached: [...reached] }
}

const LAW = `retirement`
const DIFFERENCE = `the Collection's cleaned-up status or visible rows differ from the owed retirement and visibility`

// Judges the recorded checkpoints in order, then whether the trace is complete.
const check = (
  _plan: ReadonlyArray<Action>,
  observations: ReadonlyArray<{ checkpoint: string; value: unknown }>,
  expected: Expected,
): Verdict => {
  for (const [index, owed] of expected.checkpoints.entries()) {
    const observed = observations[index]
    if (observed === undefined) break
    if (observed.checkpoint !== owed.checkpoint)
      return violation(
        owed.checkpoint,
        `the driver recorded ${observed.checkpoint} where the plan owes ${owed.checkpoint}`,
        LAW,
      )
    const verdict = differs(
      owed.checkpoint,
      LAW,
      observed.value,
      owed.value,
      DIFFERENCE,
    )
    if (verdict) return verdict
  }
  return observations.length === expected.checkpoints.length
    ? pass
    : violation(
        `trace`,
        `the driver recorded ${observations.length} of ${expected.checkpoints.length} checkpoints`,
        LAW,
      )
}

async function driver(
  plan: ReadonlyArray<Action>,
  observe: (checkpoint: string, value: unknown) => void,
): Promise<void> {
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

  // Run every timer due by now, and the microtasks they start.
  const settle = () => vi.advanceTimersByTimeAsync(0)
  const visible = (side: Side): Visible => ({
    cleanedUp: collections[side].status === `cleaned-up`,
    keys: [...collections[side].keys()].sort(byId),
  })
  const record = (checkpoint: string) =>
    observe(checkpoint, { a: visible(`a`), b: visible(`b`) })

  const run = async (action: Action) => {
    if (action.kind === `subscribe`) {
      subscriptions[action.side].push(
        collections[action.side].subscribeChanges(() => {}),
      )
    } else if (action.kind === `unsubscribe`) {
      subscriptions[action.side].pop()!.unsubscribe()
    } else if (action.kind === `insert`) {
      const handler = createDeferred<void>()
      handlers.set(action.id, handler)
      if (action.into === `both`) {
        const transaction = createTransaction({
          autoCommit: false,
          mutationFn: () => handler.promise,
        })
        transaction.mutate(() => {
          collections.a.insert({ id: action.id })
          collections.b.insert({ id: action.id })
        })
        transaction.commit().catch(() => {})
      } else {
        collections[action.into]
          .insert({ id: action.id })
          .when(`settled`)
          .catch(() => {})
      }
    } else if (action.kind === `settle`) {
      const handler = handlers.get(action.id)!
      if (action.outcome === `complete`) handler.resolve()
      else handler.reject(new Error(`handler ${action.id} failed`))
    } else if (action.kind === `advance`) {
      await vi.advanceTimersByTimeAsync(action.elapsedMs)
    } else {
      await collections[action.side].cleanup()
    }
  }

  await withOracleCleanup(async () => {
    await settle()
    record(`start`)
    for (const [index, action] of plan.entries()) {
      await run(action)
      await settle()
      record(checkpointOf(index, action))
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

const historyArbitrary: fc.Arbitrary<History> = fc.record({
  steps: fc.array(stepArbitrary, { minLength: 1, maxLength: MAX_STEPS }),
  end: fc.constantFrom(
    `cleanup` as const,
    `drain-complete` as const,
    `drain-fail` as const,
  ),
})

// A constructed history opens with `prefix`, then keeps the generated steps.
const openWith =
  (...prefix: Array<Step>) =>
  (generated: History): History => ({
    steps: [...prefix, ...generated.steps].slice(0, MAX_STEPS),
    end: generated.end,
  })

const insertStep = (into: Side | `both`): Step => ({ kind: `insert`, into })
const settleStep = (outcome: `complete` | `fail`): Step => ({
  kind: `settle`,
  outcome,
})
const advanceStep = (elapsedMs: 120): Step => ({ kind: `advance`, elapsedMs })

// What this oracle owns: the garbage-collection hold that a persisting
// transaction places on each Collection it touches, in lifecycle.ts. The
// cleanup-queue oracle owns the timer dispatch that runs the deadline.
declareOracle({
  owns: [`src/collection/lifecycle.ts`],
  grammar: [stepArbitrary],
})

// Replay one history with TANSTACK_DB_ORACLE_SEED, TANSTACK_DB_ORACLE_PATH,
// and TANSTACK_DB_ORACLE_PROPERTY=collection-lifecycle.gc-persisting-transaction.
// Each constructed history names the states it enters, with the steps that
// enter it, and every declared state has at least one. The constructed
// histories run beside the generated ones in each campaign, so a path recorded
// before they were added may select a different history.
oracleProperty({
  id: `collection-lifecycle.gc-persisting-transaction`,
  law: {
    statement: `Automatic garbage collection retires a Collection only after gcTime with no subscriber and no persisting transaction; a persisting transaction holds each Collection it touches, and the delay restarts when the last such transaction completes or fails; explicit cleanup() retires a Collection while a transaction persists.`,
    authority: `BaseCollectionConfig.gcTime; the persisting-transaction hold in packages/db/src/collection/lifecycle.ts (optimistic rows and adapter awaitTxId waits); explicit cleanup keeps its current contract`,
    limits: `Two Collections with a synchronous ready sync and empty source; keys as numbers, up to ${MAX_STEPS} steps; clock steps of 20, 60, and 120 ms with gcTime 100; paced mutations, offline transactions, live-query Collections, and wall-clock corrections are not generated.`,
    owner: `Collection garbage collection under persisting transactions`,
  },
  histories: {
    arbitrary: historyArbitrary,
    states: reachStates,
    runs: 100,
    fixedSeeds: [20261024],
    constructed: [
      {
        name: `gc due while a transaction persists`,
        enters: [`gc-due-while-persisting`],
        build: openWith(insertStep(`a`), advanceStep(120)),
      },
      {
        name: `retired after completion`,
        enters: [`retired-after-completion`],
        build: openWith(
          insertStep(`a`),
          settleStep(`complete`),
          advanceStep(120),
        ),
      },
      {
        name: `retired after failure`,
        enters: [`retired-after-failure`],
        build: openWith(insertStep(`a`), settleStep(`fail`), advanceStep(120)),
      },
      {
        name: `retired after a shared settlement`,
        enters: [`retired-after-shared-settlement`, `retired-after-failure`],
        build: openWith(
          insertStep(`both`),
          settleStep(`fail`),
          advanceStep(120),
        ),
      },
      {
        name: `settled while subscribed`,
        enters: [`settled-while-subscribed`],
        build: openWith(
          { kind: `subscribe`, side: `a` },
          insertStep(`a`),
          settleStep(`complete`),
          advanceStep(120),
        ),
      },
      {
        name: `subscribe again after retirement`,
        enters: [`restarted-after-retirement`],
        build: openWith(
          insertStep(`a`),
          settleStep(`complete`),
          advanceStep(120),
          { kind: `subscribe`, side: `a` },
        ),
      },
      {
        // The opening insert must still be pending at the cleanup, so the
        // generated settlements are dropped. Its end becomes cleanup.
        name: `explicit cleanup while a transaction persists`,
        enters: [`cleanup-while-persisting`],
        build: (generated): History => ({
          steps: [
            insertStep(`b`),
            ...generated.steps.filter((step) => step.kind !== `settle`),
          ].slice(0, MAX_STEPS),
          end: `cleanup`,
        }),
      },
    ],
  },
  resolve,
  model: expectedOf,
  reached: (_plan, _trace, expected) => expected.reached,
  driver,
  check,
})
