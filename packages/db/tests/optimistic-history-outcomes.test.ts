/**
 * Ordinary harness self-tests for the optimistic-history outcome driver: a
 * cleanup failure keeps the primary failure and every cleanup failure. The
 * outcome law is owned by optimistic-history-outcomes-oracle.test.ts.
 */
import { describe, expect, it } from 'vitest'
import {
  observeHistoryPromise,
  withHistoryCleanup,
} from './optimistic-history-oracle.js'

describe(`Outcome observer calibration`, () => {
  it.each([undefined, Object.freeze(new Error(`frozen primary`))])(
    `retains primary %s and every cleanup failure`,
    async (primary) => {
      const cleanupError = new Error(`cleanup`)
      const calls: Array<number> = []
      const observed = observeHistoryPromise(
        withHistoryCleanup(
          () => Promise.reject(primary),
          () => [
            () => {
              calls.push(1)
              throw cleanupError
            },
            () => {
              calls.push(2)
              return Promise.reject(undefined)
            },
            () => {
              calls.push(3)
            },
          ],
        ),
      )
      await observed.settled
      expect(calls).toEqual([1, 2, 3])
      const result = observed.read()
      expect(result.status).toBe(`rejected`)
      if (result.status !== `rejected`)
        throw new Error(`missing cleanup rejection`)
      expect(result.reason).toBeInstanceOf(AggregateError)
      const aggregate = result.reason as AggregateError
      expect(aggregate.cause).toBe(primary)
      expect(aggregate.errors).toHaveLength(3)
      expect(aggregate.errors[0]).toBe(primary)
      expect(aggregate.errors[1]).toBe(cleanupError)
      expect(aggregate.errors[2]).toBeUndefined()
    },
  )
})
