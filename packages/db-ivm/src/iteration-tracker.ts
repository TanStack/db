/**
 * Creates a simple iteration counter with a limit check.
 * When the limit is exceeded, calls the provided diagnostic function to capture state.
 *
 * This design avoids per-iteration overhead - state capture only happens when needed.
 *
 * @example
 * ```ts
 * const checkLimit = createIterationLimitChecker(100000)
 *
 * while (pendingWork()) {
 *   if (checkLimit(() => ({
 *     context: 'D2 graph execution',
 *     diagnostics: { totalOperators: operators.length }
 *   }))) {
 *     break
 *   }
 *   step()
 * }
 * ```
 */

export type LimitExceededInfo = {
  context: string
  diagnostics?: Record<string, unknown>
}

/**
 * Creates an iteration limit checker that logs a warning when the limit is exceeded.
 *
 * @param maxIterations - The maximum number of iterations before the limit is exceeded
 * @returns A function that increments the counter and returns true if limit exceeded
 */
export function createIterationLimitChecker(
  maxIterations: number,
): (getInfo: () => LimitExceededInfo) => boolean {
  let iterations = 0

  return function checkLimit(getInfo: () => LimitExceededInfo): boolean {
    iterations++

    if (iterations > maxIterations) {
      // Only capture diagnostic info when we actually exceed the limit
      const { context, diagnostics } = getInfo()

      const diagnosticSection = diagnostics
        ? `\nDiagnostic info: ${JSON.stringify(diagnostics, null, 2)}\n`
        : `\n`

      console.warn(
        `[TanStack DB] ${context} exceeded ${maxIterations} iterations. ` +
          `Continuing with available data.` +
          diagnosticSection +
          `Please report this issue at https://github.com/TanStack/db/issues`,
      )
      return true
    }

    return false
  }
}
