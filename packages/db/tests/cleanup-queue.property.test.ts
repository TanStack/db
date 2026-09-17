import fc from 'fast-check'
import { expect, it, vi } from 'vitest'
import { CleanupQueue } from '../src/collection/cleanup-queue'
import { oraclePropertyOptions, oracleRuns } from './oracle-config'
import { resetCleanupQueue } from './utils'

type Action =
  | { kind: `schedule`; key: number; delay: number; throws: boolean }
  | { kind: `cancel`; key: number }
  | { kind: `advance`; elapsed: number }
type Delivery = { id: number; at: number }
type Fault =
  | `none`
  | `ignore-cancel`
  | `lose-replacement`
  | `duplicate`
  | `late`

// The model is a list of current appointments, not a model of the root timer,
// its microtask or its early wakeups. Equal-deadline callback order is free.
// Callbacks may throw, but do not schedule/cancel other callbacks: reentrant
// delivery needs a separate contract, not assumptions from today's Map loop.
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
  const expected: Array<Delivery> = []
  const expectedErrors: Array<string> = []
  let appointments: Array<{
    id: number
    key: number
    at: number
    throws: boolean
  }> = []
  let now = 0
  const canonical = (rows: Array<Delivery>) =>
    [...rows].sort((a, b) => a.id - b.id)
  const check = () => {
    expect(canonical(actual)).toEqual(canonical(expected))
    expect(
      errors.mock.calls
        .map(([label, error]) => {
          expect(label).toBe(`Error in CleanupQueue task:`)
          expect(error).toBeInstanceOf(Error)
          return (error as Error).message
        })
        .sort(),
    ).toEqual([...expectedErrors].sort())
  }
  const advance = async (elapsed: number) => {
    await Promise.resolve() // Admit the whole synchronous registration batch.
    expect(vi.getTimerCount()).toBeLessThanOrEqual(1)
    now += elapsed
    for (const entry of appointments.filter(
      (appointment) => appointment.at <= now,
    )) {
      expected.push({ id: entry.id, at: entry.at })
      if (entry.throws) expectedErrors.push(`callback:${entry.id}`)
    }
    appointments = appointments.filter((entry) => entry.at > now)
    vi.advanceTimersByTime(elapsed)
    check()
    expect(vi.getTimerCount()).toBe(appointments.length ? 1 : 0)
  }
  try {
    check()
    for (const [id, action] of actions.entries()) {
      if (action.kind === `advance`) {
        await advance(action.elapsed)
      } else if (action.kind === `cancel`) {
        appointments = appointments.filter((entry) => entry.key !== action.key)
        if (fault !== `ignore-cancel`) queue.cancel(keys[action.key])
      } else {
        appointments = appointments.filter((entry) => entry.key !== action.key)
        appointments.push({
          id,
          key: action.key,
          at: now + action.delay,
          throws: action.throws,
        })
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
