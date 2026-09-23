import { describe, expect, it } from 'vitest'
import { expectAssertionFailure } from './expected-failure.js'
import { TraceAssertionError, runTrace } from './trace-runner.js'
import type { AssertionDifference } from './expected-failure.js'

type CheckpointGuard = (
  assertion: () => Promise<void>,
  expected: {
    checkpoint: number
    classify: (difference: AssertionDifference) => boolean
  },
) => () => Promise<void>

// Enumerate independent rejection axes: an unrelated failure must not mask a
// missing checkpoint, assertion-type, or difference check.
const checkpointCases = [0, 2, 4].flatMap((checkpoint) =>
  [true, false].flatMap((isAssertion) =>
    [true, false].map((matchesDifference) => ({
      checkpoint,
      isAssertion,
      matchesDifference,
    })),
  ),
)

async function checkCheckpointCase(
  guard: CheckpointGuard,
  scenario: (typeof checkpointCases)[number],
): Promise<void> {
  const { checkpoint, isAssertion, matchesDifference } = scenario
  const guarded = guard(
    () =>
      isAssertion
        ? assertionMismatch(checkpoint)
        : Promise.reject(
            new TraceAssertionError(
              checkpoint,
              new TypeError(`projection failed`),
            ),
          ),
    {
      checkpoint: 2,
      classify: ({ actual, expected }) =>
        actual === (matchesDifference ? `observed` : `different`) &&
        expected === `expected`,
    },
  )

  if (checkpoint === 2 && isAssertion && matchesDifference) {
    await expect(guarded()).resolves.toBeUndefined()
  } else {
    await expect(guarded()).rejects.toMatchObject({ name: `AssertionError` })
  }
}

function assertionMismatch(checkpoint: number): Promise<void> {
  try {
    expect(`observed`).toBe(`expected`)
    return Promise.resolve()
  } catch (error) {
    return Promise.reject(new TraceAssertionError(checkpoint, error))
  }
}

describe(`expected failure guard`, () => {
  it(`retains cleanup evidence on a wrapped assertion cause`, async () => {
    for (const cleanupFails of [false, true]) {
      const guarded = expectAssertionFailure(
        () =>
          runTrace({
            steps: [],
            driver: {
              setup: () => undefined,
              apply: () => undefined,
              cleanup: () => undefined,
            },
            projection: {
              observe: () => 1,
              recompute: () => 2,
              assertEqual: (actual, expected) => {
                try {
                  expect(actual).toBe(expected)
                } catch (error) {
                  if (cleanupFails && error instanceof Error) {
                    Object.assign(error, {
                      suppressed: [new Error(`earlier cleanup`)],
                    })
                  }
                  throw error
                }
              },
            },
          }),
        { checkpoint: 0 },
      )
      if (cleanupFails) await expect(guarded()).rejects.toBeInstanceOf(Error)
      else await expect(guarded()).resolves.toBeUndefined()
    }
  })

  it.each([`checkpoint`, `message`] as const)(
    `does not classify additional cleanup failures as an expected %s mismatch`,
    async (form) => {
      for (const cleanupFails of [false, true]) {
        const secondary = new Error(`cleanup failed`)
        const assertion = () =>
          runTrace({
            steps: [],
            driver: {
              setup: () => undefined,
              start:
                form === `message`
                  ? () => {
                      expect(1).toBe(2)
                    }
                  : undefined,
              apply: () => undefined,
              cleanup: () => {
                if (cleanupFails) throw secondary
              },
            },
            projection: {
              observe: () => 1,
              recompute: () => 2,
              assertEqual: (actual, expected) => {
                expect(actual).toBe(expected)
              },
            },
          })
        const guarded = expectAssertionFailure(
          assertion,
          form === `checkpoint` ? { checkpoint: 0 } : { message: /expected/ },
        )
        if (cleanupFails) await expect(guarded()).rejects.toBeInstanceOf(Error)
        else await expect(guarded()).resolves.toBeUndefined()
      }
    },
  )
  it(`accepts an assertion mismatch at the expected checkpoint`, async () => {
    const guarded = expectAssertionFailure(() => assertionMismatch(2), {
      checkpoint: 2,
    })

    await guarded()
  })

  it(`rejects an assertion mismatch from the wrong checkpoint`, async () => {
    const guarded = expectAssertionFailure(() => assertionMismatch(0), {
      checkpoint: 2,
    })

    await expect(guarded()).rejects.toBeInstanceOf(Error)
  })

  it.each(checkpointCases)(
    `checks checkpoint=$checkpoint, assertion=$isAssertion, difference=$matchesDifference independently`,
    async (scenario) => {
      await checkCheckpointCase(expectAssertionFailure, scenario)
    },
  )

  it.each([`checkpoint`, `message`] as const)(
    `rejects unexpected success in the %s form`,
    async (form) => {
      const guarded = expectAssertionFailure(
        () => Promise.resolve(),
        form === `checkpoint` ? { checkpoint: 2 } : { message: /expected/ },
      )
      await expect(guarded()).rejects.toBeInstanceOf(Error)
    },
  )

  it.each([`checkpoint`, `difference`] as const)(
    `detects a guard that ignores the %s constraint`,
    async (constraint) => {
      // Test-owned fault injection only: relax one option at the call boundary.
      const faultyGuard: CheckpointGuard = (assertion, expected) =>
        expectAssertionFailure(assertion, {
          ...expected,
          ...(constraint === `checkpoint`
            ? { checkpoint: 0 }
            : { classify: () => true }),
        })
      await expect(
        checkCheckpointCase(faultyGuard, {
          checkpoint: constraint === `checkpoint` ? 0 : 2,
          isAssertion: true,
          matchesDifference: constraint === `checkpoint`,
        }),
      ).rejects.toBeInstanceOf(Error)
    },
  )

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

  it(`accepts an assertion mismatch with the expected difference`, async () => {
    const guarded = expectAssertionFailure(() => assertionMismatch(2), {
      checkpoint: 2,
      classify: ({ actual, expected }) =>
        actual === `observed` && expected === `expected`,
    })

    await guarded()
  })

  it(`rejects an assertion mismatch with a different shape`, async () => {
    const guarded = expectAssertionFailure(() => assertionMismatch(2), {
      checkpoint: 2,
      classify: ({ actual }) => actual === `different`,
    })

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
