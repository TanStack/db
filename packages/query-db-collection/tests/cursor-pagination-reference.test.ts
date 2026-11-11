// Rules of the cursor pagination reference model and its slice comparison,
// checked by hand without production. cursor-pagination.oracle.test.ts judges
// the opaque cursor pager with the same expectedRows model.
import { describe, expect, it } from 'vitest'
import { expectedRows } from './cursor-pagination/model-oracle.js'
import {
  allAscending,
  fixtureRows,
} from './cursor-pagination-reference-support'
import type { Row, Scope, Window } from './cursor-pagination/model-oracle.js'

async function checkRead(
  source: Array<Row>,
  scope: Scope,
  window: Window,
  read: (window: Window) => Promise<Array<Row>>,
) {
  const expected = expectedRows(source, scope, window)
  expect(await read(window), `ordered slice ${JSON.stringify(window)}`).toEqual(
    expected,
  )
}

describe(`cursor pagination reference`, () => {
  it(`preserves ties, filtering and reverse total order`, () => {
    expect(
      expectedRows(
        fixtureRows,
        { group: 1, descending: true },
        { offset: 1, limit: 3 },
      ).map((row) => row.id),
    ).toEqual([5, 3, 1])
    expect(
      expectedRows(fixtureRows, allAscending, { offset: 0, limit: 0 }),
    ).toEqual([])
  })

  it(`rejects capped-page, wrong-order and duplicate-row answers`, async () => {
    const window = { offset: 0, limit: 8 }
    const expected = expectedRows(fixtureRows, allAscending, window)
    for (const wrong of [
      expected.slice(0, 2),
      [...expected].reverse(),
      [...expected.slice(0, 7), expected[0]!],
    ]) {
      await expect(
        checkRead(fixtureRows, allAscending, window, () =>
          Promise.resolve(wrong),
        ),
      ).rejects.toThrow(`ordered slice`)
    }
    await checkRead(fixtureRows, allAscending, window, () =>
      Promise.resolve(expected),
    )
  })
})
