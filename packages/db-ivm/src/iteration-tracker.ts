/**
 * Tracks state transitions during iteration loops for diagnostic purposes.
 * Used by circuit breakers to report where iterations were spent when limits are exceeded.
 *
 * The tracker collects a history of state transitions, where each entry records
 * a period of time (iteration range) spent in a particular state. When the iteration
 * limit is exceeded, this history helps diagnose infinite loop causes.
 *
 * @example
 * ```ts
 * const tracker = createIterationTracker<{ operators: string }>(100000)
 *
 * while (pendingWork()) {
 *   const state = { operators: getOperatorsWithWork().join(',') }
 *   if (tracker.trackAndCheckLimit(state)) {
 *     console.warn(tracker.formatWarning('D2 graph execution', {
 *       totalOperators: operators.length,
 *     }))
 *     break
 *   }
 *   step()
 * }
 * ```
 */

export type StateHistoryEntry<TState> = {
  state: TState
  startIter: number
  endIter: number
}

export type IterationTracker<TState> = {
  /**
   * Records the current state and increments the iteration counter.
   * Returns true if the iteration limit has been exceeded.
   */
  trackAndCheckLimit: (state: TState) => boolean

  /**
   * Formats a warning message with iteration breakdown and diagnostic info.
   * Call this after trackAndCheckLimit returns true.
   */
  formatWarning: (
    context: string,
    diagnosticInfo?: Record<string, unknown>
  ) => string

  /**
   * Returns the current iteration count.
   */
  getIterations: () => number

  /**
   * Returns the state history for inspection.
   */
  getHistory: () => Array<StateHistoryEntry<TState>>
}

/**
 * Creates an iteration tracker that monitors loop iterations and records state transitions.
 *
 * @param maxIterations - The maximum number of iterations before the limit is exceeded
 * @param stateToKey - Optional function to convert state to a string key for comparison.
 *                     Defaults to JSON.stringify.
 */
export function createIterationTracker<TState>(
  maxIterations: number,
  stateToKey: (state: TState) => string = (state) => JSON.stringify(state)
): IterationTracker<TState> {
  const history: Array<StateHistoryEntry<TState>> = []
  let currentStateKey: string | null = null
  let currentState: TState | null = null
  let stateStartIter = 1
  let iterations = 0

  function recordCurrentState(): void {
    if (currentStateKey !== null && currentState !== null) {
      history.push({
        state: currentState,
        startIter: stateStartIter,
        endIter: iterations,
      })
    }
  }

  function trackAndCheckLimit(state: TState): boolean {
    const stateKey = stateToKey(state)

    if (stateKey !== currentStateKey) {
      recordCurrentState()
      currentStateKey = stateKey
      currentState = state
      stateStartIter = iterations + 1
    }

    iterations++

    if (iterations > maxIterations) {
      recordCurrentState()
      return true
    }

    return false
  }

  function formatWarning(
    context: string,
    diagnosticInfo?: Record<string, unknown>
  ): string {
    const iterationBreakdown = history
      .map((h) => `    ${h.startIter}-${h.endIter}: ${stateToKey(h.state)}`)
      .join(`\n`)

    const diagnosticSection = diagnosticInfo
      ? `\nDiagnostic info: ${JSON.stringify(diagnosticInfo, null, 2)}\n`
      : `\n`

    return (
      `[TanStack DB] ${context} exceeded ${maxIterations} iterations. ` +
      `Continuing with available data.\n` +
      `Iteration breakdown (where the loop spent time):\n${iterationBreakdown}` +
      diagnosticSection +
      `Please report this issue at https://github.com/TanStack/db/issues`
    )
  }

  function getIterations(): number {
    return iterations
  }

  function getHistory(): Array<StateHistoryEntry<TState>> {
    return [...history]
  }

  return {
    trackAndCheckLimit,
    formatWarning,
    getIterations,
    getHistory,
  }
}
