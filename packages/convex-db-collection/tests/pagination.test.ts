/**
 * Fixed scenarios for automatic pagination: harness cleanup fidelity, maxRows
 * validation, and the default row cap. The complete-snapshot law and its
 * generated histories are owned by pagination-oracle.property.test.ts. These
 * fixed tests compare with written values and have no oracle owner (tracked in
 * #2264).
 */
import { createCollection } from '@tanstack/db'
import { expect, it } from 'vitest'
import { convexPaginatedCollectionOptions } from '../src/index'
import { withTestCleanup } from './helpers'
import { keyedRows, provider, query } from './pagination-support'

// Shrinking must retain the law mismatch even when disposal also fails.
it(`retains the primary comparison when cleanup also fails`, async () => {
  const primary = new Error(`row mismatch`)
  const cleanup = new Error(`release mismatch`)
  let lastReleased = false
  await expect(
    withTestCleanup(
      () => Promise.reject(primary),
      () => Promise.reject(cleanup),
      () => {
        lastReleased = true
      },
    ),
  ).rejects.toMatchObject({ cause: primary, errors: [primary, cleanup] })
  expect(lastReleased).toBe(true)
})

it.each([0, -1, 1.5, Infinity, NaN])(
  `rejects invalid maxRows %s`,
  async (maxRows) => {
    const source = provider(false, `none`)
    const collection = createCollection(
      convexPaginatedCollectionOptions({
        client: source.client,
        query,
        queryArgs: {},
        maxRows,
        getKey: (row) => row.id,
      }),
    )
    try {
      await expect(collection.preload()).rejects.toThrow(`maxRows`)
      expect(source.slots).toHaveLength(0)
    } finally {
      await collection.cleanup()
    }
  },
)

// The omitted default needs both adjacent observations. Rejection at 10,001
// alone also accepts a wrong default of 9,999; acceptance at 10,000 rejects it.
// Calibration: defaults of 9,999 and 10,001 fail the accepted-error and
// over-cap-error comparisons respectively; the documented default passes both.
it(`accepts ten thousand rows and rejects the next row under the default cap`, async () => {
  const source = provider(false, `none`)
  const collection = createCollection(
    convexPaginatedCollectionOptions({
      client: source.client,
      query,
      queryArgs: {},
      pageSize: 10_001,
      getKey: (row) => row.id,
    }),
  )
  collection.startSyncImmediate()
  await withTestCleanup(
    async () => {
      const rows = Array.from({ length: 10_001 }, (_, rank) => ({
        id: String(rank),
        rank,
        text: String(rank),
      }))
      const accepted = rows.slice(0, 10_000)
      await source.publish(accepted)
      expect(collection.utils.getSyncError()).toBeUndefined()
      await collection.utils.awaitSync()
      expect(collection.status).toBe(`ready`)
      expect(keyedRows([...collection.values()])).toEqual(keyedRows(accepted))
      await source.publish(rows)
      expect(collection.utils.getSyncError()).toBeInstanceOf(RangeError)
      expect(keyedRows([...collection.values()])).toEqual(keyedRows(accepted))
      expect(source.slots).toHaveLength(1)
      await expect(collection.utils.awaitSync()).rejects.toBeInstanceOf(
        RangeError,
      )
    },
    () => collection.cleanup(),
  )
})
