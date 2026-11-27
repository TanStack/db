import { expect, test } from 'vitest'
import {
  recordCursorDemandCleanup,
  retainCursorDemandCleanup,
} from './cursor-persisted-demand-driver'
import type { CursorDemandResult } from './cursor-persisted-demand-driver'

function completedResult(): CursorDemandResult {
  return {
    beforeStartupEvents: [],
    beforeStartup: [],
    savedPhysical: [],
    savedAcquisitions: [],
    cuts: [],
    reached: [],
    resets: [],
    providerRequests: [],
    cleanupErrors: [`earlier diagnostic`],
  }
}

test(`cursor cleanup retains a completed result when a reason cannot print`, async () => {
  const result = completedResult()
  let released = false
  const retained = await retainCursorDemandCleanup(
    () => Promise.resolve(result),
    [
      () => {
        throw Object.create(null)
      },
      () => {
        released = true
      },
    ],
  )
  expect(retained).toBe(result)
  expect(result.cleanupErrors).toEqual([
    `earlier diagnostic`,
    `[unprintable cleanup error]`,
  ])
  expect(released).toBe(true)
})

test(`cursor session cleanup records an unprintable reason and releases every resource`, async () => {
  const result = completedResult()
  let released = false
  await recordCursorDemandCleanup(result, [
    () => {
      throw Object.create(null)
    },
    () => {
      released = true
    },
  ])
  expect(result.cleanupErrors).toEqual([
    `earlier diagnostic`,
    `[unprintable cleanup error]`,
  ])
  expect(released).toBe(true)
})

test(`cursor cleanup preserves raw primary and secondary reasons before recording completes`, async () => {
  const primary: unknown = Object.create(null)
  const secondary: unknown = Object.create(null)
  let released = false
  const failure: unknown = await retainCursorDemandCleanup(
    () => Promise.reject(primary),
    [
      () => {
        throw secondary
      },
      () => {
        released = true
      },
    ],
  ).catch((error: unknown) => error)
  expect(failure).toBeInstanceOf(AggregateError)
  expect((failure as AggregateError).cause).toBe(primary)
  expect((failure as AggregateError).errors).toEqual([primary, secondary])
  expect(released).toBe(true)
})
