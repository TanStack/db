// Shared helpers for the oracle file and the ordinary tests moved from it.
import { expect } from 'vitest'

export type Row = { id: number; rank: number }
export const cleanupError = {
  name: `CollectionStateError`,
  message: expect.stringContaining(`after cleanup() completes`),
}
export const reentryScenarios = ([`abort`, `release`] as const).flatMap(
  (boundary) =>
    [false, true].flatMap((nestedCleanup) =>
      [1, 2].map((attempts) => ({
        id: `${boundary}:${nestedCleanup ? `nested` : `plain`}:${attempts}`,
        boundary,
        nestedCleanup,
        attempts,
      })),
    ),
)
export const completedBoundaryScenarios = ([`event`, `await`] as const).flatMap(
  (boundary) =>
    [false, true].map((liveQuery) => ({
      id: `${boundary}:${liveQuery ? `live-query` : `source`}`,
      boundary,
      liveQuery,
    })),
)
export async function withOracleCleanup<T>(
  body: () => T | Promise<T>,
  cleanups: Array<() => void | Promise<unknown>>,
): Promise<T> {
  let value: T | undefined
  const failures: Array<unknown> = []
  try {
    value = await body()
  } catch (error) {
    failures.push(error)
  }
  for (const cleanup of cleanups) {
    try {
      await cleanup()
    } catch (error) {
      failures.push(error)
    }
  }
  if (failures.length === 1) throw failures[0]
  if (failures.length > 1) {
    throw new AggregateError(failures, `Cleanup oracle and teardown failed`, {
      cause: failures[0],
    })
  }
  return value as T
}
