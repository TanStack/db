import { describe, expect, it } from 'vitest'
import {
  expectRowSnapshot,
  runRowSnapshotHistories,
} from './row-snapshot-oracle'
import type { LiveQueryDriver } from './contract'

// Wrong observations go through the same checker as receiving histories.
// These controls judge checker sensitivity, not a separate product model.
describe(`row snapshot comparison calibration`, () => {
  const expected = { id: `a`, value: 0 }
  const cases = [
    {
      name: `unexpected ordinary root field`,
      actual: { ...expected, unexpected: { value: 1 } },
      expected,
    },
    {
      name: `missing ordinary root field`,
      actual: { id: `a` },
      expected,
    },
    {
      name: `unexpected undefined root field`,
      actual: { ...expected, unexpected: undefined },
      expected,
    },
    {
      name: `missing explicitly undefined root field`,
      actual: expected,
      expected: { ...expected, optional: undefined },
    },
    {
      name: `unexpected nested undefined field`,
      actual: { ...expected, config: { value: 0, optional: undefined } },
      expected: { ...expected, config: { value: 0 } },
    },
    {
      name: `missing explicitly undefined nested field`,
      actual: { ...expected, config: { value: 0 } },
      expected: { ...expected, config: { value: 0, optional: undefined } },
    },
    {
      name: `unexpected undefined array element`,
      actual: { ...expected, config: [undefined] },
      expected: { ...expected, config: new Array(1) },
    },
    {
      name: `missing explicitly undefined array element`,
      actual: { ...expected, config: new Array(1) },
      expected: { ...expected, config: [undefined] },
    },
  ]

  it.each(cases)(`rejects $name`, ({ actual, expected: model, name }) => {
    expect(() => expectRowSnapshot(actual, model, name)).toThrow()
  })

  it(`accepts the complete matching user shape`, () => {
    expect(() =>
      expectRowSnapshot({ ...expected }, expected, `matching snapshot`),
    ).not.toThrow()
  })
})

type CalibrationRow = { id: string } & Record<string, unknown>
type Changes = ReadonlyArray<{ previousValue: CalibrationRow }>

function cleanupDriver(primaryFailure?: Error) {
  const projectionFailure = new Error(`projection cleanup rejected`)
  let sourceCleanups = 0
  let projectionCleanups = 0
  let row: CalibrationRow
  let notify: ((changes: Changes) => void) | undefined
  const source = {
    get: () => row,
    subscribeChanges(callback: (changes: Changes) => void) {
      notify = callback
      return {
        unsubscribe() {
          notify = undefined
        },
      }
    },
    cleanup() {
      sourceCleanups++
      return Promise.resolve()
    },
  }
  const projection = {
    cleanup() {
      projectionCleanups++
      return Promise.reject(projectionFailure)
    },
  }
  const handle = {
    current: () => ({ data: [row] }),
    collection: () => projection,
    flush() {
      return primaryFailure ? Promise.reject(primaryFailure) : Promise.resolve()
    },
    apply(write: () => void) {
      write()
      return Promise.resolve()
    },
    unmount() {},
  }
  // Only the callback/sync path runs. The fixture supplies its minimal driver
  // at this boundary; it does not pretend to implement a real Collection.
  const driver = {
    name: `cleanup-calibration`,
    makeSource(initial: ReadonlyArray<CalibrationRow>) {
      row = initial[0]!
      return {
        collection: source,
        update(next: CalibrationRow) {
          const previousValue = row
          row = next
          notify?.([{ previousValue }])
        },
      }
    },
    mount: () => handle,
  } as unknown as LiveQueryDriver
  return {
    driver,
    projectionFailure,
    counts: () => ({ sourceCleanups, projectionCleanups }),
  }
}

function containsFailure(
  actual: unknown,
  expected: Error,
  seen = new Set<unknown>(),
): boolean {
  if (actual === expected) return true
  if (!(actual instanceof Error) || seen.has(actual)) return false
  seen.add(actual)
  return (
    containsFailure(actual.cause, expected, seen) ||
    (actual instanceof AggregateError &&
      actual.errors.some((error: unknown) =>
        containsFailure(error, expected, seen),
      ))
  )
}

describe(`row snapshot history cleanup`, () => {
  it(`attempts source cleanup after projection cleanup rejects`, async () => {
    const subject = cleanupDriver()
    const failure: unknown = await runRowSnapshotHistories(
      subject.driver,
      `callback`,
      `sync`,
    ).catch((error: unknown) => error)
    expect(containsFailure(failure, subject.projectionFailure)).toBe(true)
    const { sourceCleanups, projectionCleanups } = subject.counts()
    expect(projectionCleanups).toBeGreaterThan(0)
    expect(sourceCleanups).toBe(projectionCleanups)
  })

  it(`preserves a primary failure and the distinct cleanup failure`, async () => {
    const primaryFailure = new Error(`framework flush failed`)
    const subject = cleanupDriver(primaryFailure)
    const failure: unknown = await runRowSnapshotHistories(
      subject.driver,
      `callback`,
      `sync`,
    ).catch((error: unknown) => error)
    expect(containsFailure(failure, primaryFailure)).toBe(true)
    expect(containsFailure(failure, subject.projectionFailure)).toBe(true)
    const { sourceCleanups, projectionCleanups } = subject.counts()
    expect(projectionCleanups).toBeGreaterThan(0)
    expect(sourceCleanups).toBe(projectionCleanups)
  })
})
