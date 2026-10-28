/**
 * Row type and teardown shared by the pagination oracle and its ordinary unit
 * tests in pagination.test.ts. The law that the ordered window equals
 * independent recomputation is owned by pagination-oracle.property.test.ts.
 */

export type PageRow = {
  id: number
  rank: number
  keep?: boolean
}

export type CleanupTarget = {
  cleanup: () => unknown
}

export async function cleanupAll(
  ...targets: ReadonlyArray<CleanupTarget>
): Promise<void> {
  const results = await Promise.allSettled(
    targets.map((target) => Promise.resolve().then(() => target.cleanup())),
  )
  const rejection = results.find(
    (result): result is PromiseRejectedResult => result.status === `rejected`,
  )
  if (rejection) throw rejection.reason
}
