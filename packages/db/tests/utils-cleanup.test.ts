import { describe, expect, it } from 'vitest'
import { withOracleCleanup } from './utils'

describe(`withOracleCleanup`, () => {
  it(`returns the check result after cleanup`, async () => {
    const result = { value: 1 }
    let cleaned = false
    const observed = await withOracleCleanup(
      () => result,
      [
        () => {
          cleaned = true
        },
      ],
    )

    expect(observed).toBe(result)
    expect(cleaned).toBe(true)
  })

  it(`preserves the primary failure and every cleanup failure`, async () => {
    const primary = new Error(`check failed`)
    const first = new Error(`first cleanup failed`)
    const second = new Error(`second cleanup failed`)
    let observed: unknown
    try {
      await withOracleCleanup(() => {
        throw primary
      }, [
        () => {
          throw first
        },
        () => Promise.reject(second),
      ])
    } catch (error) {
      observed = error
    }

    expect(observed).toBeInstanceOf(AggregateError)
    const failure = observed as AggregateError
    expect(failure.cause).toBe(primary)
    expect(failure.errors).toEqual([primary, first, second])
  })

  it(`attempts later cleanup steps after a cleanup failure`, async () => {
    const failure = new Error(`cleanup failed`)
    const attempts: Array<string> = []
    const result = withOracleCleanup(() => {
      attempts.push(`check`)
    }, [
      () => {
        attempts.push(`first`)
        throw failure
      },
      () => {
        attempts.push(`second`)
      },
      () => {
        attempts.push(`third`)
      },
    ])

    await expect(result).rejects.toBe(failure)
    expect(attempts).toEqual([`check`, `first`, `second`, `third`])
  })
})
