import { expect } from 'vitest'
import { expectOrderedRows } from './result-laws'

/** Page labels and request timing are separate laws, not inferred from rows. */
export function expectPageRows(
  actual: { data: unknown; pages: Array<Array<unknown>> },
  expected: ReadonlyArray<unknown>,
  pageSize: number,
): void {
  expect(Number.isInteger(pageSize) && pageSize > 0).toBe(true)
  expectOrderedRows(actual.data, expected)
  expect(Array.isArray(actual.pages)).toBe(true)
  const pageCount = Math.max(1, Math.ceil(expected.length / pageSize))
  expect(actual.pages).toHaveLength(pageCount)
  for (let page = 0; page < pageCount; page++) {
    expectOrderedRows(
      actual.pages[page],
      expected.slice(page * pageSize, (page + 1) * pageSize),
    )
  }
  expectOrderedRows(actual.pages.flat(), actual.data)
}
