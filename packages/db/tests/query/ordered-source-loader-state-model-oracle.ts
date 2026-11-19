/**
 * The retirement-progress comparison of
 * `ordered-source-loader-state-oracle.test.ts`, moved unchanged so that its
 * checker calibration in `ordered-source-loader-state-model.test.ts` can read
 * it. That oracle file states the law and its authority. This module
 * registers no tests.
 */
import { rejectAt } from './ordered-comparison-oracle.js'

// ARCHITECTURE's ordered repair and publication laws: a read started before
// an invalidation cannot pay it, and a later read must start before replacement
// publication. Event order comes only from observed source callbacks and
// adapter requests on one clock; a read that starts after the invalidation is
// in its epoch. Dispatch may be deferred while the public gate holds.
export function checkRetirementProgress(
  invalidationAt: number | undefined,
  startedAt: Array<number>,
  publicationAt = Number.POSITIVE_INFINITY,
): void {
  if (
    invalidationAt !== undefined &&
    !startedAt.some((at) => at > invalidationAt && at < publicationAt)
  ) {
    rejectAt(
      `ordered-source-loader-state-oracle.test.ts:550`,
      new Error(
        `retirement invalidation: no authoritative read followed the adapter invalidation before publication`,
      ),
    )
  }
}
