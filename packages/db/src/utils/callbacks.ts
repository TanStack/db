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
