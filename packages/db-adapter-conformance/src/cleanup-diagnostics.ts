/**
 * Formatting stays secondary to the recorded observation. Thrown values can
 * reject conversion or property access; aggregates can be cyclic or deep.
 * Ordinary nested diagnostics remain expanded, with stable fallback labels.
 * This helper has no test-runner or host dependency.
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
