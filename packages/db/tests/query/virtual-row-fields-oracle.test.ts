/**
 * Runtime correspondence for the virtual-row-field type oracle.
 *
 * The published query row owns virtual metadata. Nested user objects and
 * opaque values selected through scalar child queries retain their original
 * runtime shapes and must not be decorated as rows.
 */
import { describe, expect, test } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import {
  createLiveQueryCollection,
  eq,
  materialize,
  toArray,
} from '../../src/query/index.js'
import { hasVirtualProps } from '../../src/virtual-props.js'
import { mockSyncCollectionOptions } from '../utils.js'

type Row = {
  id: string
  profile: { label: string }
  createdAt: Date
}

describe(`virtual row field runtime boundary`, () => {
  test(`decorates rows but not nested user objects or opaque child values`, async () => {
    const createdAt = new Date(`2026-09-20T12:34:56.000Z`)
    const rows = createCollection(
      mockSyncCollectionOptions<Row>({
        id: `virtual-row-fields-runtime-oracle-source`,
        getKey: (row) => row.id,
        initialData: [{ id: `row-1`, profile: { label: `nested` }, createdAt }],
      }),
    )
    const live = createLiveQueryCollection((q) =>
      q.from({ row: rows }).select(({ row }) => ({
        id: row.id,
        profile: row.profile,
        createdAt: row.createdAt,
        dates: toArray(
          q
            .from({ child: rows })
            .where(({ child }) => eq(child.id, row.id))
            .select(({ child }) => child.createdAt),
        ),
        firstDate: materialize(
          q
            .from({ child: rows })
            .where(({ child }) => eq(child.id, row.id))
            .select(({ child }) => child.createdAt)
            .findOne(),
        ),
      })),
    )

    try {
      await live.preload()

      const result = live.toArray[0]!
      expect(hasVirtualProps(result)).toBe(true)
      expect(result.$key).toBe(`row-1`)

      expect(result.profile).toEqual({ label: `nested` })
      expect(hasVirtualProps(result.profile)).toBe(false)
      expect(`$key` in result.profile).toBe(false)

      expect(result.createdAt).toBeInstanceOf(Date)
      expect(hasVirtualProps(result.createdAt)).toBe(false)
      expect(result.dates).toHaveLength(1)
      expect(result.dates[0]).toBeInstanceOf(Date)
      expect(hasVirtualProps(result.dates[0])).toBe(false)
      expect(result.firstDate).toBeInstanceOf(Date)
      expect(hasVirtualProps(result.firstDate)).toBe(false)
    } finally {
      await live.cleanup()
      await rows.cleanup()
    }
  })
})
