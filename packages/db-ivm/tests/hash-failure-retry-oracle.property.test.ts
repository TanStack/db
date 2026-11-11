/**
 * A failed structural traversal publishes no reusable hash state. A serial
 * retry rereads the prefix through its rejecting getter. Only success may
 * cache the whole root, and it must match the plain structural copy's hash.
 *
 * This is the established structural-hash retry contract (oracle-coverage.md,
 * Structural values and ordered primitives), also exercised for cycle rejection by the graph owner.
 * The claim stays on one previously uncached array of plain getter objects.
 * It excludes pre-cached descendants, shared objects, reentry, other carriers,
 * and other rejection causes.
 */
import fc from 'fast-check'
import { hash } from '../src/hashing/hash'
import { declareOracle } from '../../db/tests/oracle-declaration.js'
import {
  differs,
  oracleProperty,
  pass,
  violation,
} from '../../db/tests/oracle-property.js'
import type {
  ConstructedHistory,
  Observation,
  Verdict,
} from '../../db/tests/oracle-property.js'

type History = {
  completed: number
  tail: number
  failures: number
  value: number
}
type Plan = History & { error: Error; requiredStates: ReadonlyArray<string> }
type Owed = Observation & { law: string }
type FailureCut = { sameError: boolean; reads: Array<number> }

// The model-only row combines independent getters into an ordered read-count
// vector. `completed` getters precede the rejecting one; `tail` getters follow
// it. A failure can read only that prefix, and every retry owes it again.
const retryHistoryArbitrary = fc.record({
  completed: fc.integer({ min: 0, max: 3 }),
  tail: fc.integer({ min: 0, max: 2 }),
  failures: fc.integer({ min: 1, max: 3 }),
  value: fc.integer({ min: -20, max: 20 }),
})

function expectedFailedReads(
  completed: number,
  length: number,
  attempt: number,
): Array<number> {
  return Array.from({ length }, (_, index) =>
    index <= completed ? attempt : 0,
  )
}

// Success reads the old prefix once more and the untouched suffix once.
function expectedSuccessReads(
  completed: number,
  length: number,
  failures: number,
): Array<number> {
  return Array.from({ length }, (_, index) =>
    index <= completed ? failures + 1 : 1,
  )
}

function plainCopy(length: number, value: number): Array<{ value: number }> {
  return Array.from({ length }, (_, index) => ({ value: value + index }))
}

function expectedTrace({ completed, tail, failures, requiredStates }: Plan): {
  results: Array<Owed>
  requiredStates: ReadonlyArray<string>
} {
  const length = completed + 1 + tail
  const failed = Array.from({ length: failures }, (_, index) => ({
    checkpoint: `failed attempt ${index + 1}`,
    law: `atomic failure cut`,
    value: {
      sameError: true,
      reads: expectedFailedReads(completed, length, index + 1),
    },
  }))
  const reads = expectedSuccessReads(completed, length, failures)
  return {
    requiredStates,
    results: [
      ...failed,
      {
        checkpoint: `successful retry`,
        law: `successful retry`,
        value: { sameDigest: true, reads },
      },
      {
        checkpoint: `cached root`,
        law: `cache reuse`,
        value: { sameDigest: true, reads },
      },
    ],
  }
}

// Distinct checkpoint names preserve a driver's error if it interrupts a later
// attempt. Missing observations in a completed trace still fail the same check.
function checkRetryTrace(
  _plan: Plan,
  trace: ReadonlyArray<Observation>,
  expected: ReturnType<typeof expectedTrace>,
): Verdict {
  let at = 0
  for (const actual of trace) {
    if (actual.checkpoint === `reach`) continue
    const owed = expected.results[at++]
    if (owed === undefined)
      return violation(
        actual.checkpoint,
        `an extra result was observed`,
        `retry sequence`,
      )
    const mismatch = differs(actual.checkpoint, owed.law, actual, {
      checkpoint: owed.checkpoint,
      value: owed.value,
    })
    if (mismatch) return mismatch
  }
  if (at !== expected.results.length)
    return violation(
      expected.results[at]!.checkpoint,
      `the result was not observed`,
      expected.results[at]!.law,
    )
  for (const state of expected.requiredStates) {
    if (
      !trace.some(
        (entry) => entry.checkpoint === `reach` && entry.value === state,
      )
    )
      return violation(
        `constructed states`,
        `constructed history missed ${state}`,
        `constructed reach`,
      )
  }
  return pass
}

// Track every builder call, rather than only the framework's first seeded
// examples. Fresh object results preserve their own obligations during normal
// generation and mapped shrinking without changing the original grammar.
const constructionStates = new WeakMap<History, ReadonlyArray<string>>()

function enforceConstructed(
  builders: Array<ConstructedHistory<History>>,
): Array<ConstructedHistory<History>> {
  return builders.map((builder) => ({
    ...builder,
    build: (generated) => {
      const history = builder.build(generated)
      constructionStates.set(history, builder.enters)
      return history
    },
  }))
}

declareOracle({
  owns: [`src/hashing/hash.ts#hash`],
  model: [expectedFailedReads, expectedSuccessReads, expectedTrace],
  check: [checkRetryTrace],
})

// Hash the same root on every attempt, then at the successful and cached
// checkpoints. The rejecting getter throws the exact source error. Observing
// its identity as a Boolean keeps substituted errors distinguishable even
// when they have the same message. Unexpected errors after rejection propagate.
function driveRetry(
  plan: Plan,
  observe: (checkpoint: string, value: unknown) => void,
): void {
  const { completed, tail, failures, value, error } = plan
  const reads = Array.from({ length: completed + 1 + tail }, () => 0)
  let rejecting = true
  const root = reads.map((_, index) => ({
    get value() {
      reads[index]!++
      if (index === completed && rejecting) throw error
      return value + index
    },
  }))
  for (let attempt = 1; attempt <= failures; attempt++) {
    let actualError: unknown
    try {
      hash(root)
    } catch (cause) {
      actualError = cause
    }
    observe(`failed attempt ${attempt}`, {
      sameError: actualError === error,
      reads: [...reads],
    })
  }
  rejecting = false
  const result = hash(root)
  observe(`successful retry`, {
    sameDigest: Object.is(result, hash(plainCopy(reads.length, value))),
    reads: [...reads],
  })
  observe(`cached root`, {
    sameDigest: Object.is(hash(root), result),
    reads: [...reads],
  })
  if (completed > 0) observe(`reach`, `failed prefix reread`)
  if (tail > 0) observe(`reach`, `untouched suffix`)
  if (failures > 1) observe(`reach`, `repeated failure`)
  if (completed === 0) observe(`reach`, `first getter failure`)
  if (tail === 0) observe(`reach`, `last getter failure`)
}

function corruptFailure(
  trace: ReadonlyArray<Observation>,
  change: (value: FailureCut) => FailureCut,
): Array<Observation> {
  return trace.map((entry) =>
    entry.checkpoint === `failed attempt 2`
      ? { ...entry, value: change(entry.value as FailureCut) }
      : entry,
  )
}

// Every declared axis changes an owed observation: removing completed siblings
// loses cached-prefix detection, removing the tail loses early-read detection,
// and removing repeated failure loses retry counts. Values vary digest-copy
// equality. A success followed by another rejection is outside this grammar.
oracleProperty({
  id: `ivm.hash-failure-retry`,
  law: {
    statement: `Failed getter traversals preserve the original rejection and read cut; retries reread the prefix, success matches a plain copy, and only success makes root reuse read nothing.`,
    authority: `Established structural-hash retry contract; oracle-coverage.md, Structural values and ordered primitives; existing hash graph cycle-retry owner.`,
    limits: `Serial calls on one uncached array of plain getter objects, 0..3 completed siblings, 0..2 tail getters, 1..3 failures, values -20..20. No pre-cached descendants, sharing, reentry, or other rejection causes.`,
  },
  histories: {
    arbitrary: retryHistoryArbitrary,
    runs: 100,
    fixedSeeds: [205206],
    states: [
      `failed prefix reread`,
      `untouched suffix`,
      `repeated failure`,
      `first getter failure`,
      `last getter failure`,
    ],
    constructed: enforceConstructed([
      {
        name: `failed prefix and untouched tail`,
        enters: [
          `failed prefix reread`,
          `untouched suffix`,
          `repeated failure`,
        ],
        build: (history) => ({
          ...history,
          completed: Math.max(1, history.completed),
          tail: Math.max(1, history.tail),
          failures: Math.max(2, history.failures),
        }),
      },
      {
        name: `rejecting first and last getter`,
        enters: [`first getter failure`, `last getter failure`],
        build: (history) => ({ ...history, completed: 0, tail: 0 }),
      },
    ]),
    fixed: [
      ...[0, 1, 2, 3].map((completed) => ({
        name: `retries after ${completed} completed siblings`,
        history: { completed, tail: 2, failures: 2, value: 10 },
      })),
      {
        name: `first getter without an untouched tail`,
        history: { completed: 0, tail: 0, failures: 1, value: -20 },
      },
      {
        name: `three failures at the last getter`,
        history: { completed: 3, tail: 0, failures: 3, value: 20 },
      },
      {
        name: `prefix and tail from the original calibration`,
        history: { completed: 1, tail: 1, failures: 2, value: 0 },
      },
    ],
  },
  resolve: (history) => ({
    ...history,
    error: new Error(`getter rejected`),
    requiredStates: constructionStates.get(history) ?? [],
  }),
  model: expectedTrace,
  driver: driveRetry,
  check: checkRetryTrace,
  calibrations: [
    {
      name: `omits a constructed state`,
      law: `constructed reach`,
      corrupt: (trace, plan) => {
        const state = plan.requiredStates[0]
        return state === undefined
          ? undefined
          : trace.filter(
              (entry) => entry.checkpoint !== `reach` || entry.value !== state,
            )
      },
    },
    {
      name: `reuses a failed sibling cache`,
      law: `atomic failure cut`,
      corrupt: (trace, plan) =>
        plan.completed > 0 && plan.failures > 1
          ? corruptFailure(trace, (value) => ({
              ...value,
              reads: value.reads.map((read, index) =>
                index === 0 ? read - 1 : read,
              ),
            }))
          : undefined,
    },
    {
      name: `substitutes the source error`,
      law: `atomic failure cut`,
      corrupt: (trace, plan) =>
        plan.failures > 1
          ? corruptFailure(trace, (value) => ({ ...value, sameError: false }))
          : undefined,
    },
    {
      name: `reads past the failed getter`,
      law: `atomic failure cut`,
      corrupt: (trace, plan) =>
        plan.tail > 0 && plan.failures > 1
          ? corruptFailure(trace, (value) => ({
              ...value,
              reads: value.reads.map((read, index) =>
                index === value.reads.length - 1 ? read + 1 : read,
              ),
            }))
          : undefined,
    },
  ],
})
