// Ordinary robustness tests for the opaque cursor pager: very large backend
// pages and a repeated continuation cursor. The opaque cursor law (every window
// equals the full-relation slice) is owned by cursor-pagination.oracle.test.ts.
import { describe, expect, it } from 'vitest'
import { createCursorPager } from './cursor-pagination/pager.js'

describe(`opaque cursor adapter`, () => {
  it(`accepts large backend pages without spreading rows into arguments`, async () => {
    const rows = Array.from({ length: 150_000 }, (_, id) => id)
    const pager = createCursorPager(() =>
      Promise.resolve({ rows, nextCursor: null }),
    )
    expect(await pager.read({ offset: 149_997, limit: undefined })).toEqual(
      rows.slice(149_997),
    )
    expect(await pager.read({ offset: 0, limit: 2 })).toEqual(rows.slice(0, 2))
  })

  it(`rejects a repeated opaque cursor without looping`, async () => {
    let calls = 0
    const pager = createCursorPager(() => {
      calls++
      return Promise.resolve({ rows: [], nextCursor: `same` })
    })
    await expect(pager.read({ offset: 0, limit: 1 })).rejects.toThrow(
      `repeated`,
    )
    expect(calls).toBe(2)
  })
})
