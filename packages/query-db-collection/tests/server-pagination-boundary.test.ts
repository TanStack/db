import { describe, expect, it } from 'vitest'
import { createServerPaginationFixture } from './server-pagination-fixture'

describe(`manual server page ownership`, () => {
  it(`an explicit refetch replaces directly appended eager rows despite infinite stale time`, async () => {
    const fixture = createServerPaginationFixture({
      rows: [{ id: 1, rank: 1 }],
      syncMode: `eager`,
    })
    try {
      await fixture.collection.preload()
      fixture.collection.utils.writeUpsert({ id: 2, rank: 2 })
      expect([...fixture.collection.keys()]).toEqual([1, 2])
      await fixture.collection.utils.refetch()
      expect([...fixture.collection.keys()]).toEqual([1])
    } finally {
      await fixture.collection.cleanup()
      fixture.client.clear()
    }
  })
})
