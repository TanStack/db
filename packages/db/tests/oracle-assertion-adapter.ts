// Registration support for migrating an existing independent assertion helper.
// The named helper still owns its semantic model and comparisons. These
// functions neither compute an expected product result nor replace that helper:
// they pass its already-computed judgment to oracleProperty without changing
// the observation cut or catching setup, production, or cleanup failures.
import { pass, violation } from './oracle-property'
import type { Observation, Verdict } from './oracle-property'

const comparisonFailures = new WeakMap<Error, string>()
const judgments = new WeakMap<object, Verdict>()

/** Mark an error at an explicit semantic comparison failure, preserving it. */
export function rejectAt(checkpoint: string, error: Error): never {
  comparisonFailures.set(error, checkpoint)
  throw error
}

/** Mark only an assertion thrown by an authored comparison, then rethrow the
 * identical object. A production AssertionError outside this boundary is not
 * converted. Awaited matcher failures keep the same Promise rejection too. */
export function oracleAssertion<T>(checkpoint: string, compare: () => T): T {
  const failed = (error: unknown): never => {
    if (error instanceof Error && error.name === `AssertionError`)
      comparisonFailures.set(error, checkpoint)
    else if (
      error instanceof Error &&
      error.name === `OracleCheckpointFailure` &&
      error.cause instanceof Error &&
      error.cause.name === `AssertionError`
    )
      comparisonFailures.set(error.cause, checkpoint)
    throw error
  }
  try {
    const result = compare()
    if (
      result !== null &&
      typeof result === `object` &&
      `then` in result &&
      typeof result.then === `function`
    )
      return Promise.resolve(result).catch(failed) as T
    return result
  } catch (error) {
    return failed(error)
  }
}

function comparisonCheckpoint(
  error: unknown,
  seen = new Set<unknown>(),
): string | undefined {
  if (!(error instanceof Error) || seen.has(error)) return undefined
  seen.add(error)
  const own = comparisonFailures.get(error)
  if (own !== undefined) return own
  if (error instanceof AggregateError) {
    const checkpoints = error.errors.map((failure: unknown) =>
      comparisonCheckpoint(failure, new Set(seen)),
    )
    // A mixed comparison/cleanup aggregate remains the original driver error.
    return checkpoints.length > 0 &&
      checkpoints.every((value) => value !== undefined)
      ? checkpoints[0]
      : undefined
  }
  return comparisonCheckpoint(error.cause, seen)
}

/** Run the complete existing independent helper. Its authored assertions stay
 * at their old cuts; only a marked comparison failure becomes a native verdict.
 * Original errors, causes and stacks remain attached without serialization. */
export async function recordAssertionJudgment(
  law: string,
  plan: object,
  observe: (checkpoint: string, value: unknown) => void,
  judge: () => void | Promise<void>,
): Promise<void> {
  let verdict = pass
  try {
    await judge()
  } catch (error) {
    const checkpoint = comparisonCheckpoint(error)
    if (checkpoint === undefined) throw error
    verdict = {
      kind: `violation`,
      law,
      checkpoint,
      difference: error instanceof Error ? error.message : String(error),
      cause: error,
    }
  }
  judgments.set(plan, verdict)
  // The framework requires data observations. Keep Error objects solely in the
  // plan's WeakMap entry, preserving their identity without encoding them.
  observe(
    verdict.kind === `pass`
      ? `independent assertion judgment`
      : verdict.checkpoint,
    { kind: verdict.kind },
  )
}

/** The semantic reference remains in the named independent helper. The native
 * model retrieves its recorded judgment; it does not infer truth from product
 * observations. An interrupted driver has no judgment and keeps its error. */
export function recordedAssertionJudgment(
  plan: object,
  _trace: ReadonlyArray<Observation>,
): Verdict {
  return (
    judgments.get(plan) ??
    violation(
      `independent assertion judgment`,
      `the driver did not record its independent helper's judgment`,
      `assertion judgment transport`,
    )
  )
}

export function forwardAssertionJudgment(
  _plan: unknown,
  _trace: ReadonlyArray<Observation>,
  judgment: Verdict,
): Verdict {
  return judgment
}
