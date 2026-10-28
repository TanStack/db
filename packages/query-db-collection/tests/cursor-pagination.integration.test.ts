// Ordinary integration tests for the cursor adapter through production pagination:
// response delivery with a shallower peer after deep exhaustion. The window law is
// owned by cursor-pagination-oracle.integration.test.ts.
import { describe, expect, it, vi } from 'vitest'
import { createLiveQueryWindowController } from '../../db/src/live-query-window-controller.js'
import {
  createFixture,
  observeRows,
} from './cursor-pagination-integration-fixture.js'

describe(`cursor adapter through production pagination`, () => {
  it(`holds real response delivery and preserves a shallower peer after deep exhaustion`, async () => {
    const rows = Array.from({ length: 9 }, (_, id) => ({
      id,
      rank: Math.floor(id / 6),
      group: 0,
    }))
    const scope = { group: undefined, descending: false }
    const fixture = createFixture(rows, scope, 2, true)
    const shallow = createLiveQueryWindowController(fixture.live, {
      pageSize: 3,
    })
    const deep = createLiveQueryWindowController(fixture.live, { pageSize: 10 })
    const publications: Array<Array<number>> = []
    const stopShallow = shallow.subscribe(() =>
      publications.push(shallow.getSnapshot().data.map((row) => row.id)),
    )
    const stopDeep = deep.subscribe(() => {})
    let fulfilledPreloads = 0
    const pending = Promise.allSettled(
      [shallow.preload(), deep.preload()].map((promise) =>
        promise.then(() => {
          fulfilledPreloads++
        }),
      ),
    )
    try {
      await vi.waitFor(() => expect(fixture.received()).toBe(1))
      expect(fulfilledPreloads).toBe(0)
      expect(shallow.getSnapshot().data).toEqual([])
      expect(publications.every((batch) => batch.length === 0)).toBe(true)
      fixture.gate.resolve()
      expect((await pending).map((result) => result.status)).toEqual([
        `fulfilled`,
        `fulfilled`,
      ])
      expect(shallow.getSnapshot().hasNextPage).toBe(true)
      expect(deep.getSnapshot().hasNextPage).toBe(false)
      stopDeep()
      deep.dispose()
      await shallow.preload()
      expect(observeRows(shallow.getSnapshot().data)).toEqual(rows.slice(0, 3))
      expect(shallow.getSnapshot().hasNextPage).toBe(true)
      await shallow.fetchNextPage()
      expect(observeRows(shallow.getSnapshot().data)).toEqual(rows.slice(0, 6))
      expect(fixture.backend.calls).toHaveLength(5)
    } finally {
      fixture.gate.resolve()
      await pending
      stopShallow()
      stopDeep()
      shallow.dispose()
      deep.dispose()
      await fixture.cleanup()
    }
  })
})
