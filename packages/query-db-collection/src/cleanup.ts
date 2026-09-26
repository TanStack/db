import type { CleanupFn } from '@tanstack/db'

/**
 * Preserves an adapter cleanup result while retiring wrapper-local state in
 * the same stack.
 */
export function runCleanupWithLocalTeardown(
  cleanup: CleanupFn | undefined,
  teardown: () => void,
): void | Promise<void> {
  let result: unknown
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
    if (!isPromiseLike(result)) throw teardownError
    return Promise.resolve(result).then(
      () => {
        throw teardownError
      },
      (cleanupError: unknown) => {
        throw aggregateCleanupFailures(cleanupError, teardownError)
      },
    )
  }
  return isPromiseLike(result) ? Promise.resolve(result) : undefined
}

function isPromiseLike(value: unknown): value is PromiseLike<void> {
  return (
    !!value &&
    (typeof value === `object` || typeof value === `function`) &&
    typeof (value as { then?: unknown }).then === `function`
  )
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
