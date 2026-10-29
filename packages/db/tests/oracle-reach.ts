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
 * `reach(state)` when a history enters one. A call before the first
 * `beginHistory()` throws: it is a driver error, not a history. After the property ran,
 * `assertReached()` fails for every declared state that fewer than `minimum`
 * histories entered. A history counts once per state, however often it
 * enters it.
 *
 * A property that runs fixed examples first, through `oraclePropertyOptions`'
 * `examples`, passes their number as `fixedHistories`. The check then also
 * fails for every declared state that those first histories did not enter:
 * that state's reach would depend on the seed (#2287). The first histories
 * are the examples only when the reach belongs to that one property and its
 * callback begins every history, so such a reach is not shared. When fewer
 * histories ran than the fixed ones, a failure stopped the run inside the
 * examples, and the check reports only that, without naming states.
 *
 * A path replay checks one recorded history, not reach, so the check does
 * nothing then, in every reach of that process: a reach need not carry its
 * property's name, so it cannot tell whose replay runs. A seed alone reseeds
 * the whole campaign, which runs its full budget, so its reach is checked like
 * an ordinary run's.
 * `packages/db/tests/declared-reach-oracle.property.test.ts` owns these rules.
 */
export function createOracleReach<TState extends string>(
  property: string,
  states: ReadonlyArray<TState>,
  {
    minimum = 1,
    fixedHistories = 0,
    replaying: replayOverride,
  }: { minimum?: number; fixedHistories?: number; replaying?: boolean } = {},
) {
  const counts = new Map<TState, number>(states.map((state) => [state, 0]))
  const enteredByFixed = new Set<TState>()
  let histories = 0
  let current = new Set<TState>()
  // Other packages use their own replay prefixes. An explicit campaign choice
  // must not inherit an unrelated DB replay selector from the environment.
  const replaying =
    replayOverride ?? readOracleRunConfig().replayPath !== undefined
  return {
    /** Starts one generated history. */
    beginHistory(): void {
      current = new Set()
      histories += 1
    },
    /** The current history entered a declared state. */
    reach(state: TState): void {
      if (!counts.has(state)) {
        throw new Error(`${property}: undeclared reach state ${state}`)
      }
      if (histories === 0) {
        throw new Error(
          `${property}: reach(${state}) came before the first beginHistory()`,
        )
      }
      if (histories <= fixedHistories) enteredByFixed.add(state)
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
      if (histories < fixedHistories) {
        throw new Error(
          `${property}: only ${histories} of its ${fixedHistories} fixed ` +
            `histories ran, so a failure stopped the run inside the fixed ` +
            `examples`,
        )
      }
      const missed = [...counts]
        .filter(([, count]) => count < minimum)
        .map(([state, count]) => `${state} (${count})`)
      const unfixed =
        fixedHistories === 0
          ? []
          : states.filter((state) => !enteredByFixed.has(state))
      const failures = [
        ...(missed.length > 0
          ? [
              `${property}: generated histories reached these states fewer ` +
                `than ${minimum} times, so their laws were not enforced ` +
                `there: ${missed.join(`, `)}`,
            ]
          : []),
        ...(unfixed.length > 0
          ? [
              `${property}: its first ${fixedHistories} histories, the fixed ` +
                `examples, did not enter these states, so their reach ` +
                `depends on the seed: ${unfixed.join(`, `)}`,
            ]
          : []),
      ]
      if (failures.length > 0) throw new Error(failures.join(`\n`))
    },
  }
}
