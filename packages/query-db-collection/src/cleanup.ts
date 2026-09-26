import type { CleanupFn } from '@tanstack/db'

/**
 * Preserves an adapter cleanup result while retiring wrapper-local state in
 * the same stack.
 */
export function runCleanupWithLocalTeardown(
  cleanup: CleanupFn | undefined,
  teardown: () => void,
): void | Promise<void> {
  let result: void | Promise<void>
  try {
    result = cleanup?.()
  } catch (cleanupError) {
    try {
      teardown()
    } catch (teardownError) {
      throw aggregateCleanupFailures(cleanupError, teardownError)
    }
    throw cleanupError
  }

  try {
    teardown()
  } catch (teardownError) {
    if (!result) throw teardownError
    return result.then(
      () => {
        throw teardownError
      },
      (cleanupError: unknown) => {
        throw aggregateCleanupFailures(cleanupError, teardownError)
      },
    )
  }
  return result
}

function aggregateCleanupFailures(
  cleanupError: unknown,
  teardownError: unknown,
): AggregateError {
  return new AggregateError(
    [cleanupError, teardownError],
    `Adapter cleanup and local teardown both failed`,
    { cause: cleanupError },
  )
}
