// Unit tests for group keys that hold literal values in aggregate selects: a
// group key built from an array, Date, or NaN literal matches a select value
// that builds the same literal again. The law and its oracle owner are in
// aggregate-select-oracle.property.test.ts.
import { describe, expect, it } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import {
  add,
  coalesce,
  count,
  createLiveQueryCollection,
  inArray,
} from '../../src/query/index.js'
import { mockSyncCollectionOptions } from '../utils.js'

describe(`aggregate select shapes`, () => {
  // Pinned witness: a group key that holds a literal object or NaN matches a
  // select value that builds the same literal again.
  it(`matches group keys holding array, Date and NaN literals`, async () => {
    const source = createCollection(
      mockSyncCollectionOptions<{ id: number; v: number; d: Date | null }>({
        id: `sg-literals-${Math.random().toString(36).slice(2)}`,
        getKey: (r) => r.id,
        initialData: [{ id: 1, v: 1, d: null }],
      }),
    )
    const keys: Record<string, (c: any) => any> = {
      array: (c) => inArray(c.v, [1, 2]),
      date: (c) => coalesce(c.d, new Date(5)),
      nan: (c) => add(c.v, NaN),
    }
    for (const [name, key] of Object.entries(keys)) {
      const query = createLiveQueryCollection((q) =>
        q
          .from({ c: source })
          .groupBy(({ c }) => key(c))
          .select(({ c }) => ({ g: key(c), n: count(c.id) })),
      )
      await query.preload()
      expect(
        query.toArray.map((row: any) => [row.g, row.n]),
        name,
      ).toEqual([
        [name === `array` ? true : name === `date` ? new Date(5) : NaN, 1],
      ])
      await query.cleanup()
    }
    await source.cleanup()
  })
})
