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

  it.each([`fulfill`, `reject`] as const)(
    `waits for adapter cleanup before reporting a local teardown failure: %s`,
    async (outcome) => {
      const gate = createDeferred<void>()
      const adapterFailure = new Error(`query cleanup failed`)
      const teardownFailure = new Error(`query teardown failed`)
      const cleanup = vi.fn(() => gate.promise)
      const teardown = vi.fn(() => {
        throw teardownFailure
      })

      const result = runCleanupWithLocalTeardown(cleanup, teardown)
      let settled = false
      void Promise.resolve(result).then(
        () => {
          settled = true
        },
        () => {
          settled = true
        },
      )

      expect(cleanup).toHaveBeenCalledOnce()
      expect(teardown).toHaveBeenCalledOnce()
      await Promise.resolve()
      expect(settled).toBe(false)

      if (outcome === `fulfill`) {
        gate.resolve()
        await expect(result).rejects.toBe(teardownFailure)
      } else {
        gate.reject(adapterFailure)
        const failure = await Promise.resolve(result).catch(
          (error: unknown) => error,
        )
        expect(failure).toBeInstanceOf(AggregateError)
        expect(failure).toMatchObject({
          cause: adapterFailure,
          errors: [adapterFailure, teardownFailure],
        })
      }
    },
  )

  it(`keeps a synchronous adapter failure primary when local teardown also fails`, () => {
    const adapterFailure = new Error(`synchronous query cleanup failed`)
    const teardownFailure = new Error(`query teardown failed`)
    let failure: unknown

    try {
      runCleanupWithLocalTeardown(
        () => {
          throw adapterFailure
        },
        () => {
          throw teardownFailure
        },
      )
    } catch (error) {
      failure = error
    }

    expect(failure).toBeInstanceOf(AggregateError)
    expect(failure).toMatchObject({
      cause: adapterFailure,
      errors: [adapterFailure, teardownFailure],
    })
  })
})
