import { QueryClient } from '@tanstack/query-core'
import { createCollection } from '@tanstack/db'
import { describe, expect, it, vi } from 'vitest'
import { createDeferred } from '../../db/src/deferred.js'
import { runCleanupWithLocalTeardown } from '../src/cleanup'
import { queryCollectionOptions } from '../src/query.js'

describe(`Query cleanup composition`, () => {
  it(`treats an incidental contextual-void return as synchronous cleanup`, () => {
    const teardownFailure = new Error(`query teardown failed exactly`)
    const cleanup: () => void = () => 1

    expect(() =>
      runCleanupWithLocalTeardown(cleanup, () => {
        throw teardownFailure
      }),
    ).toThrow(teardownFailure)
  })

  it(`awaits a structural thenable before reporting local teardown failure`, async () => {
    const gate = createDeferred<void>()
    const adapterFailure = new Error(`structural cleanup failed exactly`)
    const teardownFailure = new Error(`query teardown failed exactly`)
    const thenable = { then: gate.promise.then.bind(gate.promise) }
    const cleanup: () => void = () => thenable

    const result = runCleanupWithLocalTeardown(cleanup, () => {
      throw teardownFailure
    })
    let settled = false
    void Promise.resolve(result).then(
      () => {
        settled = true
      },
      () => {
        settled = true
      },
    )

    await Promise.resolve()
    expect(settled).toBe(false)

    gate.reject(adapterFailure)
    const failure = await Promise.resolve(result).catch(
      (error: unknown) => error,
    )
    expect(failure).toBeInstanceOf(AggregateError)
    expect(failure).toMatchObject({
      cause: adapterFailure,
      errors: [adapterFailure, teardownFailure],
    })
  })

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

  it(`unmounts QueryClient through the public collection cleanup path`, async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          staleTime: Number.POSITIVE_INFINITY,
        },
      },
    })
    const mount = vi.spyOn(queryClient, `mount`)
    const unmount = vi.spyOn(queryClient, `unmount`)
    const collection = createCollection(
      queryCollectionOptions<{ id: string }>({
        id: `query-cleanup-public-wrapper-witness`,
        queryClient,
        queryKey: [`query-cleanup-public-wrapper-witness`],
        queryFn: () => Promise.resolve([{ id: `row` }]),
        getKey: (row) => row.id,
        startSync: true,
      }),
    )

    try {
      await collection.preload()
      expect(mount).toHaveBeenCalledOnce()

      await collection.cleanup()
      expect(unmount).toHaveBeenCalledOnce()
    } finally {
      await collection.cleanup()
    }
  })
})
