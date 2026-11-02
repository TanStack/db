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
type Changes = ReadonlyArray<{
  key: string
  type: `update`
  value: CalibrationRow
  previousValue: CalibrationRow
}>

function cleanupDriver(
  options: {
    primaryFailure?: Error
    corruptOriginal?: boolean
    omitOriginals?: boolean
    failCleanup?: boolean
    corruptSource?: `current` | `admitted` | `initial`
  } = {},
) {
  const projectionFailure = new Error(`projection cleanup rejected`)
  let sourceCleanups = 0
  let projectionCleanups = 0
  let rows = new Map<string, CalibrationRow>()
  let published = new Map<string, CalibrationRow>()
  let notify: ((changes: Changes) => void) | undefined
  const source = {
    get: (id: string) => rows.get(id),
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
      return options.failCleanup === false
        ? Promise.resolve()
        : Promise.reject(projectionFailure)
    },
  }
  const handle = {
    current: () => ({ data: [...published.values()] }),
    collection: () => projection,
    flush() {
      return options.primaryFailure
        ? Promise.reject(options.primaryFailure)
        : Promise.resolve()
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
    snapshotSourceUsesDraft: true,
    makeSource(initial: ReadonlyArray<CalibrationRow>) {
      rows = new Map(initial.map((row) => [row.id, row]))
      published = new Map(rows)
      return {
        collection: source,
        update(next: CalibrationRow) {
          const previousValue = rows.get(next.id)!
          rows.set(next.id, next)
          published.set(next.id, next)
          notify?.([
            { key: next.id, type: `update`, value: next, previousValue },
          ])
          if (options.corruptSource && next.value === 3) {
            const correct = { ...next }
            published.set(next.id, correct)
            if (options.corruptSource === `current`)
              rows.set(next.id, { ...next, corrupted: true })
            if (options.corruptSource === `admitted`) {
              rows.set(next.id, correct)
              next.corrupted = true
            }
          }
          return {
            mutations: options.omitOriginals
              ? []
              : [
                  {
                    original: options.corruptOriginal
                      ? { ...previousValue, config: `corrupted original` }
                      : previousValue,
                  },
                ],
          }
        },
      }
    },
    mount: () => {
      if (options.corruptSource === `initial`)
        for (const [id, row] of rows) {
          const correct = { ...row }
          rows.set(id, correct)
          published.set(id, correct)
          row.corrupted = true
        }
      return handle
    },
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
    const subject = cleanupDriver({ primaryFailure })
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

// This driver changes only a returned local transaction original. Current
// rows and event previousValue stay correct, so those observations cannot
// substitute for retaining the local-only receipt itself.
it(`rejects corruption confined to local mutation originals`, async () => {
  const subject = cleanupDriver({ corruptOriginal: true, failCleanup: false })
  const failure: unknown = await runRowSnapshotHistories(
    subject.driver,
    `callback`,
    `sync`,
  ).catch((error: unknown) => error)
  expect(String(failure)).toContain(`local mutation.original`)
  expect(containsFailure(failure, subject.projectionFailure)).toBe(false)
})

it(`accepts admitted source shapes without assuming draft normalization`, async () => {
  const subject = cleanupDriver({ failCleanup: false })
  // This legal source preserves input prototypes and actually removes omitted
  // keys. The adapter boundary must accept it as well as today's local-only
  // source, without a second expected-result profile for either source.
  await runRowSnapshotHistories(
    { ...subject.driver, snapshotSourceUsesDraft: true },
    `callback`,
    `sync`,
  )
})

class CalibrationValues extends Array<number> {
  total(): number {
    return this.reduce((sum, value) => sum + value, 0)
  }
}

it(`accepts private subclass wrapper prototypes and rejects lost methods`, () => {
  const source = new CalibrationValues(1, 2)
  const wrapper = new CalibrationValues(1, 2)
  Object.setPrototypeOf(wrapper, Object.create(CalibrationValues.prototype))
  expectRowSnapshot(
    { id: `a`, config: wrapper },
    { id: `a`, config: source },
    `private wrapper`,
  )
  expect(() =>
    expectRowSnapshot(
      { id: `a`, config: [1, 2] },
      { id: `a`, config: source },
      `lost method`,
    ),
  ).toThrow()
  Object.setPrototypeOf(
    wrapper,
    Object.assign(Object.create(CalibrationValues.prototype), {
      total: () => 99,
    }),
  )
  expect(() =>
    expectRowSnapshot(
      { id: `a`, config: wrapper },
      { id: `a`, config: source },
      `wrong method`,
    ),
  ).toThrow()
})

it(`rejects a draft-source receipt without any actual original`, async () => {
  const subject = cleanupDriver({ omitOriginals: true, failCleanup: false })
  const failure: unknown = await runRowSnapshotHistories(
    subject.driver,
    `callback`,
    `sync`,
  ).catch((error: unknown) => error)
  expect(String(failure)).toContain(`actual local originals`)
})

// Each fault leaves the framework result and the other source observations
// correct. Final admission has no following update that could expose it later.
it.each([
  [`current`, `current source row`],
  [`admitted`, `change.value`],
  [`initial`, `initial Collection.get`],
] as const)(
  `rejects corruption confined to the %s source row`,
  async (kind, label) => {
    const subject = cleanupDriver({ corruptSource: kind, failCleanup: false })
    const failure: unknown = await runRowSnapshotHistories(
      subject.driver,
      `callback`,
      `sync`,
    ).catch((error: unknown) => error)
    expect(String(failure)).toContain(label)
    expect(containsFailure(failure, subject.projectionFailure)).toBe(false)
  },
)
