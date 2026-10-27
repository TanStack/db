// Shared cleanup harness for the virtual row field tests. It runs a check,
// then every cleanup, and reports the check's failure as the cause.
export async function checkWithCleanup(
  check: () => Promise<void>,
  cleanups: ReadonlyArray<() => Promise<void>>,
): Promise<void> {
  let primaryFailure: unknown
  let checkFailed = false
  try {
    await check()
  } catch (error) {
    primaryFailure = error
    checkFailed = true
  }

  const cleanupFailures: Array<unknown> = []
  for (const cleanup of cleanups) {
    try {
      await cleanup()
    } catch (error) {
      cleanupFailures.push(error)
    }
  }

  if (cleanupFailures.length > 0) {
    throw new AggregateError(
      cleanupFailures,
      `Virtual row oracle check and cleanup failed`,
      {
        cause: primaryFailure,
      },
    )
  }
  if (checkFailed) throw primaryFailure
}

// The virtual row fields that every published row root carries.
export const virtualFieldNames = [
  `$key`,
  `$hasPendingWrites`,
  `$synced`,
  `$origin`,
  `$collectionId`,
] as const
