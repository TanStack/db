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

function expectNoCleanupFailures(error: unknown): void {
  if (error instanceof Error && `suppressed` in error) {
    expect(error.suppressed).toEqual([])
  }
}

export function expectAssertionFailure<TArgs extends Array<unknown>>(
  assertion: (...args: TArgs) => Promise<void>,
  expected: ExpectedAssertionFailure,
): (...args: TArgs) => Promise<void> {
  return async (...args) => {
    let error: unknown
    try {
      await assertion(...args)
    } catch (caught) {
      error = caught
    }

    // A known semantic mismatch does not excuse a second cleanup failure.
    expectNoCleanupFailures(error)
    if (`checkpoint` in expected) {
      expect(error).toMatchObject({
        name: `TraceAssertionError`,
        checkpoint: expected.checkpoint,
        cause: { name: `AssertionError` },
      })
      // runTrace wraps the assertion; its original cleanup evidence stays on
      // that cause rather than being copied into the wrapper.
      if (error instanceof Error) expectNoCleanupFailures(error.cause)
      if (expected.classify) {
        expect(expected.classify(assertionDifference(error))).toBe(true)
      }
      return
    }

    expect(error).toMatchObject({
      name: `AssertionError`,
      message:
        typeof expected.message === `string`
          ? expected.message
          : expect.stringMatching(expected.message),
    })
  }
}
