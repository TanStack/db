/** Ordinary harness tests: completed raw observations survive later teardown. */
import { expect, test } from 'vitest'
import { retainOracleCleanupObservation } from './oracle-cleanup'

test(`retains completed raw observations and each cleanup diagnostic`, async () => {
  const raw = {
    rows: [`wrong product row`],
    cleanupErrors: [`earlier diagnostic`],
  }
  const calls: Array<number> = []
  const completed = await retainOracleCleanupObservation(
    () => Promise.resolve(raw),
    [
      () => {
        calls.push(1)
        throw new Error(`cleanup one`)
      },
      () => {
        calls.push(2)
        throw undefined
      },
      () => {
        calls.push(3)
      },
    ],
  )
  expect(completed.rows).toBe(raw.rows)
  expect(completed.cleanupErrors).toEqual([
    `earlier diagnostic`,
    `Error: cleanup one`,
    `undefined`,
  ])
  expect(raw.cleanupErrors).toEqual([`earlier diagnostic`])
  expect(calls).toEqual([1, 2, 3])
})

test(`preserves an incomplete body failure before every teardown failure`, async () => {
  const primary = new Error(`body failed before recording`)
  const secondary = new Error(`cleanup failed`)
  let released = false
  const outcome = retainOracleCleanupObservation(
    () => Promise.reject(primary),
    [
      () => {
        throw secondary
      },
      () => {
        released = true
      },
    ],
  )
  await expect(outcome).rejects.toMatchObject({
    cause: primary,
    errors: [primary, secondary],
  })
  expect(released).toBe(true)
})

test(`returns the original completed result when teardown succeeds`, async () => {
  const raw: { rows: Array<string>; cleanupErrors?: ReadonlyArray<string> } = {
    rows: [],
  }
  await expect(
    retainOracleCleanupObservation(() => Promise.resolve(raw), []),
  ).resolves.toBe(raw)
})

test(`retains cleanup acquired incrementally while recording`, async () => {
  const cleanups: Array<() => unknown> = []
  let released = 0
  const raw = await retainOracleCleanupObservation(async () => {
    cleanups.unshift(() => {
      released++
      throw new Error(`late registered teardown`)
    })
    await Promise.resolve()
    return { rows: [`wrong product row`], cleanupErrors: [] }
  }, cleanups)
  expect(raw.rows).toEqual([`wrong product row`])
  expect(raw.cleanupErrors).toEqual([`Error: late registered teardown`])
  expect(released).toBe(1)
})

test(`preserves incomplete failure and incrementally acquired cleanup`, async () => {
  const cleanups: Array<() => unknown> = []
  const primary = new Error(`incomplete recorder`)
  const secondary = new Error(`late teardown`)
  let released = 0
  const outcome = retainOracleCleanupObservation(() => {
    cleanups.push(() => {
      released++
      throw secondary
    })
    throw primary
  }, cleanups)
  const failure: unknown = await outcome.catch((error: unknown) => error)
  expect(failure).toBeInstanceOf(AggregateError)
  expect((failure as AggregateError).cause).toBe(primary)
  expect((failure as AggregateError).errors).toHaveLength(2)
  expect((failure as AggregateError).errors[0]).toBe(primary)
  expect((failure as AggregateError).errors[1]).toBe(secondary)
  expect(released).toBe(1)
})

const cleanupReasons: Array<{
  name: string
  create: () => unknown
  diagnostic: string
}> = [
  {
    name: `an object without primitive conversion`,
    create: () => Object.create(null) as unknown,
    diagnostic: `[unprintable cleanup error]`,
  },
  {
    name: `a proxy with throwing primitive conversion`,
    create: () =>
      new Proxy(
        {},
        {
          get() {
            throw new Error(`conversion failed`)
          },
        },
      ),
    diagnostic: `[unprintable cleanup error]`,
  },
  {
    name: `a proxy with a throwing prototype lookup`,
    create: () =>
      new Proxy(
        { toString: () => `proxy cleanup` },
        {
          getPrototypeOf() {
            throw new Error(`prototype lookup failed`)
          },
        },
      ),
    diagnostic: `proxy cleanup: [unprintable cleanup details]`,
  },
  {
    name: `an aggregate with throwing nested-error access`,
    create: () =>
      Object.defineProperty(new AggregateError([], `nested access`), `errors`, {
        get() {
          throw new Error(`nested lookup failed`)
        },
      }),
    diagnostic: `AggregateError: nested access: [unprintable cleanup details]`,
  },
  {
    name: `an aggregate that contains itself`,
    create: () => {
      const error = new AggregateError([], `cycle`)
      error.errors.push(error)
      return error
    },
    diagnostic: `AggregateError: cycle: [circular cleanup error]`,
  },
  {
    name: `a deeply nested aggregate`,
    create: () => {
      let error: unknown = new Error(`deep cleanup`)
      for (let depth = 0; depth < 40; depth++)
        error = new AggregateError([error], `nested cleanup`)
      return error
    },
    diagnostic: `[cleanup error depth limit]`,
  },
  {
    name: `ordinary nested aggregate reasons`,
    create: () =>
      new AggregateError(
        [
          new Error(`nested cleanup one`),
          new AggregateError([new Error(`nested cleanup two`)], `inner`),
        ],
        `outer`,
      ),
    diagnostic: `AggregateError: outer: Error: nested cleanup one; AggregateError: inner: Error: nested cleanup two`,
  },
  {
    name: `an aggregate containing an unprintable reason`,
    create: () => new AggregateError([Object.create(null)], `outer`),
    diagnostic: `AggregateError: outer: [unprintable cleanup error]`,
  },
]

test.each(cleanupReasons)(
  `retains wrong raw rows and attempts every teardown for $name`,
  async ({ create, diagnostic }) => {
    const raw = {
      rows: [`wrong product row`],
      cleanupErrors: [`earlier diagnostic`],
    }
    const calls: Array<number> = []
    const completed = await retainOracleCleanupObservation(
      () => Promise.resolve(raw),
      [
        () => {
          calls.push(1)
          throw create()
        },
        () => {
          calls.push(2)
          throw new Error(`later cleanup`)
        },
        () => {
          calls.push(3)
        },
      ],
    )
    expect(completed.rows).toBe(raw.rows)
    expect(completed.cleanupErrors).toHaveLength(3)
    expect(completed.cleanupErrors[0]).toBe(`earlier diagnostic`)
    expect(completed.cleanupErrors[1]).toContain(diagnostic)
    expect(completed.cleanupErrors[2]).toBe(`Error: later cleanup`)
    expect(raw.cleanupErrors).toEqual([`earlier diagnostic`])
    expect(calls).toEqual([1, 2, 3])
  },
)
