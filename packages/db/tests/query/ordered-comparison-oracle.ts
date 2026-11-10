/**
 * The ordered-query migration keeps the existing independent models and their
 * assertion sites. This adapter registers that same judgment with the native
 * property runner; it supplies no new reference answer or coverage claim.
 * Only an assertion thrown at an explicitly wrapped comparison is forwarded.
 * Runtime, setup, and cleanup errors retain their original identity and path.
 */
import type { Observation, Verdict } from '../oracle-property.js'

const comparisons = new WeakMap<object, string>()
const failures = new WeakMap<object, unknown>()

function comparisonFailed(checkpoint: string, error: unknown): never {
  if (error instanceof Error && error.name === `AssertionError`)
    comparisons.set(error, checkpoint)
  throw error
}

/** Mark the original assertion object, including an awaited matcher failure. */
export function compareAt<T>(checkpoint: string, compare: () => T): T {
  try {
    const result = compare()
    if (result instanceof Promise)
      return result.catch((error: unknown) =>
        comparisonFailed(checkpoint, error),
      ) as T
    return result
  } catch (error) {
    return comparisonFailed(checkpoint, error)
  }
}

function comparisonCheckpoint(error: unknown): string | undefined {
  if (!(error instanceof Error)) return undefined
  return comparisons.get(error) ?? comparisonCheckpoint(error.cause)
}

export async function observeComparison(
  history: object,
  observe: (checkpoint: string, value: unknown) => void,
  run: () => unknown,
): Promise<void> {
  failures.delete(history)
  try {
    await run()
    observe(`existing comparison`, { kind: `pass` })
  } catch (error) {
    const checkpoint = comparisonCheckpoint(error)
    if (checkpoint === undefined) throw error
    failures.set(history, error)
    observe(checkpoint, {
      kind: `violation`,
      checkpoint,
      difference: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}

// The model here is the recorded result of the original independent semantic
// judgment. The wrapper does not substitute a second model for that judgment.
export function recordedComparison(
  history: object,
  observations: ReadonlyArray<Observation>,
): Verdict {
  const result = observations[0]?.value as Verdict | undefined
  // With no judgment, a driver's original error must decide. The framework
  // rethrows it after this prefix is accepted; this does not accept a history.
  if (result === undefined) return { kind: `pass` }
  return result.kind === `pass`
    ? result
    : { ...result, cause: failures.get(history) }
}
