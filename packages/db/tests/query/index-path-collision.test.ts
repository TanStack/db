// Ordinary cleanup-harness tests for the index path collision oracle. The
// distinct-path law is owned by index-path-collision-oracle.test.ts.
import { expect, it } from 'vitest'
import { checkWithCleanup } from './index-path-collision-support.js'

it(`preserves a mismatch and secondary cleanup error`, async () => {
  const primary = new Error(`wrong public rows`)
  const cleanup = new Error(`cleanup failed`)
  const released: Array<string> = []
  let failure: unknown

  try {
    await checkWithCleanup((register) => {
      register(() => {
        released.push(`source`)
        throw cleanup
      })
      register(() => {
        released.push(`query`)
      })
      throw primary
    })
  } catch (error) {
    failure = error
  }

  expect(released).toEqual([`query`, `source`])
  expect(failure).toBeInstanceOf(AggregateError)
  expect((failure as AggregateError).cause).toBe(primary)
  expect((failure as AggregateError).errors).toEqual([cleanup])
})
