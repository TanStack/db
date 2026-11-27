import { expect, test } from 'vitest'
import {
  recordDirectDemandCleanup,
  retainDirectDemandCleanup,
} from './persisted-demand-driver'
import type { DirectDemandResult } from './persisted-demand-driver'

test(`receiving cleanup retains a completed result and runs every cleanup`, async () => {
  const result: DirectDemandResult = {
    events: [],
    beforeStartupEvents: [],
    beforeStartup: [],
    beforeStartupPhysical: [],
    cuts: [],
    reached: [],
    providerRequests: [0, 0],
    resets: [],
    cleanupErrors: [],
  }
  let closed = false
  const retained = await retainDirectDemandCleanup(
    () => Promise.resolve(result),
    [
      () => {
        throw new Error(`remove failed`)
      },
      () => {
        closed = true
      },
    ],
  )
  expect(retained).toBe(result)
  expect(retained.cleanupErrors).toEqual([`Error: remove failed`])
  expect(closed).toBe(true)
})

test(`receiving cleanup keeps an earlier execution error as its cause`, async () => {
  const original = new Error(`original checkpoint`)
  const secondary = new Error(`close failed`)
  const failed = retainDirectDemandCleanup(
    () => Promise.reject(original),
    [
      () => {
        throw secondary
      },
    ],
  )
  await expect(failed).rejects.toMatchObject({
    cause: original,
    errors: [original, secondary],
  })
})

test(`an undescribable cleanup keeps the completed observation and later releases`, async () => {
  const result: DirectDemandResult = {
    events: [],
    beforeStartupEvents: [],
    beforeStartup: [],
    beforeStartupPhysical: [],
    cuts: [],
    reached: [],
    providerRequests: [0, 0],
    resets: [],
    cleanupErrors: [],
  }
  let released = false
  const retained = await retainDirectDemandCleanup(
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
  expect(retained.cleanupErrors).toEqual([`[unprintable cleanup error]`])
  expect(released).toBe(true)
})

test(`session cleanup records an undescribable reason and continues teardown`, async () => {
  const diagnostics: Array<string> = []
  let released = false
  await recordDirectDemandCleanup(diagnostics, [
    () => {
      throw Object.create(null)
    },
    () => {
      released = true
    },
  ])
  expect(diagnostics).toEqual([`[unprintable cleanup error]`])
  expect(released).toBe(true)
})
