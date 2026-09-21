import fc from 'fast-check'
import { expect, it, vi } from 'vitest'
import { CleanupQueue } from '../src/collection/cleanup-queue'
import { oraclePropertyOptions, oracleRuns } from './oracle-config'
import { resetCleanupQueue } from './utils'

/**
 * # Which cleanup callback must run?
 *
 * A cleanup appointment binds one key to one callback and one deadline.
 * Scheduling the same key replaces its appointment. Cancellation removes its
 * appointment. Advancing the clock runs each due callback exactly once.
 *
 * A callback error must not stop another due callback. The contract does not
 * set callback order when one clock advance makes several callbacks due. The
 * queue must use at most one root timer.
 *
 * `stepModel` stores only appointments and public deliveries. It does not copy
 * the production timer, microtask, or wake-up logic.
 */

type Action =
  | { kind: `schedule`; key: number; delay: number; throws: boolean }
  | { kind: `cancel`; key: number }
  | { kind: `advance`; elapsed: number }
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
  | `none`
  | `ignore-cancel`
  | `lose-replacement`
  | `duplicate`
  | `late`

// Each key has at most one appointment. A schedule replaces the old
// appointment. An advance moves the clock and delivers all due appointments.
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
async function runHistory(actions: Array<Action>, fault: Fault = `none`) {
  vi.useFakeTimers()
  vi.setSystemTime(0)
  resetCleanupQueue()
  const queue = CleanupQueue.getInstance()
  // Distinct primitive types and equal-shaped object identities are separate
  // registrations. The model refers to slots, not serialized production keys.
  const keys = [0, `0`, {}, {}]
  const errors = vi.spyOn(console, `error`).mockImplementation(() => {})
  const actual: Array<Delivery> = []
  let model: Model = {
    now: 0,
    appointments: [],
    deliveries: [],
    errors: [],
  }
  const canonical = (rows: Array<Delivery>) =>
    [...rows].sort((a, b) => a.id - b.id)
  const check = () => {
    expect(canonical(actual)).toEqual(canonical(model.deliveries))
    expect(
      errors.mock.calls
        .map(([label, error]) => {
          expect(label).toBe(`Error in CleanupQueue task:`)
          expect(error).toBeInstanceOf(Error)
          return (error as Error).message
        })
        .sort(),
    ).toEqual([...model.errors].sort())
  }
  const advance = async (elapsed: number) => {
    await Promise.resolve() // Admit the whole synchronous registration batch.
    expect(vi.getTimerCount()).toBeLessThanOrEqual(1)
    model = stepModel(model, -1, { kind: `advance`, elapsed })
    vi.advanceTimersByTime(elapsed)
    check()
    expect(vi.getTimerCount()).toBe(model.appointments.length ? 1 : 0)
  }
  try {
    check()
    for (const [id, action] of actions.entries()) {
      if (action.kind === `advance`) {
        await advance(action.elapsed)
      } else if (action.kind === `cancel`) {
        model = stepModel(model, id, action)
        if (fault !== `ignore-cancel`) queue.cancel(keys[action.key])
      } else {
        model = stepModel(model, id, action)
        queue.schedule(
          fault === `lose-replacement` ? { key: action.key } : keys[action.key],
          action.delay + (fault === `late` ? 1 : 0),
          () => {
            actual.push({ id, at: Date.now() })
            if (fault === `duplicate`) actual.push({ id, at: Date.now() })
            if (action.throws) throw new Error(`callback:${id}`)
          },
        )
      }
      check() // Registration and cancellation cannot deliver callbacks inline.
    }
    await advance(21) // Generated delays are <=20: require complete drainage.
  } finally {
    await Promise.resolve()
    resetCleanupQueue()
    vi.clearAllTimers()
    errors.mockRestore()
    vi.useRealTimers()
  }
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
)

// Run one stable campaign and one random campaign. The shared oracle config
// accepts a seed and shrink path for replay of the random lane.
it.each([20260913, undefined])(
  `obeys appointment histories (seed %s)`,
  async (seed) => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(actionArbitrary, { maxLength: 50 }),
        (actions) => runHistory(actions),
      ),
      {
        ...(seed === undefined
          ? oraclePropertyOptions(100, `cleanup-queue.history`)
          : { seed, numRuns: oracleRuns(100) }),
        examples: [
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
        ],
      },
    )
  },
)

// These controls prove that the oracle rejects four plausible wrong queues.
it.each([`ignore-cancel`, `lose-replacement`, `duplicate`, `late`] as const)(
  `rejects the %s faulty queue`,
  async (fault) => {
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
    ).rejects.toThrow()
  },
)
