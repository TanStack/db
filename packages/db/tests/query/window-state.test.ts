import { describe, expect, it } from 'vitest'
import { PropRef } from '../../src/query/ir.js'
import { WindowState } from '../../src/query/live/window-state.js'
import type { CollectionImpl } from '../../src/collection/index.js'
import type { ChangeMessage } from '../../src/types.js'

type Row = { id: number; rank: number | null }

function mockCollection(rows: ReadonlyArray<Row>): CollectionImpl<Row, number> {
  const changes = rows.map(
    (value): ChangeMessage<Row, number> => ({
      type: `insert`,
      key: value.id,
      value,
    }),
  )
  return {
    compareOptions: { stringSort: `lexical` },
    currentStateAsChanges: () => changes,
    entries: () => rows.map((row) => [row.id, row] as const)[Symbol.iterator](),
  } as unknown as CollectionImpl<Row, number>
}

describe(`WindowState`, () => {
  it(`retains live changes that arrive before initial coverage settles`, () => {
    const rows = [
      { id: 1, rank: 1 },
      { id: 2, rank: 2 },
      { id: 3, rank: 3 },
    ]
    const window = new WindowState<Row, number>(
      mockCollection(rows),
      [
        {
          expression: new PropRef([`rank`]),
          compareOptions: { direction: `asc`, nulls: `first` },
        },
      ],
      undefined,
      2,
    )

    window.admitChanges(
      rows.slice(1).map((value) => ({ type: `insert`, key: value.id, value })),
    )
    window.admitChanges([{ type: `insert`, key: 1, value: rows[0]! }])
    window.recordInitialCoverage([2, 3], false)

    expect(window.requestBoundary()).toEqual({ key: 2, values: [2] })
    expect(window.requiresPrefixRefresh).toBe(true)
  })

  it(`tracks changes that enter retained coverage while the active window is narrow`, () => {
    const rows = [
      { id: 1, rank: 1 },
      { id: 2, rank: 2 },
      { id: 7, rank: 2.5 },
      { id: 3, rank: 3 },
    ]
    const window = new WindowState<Row, number>(
      mockCollection(rows),
      [
        {
          expression: new PropRef([`rank`]),
          compareOptions: { direction: `asc`, nulls: `first` },
        },
      ],
      undefined,
      3,
    )

    window.recordInitialCoverage([1, 2, 3], false)
    window.recordContinuationCoverage(
      [],
      false,
      3,
      false,
      window.coverageRevision,
    )
    window.ensureSize(1)
    window.admitChanges([{ type: `insert`, key: 7, value: rows[2]! }])
    window.ensureSize(3)

    expect(window.reconcile(new Map()).map(({ key }) => key)).toEqual([1, 2, 7])
    expect(window.requiresPrefixRefresh).toBe(true)
  })

  it(`does not reuse an ordered boundary across truncate generations`, () => {
    const window = new WindowState<Row, number>(
      mockCollection([
        { id: 1, rank: 1 },
        { id: 2, rank: 2 },
        { id: 3, rank: 3 },
        { id: 4, rank: 4 },
      ]),
      [
        {
          expression: new PropRef([`rank`]),
          compareOptions: { direction: `asc`, nulls: `first` },
        },
      ],
      undefined,
      2,
    )

    window.recordInitialCoverage([1], false)
    window.recordContinuationCoverage(
      [2],
      false,
      2,
      false,
      window.coverageRevision,
    )
    expect(window.requestBoundary()).toEqual({ key: 2, values: [2] })

    window.resetCoverage()
    expect(window.requestBoundary()).toBeUndefined()

    window.recordInitialCoverage([3], false)
    window.recordContinuationCoverage(
      [4],
      false,
      2,
      false,
      window.coverageRevision,
    )
    expect(window.requestBoundary()).toEqual({ key: 4, values: [4] })
  })

  it.each([
    { direction: `asc`, nulls: `first`, expected: { key: 3, values: [2] } },
    { direction: `asc`, nulls: `last`, expected: { key: 1, values: [null] } },
    { direction: `desc`, nulls: `first`, expected: { key: 2, values: [1] } },
    { direction: `desc`, nulls: `last`, expected: { key: 1, values: [null] } },
  ] as const)(
    `keeps a failed replay boundary on the last complete publication ($direction, nulls $nulls)`,
    ({ direction, nulls, expected }) => {
      const window = new WindowState<Row, number>(
        mockCollection([{ id: 2, rank: 100 }]),
        [
          {
            expression: new PropRef([`rank`]),
            compareOptions: { direction, nulls },
          },
        ],
        undefined,
        1,
      )
      const lastCompletePublication = new Map<number, Row>([
        [1, { id: 1, rank: null }],
        [2, { id: 2, rank: 1 }],
        [3, { id: 3, rank: 2 }],
      ])

      expect(window.boundary(lastCompletePublication)).toEqual(expected)
    },
  )

  it.each(
    ([`asc`, `desc`] as const).flatMap((direction) =>
      ([`first`, `last`] as const).flatMap((nulls) =>
        [2, 4].map((requestedPrefix) => ({
          direction,
          nulls,
          requestedPrefix,
        })),
      ),
    ),
  )(
    `keeps legacy satisfaction local ($direction, nulls $nulls, prefix $requestedPrefix)`,
    ({ direction, nulls, requestedPrefix }) => {
      const window = new WindowState<Row, number>(
        mockCollection([
          { id: 1, rank: null },
          { id: 2, rank: 1 },
          { id: 3, rank: 2 },
        ]),
        [
          {
            expression: new PropRef([`rank`]),
            compareOptions: { direction, nulls },
          },
        ],
        undefined,
        requestedPrefix,
      )

      window.recordLocalRequestSatisfaction(requestedPrefix)

      expect(window.localPrefixSize).toBe(Math.min(requestedPrefix, 3))
      expect(window.coversActiveWindow).toBe(requestedPrefix <= 3)
      expect(window.requestBoundary()).toBeUndefined()
      expect(window.requiresPrefixRefresh).toBe(true)
    },
  )
})
