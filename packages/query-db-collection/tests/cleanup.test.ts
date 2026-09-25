import { describe, expect, it, vi } from 'vitest'
import { runCleanupWithLocalTeardown } from '../src/cleanup'

function createDeferred() {
  let resolve!: () => void
  let reject!: (error: unknown) => void
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

describe(`Query cleanup composition`, () => {
  it.each([`fulfill`, `reject`] as const)(
    `preserves adapter cleanup settlement while tearing down locally: %s`,
    async (outcome) => {
      const gate = createDeferred()
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
