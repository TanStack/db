// Shared cleanup harness for the index path collision tests. It runs a check,
// then every registered release, and keeps the check's failure as the cause.
export type Release = () => void | Promise<void>

export async function checkWithCleanup(
  check: (register: (release: Release) => void) => void | Promise<void>,
) {
  const releases: Array<Release> = []
  let primaryFailure: { error: unknown } | undefined
  try {
    await check((release) => releases.unshift(release))
  } catch (error) {
    primaryFailure = { error }
  }

  const cleanupErrors: Array<unknown> = []
  for (const release of releases) {
    try {
      await release()
    } catch (error) {
      cleanupErrors.push(error)
    }
  }
  if (cleanupErrors.length) {
    throw new AggregateError(cleanupErrors, `Path oracle cleanup failed`, {
      cause: primaryFailure?.error,
    })
  }
  if (primaryFailure) throw primaryFailure.error
}
