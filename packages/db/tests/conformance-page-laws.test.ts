import { expect, it } from 'vitest'
import fc from 'fast-check'
import { expectPageRows } from './conformance/page-laws'

const rows = [1, 2, 3].map((id) => ({ id: `${id}`, name: `row${id}` }))

it.each([
  { data: rows, pages: [rows.slice(0, 2), [{ id: `4`, name: `wrong` }]] },
  { data: rows, pages: [rows.slice(0, 2).reverse(), rows.slice(2)] },
  { data: rows, pages: [rows.slice(0, 2), []] },
  { data: rows, pages: [rows.slice(0, 2), rows.slice(2), []] },
  { data: [...rows].reverse(), pages: [rows.slice(0, 2), rows.slice(2)] },
  { data: rows, pages: [rows] },
])(`rejects a corrupted page boundary %#`, (actual) => {
  expectPageRows(
    { data: rows, pages: [rows.slice(0, 2), rows.slice(2)] },
    rows,
    2,
  )
  expect(() => expectPageRows(actual, rows, 2)).toThrowError()
})

it.each([751391, undefined])(
  `checks generated complete page partitions seed=%s`,
  (seed) => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 30 }),
        fc.integer({ min: 1, max: 8 }),
        (count, pageSize) => {
          const expected = Array.from({ length: count }, (_, index) => ({
            id: `${index}`,
            value: index * 7,
          }))
          // Driver-side test values use a streaming chunk builder rather than the
          // checker's slice/index formula.
          const pages: Array<Array<{ id: string; value: number }>> = [[]]
          for (const row of expected) {
            if (pages.at(-1)!.length === pageSize) pages.push([])
            pages.at(-1)!.push({ ...row })
          }
          const actual = { data: expected.map((row) => ({ ...row })), pages }
          expectPageRows(actual, expected, pageSize)
          const corrupted = pages.map((page) => page.map((row) => ({ ...row })))
          if (count) corrupted.at(-1)!.at(-1)!.value++
          else corrupted[0]!.push({ id: `ghost`, value: 0 })
          expect(() =>
            expectPageRows({ ...actual, pages: corrupted }, expected, pageSize),
          ).toThrowError()
        },
      ),
      { seed, numRuns: 50 },
    )
  },
)
