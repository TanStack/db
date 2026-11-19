/**
 * Runs an oracle check, then every cleanup step in order, and returns its result.
 * A cleanup failure never replaces the check's own failure: the check failure
 * is thrown alone or as the `cause` of an `AggregateError` that also holds each
 * cleanup failure. This module has no runtime imports, so browser drivers can
 * use the same failure-preserving cleanup as Node drivers.
 */
export async function withOracleCleanup<T>(
  check: () => Promise<T> | T,
  cleanups: ReadonlyArray<() => unknown>,
): Promise<T> {
  const failures: Array<unknown> = []
  let checkFailed = false
  let result!: T
  try {
    result = await check()
  } catch (error) {
    checkFailed = true
    failures.push(error)
  }
  for (const cleanup of cleanups) {
    try {
      await cleanup()
    } catch (error) {
      failures.push(error)
    }
  }
  if (failures.length === 1) throw failures[0]
  if (failures.length > 1) {
    throw new AggregateError(
      failures,
      checkFailed ? `Oracle check and cleanup failed` : `Oracle cleanup failed`,
      { cause: failures[0] },
    )
  }
  return result
}
