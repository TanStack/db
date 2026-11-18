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

/**
 * Formatting stays secondary to the recorded observation. Thrown values can
 * reject conversion or property access; aggregates can be cyclic or deep.
 * Ordinary nested diagnostics remain expanded, with stable fallback labels.
 */
export function describeOracleCleanupError(reason: unknown): string {
  const ancestors = new Set<unknown>()
  const describe = (error: unknown, depth: number): string => {
    if (depth >= 32) return `[cleanup error depth limit]`
    if (ancestors.has(error)) return `[circular cleanup error]`
    let description = `[unprintable cleanup error]`
    try {
      description = String(error)
      if (!(error instanceof AggregateError)) return description
      ancestors.add(error)
      try {
        const reasons: unknown = error.errors
        if (!Array.isArray(reasons))
          return `${description}: [unprintable cleanup details]`
        return `${description}: ${reasons
          .map((nestedError: unknown) => describe(nestedError, depth + 1))
          .join(`; `)}`
      } finally {
        ancestors.delete(error)
      }
    } catch {
      return description === `[unprintable cleanup error]`
        ? description
        : `${description}: [unprintable cleanup details]`
    }
  }
  return describe(reason, 0)
}

/**
 * A receiving driver records raw observations before a remote registrar judges
 * them. Once recording completes, teardown must travel beside that raw result:
 * throwing here would hide a product mismatch from the registrar. Each cleanup
 * still runs. Before recording completes, withOracleCleanup retains the body
 * failure as primary and each cleanup failure as a separate AggregateError item.
 */
export async function retainOracleCleanupObservation<
  T extends { cleanupErrors?: ReadonlyArray<string> },
>(
  record: () => Promise<T>,
  cleanups: ReadonlyArray<() => unknown>,
): Promise<T> {
  let completed: T | undefined
  const diagnostics: Array<string> = []
  const guardedCleanups: Array<() => Promise<void>> = []
  const result = await withOracleCleanup(async () => {
    try {
      completed = await record()
      return completed
    } finally {
      // Recording may acquire resources incrementally. Snapshot only after
      // its body ends so every registered cleanup participates.
      guardedCleanups.push(
        ...cleanups.map((cleanup) => async () => {
          try {
            await cleanup()
          } catch (error) {
            if (completed === undefined) throw error
            diagnostics.push(describeOracleCleanupError(error))
          }
        }),
      )
    }
  }, guardedCleanups)
  return diagnostics.length
    ? {
        ...result,
        cleanupErrors: [...(result.cleanupErrors ?? []), ...diagnostics],
      }
    : result
}
