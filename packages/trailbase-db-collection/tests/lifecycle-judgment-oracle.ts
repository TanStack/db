/**
 * Reference facts and production observations stay in separate trace records.
 * The service interpreter computes reference rows from authored commands and
 * its independent Map. It never reads adapter rows, errors or verdicts to
 * compute them. The sole observational relations are resource release and
 * stable error identity: their reference tokens name earlier acquired or
 * observed objects, not an expected replacement value.
 *
 * Tokenizing opaque identities is a capture abstraction. It preserves identity
 * while keeping timer handles, streams and Error objects out of serialized
 * traces. The framework check applies every relation and retains raw facts at
 * the first mismatching cut. No Vitest assertion executes in the driver.
 */
import { isDeepStrictEqual } from 'node:util'

import { pass, violation } from '../../db/tests/oracle-property'
import type { Observation, Verdict } from '../../db/tests/oracle-property'

type Identity =
  | { kind: `symbol`; token: number }
  | { kind: `object`; token: number }
  | { kind: `primitive`; value: unknown }
type Relation = `equal` | `includes`
export type ReferenceFact = {
  checkpoint: string
  relation: Relation
  expected: unknown
}
type MockCalls = { mock: { calls: ReadonlyArray<ReadonlyArray<unknown>> } }
type Diagnostic =
  | { epoch: number; args: ReadonlyArray<unknown> }
  | { epoch: number; error: unknown }
type Health = {
  hasErrors: boolean
  failureReason: unknown
  error: unknown
}
export type LawRecorder = ReturnType<typeof createLawRecorder>

export function createLawRecorder(
  observe: (checkpoint: string, value: unknown) => void,
) {
  let sequence = 0
  const identities = new WeakMap<object, number>()
  const symbols = new Map<symbol, number>()
  let nextIdentity = 0
  const identity = (value: unknown): Identity => {
    if (typeof value === `symbol`) {
      let token = symbols.get(value)
      if (token === undefined) {
        token = nextIdentity++
        symbols.set(value, token)
      }
      return { kind: `symbol`, token }
    }
    if (
      (typeof value === `object` && value !== null) ||
      typeof value === `function`
    ) {
      const object = value
      let token = identities.get(object)
      if (token === undefined) {
        token = nextIdentity++
        identities.set(object, token)
      }
      return { kind: `object`, token }
    }
    return { kind: `primitive`, value }
  }
  const emit = (
    label: string,
    actual: unknown,
    expected: unknown,
    relation: Relation = `equal`,
  ) => {
    const checkpoint = `${sequence++}:${label}`
    const reference: ReferenceFact = { checkpoint, relation, expected }
    observe(`reference`, reference)
    observe(checkpoint, actual)
  }
  return {
    equal: (label: string, actual: unknown, expected: unknown) =>
      emit(label, actual, expected),
    same: (label: string, actual: unknown, expected: unknown) => {
      // Reserve the reference token first. Its name cannot follow a new wrong
      // actual object. Both tokens still refer to this history's identity map.
      const reference = identity(expected)
      emit(label, identity(actual), reference)
    },
    defined: (label: string, actual: unknown) =>
      emit(label, actual !== undefined, true),
    calls: (label: string, mock: MockCalls, count: number) =>
      emit(label, mock.mock.calls.length, count),
    calledWith: (label: string, mock: MockCalls, expected: unknown) => {
      const reference = [identity(expected)]
      const actual = mock.mock.calls.map((args) => args.map(identity))
      emit(label, actual, reference, `includes`)
    },
    errorName: (label: string, actual: unknown, expected: string) =>
      emit(
        label,
        typeof actual === `object` && actual !== null && `name` in actual
          ? actual.name
          : undefined,
        expected,
      ),
    // This law forbids every report and detached rejection. Preserve each
    // event, its epoch, argument order and opaque reason identity. A provider
    // may reject with any JavaScript value, including DOMException or a class;
    // those reasons are not framework observation data and need no value law.
    diagnostics: (
      label: string,
      actual: ReadonlyArray<Diagnostic>,
      expected: ReadonlyArray<Diagnostic>,
    ) => {
      const capture = (entries: ReadonlyArray<Diagnostic>) =>
        entries.map((entry) => ({
          epoch: entry.epoch,
          ...(`args` in entry
            ? { args: entry.args.map(identity) }
            : { error: identity(entry.error) }),
        }))
      const reference = capture(expected)
      emit(label, capture(actual), reference)
    },
    health: (
      label: string,
      health: Health,
      requireObject: boolean,
      cause?: unknown,
    ) => {
      const error = health.error
      const expected: {
        hasErrors: boolean
        failureReason: null
        errorPresent: boolean
        cause?: unknown
      } = {
        hasErrors: true,
        failureReason: null,
        errorPresent: true,
      }
      const actual: {
        hasErrors: boolean
        failureReason: unknown
        errorPresent: boolean
        cause?: unknown
      } = {
        hasErrors: health.hasErrors,
        failureReason: health.failureReason,
        errorPresent: requireObject
          ? typeof error === `object` && error !== null
          : error !== undefined && error !== null,
      }
      if (cause !== undefined) {
        expected.cause = cause
        actual.cause =
          typeof error === `object` && error !== null && `cause` in error
            ? error.cause
            : undefined
      }
      emit(label, actual, expected)
    },
    reach: (state: string) => observe(`reach`, state),
    finish: () => observe(`complete`, true),
  }
}

/** These reference facts are outputs of the independent authored service model,
 * carried separately from production observations. The trace is a transport
 * for the interleaved interpreter, not authority for the promised answer. */
export function referenceFacts(
  _history: unknown,
  trace: ReadonlyArray<Observation>,
) {
  return trace
    .filter((entry) => entry.checkpoint === `reference`)
    .map((entry) => entry.value as ReferenceFact)
}

export function checkLawFacts(
  _history: unknown,
  trace: ReadonlyArray<Observation>,
  references: ReadonlyArray<ReferenceFact>,
  law = `TrailBase lifecycle and page convergence`,
): Verdict {
  const actual = trace.filter(
    (entry) =>
      entry.checkpoint !== `reference` &&
      entry.checkpoint !== `reach` &&
      entry.checkpoint !== `complete`,
  )
  for (const [index, reference] of references.entries()) {
    const observed = actual[index]
    if (!observed)
      return violation(
        reference.checkpoint,
        `production fact was not recorded`,
        law,
      )
    if (observed.checkpoint !== reference.checkpoint)
      return violation(
        observed.checkpoint,
        `observation order differs from the reference cuts`,
        law,
        { actual: observed.checkpoint, expected: reference.checkpoint },
      )
    const matches =
      reference.relation === `includes`
        ? Array.isArray(observed.value) &&
          observed.value.some((entry: unknown) =>
            isDeepStrictEqual(entry, reference.expected),
          )
        : isDeepStrictEqual(observed.value, reference.expected)
    if (!matches)
      return violation(
        observed.checkpoint,
        `production fact differs from the independent reference`,
        law,
        { actual: observed.value, expected: reference.expected },
      )
  }
  if (actual.length !== references.length)
    return violation(
      actual[references.length]?.checkpoint ?? `complete`,
      `production fact has no reference judgment`,
      law,
    )
  return trace.some(
    (entry) => entry.checkpoint === `complete` && entry.value === true,
  )
    ? pass
    : violation(`complete`, `history did not finish`, law)
}
