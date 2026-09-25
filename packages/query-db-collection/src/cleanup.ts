import type { CleanupFn } from '@tanstack/db'

/**
 * Preserves an adapter cleanup result while retiring wrapper-local state in
 * the same stack.
 */
export function runCleanupWithLocalTeardown(
  cleanup: CleanupFn | undefined,
  teardown: () => void,
): void | Promise<void> {
  try {
    return cleanup?.()
  } finally {
    teardown()
  }
}
