/** Own each successfully returned harness, regardless of its factory. */
export function harnessScope<
  Args extends Array<unknown>,
  Harness extends { cleanup: () => void | Promise<void> },
>(factory: (...args: Args) => Harness) {
  const cleanups: Array<() => void | Promise<void>> = []
  return {
    create(...args: Args): Harness {
      const harness = factory(...args)
      cleanups.push(harness.cleanup.bind(harness))
      return harness
    },
    async cleanup() {
      const errors: Array<unknown> = []
      while (cleanups.length) {
        const dispose = cleanups.pop()!
        try {
          await dispose()
        } catch (error) {
          errors.push(error)
        }
      }
      if (errors.length === 1) throw errors[0]
      if (errors.length > 1) {
        throw new AggregateError(errors, `Harness cleanup failed`, {
          cause: errors[0],
        })
      }
    },
  }
}
