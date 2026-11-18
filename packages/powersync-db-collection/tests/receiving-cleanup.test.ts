import { expect, it } from 'vitest'
import { retainNativeObservation } from './receiving-cleanup'

it(`retains a completed observation and every later cleanup error`, async () => {
  const calls: Array<string> = []
  const result = await retainNativeObservation<{
    wrongRows: Array<string>
    cleanupErrors?: ReadonlyArray<string>
  }>(
    () => Promise.resolve({ wrongRows: [`wrong`] }),
    [
      () => {
        calls.push(`first`)
        throw new Error(`first disposal failed`)
      },
      () => {
        calls.push(`second`)
        throw new Error(`second disposal failed`)
      },
    ],
  )
  expect(result.wrongRows).toEqual([`wrong`])
  expect(calls).toEqual([`first`, `second`])
  expect(result.cleanupErrors).toHaveLength(2)
  expect(result.cleanupErrors?.[0]).toContain(`first disposal failed`)
  expect(result.cleanupErrors?.[1]).toContain(`second disposal failed`)
})

it(`keeps an incomplete receiving failure primary and releases its resources`, async () => {
  const primary = new Error(`read failed before observation`)
  const secondary = new Error(`disposal also failed`)
  const result = await retainNativeObservation(
    () => Promise.reject(primary),
    [
      () => {
        throw secondary
      },
    ],
  ).catch((error: unknown) => error)
  expect(result).toBeInstanceOf(AggregateError)
  expect((result as AggregateError).cause).toBe(primary)
  expect((result as AggregateError).errors).toEqual([primary, secondary])
})
