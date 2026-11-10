/** Attempt every callback, then rethrow the first exact failure value. */
export function runAllCallbacks(callbacks: Iterable<() => void>): void {
  let firstFailure: { error: unknown } | undefined
  for (const callback of callbacks) {
    try {
      callback()
    } catch (error) {
      firstFailure ??= { error }
    }
  }
  if (firstFailure) throw firstFailure.error
}

/**
 * Report an adapter contract breach, such as an `unloadSubset` that throws,
 * without changing the caller's result. The error surfaces as uncaught.
 */
export function reportUncaught(error: unknown): void {
  queueMicrotask(() => {
    throw error
  })
}
