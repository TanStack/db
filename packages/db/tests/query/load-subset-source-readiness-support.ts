// Shared cleanup for the load-subset source-readiness tests. It runs each
// phase of cleanup, collects every failure, and keeps the primary failure as
// the cause. The readiness law is owned by
// load-subset-source-readiness-refinement-oracle.test.ts.
export async function finishCleanup(
  primaryFailure: { error: unknown } | undefined,
  phases: ReadonlyArray<
    ReadonlyArray<{ name: string; run: () => Promise<unknown> }>
  >,
): Promise<void> {
  const cleanupErrors: Array<Error> = []
  for (const phase of phases) {
    const results = await Promise.allSettled(
      phase.map(({ run }) => Promise.resolve().then(run)),
    )
    for (const [index, result] of results.entries()) {
      if (result.status === `rejected`) {
        cleanupErrors.push(
          new Error(`${phase[index]!.name} cleanup failed`, {
            cause: result.reason,
          }),
        )
      }
    }
  }
  if (cleanupErrors.length > 0) {
    throw new AggregateError(
      cleanupErrors,
      `Oracle cleanup failed`,
      primaryFailure && { cause: primaryFailure.error },
    )
  }
}
