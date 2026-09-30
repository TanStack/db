/**
 * A live-query result has at most one row per key. Queries that keep their
 * compiled pipeline skip the keyed reduction that used to reject extra
 * contributors, so the output boundary checks the invariant for every shape.
 * No public query can produce the violation; the witness injects one.
 */
import { MultiSet } from '@tanstack/db-ivm'
import { expect, it } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import { createLiveQueryCollection } from '../../src/query/index.js'
import { getCollectionBuilder } from '../../src/query/live/collection-registry.js'
import { mockSyncCollectionOptions } from '../utils.js'

type Row = { id: string }

it(`rejects a flush that publishes two rows for one key`, async () => {
  const source = createCollection(
    mockSyncCollectionOptions<Row>({
      id: `result-multiplicity-source`,
      getKey: (row) => row.id,
      initialData: [{ id: `a` }],
    }),
  )
  const live = createLiveQueryCollection((q) => q.from({ row: source }))
  try {
    await live.preload()
    const syncState = getCollectionBuilder(live)?.currentSyncState
    const input = syncState && Object.values(syncState.inputs)[0]
    if (!syncState?.graph || !syncState.flushPendingChanges || !input) {
      throw new Error(`Missing live query sync state`)
    }
    input.sendData(
      new MultiSet([
        [[`b`, { id: `b` }], 1],
        [[`b`, { id: `b` }], 1],
      ]),
    )
    syncState.graph.run()
    expect(() => syncState.flushPendingChanges!()).toThrow(
      `a key has at most one result row`,
    )
  } finally {
    await live.cleanup()
    await source.cleanup()
  }
})
