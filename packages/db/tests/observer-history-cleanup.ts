/**
 * Releases an observer history's resources in order, then rethrows the
 * history's failure. Cleanup errors are aggregated with that failure, so a
 * failing history never hides a cleanup failure.
 */
export async function finishHistory(
  cleanup: ReadonlyArray<() => void | Promise<void>>,
  failure: { error: unknown } | undefined,
): Promise<void> {
  const cleanupFailures: Array<unknown> = []
  for (const release of cleanup) {
    try {
      await release()
    } catch (error) {
      cleanupFailures.push(error)
    }
  }
  if (cleanupFailures.length > 0) {
    throw new AggregateError(
      failure ? [failure.error, ...cleanupFailures] : cleanupFailures,
      `Observer history cleanup failed`,
      failure ? { cause: failure.error } : undefined,
    )
  }
  if (failure) throw failure.error
}
