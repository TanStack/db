import { expect, it } from 'vitest'
import fc from 'fast-check'
import {
  expectKeyedRows,
  expectOrderedRows,
  expectResultSurface,
  expectUnorderedRows,
} from './conformance/result-laws'

const rows = [
  { id: `a`, count: 2 },
  { id: `b`, count: 1 },
]

it(`checks declared result types without copying or repairing the surface`, () => {
  const raw = {
    status: `ready`,
    isReady: false,
    isError: false,
    isEnabled: false,
    data: [{ value: undefined }],
  }
  expect(expectResultSurface(raw)).toBe(raw)
  for (const key of [`status`, `isReady`, `isError`, `isEnabled`] as const) {
    const malformed = { ...raw, [key]: undefined }
    expect(() => expectResultSurface(malformed)).toThrowError(
      new RegExp(`raw ${key}`),
    )
  }
})

it(`separates only the four documented virtual fields from selected values`, () => {
  const actual = rows.map((row) => ({
    ...row,
    $synced: true,
    $origin: `remote`,
    $key: row.id,
    $collectionId: `source`,
  }))
  expectUnorderedRows(actual, rows)
  expectOrderedRows(actual, rows)
  const wrapped = actual.map((row) =>
    Object.defineProperty({ ...row }, Symbol(`framework`), { value: {} }),
  )
  expectUnorderedRows(wrapped, rows)
  expectOrderedRows(wrapped, rows)
  for (const extra of [`$unexpected`, Symbol(`extra`)]) {
    const corrupted = actual.map((row) => ({ ...row, [extra]: undefined }))
    expect(() => expectUnorderedRows(corrupted, rows)).toThrowError()
    expect(() => expectOrderedRows(corrupted, rows)).toThrowError()
  }
})

it(`accepts reordered complete unordered rows without mutating inputs`, () => {
  const actual = [...rows].reverse()
  expectUnorderedRows(actual, rows)
  expect(actual.map((row) => row.id)).toEqual([`b`, `a`])
  expectOrderedRows(actual, [...rows].reverse())
})

it.each(
  [
    [],
    [
      { id: `a`, count: 2 },
      { id: `c`, count: 1 },
    ],
    [
      { id: `a`, count: 2 },
      { id: `a`, count: 2 },
    ],
    [
      { id: `a`, count: 1 },
      { id: `b`, count: 1 },
    ],
    [
      { id: `a`, count: 2, unexpected: undefined },
      { id: `b`, count: 1 },
    ],
  ].map((actual) => ({ actual })),
)(`rejects incomplete or corrupted unordered rows %#`, ({ actual }) => {
  expectUnorderedRows(rows, rows)
  expect(() => expectUnorderedRows(actual, rows)).toThrowError()
})

it(`retains raw grouped cardinality instead of folding duplicate groups`, () => {
  const expected = [
    { team: `a`, count: 2 },
    { team: `b`, count: 1 },
  ]
  const duplicated = [...expected, { team: `a`, count: 2 }]
  expect(new Map(duplicated.map((row) => [row.team, row.count]))).toEqual(
    new Map(expected.map((row) => [row.team, row.count])),
  )
  expect(() => expectUnorderedRows(duplicated, expected, `team`)).toThrowError()
})

it(`rejects wrong peer children even with unchanged root and child counts`, () => {
  const expected = [
    { id: `a`, issues: [{ id: `i1`, title: `one` }] },
    { id: `b`, issues: [{ id: `i2`, title: `two` }] },
  ]
  expectUnorderedRows(expected, expected)
  const swapped = [
    { ...expected[0], issues: expected[1]!.issues },
    { ...expected[1], issues: expected[0]!.issues },
  ]
  expect(() => expectUnorderedRows(swapped, expected)).toThrowError()
})

it(`rejects a wrong order despite preserving every row`, () => {
  expectUnorderedRows([...rows].reverse(), rows)
  expect(() => expectOrderedRows([...rows].reverse(), rows)).toThrowError()
  expect(() => expectOrderedRows([], rows)).toThrowError()
})

it(`checks state keys and values, not only map size`, () => {
  const expected = [{ id: `a` }, { id: `b` }]
  expectKeyedRows(new Map(expected.map((row) => [row.id, row])), expected)
  expect(() =>
    expectKeyedRows(
      new Map([
        [`a`, { id: `a` }],
        [`stale`, { id: `b` }],
      ]),
      expected,
    ),
  ).toThrowError()
  expect(() =>
    expectKeyedRows(
      new Map([
        [`a`, { id: `b` }],
        [`b`, { id: `a` }],
      ]),
      expected,
    ),
  ).toThrowError()
})

it.each([513091, undefined])(
  `checks generated selected-row distinctions seed=%s`,
  (seed) => {
    fc.assert(
      fc.property(
        fc.array(fc.integer(), { minLength: 2, maxLength: 12 }),
        (values) => {
          const expected = values.map((value, index) => ({
            id: `${index}`,
            value,
          }))
          const actual = [...expected].reverse()
          expectUnorderedRows(actual, expected)
          expectOrderedRows(actual, [...expected].reverse())
          const corrupt = actual.map((row, index) =>
            index === 0 ? { ...row, value: row.value + 1 } : row,
          )
          expect(() => expectUnorderedRows(corrupt, expected)).toThrowError()
          expect(() => expectOrderedRows(actual, expected)).toThrowError()
        },
      ),
      { seed, numRuns: 50 },
    )
  },
)
