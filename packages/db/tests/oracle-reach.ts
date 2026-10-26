import { readOracleRunConfig } from './oracle-config.js'

/**
 * Declared reach for a generated-history property.
 *
 * A law is enforced only in the states that generated histories reach. A
 * property can pass any number of runs and still check nothing in the state
 * its law is about, because the grammar, the driver, or the run budget never
 * produces that state. Counting passing runs does not show reach.
 *
 * A property declares the states its laws depend on. Its driver calls
 * `reach(state)` when a history enters one. After the property ran,
 * `assertReached()` fails for every declared state that fewer than `minimum`
 * histories entered. A history counts once per state, however often it
 * enters it.
 *
 * A replay of one seed or path checks one history, not reach, so the check
 * does nothing then.
 */
export function createOracleReach<TState extends string>(
  property: string,
  states: ReadonlyArray<TState>,
  { minimum = 1 }: { minimum?: number } = {},
) {
  const counts = new Map<TState, number>(states.map((state) => [state, 0]))
  let current = new Set<TState>()
  const { replaySeed, replayPath } = readOracleRunConfig()
  const replaying = replaySeed !== undefined || replayPath !== undefined
  return {
    /** Starts one generated history. */
    beginHistory(): void {
      current = new Set()
    },
    /** The current history entered a declared state. */
    reach(state: TState): void {
      if (!counts.has(state)) {
        throw new Error(`${property}: undeclared reach state ${state}`)
      }
      if (current.has(state)) return
      current.add(state)
      counts.set(state, counts.get(state)! + 1)
    },
    /** How many histories entered each declared state. */
    counts(): ReadonlyMap<TState, number> {
      return counts
    },
    /** Fails for each declared state that too few histories entered. */
    assertReached(): void {
      if (replaying) return
      const missed = [...counts]
        .filter(([, count]) => count < minimum)
        .map(([state, count]) => `${state} (${count})`)
      if (missed.length > 0) {
        throw new Error(
          `${property}: generated histories reached these states fewer than ` +
            `${minimum} times, so their laws were not enforced there: ` +
            missed.join(`, `),
        )
      }
    },
  }
}
