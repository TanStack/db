import fc from 'fast-check'
import { expect, it, vi } from 'vitest'
import { CleanupQueue } from '../src/collection/cleanup-queue'
import { oracleProperty, oracleRoute, pass, violation } from './oracle-config'
import { declareOracle } from './oracle-declaration'
import { resetCleanupQueue } from './utils'
import type { Observation, Verdict } from './oracle-config'

/**
 * # Which cleanup callback must run?
 *
 * A cleanup appointment binds one key to one callback and one deadline.
 * Scheduling the same key replaces its appointment. Cancellation removes its
 * appointment. Advancing elapsed time runs each due callback exactly once.
 * A wall-clock correction does not move an appointment's elapsed deadline.
 *
 * A callback error must not stop another due callback. The contract does not
 * set callback order when one clock advance makes several callbacks due. The
 * queue must use at most one root timer. These laws come from the
 * `CleanupQueue.schedule`/`cancel` API and its documented batching contract;
 * the elapsed GC deadline is also the `gcTime` promise recorded in
 * `docs/contributing/oracle-reviews/issue-1796-gc-clock.md`.
 *
 * `stepModel` stores only elapsed appointments and callback deliveries.
 * `Model.now` and `Appointment.at` use elapsed milliseconds; `Delivery.at`
 * records the elapsed time at which the callback ran. These are model and
 * observation values, not Collection lifecycle states. The model does not
 * copy the production timer, microtask, or wake-up logic. The grammar
 * crosses registration, cancellation, replacement, elapsed advance, and
 * positive or negative wall-clock correction. Callback reentry is out of
 * scope. So are suspend/resume, absent `performance.now()`, and timer-provider
 * replacement while an appointment is pending. The public Collection effect
 * of this queue is checked separately in `collection-gc-clock.test.ts`.
 */

type Action =
  | { kind: `schedule`; key: number; delay: number; throws: boolean }
  | { kind: `cancel`; key: number }
  | { kind: `advance`; elapsed: number }
  | { kind: `stepWallClock`; offset: number }
type Delivery = { id: number; at: number }
type Appointment = {
  id: number
  key: number
  at: number
  throws: boolean
}
type Model = {
  now: number
  appointments: Array<Appointment>
  deliveries: Array<Delivery>
  errors: Array<string>
}
type Fault =
  `none` | `ignore-cancel` | `lose-replacement` | `duplicate` | `late`

// Each key has at most one appointment. A schedule replaces the old
// appointment. Only elapsed advance moves its deadline toward delivery.
function stepModel(model: Model, id: number, action: Action): Model {
  if (action.kind === `schedule`) {
    return {
      ...model,
      appointments: [
        ...model.appointments.filter((entry) => entry.key !== action.key),
        {
          id,
          key: action.key,
          at: model.now + action.delay,
          throws: action.throws,
        },
      ],
    }
  }

  if (action.kind === `cancel`) {
    return {
      ...model,
      appointments: model.appointments.filter(
        (entry) => entry.key !== action.key,
      ),
    }
  }

  if (action.kind === `stepWallClock`) return model

  const now = model.now + action.elapsed
  const due = model.appointments.filter((entry) => entry.at <= now)
  return {
    now,
    appointments: model.appointments.filter((entry) => entry.at > now),
    deliveries: [
      ...model.deliveries,
      ...due.map((entry) => ({ id: entry.id, at: entry.at })),
    ],
    errors: [
      ...model.errors,
      ...due
        .filter((entry) => entry.throws)
        .map((entry) => `callback:${entry.id}`),
    ],
  }
}

// Callbacks in this model do not schedule or cancel other callbacks. Reentrant
// callbacks need a separate contract. They must not inherit current Map-loop
// behavior by accident.
// The check: deliveries and reported task errors match the model at this cut.
// Deliveries compare as a set, by id, so their publication order is not judged.
function expectQueueState(
  actual: ReadonlyArray<Delivery>,
  model: Model,
  errorCalls: ReadonlyArray<ReadonlyArray<unknown>>,
): void {
  const canonical = (rows: ReadonlyArray<Delivery>) =>
    [...rows].sort((a, b) => a.id - b.id)
  expect(canonical(actual)).toEqual(canonical(model.deliveries))
  expect(
    errorCalls
      .map(([label, error]) => {
        expect(label).toBe(`Error in CleanupQueue task:`)
        expect(error).toBeInstanceOf(Error)
        return (error as Error).message
      })
      .sort(),
  ).toEqual([...model.errors].sort())
}

// What this oracle owns: the gap report judges every function in
// cleanup-queue.ts by this file's tests.
declareOracle({
  owns: [`src/collection/cleanup-queue.ts`],
  check: [expectQueueState],
  model: [stepModel],
})

type QueueObservation = {
  deliveries: Array<Delivery>
  errors: Array<Array<unknown>>
  timers: number
}
type QueueExpectation = { model: Model; timers?: number; atMostOne?: true }

// The model predicts the same cuts as the original per-action comparison.
// Timer cardinality is owed before and after an elapsed advance, while every
// action also checks that registration and cancellation do not deliver inline.
function modelHistory(actions: Array<Action>): Array<QueueExpectation> {
  let model: Model = {
    now: 0,
    appointments: [],
    deliveries: [],
    errors: [],
  }
  const cuts: Array<QueueExpectation> = [{ model }]
  const advance = (elapsed: number) => {
    cuts.push({ model, atMostOne: true })
    model = stepModel(model, -1, { kind: `advance`, elapsed })
    cuts.push({ model }, { model, timers: model.appointments.length ? 1 : 0 })
  }
  for (const [id, action] of actions.entries()) {
    if (action.kind === `advance`) advance(action.elapsed)
    else model = stepModel(model, id, action)
    cuts.push({ model })
  }
  advance(21)
  return cuts
}

function expectCut(actual: QueueObservation, expected: QueueExpectation): void {
  if (expected.atMostOne) expect(actual.timers).toBeLessThanOrEqual(1)
  else if (expected.timers !== undefined)
    expect(actual.timers).toBe(expected.timers)
  else expectQueueState(actual.deliveries, expected.model, actual.errors)
}

function checkHistory(
  _actions: Array<Action>,
  observations: ReadonlyArray<Observation>,
  expected: Array<QueueExpectation>,
): Verdict {
  for (const [index, observation] of observations.entries()) {
    try {
      expectCut(observation.value as QueueObservation, expected[index]!)
    } catch (error) {
      if (!(error instanceof Error) || error.name !== `AssertionError`)
        throw error
      return {
        kind: `violation`,
        checkpoint: observation.checkpoint,
        difference: error.message,
        law: `appointment histories`,
        cause: error,
      }
    }
  }
  return observations.length === expected.length
    ? pass
    : violation(
        `complete history`,
        `the queue history stopped before its final drain`,
      )
}

// The production driver records the existing action cuts before cleanup. It
// retains the original timer scheduling, error capture and cleanup diagnostics.
async function driveHistory(
  actions: Array<Action>,
  record: (checkpoint: string, value: QueueObservation) => void,
  fault: Fault = `none`,
) {
  vi.useFakeTimers()
  vi.setSystemTime(0)
  resetCleanupQueue()
  const queue = CleanupQueue.getInstance()
  // Distinct primitive types and equal-shaped object identities are separate
  // registrations. The model refers to slots, not serialized production keys.
  const keys = [0, `0`, {}, {}]
  const errors = vi.spyOn(console, `error`).mockImplementation(() => {})
  const actual: Array<Delivery> = []
  let wallClockOffset = 0
  let cut = 0
  const check = () =>
    record(`cut ${cut++}`, {
      deliveries: actual.map((delivery) => ({ ...delivery })),
      errors: errors.mock.calls.map((call) => [...call]),
      timers: vi.getTimerCount(),
    })
  const advance = async (elapsed: number) => {
    await Promise.resolve() // Admit the whole synchronous registration batch.
    check()
    vi.advanceTimersByTime(elapsed)
    check()
    check()
  }
  let primaryFailure: unknown
  let failed = false
  const cleanupErrors: Array<unknown> = []
  try {
    check()
    for (const [id, action] of actions.entries()) {
      if (action.kind === `advance`) {
        await advance(action.elapsed)
      } else if (action.kind === `stepWallClock`) {
        wallClockOffset += action.offset
        vi.setSystemTime(Date.now() + action.offset)
      } else if (action.kind === `cancel`) {
        if (fault !== `ignore-cancel`) queue.cancel(keys[action.key])
      } else {
        queue.schedule(
          fault === `lose-replacement` ? { key: action.key } : keys[action.key],
          action.delay + (fault === `late` ? 1 : 0),
          () => {
            actual.push({ id, at: Date.now() - wallClockOffset })
            if (fault === `duplicate`)
              actual.push({ id, at: Date.now() - wallClockOffset })
            if (action.throws) throw new Error(`callback:${id}`)
          },
        )
      }
      check() // Registration and cancellation cannot deliver callbacks inline.
    }
    await advance(21) // Generated delays are <=20: require complete drainage.
  } catch (error) {
    primaryFailure = error
    failed = true
  } finally {
    await Promise.resolve()
    for (const cleanup of [
      () => resetCleanupQueue(),
      () => vi.clearAllTimers(),
      () => errors.mockRestore(),
      () => vi.useRealTimers(),
    ]) {
      try {
        cleanup()
      } catch (error) {
        cleanupErrors.push(error)
      }
    }
  }
  if (cleanupErrors.length > 0) {
    throw new AggregateError(
      cleanupErrors,
      `cleanup queue oracle teardown failed`,
      {
        cause: primaryFailure,
      },
    )
  }
  if (failed) throw primaryFailure
}

// Fixed wrong-driver controls retain their original assertion boundary.
async function runHistory(actions: Array<Action>, fault: Fault = `none`) {
  const expected = modelHistory(actions)
  let cut = 0
  await driveHistory(
    actions,
    (_checkpoint, actual) => {
      expectCut(actual, expected[cut++]!)
    },
    fault,
  )
}

const actionArbitrary: fc.Arbitrary<Action> = fc.oneof(
  fc.record({
    kind: fc.constant(`schedule` as const),
    key: fc.integer({ min: 0, max: 3 }),
    delay: fc.integer({ min: 0, max: 20 }),
    throws: fc.boolean(),
  }),
  fc.record({
    kind: fc.constant(`cancel` as const),
    key: fc.integer({ min: 0, max: 3 }),
  }),
  fc.record({
    kind: fc.constant(`advance` as const),
    elapsed: fc.integer({ min: 0, max: 20 }),
  }),
  fc.record({
    kind: fc.constant(`stepWallClock` as const),
    offset: fc.integer({ min: -1000, max: 1000 }),
  }),
)

// Grammar: 0..3 select a numeric key, its string twin, and two equal-shaped
// object identities; delay/advance are integer milliseconds in 0..20, and
// wall-clock corrections are integers in -1000..1000. Empty histories and
// zero elapsed steps are legal. Fixed witnesses reconstruct a backward-step
// delay, a forward-step early delivery, replacement plus cancellation plus
// callback failure, and distinct key identities. Removing schedule loses
// delivery, cancel loses suppression, explicit advance loses the intermediate
// deadline checkpoint (the final drain still checks eventual delivery),
// and wall-clock correction loses the monotonic-clock challenge. The throw
// flag tests isolation when another callback is due. Negative/non-finite
// delays and elapsed advances, and callback reentry are outside this bounded
// grammar; a negative elapsed advance is invalid for its monotonic elapsed
// clock. The fixed seed and seedless campaigns use the same property and run
// budget. The shared oracle config
// accepts a seed and shrink path for direct replay of the seedless grammar.
const fixedHistories: Array<[Array<Action>]> = [
  [
    [
      { kind: `schedule`, key: 0, delay: 10, throws: false },
      { kind: `stepWallClock`, offset: -1000 },
      // At 9 the callback is early; at 10 it is due.
      { kind: `advance`, elapsed: 9 },
      { kind: `advance`, elapsed: 1 },
    ],
  ],
  [
    [
      { kind: `schedule`, key: 0, delay: 10, throws: false },
      { kind: `stepWallClock`, offset: 1000 },
      { kind: `schedule`, key: 1, delay: 20, throws: false },
      { kind: `advance`, elapsed: 0 },
      // The wall step cannot shift this elapsed-time boundary.
      { kind: `advance`, elapsed: 9 },
      { kind: `advance`, elapsed: 1 },
    ],
  ],
  [
    [
      { kind: `schedule`, key: 0, delay: 1, throws: false },
      { kind: `schedule`, key: 0, delay: 4, throws: true },
      { kind: `schedule`, key: 1, delay: 4, throws: false },
      { kind: `schedule`, key: 2, delay: 2, throws: false },
      { kind: `cancel`, key: 2 },
      { kind: `advance`, elapsed: 3 },
      { kind: `advance`, elapsed: 1 },
      { kind: `schedule`, key: 0, delay: 0, throws: false },
      { kind: `advance`, elapsed: 0 },
    ],
  ],
  [
    [
      { kind: `schedule`, key: 0, delay: 0, throws: false },
      { kind: `schedule`, key: 1, delay: 0, throws: false },
      { kind: `schedule`, key: 2, delay: 20, throws: false },
      { kind: `schedule`, key: 3, delay: 20, throws: false },
      { kind: `advance`, elapsed: 0 },
      { kind: `cancel`, key: 2 },
      { kind: `advance`, elapsed: 20 },
    ],
  ],
]

oracleProperty({
  id: `cleanup-queue.history`,
  law: {
    statement: `Cleanup appointments replace and cancel by key, run once at their elapsed deadline, isolate callback failures, and use at most one root timer.`,
    authority: `CleanupQueue.schedule/cancel batching contract; docs/contributing/oracle-reviews/issue-1796-gc-clock.md`,
    limits: `Bounded non-reentrant callbacks, finite delays, and controlled elapsed and wall clocks; no suspend/resume or timer-provider replacement.`,
  },
  histories: {
    arbitrary: fc.array(actionArbitrary, { maxLength: 50 }),
    runs: 100,
    fixedSeeds: [20260913],
    fixed: fixedHistories.map(([history], index) => ({
      name: `appointment regression ${index + 1}`,
      history,
    })),
  },
  model: modelHistory,
  driver: (actions, observe) => driveHistory(actions, observe),
  check: checkHistory,
})

// These controls prove that the oracle rejects four plausible wrong queues.
it.each([`ignore-cancel`, `lose-replacement`, `duplicate`, `late`] as const)(
  `rejects the %s faulty queue`,
  async (fault) => {
    oracleRoute(`calibration`)
    await expect(
      runHistory(
        [
          { kind: `schedule`, key: 0, delay: 1, throws: false },
          { kind: `schedule`, key: 0, delay: 3, throws: false },
          { kind: `schedule`, key: 1, delay: 2, throws: false },
          { kind: `cancel`, key: 1 },
          { kind: `advance`, elapsed: 3 },
        ],
        fault,
      ),
    ).rejects.toMatchObject({ name: `AssertionError` })
  },
)
