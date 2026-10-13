import { describe, expect, it, vi } from 'vitest'
import { Temporal } from 'temporal-polyfill'
import { createCollection } from '../src/collection/index.js'
import { BasicIndex } from '../src/indexes/basic-index.js'
import { BTreeIndex } from '../src/indexes/btree-index.js'
import { PropRef } from '../src/query/ir.js'
import { orderedEntriesArray, withOracleCleanup } from './utils.js'

/**
 * A ZonedDateTime's ordered position is its instant. Two zones at the same
 * instant share an ordered position but remain distinct equality values.
 * Authority: Temporal.ZonedDateTime.compare/equals, the established WHERE
 * evaluator contract in query/compiler/evaluators-oracle.test.ts, the
 * ordered Collection contract, and the established direct key-tie rule in
 * deterministic-ordering.test.ts. IndexInterface names the direct methods.
 *
 * This bounded oracle covers one polyfill copy, two opposing offset zones,
 * one equal-instant pair, a one-nanosecond successor, and negative instants
 * around the epoch. Direct indexes and public Collection snapshots order
 * equal-instant peers by source key, including at a limit boundary. It
 * checks direct BasicIndex/BTreeIndex adds, builds, and value cursors, one
 * removal/insertion/update continuation, then the public ordered Collection
 * snapshot with limit 1. Direct custom-comparator witnesses preserve the
 * former display-string operands and let the callback order two rows whose
 * values share one query-equality class. An opposite callback distinguishes
 * callback-result order from plain display-text order. They check add/build,
 * exact lookup, range and cursor boundaries, representative removal, and
 * updates that change callback order without changing query equality. These
 * checks do not claim arbitrary
 * Temporal kinds, time-zone transitions, longer histories,
 * public/provider cursor continuation, or live-query publication.
 * The separate admission lane below protects default equality indexes for
 * genuine Temporal values that lack a public order. It does not assign those
 * values a public `orderBy` result: changelog #1519 requires `orderBy` to
 * reject PlainMonthDay and mixed Temporal kinds. Its admission and exact
 * membership authority is the public createIndex contract and #1519's
 * unchanged Temporal `eq` relation; #1370 established Temporal index keys.
 */

type Row = { id: string; when: Temporal.ZonedDateTime }
type Fixture = Readonly<{
  id: string
  text: string
  epochNanoseconds: bigint
  equalityClass: string
}>

// The supplied epoch nanoseconds are the model's order labels. Neither the
// index's normalization nor its comparator computes an expected position.
// The first and second rows have the same instant in different zones; the
// third is only one nanosecond later. The fourth has later instant but earlier
// local clock text than the first, so textual index order is observably wrong.
const fixtures: ReadonlyArray<Fixture> = [
  {
    id: `b-plus-fourteen`,
    text: `2024-01-15T23:00:00+14:00[+14:00]`,
    epochNanoseconds: 1_705_309_200_000_000_000n,
    equalityClass: `plus-fourteen`,
  },
  {
    id: `c-utc`,
    text: `2024-01-15T09:00:00+00:00[+00:00]`,
    epochNanoseconds: 1_705_309_200_000_000_000n,
    equalityClass: `utc`,
  },
  {
    id: `a-one-nanosecond-later`,
    text: `2024-01-15T09:00:00.000000001+00:00[+00:00]`,
    epochNanoseconds: 1_705_309_200_000_000_001n,
    equalityClass: `one-nanosecond-later`,
  },
  {
    id: `d-minus-five`,
    text: `2024-01-15T05:00:00-05:00[-05:00]`,
    epochNanoseconds: 1_705_312_800_000_000_000n,
    equalityClass: `minus-five`,
  },
]

// Textual sorting of signed decimal epoch values puts -10 before -100. These
// pre-epoch neighbors reject that tempting numeric-string repair, even though
// their ZonedDateTime display strings happen to be in chronological order.
const negativeFixtures: ReadonlyArray<Fixture> = [
  {
    id: `a-minus-ten`,
    text: `1969-12-31T23:59:59.999999990+00:00[+00:00]`,
    epochNanoseconds: -10n,
    equalityClass: `minus-ten`,
  },
  {
    id: `b-minus-hundred`,
    text: `1969-12-31T23:59:59.999999900+00:00[+00:00]`,
    epochNanoseconds: -100n,
    equalityClass: `minus-hundred`,
  },
  {
    id: `c-zero`,
    text: `1970-01-01T00:00:00+00:00[+00:00]`,
    epochNanoseconds: 0n,
    equalityClass: `zero`,
  },
]

function rowsFromFixtures(
  samples: ReadonlyArray<Fixture> = fixtures,
): Array<Row> {
  return samples.map(({ id, text, epochNanoseconds }) => {
    const when = Temporal.ZonedDateTime.from(text)
    // This checks fixture construction, not the production comparison rule.
    expect(when.epochNanoseconds).toBe(epochNanoseconds)
    return { id, when }
  })
}

// The model sorts supplied instant labels, then source keys at a tied instant.
// It has no access to index normalization or production comparison. An exact
// prefix comparison detects omissions, duplicates, order, and a wrong limit tie.
function expectOrderedPrefix(
  actual: Array<string | number> | undefined,
  count: number,
  samples: ReadonlyArray<Fixture> = fixtures,
): void {
  const expected = [...samples]
    .sort((left, right) =>
      left.epochNanoseconds < right.epochNanoseconds
        ? -1
        : left.epochNanoseconds > right.epochNanoseconds
          ? 1
          : left.id < right.id
            ? -1
            : left.id > right.id
              ? 1
              : 0,
    )
    .slice(0, count)
    .map(({ id }) => id)
  expect(actual).toEqual(expected)
}

const indexTypes = [
  [`BasicIndex`, BasicIndex],
  [`BTreeIndex`, BTreeIndex],
] as const

it(`rejects a later instant and the wrong equal-instant boundary key`, () => {
  // A lexical index chose d-minus-five at the first-row checkpoint. A tie
  // resolved by admission order can choose c-utc. Both violate the model.
  expect(() => expectOrderedPrefix([`b-plus-fourteen`], 1)).not.toThrow()
  expect(() => expectOrderedPrefix([`c-utc`], 1)).toThrow()
  expect(() => expectOrderedPrefix([`d-minus-five`], 1)).toThrow()
})

describe.each(indexTypes)(
  `%s ZonedDateTime indexed order`,
  (_name, IndexType) => {
    it.each([`add`, `build`] as const)(
      `refines instant order and zone-sensitive equality after %s`,
      (construction) => {
        const rows = rowsFromFixtures()
        const index = new IndexType(1, new PropRef([`when`]))

        // The legal direct history either adds each unique source key or builds
        // once from that same source snapshot. No source key changes afterward.
        if (construction === `add`) {
          for (const row of rows) index.add(row.id, row)
        } else {
          index.build(rows.map((row): [string, Row] => [row.id, row]))
        }

        // Exact lookup and ordered position are distinct observations. An
        // epoch-only key would incorrectly merge the two equal-instant zones.
        for (const row of rows) {
          const fixture = fixtures.find(({ id }) => id === row.id)!
          const expected = new Set(
            fixtures
              .filter(
                ({ equalityClass }) => equalityClass === fixture.equalityClass,
              )
              .map(({ id }) => id),
          )
          const equalButDistinct = Temporal.ZonedDateTime.from(
            row.when.toString(),
          )
          expect(equalButDistinct).not.toBe(row.when)
          expect(index.equalityLookup(equalButDistinct)).toEqual(expected)
        }
        expect(rows[0]!.when.epochNanoseconds).toBe(
          rows[1]!.when.epochNanoseconds,
        )
        expect(index.equalityLookup(rows[1]!.when).has(rows[0]!.id)).toBe(false)

        // Returned key arrays preserve instant order and multiplicity at the
        // direct IndexInterface checkpoint. Limit 1 detects a later instant
        // or the wrong source-key tie inside the equal-instant first group.
        expectOrderedPrefix(index.takeFromStart(rows.length), rows.length)
        expectOrderedPrefix(index.takeFromStart(1), 1)
        // A cursor at the shared instant must skip both zones, while retaining
        // the one-nanosecond successor. An ordered key with a zone suffix would
        // incorrectly leave one equal-instant row beyond this cursor.
        expect(index.take(2, rows[0]!.when)).toEqual([
          `a-one-nanosecond-later`,
          `d-minus-five`,
        ])
      },
    )

    it.each([`add`, `build`] as const)(
      `orders equal-instant source keys after reverse %s admission`,
      (construction) => {
        // The instant model ties these two rows; the direct IndexInterface
        // contract orders keys inside a comparator group. Reverse admission
        // distinguishes that law from insertion-order traversal.
        const [plusFourteen, utc] = rowsFromFixtures()
        const reversed = [utc!, plusFourteen!]
        const index = new IndexType(1, new PropRef([`when`]))
        if (construction === `add`) {
          for (const row of reversed) index.add(row.id, row)
        } else {
          index.build(reversed.map((row): [string, Row] => [row.id, row]))
        }
        expect(index.takeFromStart(2)).toEqual([`b-plus-fourteen`, `c-utc`])
      },
    )

    it(`retains an equal-instant peer through removal, insertion, and zone update`, () => {
      const [plusFourteen, utc, nanosecondLater] = rowsFromFixtures()
      const index = new IndexType(1, new PropRef([`when`]))
      for (const row of [plusFourteen!, utc!, nanosecondLater!]) {
        index.add(row.id, row)
      }

      // A source removal changes membership but leaves the peer at the same
      // instant. The peer becomes the ordered representative of that position.
      index.remove(plusFourteen!.id, plusFourteen)
      expect(index.takeFromStart(3)).toEqual([
        `c-utc`,
        `a-one-nanosecond-later`,
      ])
      expect(index.equalityLookup(plusFourteen!.when)).toEqual(new Set())
      expect(index.equalityLookup(utc!.when)).toEqual(new Set([`c-utc`]))

      // The ordered group must keep a live representative after removal.
      // The live-query architecture requires this for stable traversal.
      expect(orderedEntriesArray(index)[0]?.[0]).toBe(utc!.when)

      const inserted: Fixture = {
        id: `one-nanosecond-earlier`,
        text: `2024-01-15T08:59:59.999999999+00:00[+00:00]`,
        epochNanoseconds: fixtures[1]!.epochNanoseconds - 1n,
        equalityClass: `one-nanosecond-earlier`,
      }
      const [earlier] = rowsFromFixtures([inserted])
      index.add(earlier!.id, earlier)
      expectOrderedPrefix(index.takeFromStart(3), 3, [
        inserted,
        fixtures[1]!,
        fixtures[2]!,
      ])
      expect(index.take(2, earlier!.when)).toEqual([
        `c-utc`,
        `a-one-nanosecond-later`,
      ])

      // Updating that peer to another zone at the same supplied instant moves
      // its exact lookup bucket without changing its ordered position.
      const moved = {
        id: utc!.id,
        when: Temporal.ZonedDateTime.from(`2024-01-15T04:00:00-05:00[-05:00]`),
      }
      expect(moved.when.epochNanoseconds).toBe(fixtures[1]!.epochNanoseconds)
      index.update(utc!.id, utc, moved)
      expect(index.equalityLookup(utc!.when)).toEqual(new Set())
      expect(index.equalityLookup(moved.when)).toEqual(new Set([`c-utc`]))
      expectOrderedPrefix(index.takeFromStart(3), 3, [
        inserted,
        fixtures[1]!,
        fixtures[2]!,
      ])
      expect(index.take(2, utc!.when)).toEqual([`a-one-nanosecond-later`])
    })

    it.each([`add`, `build`] as const)(
      `orders negative nanosecond instants after %s`,
      (construction) => {
        const rows = rowsFromFixtures(negativeFixtures)
        const index = new IndexType(1, new PropRef([`when`]))
        if (construction === `add`) {
          for (const row of rows) index.add(row.id, row)
        } else {
          index.build(rows.map((row): [string, Row] => [row.id, row]))
        }
        // The model sorts supplied signed BigInts, not their decimal strings.
        expectOrderedPrefix(
          index.takeFromStart(rows.length),
          rows.length,
          negativeFixtures,
        )
      },
    )

    it(`retains a string-compatible custom comparator across negative instants`, () => {
      const [minusTen, minusHundred] = rowsFromFixtures(negativeFixtures)
      const index = new IndexType(1, new PropRef([`when`]), undefined, {
        compareFn: (left: string, right: string) => left.localeCompare(right),
      })

      // This legal callback ordered normalized strings before the Temporal
      // index repair. Negative decimal strings distinguish the former display
      // operands from the new exact-equality tuple.
      index.add(minusTen!.id, minusTen)
      index.add(minusHundred!.id, minusHundred)
      expect(index.takeFromStart(2)).toEqual([`b-minus-hundred`, `a-minus-ten`])
      expect(index.equalityLookup(minusHundred!.when)).toEqual(
        new Set([`b-minus-hundred`]),
      )
    })

    it.each([`add`, `build`] as const)(
      `orders equal UTC aliases by a custom callback after %s`,
      (construction) => {
        const source = [
          {
            id: `a-utc`,
            when: Temporal.ZonedDateTime.from(`2024-01-15T09:00:00+00:00[UTC]`),
          },
          {
            id: `z-alias`,
            when: Temporal.ZonedDateTime.from(
              `2024-01-15T09:00:00+00:00[Etc/UTC]`,
            ),
          },
        ]
        const [utc, alias] = source
        expect(utc!.when.equals(alias!.when)).toBe(true)
        const callbackArguments: Array<[string, string]> = []
        const index = new IndexType(1, new PropRef([`when`]), undefined, {
          compareFn: (left: string, right: string) => {
            callbackArguments.push([left, right])
            return left.localeCompare(right)
          },
        })

        // The exact-equality class has both keys. The callback's legacy
        // display keys place Etc/UTC before UTC, despite the opposite key order.
        if (construction === `add`) {
          for (const row of source) index.add(row.id, row)
        } else {
          index.build(source.map((row): [string, Row] => [row.id, row]))
        }
        expect(index.equalityLookup(utc!.when)).toEqual(
          new Set([`a-utc`, `z-alias`]),
        )
        expect(index.takeFromStart(2)).toEqual([`z-alias`, `a-utc`])
        expect(index.rangeQuery({ to: alias!.when })).toEqual(
          new Set([`z-alias`]),
        )
        expect(
          index.rangeQuery({ from: alias!.when, fromInclusive: false }),
        ).toEqual(new Set([`a-utc`]))
        expect(index.take(2, alias!.when)).toEqual([`a-utc`])
        expect(index.takeReversed(2, utc!.when)).toEqual([`z-alias`])
        expect(callbackArguments.length).toBeGreaterThan(0)
        const expectedOperands = new Set(
          source.map(
            ({ when }) =>
              `\u0000tanstack-db:temporal:Temporal.ZonedDateTime:${when.toString()}`,
          ),
        )
        for (const [left, right] of callbackArguments) {
          expect(expectedOperands.has(left)).toBe(true)
          expect(expectedOperands.has(right)).toBe(true)
        }

        // Removal supplies the exact prior source row. The first stored
        // representative must be replaced by a surviving row's value.
        index.remove(utc!.id, utc)
        expect(index.takeFromStart(2)).toEqual([`z-alias`])
        expect(orderedEntriesArray(index)[0]?.[0]).toBe(alias!.when)
        expect(index.equalityLookup(alias!.when)).toEqual(new Set([`z-alias`]))
      },
    )

    it.each([`add`, `build`] as const)(
      `follows an opposite callback for equal UTC aliases after %s and update`,
      (construction) => {
        const source = [
          {
            id: `z-utc`,
            when: Temporal.ZonedDateTime.from(`2024-01-15T09:00:00+00:00[UTC]`),
          },
          {
            id: `a-alias`,
            when: Temporal.ZonedDateTime.from(
              `2024-01-15T09:00:00+00:00[Etc/UTC]`,
            ),
          },
        ]
        const [utc, alias] = source
        expect(utc!.when.equals(alias!.when)).toBe(true)
        expect(
          alias!.when.toString().localeCompare(utc!.when.toString()),
        ).toBeLessThan(0)
        const index = new IndexType(1, new PropRef([`when`]), undefined, {
          compareFn: (left: string, right: string) => right.localeCompare(left),
        })
        // The callback puts UTC first. Both display-text order and source-key
        // order put the alias first, so either shortcut fails this observation.
        if (construction === `add`) {
          for (const row of source) index.add(row.id, row)
        } else {
          index.build(source.map((row): [string, Row] => [row.id, row]))
        }
        expect(index.equalityLookup(utc!.when)).toEqual(
          new Set([`z-utc`, `a-alias`]),
        )
        expect(index.takeFromStart(2)).toEqual([`z-utc`, `a-alias`])
        expect(index.rangeQuery({ to: utc!.when })).toEqual(new Set([`z-utc`]))
        expect(index.take(1, utc!.when)).toEqual([`a-alias`])

        // Updating Etc/UTC to UTC preserves query equality but makes the
        // callback operands identical. Both rows must now occupy the same
        // callback position and use the source-key tie rule. An index that
        // retains the old per-row position would leak a stale row through a
        // bound or cursor at UTC.
        const moved = {
          id: alias!.id,
          when: Temporal.ZonedDateTime.from(utc!.when.toString()),
        }
        expect(moved.when.equals(alias!.when)).toBe(true)
        index.update(alias!.id, alias, moved)
        expect(index.equalityLookup(utc!.when)).toEqual(
          new Set([`z-utc`, `a-alias`]),
        )
        expect(index.takeFromStart(2)).toEqual([`a-alias`, `z-utc`])
        expect(index.rangeQuery({ to: utc!.when, toInclusive: true })).toEqual(
          new Set([`a-alias`, `z-utc`]),
        )
        expect(
          index.rangeQuery({ from: utc!.when, fromInclusive: true }),
        ).toEqual(new Set([`a-alias`, `z-utc`]))
        expect(index.take(2, utc!.when)).toEqual([])
        expect(index.takeReversed(2, utc!.when)).toEqual([])
      },
    )

    it(`reorders equal UTC aliases by the callback after a same-class update`, () => {
      const alias = Temporal.ZonedDateTime.from(
        `2024-01-15T09:00:00+00:00[Etc/UTC]`,
      )
      const utc = Temporal.ZonedDateTime.from(`2024-01-15T09:00:00+00:00[UTC]`)
      expect(alias.equals(utc)).toBe(true)
      expect(alias.toString().localeCompare(utc.toString())).toBeLessThan(0)
      const first = { id: `z-utc`, when: alias }
      const second = {
        id: `a-alias`,
        when: Temporal.ZonedDateTime.from(alias.toString()),
      }
      const index = new IndexType(1, new PropRef([`when`]), undefined, {
        compareFn: (left: string, right: string) => right.localeCompare(left),
      })

      // The initial callback operands are identical, so source keys order
      // the two rows. The update changes one callback operand to UTC while
      // keeping its query-equality class. Reverse locale order then puts
      // z-utc first even though display text and source keys put a-alias first.
      index.add(first.id, first)
      index.add(second.id, second)
      expect(index.takeFromStart(2)).toEqual([`a-alias`, `z-utc`])
      const moved = { id: first.id, when: utc }
      index.update(first.id, first, moved)
      expect(index.equalityLookup(utc)).toEqual(new Set([`z-utc`, `a-alias`]))
      expect(index.takeFromStart(2)).toEqual([`z-utc`, `a-alias`])
      expect(index.rangeQuery({ to: utc, toInclusive: true })).toEqual(
        new Set([`z-utc`]),
      )
      expect(index.take(2, utc)).toEqual([`a-alias`])
    })

    it(`moves one row within its exact class when its custom order changes`, () => {
      const utc = {
        id: `a-utc`,
        when: Temporal.ZonedDateTime.from(`2024-01-15T09:00:00+00:00[UTC]`),
      }
      const alias = {
        id: `z-alias`,
        when: Temporal.ZonedDateTime.from(`2024-01-15T09:00:00+00:00[Etc/UTC]`),
      }
      const index = new IndexType(1, new PropRef([`when`]), undefined, {
        compareFn: (left: string, right: string) => left.localeCompare(right),
      })
      index.add(utc.id, utc)
      index.add(alias.id, alias)
      expect(index.takeFromStart(2)).toEqual([`z-alias`, `a-utc`])

      // The query equality class stays fixed, while the callback position
      // changes from the later UTC display string to the earlier alias text.
      const moved = { id: utc.id, when: alias.when }
      index.update(utc.id, utc, moved)
      expect(index.equalityLookup(alias.when)).toEqual(
        new Set([`a-utc`, `z-alias`]),
      )
      expect(index.takeFromStart(2)).toEqual([`a-utc`, `z-alias`])
      expect(index.take(2, alias.when)).toEqual([])
    })

    it(`publishes the source-key first equal-instant row from an ordered Collection snapshot`, async () => {
      const rows = rowsFromFixtures()
      // Admit the UTC peer before the smaller-key +14:00 peer. Changelog #958
      // establishes key order for comparator ties; this reversal distinguishes
      // that public limit-one result from admission order on both read paths.
      const admission = [rows[1]!, rows[0]!, ...rows.slice(2)]
      const collection = createCollection<Row, string>({
        id: `temporal-index-order-${_name}`,
        getKey: (row) => row.id,
        autoIndex: `off`,
        startSync: true,
        sync: {
          sync: ({ begin, write, commit, markReady }) => {
            begin()
            for (const row of admission) write({ type: `insert`, value: row })
            commit()
            markReady()
          },
        },
      })

      const orderBy = [
        {
          expression: new PropRef([`when`]),
          compareOptions: {
            direction: `asc` as const,
            nulls: `first` as const,
          },
        },
      ]
      const readFirst = (optimizedOnly: boolean) =>
        collection
          .currentStateAsChanges({ orderBy, limit: 1, optimizedOnly })
          ?.map(({ value }) => value.id)

      await withOracleCleanup(async () => {
        await collection.stateWhenReady()
        expect(collection.indexes.size).toBe(0)
        // The unindexed public scan checks the same ordering law through a
        // separate production path before index creation.
        expect(readFirst(false)).toEqual([`b-plus-fourteen`])

        const index = collection.createIndex((row) => row.when, {
          indexType: IndexType,
        })
        const take = vi.spyOn(index, `takeFromStart`)
        // optimizedOnly forbids a scan fallback; the spy shows that the intended
        // index path supplied this public snapshot after the build.
        const indexed = readFirst(true)
        expect(take).toHaveBeenCalled()
        expect(indexed).toEqual([`b-plus-fourteen`])
      }, [() => collection.cleanup()])
    })
  },
)

type AdmissionRow = { id: string; when: unknown; equalityClass: string }
type AdmissionProbe = { when: unknown; equalityClass: string }

// These are valid values from one Temporal implementation. The model's class
// labels come from constructor fields and the native equality distinction,
// independent of index normalization or the index's internal sort order.
const admissionFixtures = [
  {
    name: `Duration with calendar units`,
    orderErrorType: RangeError,
    orderErrorMessage: `Missing relativeTo`,
    rows: [
      {
        id: `a`,
        when: Temporal.Duration.from({ months: 1 }),
        equalityClass: `one-month`,
      },
      {
        id: `b`,
        when: Temporal.Duration.from({ months: 2 }),
        equalityClass: `two-months`,
      },
      {
        id: `c`,
        when: Temporal.Duration.from({ hours: 1 }),
        equalityClass: `one-hour`,
      },
    ],
    probes: [
      {
        when: Temporal.Duration.from({ months: 1 }),
        equalityClass: `one-month`,
      },
      {
        when: Temporal.Duration.from({ months: 2 }),
        equalityClass: `two-months`,
      },
      { when: Temporal.Duration.from({ hours: 1 }), equalityClass: `one-hour` },
    ],
  },
  {
    name: `PlainMonthDay with distinct reference years`,
    orderErrorType: TypeError,
    orderErrorMessage: `Temporal.PlainMonthDay has no defined ordering`,
    rows: [
      {
        id: `a`,
        when: new Temporal.PlainMonthDay(2, 29, `iso8601`, 1972),
        equalityClass: `1972`,
      },
      {
        id: `b`,
        when: new Temporal.PlainMonthDay(2, 29, `iso8601`, 2004),
        equalityClass: `2004`,
      },
      {
        id: `c`,
        when: new Temporal.PlainMonthDay(3, 1, `iso8601`, 1972),
        equalityClass: `march`,
      },
    ],
    probes: [
      {
        when: new Temporal.PlainMonthDay(2, 29, `iso8601`, 1972),
        equalityClass: `1972`,
      },
      {
        when: new Temporal.PlainMonthDay(2, 29, `iso8601`, 2004),
        equalityClass: `2004`,
      },
      {
        when: new Temporal.PlainMonthDay(3, 1, `iso8601`, 1972),
        equalityClass: `march`,
      },
    ],
  },
  {
    name: `mixed Temporal kinds`,
    orderErrorType: TypeError,
    orderErrorMessage: `Cannot order Temporal values of different types`,
    rows: [
      {
        id: `a`,
        when: Temporal.Instant.from(`2024-01-01T00:00:00Z`),
        equalityClass: `instant-one`,
      },
      {
        id: `b`,
        when: Temporal.PlainDate.from(`2024-01-02`),
        equalityClass: `date`,
      },
      {
        id: `c`,
        when: Temporal.Instant.from(`2024-01-03T00:00:00Z`),
        equalityClass: `instant-two`,
      },
    ],
    probes: [
      {
        when: Temporal.Instant.from(`2024-01-01T00:00:00Z`),
        equalityClass: `instant-one`,
      },
      { when: Temporal.PlainDate.from(`2024-01-02`), equalityClass: `date` },
      {
        when: Temporal.Instant.from(`2024-01-03T00:00:00Z`),
        equalityClass: `instant-two`,
      },
    ],
  },
] satisfies Array<{
  name: string
  orderErrorType: typeof Error
  orderErrorMessage: string
  rows: Array<AdmissionRow>
  probes: Array<AdmissionProbe>
}>

describe.each(indexTypes)(`%s valid Temporal admission`, (_name, IndexType) => {
  it.each(admissionFixtures)(
    `retains exact membership across add/build order for $name`,
    ({ rows, probes }) => {
      const expectedKeys = new Set(rows.map(({ id }) => id))
      // Admission order is not a public order contract for these values.
      // Every construction must retain every key in its internal traversal.
      for (const construction of [`forward`, `reverse`, `build`] as const) {
        const index = new IndexType(1, new PropRef([`when`]))
        const admission =
          construction === `reverse` ? [...rows].reverse() : rows
        if (construction === `build`) {
          index.build(
            admission.map((row): [string, AdmissionRow] => [row.id, row]),
          )
        } else {
          for (const row of admission) index.add(row.id, row)
        }
        for (const row of rows) {
          expect(index.equalityLookup(row.when)).toEqual(new Set([row.id]))
        }
        for (const probe of probes) {
          const matchingKeys = rows
            .filter((row) => row.equalityClass === probe.equalityClass)
            .map((row) => row.id)
          expect(index.equalityLookup(probe.when)).toEqual(
            new Set(matchingKeys),
          )
        }
        const ordered = index.takeFromStart(rows.length)
        expect(ordered).toHaveLength(rows.length)
        expect(new Set(ordered).size).toBe(ordered.length)
        expect(new Set(ordered)).toEqual(expectedKeys)
      }
    },
  )

  it.each(admissionFixtures)(
    `publishes each valid $name row with its exact index membership`,
    async ({ rows, orderErrorType, orderErrorMessage }) => {
      let commitRow!: (row: AdmissionRow) => void
      const collection = createCollection<AdmissionRow, string>({
        id: `temporal-admission-${_name}-${rows[0]!.equalityClass}`,
        getKey: (row) => row.id,
        autoIndex: `off`,
        startSync: true,
        sync: {
          sync: ({ begin, write, commit, markReady }) => {
            commitRow = (row) => {
              begin()
              write({ type: `insert`, value: row })
              commit()
            }
            markReady()
          },
        },
      })

      await withOracleCleanup(async () => {
        await collection.stateWhenReady()
        const index = collection.createIndex((row) => row.when, {
          indexType: IndexType,
        })
        const observed: Array<{
          key: string
          stored: boolean
          exact: Array<string | number>
        }> = []
        const subscription = collection.subscribeChanges(
          (changes) => {
            for (const change of changes) {
              observed.push({
                key: change.key,
                stored: collection.get(change.key)?.id === change.key,
                exact: [...index.equalityLookup(change.value.when)],
              })
            }
          },
          { includeInitialState: false },
        )
        try {
          // Each synchronous commit is a public checkpoint. The second valid
          // value must neither crash the Collection nor leave a stored row
          // invisible to the index and subscriber.
          commitRow(rows[0]!)
          commitRow(rows[1]!)
          expect(collection.status).toBe(`ready`)
          expect([...collection.keys()]).toEqual([`a`, `b`])
          expect(observed).toEqual([
            { key: `a`, stored: true, exact: [`a`] },
            { key: `b`, stored: true, exact: [`b`] },
          ])
          // An equality index must not turn its private storage order into a
          // public orderBy result. Changelog #1519 delegates to Temporal's
          // static comparison, which rejects these pairs without relativeTo
          // or a common ordered kind. Limit 1 catches an index that returns
          // before comparing the second row.
          let orderFailure: unknown
          try {
            collection.currentStateAsChanges({
              orderBy: [
                {
                  expression: new PropRef([`when`]),
                  compareOptions: { direction: `asc`, nulls: `first` },
                },
              ],
              limit: 1,
            })
          } catch (error) {
            orderFailure = error
          }
          expect(orderFailure).toBeInstanceOf(orderErrorType)
          expect((orderFailure as Error).message).toContain(orderErrorMessage)
        } finally {
          subscription.unsubscribe()
        }
      }, [() => collection.cleanup()])
    },
  )
})
