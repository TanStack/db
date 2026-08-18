import { expect } from 'vitest'

export type AssertionDifference = {
  actual: unknown
  expected: unknown
}

type ExpectedAssertionFailure =
  | {
      checkpoint: number
      classify?: (difference: AssertionDifference) => boolean
    }
  | { message: string | RegExp }

function assertionDifference(error: unknown): AssertionDifference {
  if (
    typeof error !== `object` ||
    error === null ||
    !(`cause` in error) ||
    typeof error.cause !== `object` ||
    error.cause === null ||
    !(`actual` in error.cause) ||
    !(`expected` in error.cause)
  ) {
    throw new Error(`Expected an assertion difference`)
  }

  return {
    actual: error.cause.actual,
    expected: error.cause.expected,
  }
}

export function expectAssertionFailure<TArgs extends Array<unknown>>(
  assertion: (...args: TArgs) => Promise<void>,
  expected: ExpectedAssertionFailure,
): (...args: TArgs) => Promise<void> {
  return async (...args) => {
    if (`checkpoint` in expected) {
      let error: unknown
      try {
        await assertion(...args)
      } catch (caught) {
        error = caught
      }

      expect(error).toMatchObject({
        name: `TraceAssertionError`,
        checkpoint: expected.checkpoint,
        cause: { name: `AssertionError` },
      })
      if (expected.classify) {
        expect(expected.classify(assertionDifference(error))).toBe(true)
      }
      return
    }

    await expect(assertion(...args)).rejects.toMatchObject({
      name: `AssertionError`,
      message:
        typeof expected.message === `string`
          ? expected.message
          : expect.stringMatching(expected.message),
    })
  }
}
