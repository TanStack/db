/**
 * Creates an iteration counter with limit checks based on state changes.
 *
 * Tracks both total iterations AND iterations without state change. This catches:
 * - True infinite loops (same state repeating)
 * - Slow progress that exceeds total limit
 *
 * @example
 * ```ts
 * const checkLimit = createIterationLimitChecker({
 *   maxSameState: 10000,  // Max iterations without state change
 *   maxTotal: 100000,     // Hard cap regardless of state changes
 * })
 *
 * while (pendingWork()) {
 *   const stateKey = operators.filter(op => op.hasPendingWork()).length
 *   if (checkLimit(() => ({
 *     context: 'D2 graph execution',
 *     diagnostics: { totalOperators: operators.length }
 *   }), stateKey)) {
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

export type IterationLimitOptions = {
  /** Max iterations without state change before triggering (default: 10000) */
  maxSameState?: number
  /** Hard cap on total iterations regardless of state changes (default: 100000) */
  maxTotal?: number
}

/**
 * Creates an iteration limit checker that logs a warning when limits are exceeded.
 *
 * @param options - Configuration for iteration limits
 * @returns A function that checks limits and returns true if exceeded
 */
export function createIterationLimitChecker(
  options: IterationLimitOptions = {},
): (getInfo: () => LimitExceededInfo, stateKey?: string | number) => boolean {
  const maxSameState = options.maxSameState ?? 10000
  const maxTotal = options.maxTotal ?? 100000

  let totalIterations = 0
  let sameStateIterations = 0
  let lastStateKey: string | number | undefined

  return function checkLimit(
    getInfo: () => LimitExceededInfo,
    stateKey?: string | number,
  ): boolean {
    totalIterations++

    // Track same-state iterations
    if (stateKey !== undefined && stateKey !== lastStateKey) {
      // State changed - reset same-state counter
      sameStateIterations = 0
      lastStateKey = stateKey
    }
    sameStateIterations++

    const sameStateExceeded = sameStateIterations > maxSameState
    const totalExceeded = totalIterations > maxTotal

    if (sameStateExceeded || totalExceeded) {
      const { context, diagnostics } = getInfo()

      const reason = sameStateExceeded
        ? `${sameStateIterations} iterations without state change (limit: ${maxSameState})`
        : `${totalIterations} total iterations (limit: ${maxTotal})`

      const diagnosticSection = diagnostics
        ? `\nDiagnostic info: ${JSON.stringify(diagnostics, null, 2)}\n`
        : `\n`

      console.warn(
        `[TanStack DB] ${context} exceeded iteration limit: ${reason}. ` +
          `Continuing with available data.` +
          diagnosticSection +
          `Please report this issue at https://github.com/TanStack/db/issues`,
      )
      return true
    }

    return false
  }
}
