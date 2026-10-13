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
 * The ZonedDateTime lane covers ordinary values from one polyfill copy and one
 * instant. A neighboring PlainDate lane checks that native brand and equality
 * survive own display shadows while forged tags retain ordinary object
 * identity. Fixture-assigned classes, not production normalization, predict
 * exact key sets. Direct BasicIndex/BTreeIndex add, build, and removal
 * histories compare those sets after each returned action. Public Collection
 * reads compare an unindexed scan and an optimized-only indexed snapshot after
 * readiness. The mixed forged/genuine PlainDate Collection has no index:
 * default range order across an ordinary object and Temporal is unspecified.
 * This oracle does not claim all IANA aliases, arbitrary spoofed prototypes,
 * mixed Temporal implementations, joins, live-query publication, or provider
 * behavior.
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
      // The neighboring instant and calendar classes ensure that a repair
      // does not collapse every Temporal value sharing a named zone.
      expect(index.equalityLookup(source[3]!.when)).toEqual(
        expectedKeys(`later`),
      )
      expect(index.equalityLookup(source[4]!.when)).toEqual(
        expectedKeys(`calendar`),
      )

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

it(`uses the PlainDate brand for direct lookups and a public unindexed snapshot`, async () => {
  const genuine = Temporal.PlainDate.from(`2024-01-01`)
  const fake = {
    [Symbol.toStringTag]: `Temporal.PlainDate`,
    toString: () => `2024-01-01`,
  }
  const borrowed = Object.assign(
    Object.create(Temporal.PlainDate.prototype) as object,
    { toString: () => `2024-01-01` },
  )
  const shadowedTag = Temporal.PlainDate.from(`2024-01-01`)
  Object.defineProperty(shadowedTag, Symbol.toStringTag, {
    value: `ordinary`,
  })
  const shadowedText = Temporal.PlainDate.from(`2024-01-01`)
  Object.defineProperty(shadowedText, `toString`, {
    value: () => `unrelated text`,
  })
  expect(Temporal.PlainDate.prototype.equals.call(shadowedTag, genuine)).toBe(
    true,
  )
  expect(Temporal.PlainDate.prototype.equals.call(shadowedText, genuine)).toBe(
    true,
  )

  const brandSamples: ReadonlyArray<{
    id: string
    when: unknown
    matches: boolean
  }> = [
    { id: `genuine`, when: genuine, matches: true },
    { id: `forged-tag`, when: fake, matches: false },
    { id: `borrowed-prototype`, when: borrowed, matches: false },
    { id: `shadowed-tag`, when: shadowedTag, matches: true },
    { id: `shadowed-text`, when: shadowedText, matches: true },
  ]
  const probe = Temporal.PlainDate.from(`2024-01-01`)
  expect(() =>
    Reflect.apply(Temporal.PlainDate.prototype.equals, fake, [probe]),
  ).toThrow()
  expect(() =>
    Reflect.apply(Temporal.PlainDate.prototype.equals, borrowed, [probe]),
  ).toThrow()

  // A one-row index tests each exact equality class without ordering mixed
  // ordinary objects and Temporal values, whose range order is unspecified.
  for (const [, IndexType] of indexTypes) {
    for (const sample of brandSamples) {
      const index = new IndexType(1, new PropRef([`when`]))
      index.add(sample.id, sample)
      expect(index.equalityLookup(probe)).toEqual(
        sample.matches ? new Set([sample.id]) : new Set(),
      )
    }
    // Both insertion orders must retain the same equality class when a live
    // representative is removed. The forged objects are intentionally kept
    // out of this ordered index: the default comparator has no promised order
    // for a mixed ordinary-object and Temporal domain.
    for (const first of [genuine, shadowedTag]) {
      const second = first === genuine ? shadowedTag : genuine
      const index = new IndexType(1, new PropRef([`when`]))
      index.add(`first`, { when: first })
      index.add(`second`, { when: second })
      expect(index.equalityLookup(probe)).toEqual(new Set([`first`, `second`]))
      index.remove(`first`, { when: first })
      expect(index.equalityLookup(probe)).toEqual(new Set([`second`]))
    }
  }

  const collection = createCollection<{ id: string; when: unknown }, string>({
    id: `temporal-plain-date-brand`,
    getKey: (row) => row.id,
    autoIndex: `off`,
    startSync: true,
    sync: {
      sync: ({ begin, write, commit, markReady }) => {
        begin()
        for (const { id, when } of brandSamples) {
          write({ type: `insert`, value: { id, when } })
        }
        commit()
        markReady()
      },
    },
  })
  await withOracleCleanup(async () => {
    await collection.stateWhenReady()
    const predicate = new Func(`eq`, [new PropRef([`when`]), new Value(probe)])
    const keys = new Set(
      collection
        .currentStateAsChanges({ where: predicate })
        ?.map(({ value }) => value.id),
    )
    expect(keys).toEqual(new Set([`genuine`, `shadowed-tag`, `shadowed-text`]))
  }, [() => collection.cleanup()])
})
