/**
 * Harness self-test for the persisted oracle's cleanup helper: every cleanup action runs, and a primary failure is not hidden. The cleanup law is owned by persisted-oracle.test.ts through cleanupPersistedOracle; this file is an ordinary test of that machinery.
 */
import { expect, it, vi } from 'vitest'
import { cleanupPersistedOracle } from './persisted-support'

it.each([false, true])(
  `persisted oracle cleanup attempts every action without hiding a primary failure: %s`,
  async (hasPrimaryFailure) => {
    const firstFailure = new Error(`first oracle cleanup failure`)
    const secondFailure = new Error(`second oracle cleanup failure`)
    const attempts: Array<string> = []
    const warning = vi.spyOn(console, `warn`).mockImplementation(() => {})

    try {
      const outcome = await cleanupPersistedOracle(
        [
          () => {
            attempts.push(`first`)
            throw firstFailure
          },
          () => {
            attempts.push(`second`)
            return Promise.reject(secondFailure)
          },
          () => {
            attempts.push(`last`)
          },
        ],
        hasPrimaryFailure,
      ).then(
        () => undefined,
        (error: unknown) => error,
      )

      expect(attempts).toEqual([`first`, `second`, `last`])
      if (hasPrimaryFailure) {
        expect(outcome).toBeUndefined()
        expect(warning).toHaveBeenCalledWith(
          `Persisted oracle cleanup failed after the primary failure:`,
          [firstFailure, secondFailure],
        )
      } else {
        expect(outcome).toBeInstanceOf(AggregateError)
        expect((outcome as AggregateError).errors).toEqual([
          firstFailure,
          secondFailure,
        ])
        expect(warning).not.toHaveBeenCalled()
      }
    } finally {
      warning.mockRestore()
    }
  },
)
