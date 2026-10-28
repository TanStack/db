/**
 * Records what a framework binding leaves published at the end of each
 * synchronous turn. A binding may publish several values while one flush
 * runs, such as a Solid render effect or a Svelte pre-effect that reads the
 * previous query's rows before the binding's own effect replaces them. A
 * browser paints only between tasks, so a value replaced within one turn is
 * never seen. The microtask boundary is a stricter cut than the next paint:
 * a value still published when the turn ends counts, even if a later task
 * replaces it before the browser paints.
 */
export function createPublicationLog() {
  const turns: Array<unknown> = []
  const stateTurns: Array<ReadonlyArray<unknown>> = []
  let turnOpen = false
  return {
    /**
     * Record a published value and the keyed state map beside it, replacing
     * an earlier record from this turn.
     */
    record(
      value: unknown,
      state: { values: () => Iterable<unknown> } | undefined,
    ): void {
      const copy = Array.isArray(value) ? [...value] : value
      const rows = state ? [...state.values()] : []
      if (turnOpen) {
        turns[turns.length - 1] = copy
        stateTurns[stateTurns.length - 1] = rows
        return
      }
      turns.push(copy)
      stateTurns.push(rows)
      turnOpen = true
      queueMicrotask(() => {
        turnOpen = false
      })
    },
    /** The value published at the end of each turn, in order. */
    values: (): ReadonlyArray<unknown> => turns,
    /** The state map's rows at the end of each turn, in order. */
    stateValues: (): ReadonlyArray<unknown> => stateTurns,
  }
}
