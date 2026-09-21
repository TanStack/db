/**
 * Bound offline-oracle observation and exhaust test-owned cleanup.
 *
 * A checkpoint timeout says that an expected event was not observed; it does
 * not cancel the underlying operation. Cleanup therefore tries every action.
 * If the scenario already has a primary failure, cleanup failures are reported
 * without replacing it. Otherwise they form one AggregateError after all
 * resources have had a release attempt.
 */
export async function atOracleCheckpoint<T>(
  promise: Promise<T>,
  label: string,
  timeout = 1000,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () =>
            reject(new Error(`Offline oracle checkpoint timed out: ${label}`)),
          timeout,
        )
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

export async function cleanupOfflineOracle(
  actions: Array<() => void | Promise<unknown>>,
  hasPrimaryFailure: boolean,
): Promise<void> {
  const failures: Array<unknown> = []
  for (const [index, action] of actions.entries()) {
    try {
      await atOracleCheckpoint(
        Promise.resolve().then(action),
        `cleanup stage ${index}`,
        250,
      )
    } catch (error) {
      failures.push(error)
    }
  }
  if (failures.length > 0) {
    if (hasPrimaryFailure)
      console.warn(
        `Offline oracle cleanup failed after the primary failure:`,
        failures,
      )
    else throw new AggregateError(failures, `Offline oracle cleanup failed`)
  }
}
