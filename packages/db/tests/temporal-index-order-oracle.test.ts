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
 * evaluator contract in query/compiler/evaluators-oracle.test.ts, and the
 * ordered Collection and IndexInterface contracts in docs/reference.
 *
 * This bounded oracle covers one polyfill copy, two opposing offset zones,
 * one equal-instant pair, a one-nanosecond successor, and negative instants
 * around the epoch. Equal-instant peers may appear in either key order. It
 * checks direct BasicIndex/BTreeIndex adds, builds, and value cursors, one
 * removal/insertion/update continuation, then the public ordered Collection
 * snapshot with limit 1. Direct custom-comparator witnesses preserve the
 * former display-string operands and let the callback order two rows whose
 * values share one query-equality class. They check add/build, exact lookup,
 * range and cursor boundaries, representative removal, and an update that
 * changes callback order without changing query equality. Fixed add/build
 * histories also shadow a genuine value's display tag; the value cursor must
 * still cross its native instant position. These checks do not claim arbitrary
 * Temporal kinds, time-zone transitions, longer histories,
 * public/provider cursor continuation, or live-query publication.
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

// The order contract fixes instant order, but gives no public tie break for
// different zones at the same instant. A prefix may choose any members at its
// boundary, provided it includes every row at an earlier instant.
function expectOrderedPrefix(
  actual: Array<string | number> | undefined,
  count: number,
  samples: ReadonlyArray<Fixture> = fixtures,
): void {
  expect(actual).toHaveLength(count)
  const byId = new Map(samples.map((sample) => [sample.id, sample]))
  const instants = actual!.map((id) => {
    if (typeof id !== `string`)
      throw new Error(`index returned a non-string key`)
    const sample = byId.get(id)
    expect(sample).toBeDefined()
    return sample!.epochNanoseconds
  })
  expect(new Set(actual).size).toBe(count)
  const sortedInstants = samples
    .map(({ epochNanoseconds }) => epochNanoseconds)
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
  const boundary = sortedInstants[count - 1]!
  for (const sample of samples) {
    if (sample.epochNanoseconds < boundary) {
      expect(actual).toContain(sample.id)
    }
  }
  for (let index = 0; index < instants.length; index++) {
    expect(instants[index]! <= boundary).toBe(true)
    if (index > 0) expect(instants[index - 1]! <= instants[index]!).toBe(true)
  }
}

const indexTypes = [
  [`BasicIndex`, BasicIndex],
  [`BTreeIndex`, BTreeIndex],
] as const

it(`accepts either equal-instant boundary row but rejects a later instant`, () => {
  // A lexical index chose d-minus-five at the first-row checkpoint. The
  // checker must reject that result while allowing either earliest zone.
  expect(() => expectOrderedPrefix([`b-plus-fourteen`], 1)).not.toThrow()
  expect(() => expectOrderedPrefix([`c-utc`], 1)).not.toThrow()
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
        // before the equal-instant first group, without imposing a tie break.
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

    it.each([`add`, `build`] as const)(
      `keeps instant order when a genuine value shadows its display tag after %s`,
      (construction) => {
        const rows = rowsFromFixtures().slice(0, 3)
        Object.defineProperty(rows[0]!.when, Symbol.toStringTag, {
          value: `ordinary`,
        })
        const index = new IndexType(1, new PropRef([`when`]))
        if (construction === `add`) {
          for (const row of rows) index.add(row.id, row)
        } else {
          index.build(rows.map((row): [string, Row] => [row.id, row]))
        }

        // The source fixture supplies the instant labels. An instance display
        // property cannot move its row out of the shared earliest position.
        expectOrderedPrefix(index.takeFromStart(3), 3, fixtures.slice(0, 3))
        expectOrderedPrefix(index.takeFromStart(1), 1, fixtures.slice(0, 3))
        expect(index.take(1, rows[0]!.when)).toEqual([`a-one-nanosecond-later`])
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

    it(`publishes the earliest instant from an indexed ordered Collection snapshot`, async () => {
      const rows = rowsFromFixtures()
      const collection = createCollection<Row, string>({
        id: `temporal-index-order-${_name}`,
        getKey: (row) => row.id,
        autoIndex: `off`,
        startSync: true,
        sync: {
          sync: ({ begin, write, commit, markReady }) => {
            begin()
            for (const row of rows) write({ type: `insert`, value: row })
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
        expectOrderedPrefix(readFirst(false), 1)

        const index = collection.createIndex((row) => row.when, {
          indexType: IndexType,
        })
        const take = vi.spyOn(index, `takeFromStart`)
        // optimizedOnly forbids a scan fallback; the spy shows that the intended
        // index path supplied this public snapshot after the build.
        const indexed = readFirst(true)
        expect(take).toHaveBeenCalled()
        expectOrderedPrefix(indexed, 1)
      }, [() => collection.cleanup()])
    })
  },
)
