import { describe, expect, it, vi } from 'vitest'
import { createDeferred } from '../../db/src/deferred.js'
import { runCleanupWithLocalTeardown } from '../src/cleanup'

describe(`Query cleanup composition`, () => {
  it.each([`fulfill`, `reject`] as const)(
    `preserves adapter cleanup settlement while tearing down locally: %s`,
    async (outcome) => {
      const gate = createDeferred<void>()
      const failure = new Error(`query cleanup failed`)
      const teardown = vi.fn()
      const cleanup = vi.fn(() => gate.promise)

      const result = runCleanupWithLocalTeardown(cleanup, teardown)

      expect(cleanup).toHaveBeenCalledOnce()
      expect(teardown).toHaveBeenCalledOnce()
      expect(result).toBe(gate.promise)

      if (outcome === `reject`) {
        gate.reject(failure)
        await expect(result).rejects.toBe(failure)
      } else {
        gate.resolve()
        await expect(result).resolves.toBeUndefined()
      }
    },
  )
})
