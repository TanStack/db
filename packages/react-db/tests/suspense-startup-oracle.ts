// A ready on-demand query owes its result at the first public commit if its
// first preload is fulfilled synchronously. Local rows alone cannot prove an
// unresolved query ready. See the deferred-acquisition law and the React
// Suspense contract in docs/guides/error-handling.md.
export type StartupHistory = {
  scope: `standalone` | `provider` | `explicit`
  rows: Array<number>
  selected: number
  held: boolean
  unrelatedStream: boolean
  pendingResult: boolean
}

export type StartupTrace = {
  initial: Array<string>
  commits: Array<string>
  acquiredBeforeRelease: boolean
}

export function expectedStartup(history: StartupHistory): StartupTrace {
  const result = history.rows.includes(history.selected)
    ? `row:${history.selected}`
    : `empty`
  const waits = history.held || history.pendingResult
  return {
    initial: waits ? [`fallback`] : [result],
    commits: waits ? [`fallback`, result] : [result],
    acquiredBeforeRelease: true,
  }
}

export function startupMismatch(actual: StartupTrace, expected: StartupTrace) {
  for (const checkpoint of [
    `initial`,
    `commits`,
    `acquiredBeforeRelease`,
  ] as const) {
    if (
      JSON.stringify(actual[checkpoint]) !==
      JSON.stringify(expected[checkpoint])
    ) {
      return {
        checkpoint,
        difference: `expected ${JSON.stringify(expected[checkpoint])}, received ${JSON.stringify(actual[checkpoint])}`,
      }
    }
  }
  return undefined
}
