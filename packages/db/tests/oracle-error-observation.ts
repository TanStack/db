// A production error that a driver observes at the checkpoint where it was
// raised. The driver records the error itself: the framework compares an
// Error's name, message, and cause as data and never its stack, so the
// stack survives for the report. The check turns the observation into a
// violation of the law that the publication or the mutation breaks, and it
// keeps the Error as the verdict's cause, outside the compared values.
import type { Verdict } from './oracle-property.js'

// A thrown value as an Error, so every observation is data the framework
// compares, whatever production threw.
export function asProductionError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

export function isErrorObservation(value: unknown): value is Error {
  return value instanceof Error
}

// The verdict for an observed production error: a violation of `law` at
// `checkpoint`, with the Error as its cause. `expected` says what the law owes
// in place of the error.
export function errorViolation(
  checkpoint: string,
  law: string,
  error: Error,
  expected: string,
): Verdict {
  return {
    kind: `violation`,
    checkpoint,
    difference: `production raised ${error.name}: ${error.message}`,
    law,
    values: { actual: error.name, expected },
    cause: error,
  }
}
