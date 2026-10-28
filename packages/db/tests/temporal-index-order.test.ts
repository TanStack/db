import { Temporal } from 'temporal-polyfill'
import { describe, expect, it, vi } from 'vitest'
import { BasicIndex } from '../src/indexes/basic-index'
import { BTreeIndex } from '../src/indexes/btree-index'
import { createCollection } from '../src/collection/index'
import { createLiveQueryCollection } from '../src/query/live-query-collection'
import { PropRef } from '../src/query/ir'
import { mockSyncCollectionOptions, withOracleCleanup } from './utils'
import type { CompareOptions } from '../src/query/builder/types'

/**
 * # Does an index preserve the public order of valid ZonedDateTimes?
 *
 * Changelog #1519 promises instant order for ZonedDateTime `orderBy`. The
 * supplied instants below put `early` first, while their display strings put
 * `late` first. A plain two-row model therefore predicts `early, late` for an
 * ascending direct index read and `early` for a one-row public query.
 *
 * The legal fixed grammar crosses BasicIndex and BTreeIndex with incremental
 * adds and full builds, positive and negative epoch width, string collations,
 * direction, and equal-instant ties, then compares exact ordered keys after
 * the action. A ready source exercises scan and indexed live-query paths at
 * preload; an on-demand Collection checks the first published ordered row.
 * Index spies prove the named indexed reads. The PlainDate lane checks one
 * extended-year calendar boundary; the exception lane requires `TypeError`
 * for its named mixed or unordered Temporal pairs and claims no ordered
 * result for them. Custom index callbacks, mutated built-ins, and other
 * mixed Temporal pairs remain outside this owner.
 */
type Row = { id: string; value: Temporal.ZonedDateTime }
const rows: ReadonlyArray<Row> = [
  {
    id: `early`,
    value: Temporal.ZonedDateTime.from(`2024-01-01T14:00+14:00[+14:00]`),
  },
  {
    id: `late`,
    value: Temporal.ZonedDateTime.from(`2024-01-01T01:00+00:00[UTC]`),
  },
]
const [early, late] = rows
const expectedOrder = [`early`, `late`]
const widthBoundary: ReadonlyArray<Row> = [
  {
    id: `early`,
    value:
      Temporal.Instant.fromEpochNanoseconds(9n).toZonedDateTimeISO(`+14:00`),
  },
  {
    id: `late`,
    value: Temporal.Instant.fromEpochNanoseconds(10n).toZonedDateTimeISO(`UTC`),
  },
]
const negativeWidthBoundary: ReadonlyArray<Row> = [
  {
    id: `early`,
    value:
      Temporal.Instant.fromEpochNanoseconds(-10n).toZonedDateTimeISO(`UTC`),
  },
  {
    id: `late`,
    value: Temporal.Instant.fromEpochNanoseconds(-1n).toZonedDateTimeISO(`UTC`),
  },
]
const highMagnitudeNeighbors: ReadonlyArray<Row> = [
  {
    id: `z-earlier`,
    value:
      Temporal.Instant.fromEpochNanoseconds(
        1_704_067_200_000_000_000n,
      ).toZonedDateTimeISO(`+14:00`),
  },
  {
    id: `a-later`,
    value:
      Temporal.Instant.fromEpochNanoseconds(
        1_704_067_200_000_000_001n,
      ).toZonedDateTimeISO(`UTC`),
  },
]
const tiedInstants: ReadonlyArray<Row> = [
  {
    id: `late`,
    value: Temporal.Instant.fromEpochNanoseconds(0n).toZonedDateTimeISO(`UTC`),
  },
  {
    id: `early`,
    value:
      Temporal.Instant.fromEpochNanoseconds(0n).toZonedDateTimeISO(`+14:00`),
  },
]
const comparisons: ReadonlyArray<{
  name: string
  compareOptions?: CompareOptions
  expected: ReadonlyArray<Row[`id`]>
}> = [
  { name: `default`, expected: expectedOrder },
  {
    name: `lexical strings`,
    compareOptions: { direction: `asc`, nulls: `first`, stringSort: `lexical` },
    expected: expectedOrder,
  },
  {
    name: `locale strings`,
    compareOptions: {
      direction: `asc`,
      nulls: `first`,
      stringSort: `locale`,
      locale: `en`,
    },
    expected: expectedOrder,
  },
  {
    name: `custom string collation`,
    compareOptions: {
      direction: `asc`,
      nulls: `first`,
      stringSort: `custom`,
      compare: (a, b) => b.localeCompare(a),
    },
    expected: expectedOrder,
  },
  {
    name: `descending`,
    compareOptions: { direction: `desc`, nulls: `first` },
    expected: [`late`, `early`],
  },
]

describe(`ZonedDateTime indexed instant order`, () => {
  it(`calibrates the opposing instant and display orders`, () => {
    expect(early!.value.epochNanoseconds < late!.value.epochNanoseconds).toBe(
      true,
    )
    expect(early!.value.toString() > late!.value.toString()).toBe(true)
    expect(
      widthBoundary[0]!.value.toString() > widthBoundary[1]!.value.toString(),
    ).toBe(true)
    expect(highMagnitudeNeighbors[0]!.value.epochNanoseconds + 1n).toBe(
      highMagnitudeNeighbors[1]!.value.epochNanoseconds,
    )
    expect(Number(highMagnitudeNeighbors[0]!.value.epochNanoseconds)).toBe(
      Number(highMagnitudeNeighbors[1]!.value.epochNanoseconds),
    )
    expect(
      highMagnitudeNeighbors[0]!.value.toString() >
        highMagnitudeNeighbors[1]!.value.toString(),
    ).toBe(true)
    expect(
      [...rows]
        .sort((a, b) =>
          a.value.epochNanoseconds < b.value.epochNanoseconds ? -1 : 1,
        )
        .map((row) => row.id),
    ).toEqual(expectedOrder)
    expect([`late`, `early`]).not.toEqual(expectedOrder)
  })

  for (const IndexType of [BasicIndex, BTreeIndex]) {
    it.each([`add`, `build`] as const)(
      `${IndexType.name} %s orders the supplied instants`,
      (mode) => {
        const index = new IndexType<string>(1, new PropRef([`value`]))
        if (mode === `build`) index.build(rows.map((row) => [row.id, row]))
        else for (const row of rows) index.add(row.id, row)
        expect(index.takeFromStart(2)).toEqual(expectedOrder)
        expect(index.take(1, early!.value)).toEqual([`late`])
      },
    )

    // Equal-width 2024 epochs do not expose a key that sorts decimal text.
    // The adjacent 9ns/10ns pair does, with opposing display order too.
    it.each(comparisons)(
      `${IndexType.name} orders instants across an epoch digit-width boundary with $name`,
      ({ compareOptions, expected }) => {
        const index = new IndexType<string>(
          1,
          new PropRef([`value`]),
          undefined,
          { compareOptions },
        )
        for (const row of widthBoundary) index.add(row.id, row)
        expect(index.takeFromStart(2)).toEqual(expected)
      },
    )

    it(`${IndexType.name} orders negative instants across an epoch digit-width boundary`, () => {
      const index = new IndexType<string>(1, new PropRef([`value`]))
      for (const row of negativeWidthBoundary) index.add(row.id, row)
      expect(index.takeFromStart(2)).toEqual(expectedOrder)
    })

    it(`${IndexType.name} preserves adjacent nanoseconds at a large epoch`, () => {
      const index = new IndexType<string>(1, new PropRef([`value`]))
      for (const row of highMagnitudeNeighbors) index.add(row.id, row)
      expect(index.takeFromStart(2)).toEqual([`z-earlier`, `a-later`])
    })

    it(`${IndexType.name} orders equal instants by key while retaining exact membership`, () => {
      const index = new IndexType<string>(1, new PropRef([`value`]))
      for (const row of tiedInstants) index.add(row.id, row)
      expect(index.takeFromStart(2)).toEqual(expectedOrder)
      expect(index.equalityLookup(tiedInstants[0]!.value)).toEqual(
        new Set([`late`]),
      )
      expect(index.equalityLookup(tiedInstants[1]!.value)).toEqual(
        new Set([`early`]),
      )
    })
  }

  for (const [scenario, sourceRows] of [
    [`opposing display text`, rows],
    [`epoch digit width`, widthBoundary],
  ] as const) {
    it.each([`scan`, `BasicIndex`, `BTreeIndex`] as const)(
      `keeps the first public row for ${scenario} with %s`,
      async (path) => {
        const source = createCollection(
          mockSyncCollectionOptions<Row>({
            id: `temporal-index-order-${scenario}-${path}`,
            getKey: (row) => row.id,
            initialData: [...sourceRows],
            autoIndex: `off`,
          }),
        )
        let live: ReturnType<typeof createLiveQueryCollection> | undefined
        try {
          await source.stateWhenReady()
          const index =
            path === `scan`
              ? undefined
              : source.createIndex((row) => row.value, {
                  indexType: path === `BasicIndex` ? BasicIndex : BTreeIndex,
                })
          const take = index && vi.spyOn(index, `takeFromStart`)
          live = createLiveQueryCollection((q) =>
            q
              .from({ row: source })
              .orderBy(({ row }) => row.value)
              .limit(1),
          )
          await live.preload()
          expect([...live.values()].map((row) => row.id)).toEqual([`early`])
          if (take) expect(take).toHaveBeenCalled()
        } finally {
          await live?.cleanup()
          await source.cleanup()
        }
      },
    )
  }

  for (const IndexType of [BasicIndex, BTreeIndex]) {
    for (const [scenario, sourceRows, expectedFirst] of [
      [`epoch digit width`, widthBoundary, `early`],
      [
        `adjacent high-magnitude nanoseconds`,
        highMagnitudeNeighbors,
        `z-earlier`,
      ],
    ] as const) {
      it(`${IndexType.name} selects the earliest on-demand Collection row for ${scenario}`, async () => {
        // A local ordered snapshot reads the index before asking its provider for
        // more rows. The 9ns/10ns pair makes equality-key text order disagree
        // with the public instant order at that synchronous publication cut.
        const source = createCollection<Row>({
          id: `temporal-on-demand-${IndexType.name}-${scenario}`,
          getKey: (row) => row.id,
          syncMode: `on-demand`,
          autoIndex: `off`,
          sync: {
            sync: ({ begin, write, commit, markReady }) => {
              begin()
              for (const row of sourceRows) {
                write({ type: `insert`, value: row })
              }
              commit()
              markReady()
              return { loadSubset: () => true as const, unloadSubset: () => {} }
            },
          },
        })
        let subscription: ReturnType<typeof source.subscribeChanges> | undefined
        try {
          const index = source.createIndex((row) => row.value, {
            indexType: IndexType,
          })
          const take = vi.spyOn(index, `takeFromStart`)
          const published: Array<Array<Row[`id`]>> = []
          subscription = source.subscribeChanges(
            (changes) =>
              published.push(changes.map((change) => change.value.id)),
            { includeInitialState: false },
          )
          subscription.setOrderByIndex(index)
          subscription.requestLimitedSnapshot({
            orderBy: [
              {
                expression: new PropRef([`value`]),
                compareOptions: { direction: `asc`, nulls: `first` },
              },
            ],
            limit: 1,
          })
          expect(take).toHaveBeenCalled()
          expect(published).toEqual([[expectedFirst]])
        } finally {
          subscription?.unsubscribe()
          await source.cleanup()
        }
      })
    }
  }
})

/**
 * # Does an index preserve the public order of day/time Durations?
 *
 * Changelog #1519 makes `orderBy` use Temporal's static compare. The external
 * Temporal implementation supplies this oracle's expected sign: an hour is
 * shorter than 120 minutes, while an hour and 60 minutes tie in order but
 * remain distinct under #1519 query equality. The fixed legal domain below
 * uses day/time fields whose comparison needs no `relativeTo`. Calendar-unit
 * Durations, custom index callbacks, and a public order among tied rows are
 * outside the claim.
 *
 * Direct adds check both index engines after each supplied pair. One on-demand
 * Collection then checks the first published row at requestLimitedSnapshot's
 * synchronous cut. Distinct IDs deliberately reverse key order, so treating
 * unequal Durations as an index tie fails the ordered observation. Exclusive
 * cursors on the equal-order pair must pass neither row, even though exact
 * equality lookups keep their distinct representations separate.
 */
type DurationRow = { id: string; value: Temporal.Duration }
const durationOrderCases = [
  {
    name: `hours and minutes`,
    earlier: Temporal.Duration.from({ hours: 1 }),
    later: Temporal.Duration.from({ minutes: 120 }),
  },
  {
    name: `negative hours and minutes`,
    earlier: Temporal.Duration.from({ hours: -2 }),
    later: Temporal.Duration.from({ minutes: -30 }),
  },
  {
    name: `days and hours`,
    earlier: Temporal.Duration.from({ hours: 23 }),
    later: Temporal.Duration.from({ days: 1 }),
  },
  {
    name: `minutes and seconds`,
    earlier: Temporal.Duration.from({ seconds: 59 }),
    later: Temporal.Duration.from({ minutes: 1 }),
  },
  {
    name: `seconds and milliseconds`,
    earlier: Temporal.Duration.from({ milliseconds: 999 }),
    later: Temporal.Duration.from({ seconds: 1 }),
  },
  {
    name: `milliseconds and microseconds`,
    earlier: Temporal.Duration.from({ microseconds: 999 }),
    later: Temporal.Duration.from({ milliseconds: 1 }),
  },
  {
    name: `microseconds and nanoseconds`,
    earlier: Temporal.Duration.from({ nanoseconds: 999 }),
    later: Temporal.Duration.from({ microseconds: 1 }),
  },
]
const publishedDurationRows: ReadonlyArray<DurationRow> = [
  { id: `z-shorter`, value: Temporal.Duration.from({ hours: 1 }) },
  { id: `a-longer`, value: Temporal.Duration.from({ minutes: 120 }) },
]

describe(`Duration indexed time order`, () => {
  it.each(durationOrderCases)(
    `calibrates the $name order against Temporal`,
    ({ earlier, later }) => {
      expect(Temporal.Duration.compare(earlier, later)).toBeLessThan(0)
    },
  )

  for (const IndexType of [BasicIndex, BTreeIndex]) {
    it.each(durationOrderCases)(
      `${IndexType.name} preserves $name order`,
      ({ earlier, later }) => {
        const index = new IndexType<string>(1, new PropRef([`value`]))
        index.add(`z-earlier`, { value: earlier })
        index.add(`a-later`, { value: later })
        expect(index.takeFromStart(2)).toEqual([`z-earlier`, `a-later`])
      },
    )

    it(`${IndexType.name} retains distinct exact Duration values at an order tie`, () => {
      const hour = Temporal.Duration.from({ hours: 1 })
      const minutes = Temporal.Duration.from({ minutes: 60 })
      expect(Temporal.Duration.compare(hour, minutes)).toBe(0)
      const index = new IndexType<string>(1, new PropRef([`value`]))
      index.add(`z-hour`, { value: hour })
      index.add(`a-minutes`, { value: minutes })
      expect(index.equalityLookup(hour)).toEqual(new Set([`z-hour`]))
      expect(index.equalityLookup(minutes)).toEqual(new Set([`a-minutes`]))
      expect(new Set(index.takeFromStart(2))).toEqual(
        new Set([`z-hour`, `a-minutes`]),
      )
      expect(index.take(2, minutes)).toEqual([])
      expect(index.takeReversed(2, hour)).toEqual([])
    })

    it(`${IndexType.name} publishes the shorter Duration in an on-demand ordered snapshot`, async () => {
      const source = createCollection<DurationRow>({
        id: `duration-on-demand-${IndexType.name}`,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        autoIndex: `off`,
        sync: {
          sync: ({ begin, write, commit, markReady }) => {
            begin()
            for (const row of publishedDurationRows) {
              write({ type: `insert`, value: row })
            }
            commit()
            markReady()
            return { loadSubset: () => true as const, unloadSubset: () => {} }
          },
        },
      })
      let subscription: ReturnType<typeof source.subscribeChanges> | undefined
      try {
        const index = source.createIndex((row) => row.value, {
          indexType: IndexType,
        })
        const take = vi.spyOn(index, `takeFromStart`)
        const published: Array<Array<string>> = []
        subscription = source.subscribeChanges(
          (changes) => published.push(changes.map((change) => change.value.id)),
          { includeInitialState: false },
        )
        subscription.setOrderByIndex(index)
        subscription.requestLimitedSnapshot({
          orderBy: [
            {
              expression: new PropRef([`value`]),
              compareOptions: { direction: `asc`, nulls: `first` },
            },
          ],
          limit: 1,
        })
        expect(take).toHaveBeenCalled()
        expect(published).toEqual([[`z-shorter`]])
      } finally {
        subscription?.unsubscribe()
        await source.cleanup()
      }
    })
  }
})

/**
 * # Does string collation change PlainDate calendar order?
 *
 * Changelog #1519 promises calendar order for PlainDate. With equal month and
 * day, the year decides: -100000 precedes +10000. Their ISO display strings
 * have the opposite lexical order, so sorting normalized text would choose the
 * wrong first row. String collation applies to strings, not Temporal values.
 *
 * A ready two-row source is read through a scan, BasicIndex, or BTreeIndex.
 * The model reads the supplied years, while direct ordered snapshots and
 * live-query preload expose the public first row. Index spies establish the
 * direct indexed reads; preload is a parity check. This fixed history does
 * not claim all extended-year pairs or on-demand publication.
 */
describe(`PlainDate extended-year calendar order`, () => {
  const calendarRows = [
    { id: `negative`, value: Temporal.PlainDate.from(`-100000-01-01`) },
    { id: `positive`, value: Temporal.PlainDate.from(`+010000-01-01`) },
  ]
  const lexicalOrder = {
    direction: `asc` as const,
    nulls: `first` as const,
    stringSort: `lexical` as const,
  }

  it(`calibrates opposing year and display orders`, () => {
    expect(calendarRows[0]!.value.year).toBeLessThan(
      calendarRows[1]!.value.year,
    )
    expect(
      calendarRows[0]!.value.toString() > calendarRows[1]!.value.toString(),
    ).toBe(true)
  })

  it.each([`scan`, `BasicIndex`, `BTreeIndex`] as const)(
    `keeps calendar order with %s`,
    async (path) => {
      const source = createCollection(
        mockSyncCollectionOptions({
          id: `plain-date-extended-year-${path}`,
          getKey: (row: (typeof calendarRows)[number]) => row.id,
          initialData: calendarRows,
          autoIndex: `off`,
        }),
      )
      let live: ReturnType<typeof createLiveQueryCollection> | undefined
      await withOracleCleanup(async () => {
        await source.stateWhenReady()
        const index =
          path === `scan`
            ? undefined
            : source.createIndex((row) => row.value, {
                indexType: path === `BasicIndex` ? BasicIndex : BTreeIndex,
                options: { compareOptions: lexicalOrder },
              })
        const take = index && vi.spyOn(index, `takeFromStart`)
        try {
          const direct = source.currentStateAsChanges({
            orderBy: [
              {
                expression: new PropRef([`value`]),
                compareOptions: lexicalOrder,
              },
            ],
            limit: 1,
          })!
          expect(direct.map((change) => change.value.id)).toEqual([`negative`])
          if (take) expect(take).toHaveBeenCalled()

          live = createLiveQueryCollection((q) =>
            q
              .from({ row: source })
              .orderBy(({ row }) => row.value, lexicalOrder)
              .limit(1),
          )
          await live.preload()
          expect([...live.values()].map((row) => row.id)).toEqual([`negative`])
        } finally {
          take?.mockRestore()
        }
      }, [() => live?.cleanup(), () => source.cleanup()])
    },
  )
})

/**
 * # Can an index hide an undefined public Temporal order?
 *
 * Changelog #1519 requires TanStack DB to reject ordering two different
 * Temporal kinds; PlainMonthDay has no static comparison. The model therefore
 * predicts a TypeError for either two-row ordering, regardless of which row
 * would be first. Index storage may assign a physical position to both values,
 * but that position cannot turn this query into a successful public read.
 *
 * Each fixed history starts a ready source with both rows, optionally creates
 * a BasicIndex or BTreeIndex, then checks the direct ordered snapshot and a
 * live-query preload. These are public observation cuts; the oracle does not
 * claim that a later invalid update leaves a usable Collection or that an
 * on-demand provider has a matching error boundary.
 */
type UnorderedTemporalRow = {
  id: string
  value: Temporal.PlainDate | Temporal.PlainDateTime | Temporal.PlainMonthDay
}
const unorderedTemporalCases: ReadonlyArray<{
  name: string
  rows: Array<UnorderedTemporalRow>
}> = [
  {
    name: `different Temporal kinds`,
    rows: [
      { id: `date`, value: Temporal.PlainDate.from(`2024-01-01`) },
      {
        id: `date-time`,
        value: Temporal.PlainDateTime.from(`2024-01-02T00:00`),
      },
    ],
  },
  {
    name: `PlainMonthDay without an order`,
    rows: [
      { id: `january`, value: Temporal.PlainMonthDay.from(`01-01`) },
      { id: `february`, value: Temporal.PlainMonthDay.from(`02-01`) },
    ],
  },
]

describe(`undefined Temporal public order`, () => {
  it.each(unorderedTemporalCases)(
    `calibrates the $name premise`,
    ({ name, rows: sampleRows }) => {
      if (name === `different Temporal kinds`) {
        expect(Object.prototype.toString.call(sampleRows[0]!.value)).not.toBe(
          Object.prototype.toString.call(sampleRows[1]!.value),
        )
      } else {
        expect(Reflect.get(Temporal.PlainMonthDay, `compare`)).toBeUndefined()
      }
    },
  )

  for (const scenario of unorderedTemporalCases) {
    for (const path of [`scan`, `BasicIndex`, `BTreeIndex`] as const) {
      it(`${path} keeps the ${scenario.name} public error`, async () => {
        const source = createCollection(
          mockSyncCollectionOptions<UnorderedTemporalRow>({
            id: `undefined-temporal-order-${scenario.name}-${path}`,
            getKey: (row) => row.id,
            initialData: scenario.rows,
            autoIndex: `off`,
          }),
        )
        let live: ReturnType<typeof createLiveQueryCollection> | undefined
        await withOracleCleanup(async () => {
          await source.stateWhenReady()
          if (path !== `scan`) {
            source.createIndex((row) => row.value, {
              indexType: path === `BasicIndex` ? BasicIndex : BTreeIndex,
            })
          }
          expect(() =>
            source.currentStateAsChanges({
              orderBy: [
                {
                  expression: new PropRef([`value`]),
                  compareOptions: { direction: `asc`, nulls: `first` },
                },
              ],
              limit: 1,
            }),
          ).toThrow(TypeError)
          live = createLiveQueryCollection((q) =>
            q
              .from({ row: source })
              .orderBy(({ row }) => row.value)
              .limit(1),
          )
          await expect(live.preload()).rejects.toThrow(TypeError)
        }, [() => live?.cleanup(), () => source.cleanup()])
      })
    }
  }
})
