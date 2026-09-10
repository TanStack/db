import { describe, expect, it, vi } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import { createLiveQueryCollection } from '../../src/query/index.js'
import { count } from '../../src/query/builder/functions.js'
import { mockSyncCollectionOptions } from '../utils.js'

describe(`group representative work`, () => {
  it.each([16, 1024, 5000])(
    `encodes changed contributions, not all %s retained members`,
    async (size) => {
      const source = createCollection(
        mockSyncCollectionOptions<{ id: number; value: number }>({
          id: `group-work-${size}`,
          getKey: (row) => row.id,
          initialData: Array.from({ length: size }, (_, id) => ({
            id,
            value: 1,
          })),
        }),
      )
      const grouped = createLiveQueryCollection((q) =>
        q
          .from({ row: source })
          .groupBy(({ row }) => row.value)
          .select(({ row }) => ({ value: row.value, count: count(row.id) })),
      )
      try {
        await grouped.preload()
        for (const type of [`insert`, `delete`] as const) {
          const spy = vi.spyOn(JSON, `stringify`)
          let calls: number
          try {
            source.utils.begin()
            source.utils.write({ type, value: { id: size, value: 1 } })
            source.utils.commit()
            calls = spy.mock.calls.length
          } finally {
            spy.mockRestore()
          }
          // Group reduction still scans members. Encoding its stable input
          // keys must scale with the delta, not the retained group size.
          expect(calls).toBeLessThanOrEqual(4)
          expect(grouped.toArray).toMatchObject([
            { value: 1, count: size + (type === `insert` ? 1 : 0) },
          ])
        }
      } finally {
        await grouped.cleanup()
        await source.cleanup()
      }
    },
  )
})
