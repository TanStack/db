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
    teardown()
    throw cleanupError
  }

  try {
    teardown()
  } catch (teardownError) {
    if (!result) throw teardownError
    return result.finally(() => {
      throw teardownError
    })
  }
  return result
}
