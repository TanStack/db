/** Runner support only: both fixed/random campaigns receive the same budget.
 * Explicit seed/path replay still overrides it to the selected history. */
export function lazyOracleRuns(normal: number): number {
  const value = process.env.CONVEX_LAZY_ORACLE_RUNS_MULTIPLIER ?? `1`
  const multiplier = Number(value)
  if (
    !Number.isSafeInteger(multiplier) ||
    multiplier < 1 ||
    value.trim() === ``
  )
    throw new Error(
      `CONVEX_LAZY_ORACLE_RUNS_MULTIPLIER must be a positive integer`,
    )
  return normal * multiplier
}

/** Execute both receiving paths even after one fails, preserving nested law
 * failures in the runner's top-level message as well as their original causes. */
export async function receiveBothSdks<T>(
  receive: (kind: `javascript` | `react`) => Promise<T>,
): Promise<Array<readonly [`javascript` | `react`, T]>> {
  const results: Array<readonly [`javascript` | `react`, T]> = []
  const errors: Array<Error> = []
  const describe = (value: unknown): string =>
    value instanceof AggregateError
      ? `${value.message}\n${value.errors.map(describe).join(`\n`)}`
      : value instanceof Error
        ? (value.stack ?? value.message)
        : String(value)
  for (const kind of [`javascript`, `react`] as const) {
    try {
      results.push([kind, await receive(kind)])
    } catch (error) {
      errors.push(
        new Error(`${kind} receiver failed: ${describe(error)}`, {
          cause: error,
        }),
      )
    }
  }
  if (errors.length)
    throw new AggregateError(errors, errors.map(String).join(`\n`))
  return results
}
