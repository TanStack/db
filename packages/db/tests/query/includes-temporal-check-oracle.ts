import { expect } from 'vitest'

// Two public-observation checks of the includes temporal oracle, moved here
// unchanged from includes-temporal-oracle.test.ts. The oracle applies them at
// its scheduled-demand and release-reentry checkpoints; the ordinary checker
// calibrations in includes-temporal.test.ts feed them wrong observations. This
// module registers no tests.

export type ScheduledDemandObservation = {
  completed: Array<string>
  ready: boolean
  rows: Array<{ id: number; comments: Array<{ id: number; body: string }> }>
}

// The public row depends on whether the current acquisition's promise fulfilled.
// An obsolete acquisition's settlement alone cannot add its child row.
export function expectScheduledDemandObservation(
  observation: ScheduledDemandObservation,
  index: number,
): void {
  expect(observation.completed).toHaveLength(index + 1)
  const currentCompleted = observation.completed.includes(`demand-1`)
  expect(observation.rows).toEqual([
    {
      id: 1,
      comments: currentCompleted ? [{ id: 200, body: `current` }] : [],
    },
  ])
  if (currentCompleted) expect(observation.ready).toBe(true)
}

export type ReleaseReentryObservation = {
  changed: boolean
  empty: boolean
  loadCount: number
  requestedKeys: Array<Array<number>>
}

export function expectReleaseReentryObservation(
  observed: ReleaseReentryObservation,
  keys: ReadonlyArray<number>,
): void {
  const expectedKeys = [...keys].sort((left, right) => left - right)
  expect(observed).toEqual({
    changed: true,
    empty: false,
    loadCount: 2,
    requestedKeys: [expectedKeys, expectedKeys],
  })
}
