import { oracleReplayRequested } from '../oracle-config.js'

// The finite includes receiving matrices require this exact set of observed
// cuts within one case. This is an ordinary per-case set assertion, with the
// same diagnostics and replay behavior as its former reach bookkeeping.
export function requiredIncludesObservations<TState extends string>(
  property: string,
  states: ReadonlyArray<TState>,
) {
  if (new Set(states).size !== states.length)
    throw new Error(`${property}: a reach state is declared twice`)
  const counts = new Map<TState, number>(states.map((state) => [state, 0]))
  let begun = false
  const seen = new Set<TState>()
  return {
    beginHistory: () => {
      begun = true
      seen.clear()
    },
    reach: (state: TState) => {
      if (!counts.has(state))
        throw new Error(`${property}: undeclared reach state ${state}`)
      if (!begun)
        throw new Error(
          `${property}: reach(${state}) came before the first beginHistory()`,
        )
      if (!seen.has(state)) counts.set(state, counts.get(state)! + 1)
      seen.add(state)
    },
    counts: (): ReadonlyMap<TState, number> => counts,
    assertReached: () => {
      if (oracleReplayRequested()) return
      const missed = [...counts]
        .filter(([, count]) => count < 1)
        .map(([state, count]) => `${state} (${count})`)
      if (missed.length)
        throw new Error(
          `${property}: generated histories reached these states fewer ` +
            `than 1 times, so their laws were not enforced ` +
            `there: ${missed.join(`, `)}`,
        )
    },
  }
}
