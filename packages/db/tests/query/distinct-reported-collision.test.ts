// The issue fixed Math.random only before module initialization. Restore it
// before any test work; neither the hash implementation nor its output is mocked.
import { it, vi } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import { createLiveQueryCollection } from '../../src/query/index.js'
import { hash } from '../../../db-ivm/src/hashing/hash.js'
import { checkDistinctSnapshot } from '../../../db-ivm/tests/distinct-incrementalization-oracle.js'
import { mockSyncCollectionOptions, withOracleCleanup } from '../utils.js'

const restoreRandom = vi.hoisted(() => {
  const nativeRandom = Math.random
  Math.random = () => 0.5
  return () => {
    Math.random = nativeRandom
  }
})
restoreRandom()

it(`replays the reported selected rows with repeatable hash initialization`, async () => {
  const rows = [51277, 90754].map((value) => ({ id: `item-${value}`, value }))
  process.stdout.write(
    `reported pair digests ${JSON.stringify(rows.map(hash))}\n`,
  )
  const source = createCollection(
    mockSyncCollectionOptions({
      id: `collision-repro`,
      getKey: (row: { id: string; value: number }) => row.id,
      initialData: [],
    }),
  )
  const query = createLiveQueryCollection({
    query: (q) =>
      q
        .from({ row: source })
        .select(({ row }) => ({ id: row.id, value: row.value }))
        .distinct(),
    startSync: true,
  })
  const retain = query.subscribeChanges(() => {})
  await withOracleCleanup(async () => {
    source.utils.begin()
    for (const value of rows) source.utils.write({ type: `insert`, value })
    await source.utils.commit()
    checkDistinctSnapshot(
      query.toArray,
      rows.map((row) => [row, 1]),
      0,
    )
  }, [
    () => retain.unsubscribe(),
    () => query.cleanup(),
    () => source.cleanup(),
  ])
})
