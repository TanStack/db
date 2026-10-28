/**
 * Cleanup helper shared by the query-shape oracle's drivers and its ordinary
 * harness test in includes-query-shape.test.ts. Each source and the live query
 * are released even when another release fails. The law is owned by
 * includes-query-shape-oracle.test.ts.
 */

export type Cleanable = { cleanup: () => Promise<void> }

export async function cleanupQuery(
  live: Cleanable,
  sources: Array<{ collection: Cleanable }>,
): Promise<void> {
  const failures: Array<unknown> = []
  try {
    await live.cleanup()
  } catch (error) {
    failures.push(error)
  }
  const results = await Promise.allSettled(
    sources.map(({ collection }) => collection.cleanup()),
  )
  for (const result of results) {
    if (result.status === `rejected`) failures.push(result.reason)
  }
  if (failures.length === 1) throw failures[0]
  if (failures.length > 1) {
    throw new AggregateError(failures, `Query cleanup failed`)
  }
}
