import { expect } from 'vitest'

type ExpectedAssertionFailure =
  | { checkpoint: number }
  | { message: string | RegExp }

export function expectAssertionFailure<TArgs extends Array<unknown>>(
  assertion: (...args: TArgs) => Promise<void>,
  expected: ExpectedAssertionFailure,
): (...args: TArgs) => Promise<void> {
  return async (...args) => {
    if (`checkpoint` in expected) {
      await expect(assertion(...args)).rejects.toMatchObject({
        name: `TraceAssertionError`,
        checkpoint: expected.checkpoint,
        cause: { name: `AssertionError` },
      })
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
