import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createLiveQueryObserver } from '../../src/live-query-observer.js'
import { Query } from '../../src/query/builder/index.js'
import { createLiveQueryCollection } from '../../src/query/index.js'
import { createPooledLiveQuery } from '../../src/query/pooled-live-query.js'
import { declareOracle } from '../oracle-declaration.js'
import {
  makeSource,
  query,
  releaseTime,
} from './pooled-live-query-gc-support.js'

/**
 * # Does a pooled live query hold its source as long as its Collection would?
 *
 * Law: a pooled live query keeps its source subscribed for the same time as
 * the live-query Collection it stands in for. After the last subscriber
 * leaves, that is exactly `gcTime`; a `gcTime` of 0 or `Infinity` never
 * releases; and a query built but never subscribed waits at least the
 * Collection lifecycle's 50 ms floor. Views of one partition with different `gcTime`s release with the longest.
 * A view that subscribes again after its partition released, as a hidden
 * React Activity does, follows the source like its restarted Collection.
 *
 * Each case runs the same timeline against a pooled query and a live-query
 * Collection on separate sources and compares when each source loses its
 * subscriber, allowing the one tick the Collection's cleanup queue adds.
 * Release timing is resource lifetime, not data, so the pooled
 * live query oracle does not observe it.
 */
function pooled(gcTime: number, subscribe: boolean) {
  const source = makeSource()
  const view = createPooledLiveQuery(query(source)(new Query()), { gcTime })!
  const observer = createLiveQueryObserver(view, { mode: `wholesale` })
  if (subscribe) observer.subscribe(() => {})()
  return source
}

function compiled(gcTime: number, subscribe: boolean) {
  const source = makeSource()
  const live = createLiveQueryCollection({
    query: query(source),
    startSync: true,
    gcTime,
  })
  const observer = createLiveQueryObserver(live, { mode: `wholesale` })
  if (subscribe) observer.subscribe(() => {})()
  return source
}

// Pooled and live-query Collection sources lose their last subscriber at the
// same time under the same timeline. The Collection is the differential
// reference: the pooled partition releases in its GC timer, and the Collection
// one cleanup-queue tick later.
async function expectPooledReleaseMatchesCollection(
  gcTime: number,
  subscribe: boolean,
): Promise<void> {
  const expected = await releaseTime(compiled(gcTime, subscribe), 400)
  const actual = await releaseTime(pooled(gcTime, subscribe), 400)
  if (expected === undefined) expect(actual).toBeUndefined()
  // The Collection releases its source one cleanup-queue tick after
  // its GC timer fires; the partition releases in the timer itself.
  else expect([expected - 1, expected]).toContain(actual)
}

declareOracle({ check: [expectPooledReleaseMatchesCollection] })

describe(`pooled live query gcTime`, () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  for (const gcTime of [1, 100, 0, Number.POSITIVE_INFINITY]) {
    for (const subscribe of [true, false]) {
      it(`matches a live-query Collection for gcTime ${gcTime}${subscribe ? `` : ` without a subscriber`}`, async () => {
        await expectPooledReleaseMatchesCollection(gcTime, subscribe)
      })
    }
  }
})
