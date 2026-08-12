import { describe, expect, it } from 'vitest'
import { expectAssertionFailure } from './expected-failure.js'
import { TraceAssertionError } from './trace-runner.js'

describe(`expected failure guard`, () => {
  it(`accepts an assertion mismatch at the expected checkpoint`, async () => {
    const guarded = expectAssertionFailure(
      () => {
        try {
          expect(`observed`).toBe(`expected`)
          return Promise.resolve()
        } catch (error) {
          return Promise.reject(new TraceAssertionError(2, error))
        }
      },
      { checkpoint: 2 },
    )

    await guarded()
  })

  it(`rejects an assertion mismatch from the wrong checkpoint`, async () => {
    const guarded = expectAssertionFailure(
      () =>
        Promise.reject(
          new TraceAssertionError(0, new Error(`startup mismatch`)),
        ),
      { checkpoint: 2 },
    )

    await expect(guarded()).rejects.toBeInstanceOf(Error)
  })

  it(`rejects a runtime error from the expected checkpoint`, async () => {
    const guarded = expectAssertionFailure(
      () =>
        Promise.reject(
          new TraceAssertionError(2, new TypeError(`projection failed`)),
        ),
      { checkpoint: 2 },
    )

    await expect(guarded()).rejects.toBeInstanceOf(Error)
  })

  it(`accepts an assertion mismatch with the expected message`, async () => {
    const guarded = expectAssertionFailure(
      () =>
        Promise.resolve().then(() => {
          expect([`actual`]).toEqual([`expected`])
        }),
      { message: /expected/ },
    )

    await guarded()
  })

  it(`rejects runtime errors that happen to have the expected message`, async () => {
    const runtimeError = new TypeError(`expected value is missing`)
    const guarded = expectAssertionFailure(() => Promise.reject(runtimeError), {
      message: /expected/,
    })

    await expect(guarded()).rejects.toBeInstanceOf(Error)
  })
})
