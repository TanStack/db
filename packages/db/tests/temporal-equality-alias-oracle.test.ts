import { describe, expect, it, vi } from 'vitest'
import { Temporal } from 'temporal-polyfill'
import { createCollection } from '../src/collection/index.js'
import { BasicIndex } from '../src/indexes/basic-index.js'
import { BTreeIndex } from '../src/indexes/btree-index.js'
import { Func, PropRef, Value } from '../src/query/ir.js'
import { withOracleCleanup } from './utils.js'

/**
 * A ZonedDateTime's exact query equality follows Temporal's `.equals()`.
 * Changelog #1519 promises that relation for `eq`, distinct from instant
 * order. At one instant, UTC and Etc/UTC are equivalent zone aliases, while
 * the fixed-offset +00:00 zone remains a different identity.
 *
 * This bounded oracle covers ordinary values from one polyfill copy and one
 * instant. The fixture assigns equality classes independently of production
 * normalization. Direct BasicIndex/BTreeIndex add and build histories compare
 * exact key sets after each returned action. Public Collection reads compare
 * an unindexed scan and an optimized-only indexed snapshot after readiness.
 * A forged display tag and an own property shadowing a genuine Temporal zone
 * must not join UTC's class. This oracle does not claim all IANA aliases,
 * mixed implementations, joins, live-query publication, or provider behavior.
 */
type Row = { id: string; when: Temporal.ZonedDateTime }
type Sample = {
  id: string
  text: string
  identity: `utc` | `offset` | `later` | `calendar`
}

const samples: ReadonlyArray<Sample> = [
  {
    id: `utc`,
    text: `2024-01-15T09:00:00+00:00[UTC]`,
    identity: `utc`,
  },
  {
    id: `utc-alias`,
    text: `2024-01-15T09:00:00+00:00[Etc/UTC]`,
    identity: `utc`,
  },
  {
    id: `fixed-offset`,
    text: `2024-01-15T09:00:00+00:00[+00:00]`,
    identity: `offset`,
  },
  {
    id: `one-nanosecond-later`,
    text: `2024-01-15T09:00:00.000000001+00:00[UTC]`,
    identity: `later`,
  },
  {
    id: `gregory-calendar`,
    text: `2024-01-15T09:00:00+00:00[UTC][u-ca=gregory]`,
    identity: `calendar`,
  },
]

function rows(): Array<Row> {
  return samples.map(({ id, text }) => ({
    id,
    when: Temporal.ZonedDateTime.from(text),
  }))
}

function expectedKeys(identity: Sample[`identity`]): Set<string> {
  return new Set(
    samples
      .filter((sample) => sample.identity === identity)
      .map(({ id }) => id),
  )
}

const aliasProbe = Temporal.ZonedDateTime.from(
  `2024-01-15T09:00:00+00:00[Etc/UTC]`,
)
const offsetProbe = Temporal.ZonedDateTime.from(
  `2024-01-15T09:00:00+00:00[+00:00]`,
)

const indexTypes = [
  [`BasicIndex`, BasicIndex],
  [`BTreeIndex`, BTreeIndex],
] as const

it(`distinguishes equivalent aliases from a fixed-offset zone`, () => {
  const [utc, alias, fixed, later, gregory] = rows()
  // This checks the fixture against the external Temporal relation. Expected
  // index and query sets still come from the assigned identity classes.
  expect(utc!.when.equals(alias!.when)).toBe(true)
  expect(utc!.when.equals(fixed!.when)).toBe(false)
  expect(utc!.when.equals(later!.when)).toBe(false)
  expect(utc!.when.equals(gregory!.when)).toBe(false)
  expect(utc!.when.toString()).not.toBe(alias!.when.toString())
  expect(expectedKeys(`utc`)).toEqual(new Set([`utc`, `utc-alias`]))
  expect(expectedKeys(`offset`)).toEqual(new Set([`fixed-offset`]))
})

describe.each(indexTypes)(`%s Temporal alias equality`, (_name, IndexType) => {
  it.each([`add`, `build`] as const)(
    `finds the exact equality class after %s and one removal`,
    (construction) => {
      const source = rows()
      const index = new IndexType(1, new PropRef([`when`]))
      if (construction === `add`) {
        const seenAliasKeys = new Set<string>()
        for (const [position, row] of source.entries()) {
          index.add(row.id, row)
          if (samples[position]!.identity === `utc`) seenAliasKeys.add(row.id)
          expect(index.equalityLookup(aliasProbe)).toEqual(seenAliasKeys)
        }
      } else {
        index.build(source.map((row): [string, Row] => [row.id, row]))
      }

      // The query value is a fresh instance. A display-string key would omit
      // UTC; an instant-only key would also include fixed-offset.
      expect(index.equalityLookup(aliasProbe)).toEqual(expectedKeys(`utc`))
      expect(index.lookup(`eq`, aliasProbe)).toEqual(expectedKeys(`utc`))
      expect(index.inArrayLookup([aliasProbe])).toEqual(expectedKeys(`utc`))
      expect(index.equalityLookup(offsetProbe)).toEqual(expectedKeys(`offset`))

      index.remove(source[0]!.id, source[0]!)
      expect(index.equalityLookup(aliasProbe)).toEqual(new Set([`utc-alias`]))
      expect(index.equalityLookup(offsetProbe)).toEqual(expectedKeys(`offset`))
    },
  )

  it.each([false, true])(
    `returns alias-equal rows in a public snapshot with optimizedOnly=%s`,
    async (optimizedOnly) => {
      const source = rows()
      const collection = createCollection<Row, string>({
        id: `temporal-alias-equality-${_name}`,
        getKey: (row) => row.id,
        autoIndex: `off`,
        startSync: true,
        sync: {
          sync: ({ begin, write, commit, markReady }) => {
            begin()
            for (const row of source) write({ type: `insert`, value: row })
            commit()
            markReady()
          },
        },
      })
      const predicate = new Func(`eq`, [
        new PropRef([`when`]),
        new Value(aliasProbe),
      ])
      const readKeys = () =>
        new Set(
          collection
            .currentStateAsChanges({ where: predicate, optimizedOnly })
            ?.map(({ value }) => value.id),
        )

      await withOracleCleanup(async () => {
        await collection.stateWhenReady()
        expect(collection.indexes.size).toBe(0)
        const lookup = optimizedOnly
          ? vi.spyOn(
              collection.createIndex((row) => row.when, {
                indexType: IndexType,
              }),
              `lookup`,
            )
          : undefined
        const result = readKeys()
        if (lookup) expect(lookup).toHaveBeenCalled()
        expect(result).toEqual(expectedKeys(`utc`))
      }, [() => collection.cleanup()])
    },
  )
})

it(`keeps a forged tag and shadowed zone outside genuine UTC equality`, async () => {
  const fake = {
    [Symbol.toStringTag]: `Temporal.ZonedDateTime`,
    epochNanoseconds: aliasProbe.epochNanoseconds,
    timeZoneId: `UTC`,
    calendarId: `iso8601`,
    toString: () => `unrelated plain object`,
  }
  const shadowed = Temporal.ZonedDateTime.from(
    `2024-01-15T09:00:00+00:00[+00:00]`,
  )
  Object.defineProperty(shadowed, `timeZoneId`, { value: `UTC` })
  expect(aliasProbe.equals(shadowed)).toBe(false)
  expect(() => Reflect.apply(aliasProbe.equals, aliasProbe, [fake])).toThrow()

  const source = [
    { id: `forged`, when: fake },
    { id: `shadowed`, when: shadowed },
  ]
  for (const [, IndexType] of indexTypes) {
    for (const row of source) {
      // One row avoids asking the default ordering comparator to order a
      // forged object and a genuine Temporal value against each other.
      const index = new IndexType(1, new PropRef([`when`]))
      index.add(row.id, row)
      expect(index.equalityLookup(aliasProbe)).toEqual(new Set())
    }
  }

  const collection = createCollection<{ id: string; when: unknown }, string>({
    id: `temporal-alias-spoof-control`,
    getKey: (row) => row.id,
    autoIndex: `off`,
    startSync: true,
    sync: {
      sync: ({ begin, write, commit, markReady }) => {
        begin()
        for (const row of source) write({ type: `insert`, value: row })
        commit()
        markReady()
      },
    },
  })
  await withOracleCleanup(async () => {
    await collection.stateWhenReady()
    const predicate = new Func(`eq`, [
      new PropRef([`when`]),
      new Value(aliasProbe),
    ])
    const keys = new Set(
      collection
        .currentStateAsChanges({ where: predicate })
        ?.map(({ value }) => value.id),
    )
    expect(keys).toEqual(new Set())
  }, [() => collection.cleanup()])
})
