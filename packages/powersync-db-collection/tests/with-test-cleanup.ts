type Action = () => unknown | Promise<unknown>

/** Test resource teardown only; this carries no adapter or oracle semantics. */
export async function withTestCleanup(body: Action, cleanups: Array<Action>) {
  const failures: Array<unknown> = []
  try {
    await body()
  } catch (error) {
    failures.push(error)
  }
  for (const cleanup of cleanups) {
    try {
      await cleanup()
    } catch (error) {
      failures.push(error)
    }
  }
  if (failures.length === 1) throw failures[0]
  if (failures.length > 1) {
    throw new AggregateError(failures, `Test and cleanup failed`, {
      cause: failures[0],
    })
  }
}
