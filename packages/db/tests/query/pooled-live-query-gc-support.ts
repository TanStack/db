// Shared fixtures for the pooled live query gcTime tests. The release-timing
// law is owned by pooled-live-query-gc-oracle.test.ts. This module builds the
// sources, queries, and release measurements that both test files use.
import { vi } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import { eq } from '../../src/query/index.js'
import { mockSyncCollectionOptions } from '../utils.js'
import type { Collection } from '../../src/collection/index.js'

export type Row = { id: string; g: string }
let serial = 0

export function makeSource() {
  return createCollection(
    mockSyncCollectionOptions<Row>({
      id: `pooled-gc-fixture-${serial++}`,
      getKey: (row) => row.id,
      initialData: [{ id: `a`, g: `x` }],
    }),
  )
}

export const query =
  (source: Collection<Row, string | number, any>) => (q: any) =>
    q.from({ r: source }).where(({ r }: any) => eq(r.g, `x`))

// Milliseconds after which the source no longer has a subscriber, checking
// up to `horizon`; undefined when it keeps one throughout.
export async function releaseTime(
  source: ReturnType<typeof makeSource>,
  horizon: number,
): Promise<number | undefined> {
  for (let elapsed = 0; elapsed <= horizon; elapsed++) {
    if (source.subscriberCount === 0) return elapsed
    // Collection cleanup settles through promises after its timer fires.
    await vi.advanceTimersByTimeAsync(1)
  }
  return undefined
}
