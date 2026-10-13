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
 * The ZonedDateTime lane covers values from one polyfill copy and one instant,
 * including genuine instances with own display and intrinsic-getter shadows. A neighboring
 * PlainDate lane checks that native brand and equality survive those shadows
 * while forged tags retain ordinary object identity. Fixture-assigned classes,
 * independent of production normalization, predict exact key sets. Direct
 * BasicIndex/BTreeIndex add, build, and removal histories compare those sets
 * after each returned action. Public Collection
 * reads compare an unindexed scan and an optimized-only indexed snapshot after
 * readiness. The mixed forged/genuine PlainDate Collection has no index:
 * default range order across an ordinary object and Temporal is unspecified.
 * A second lane uses one polyfill copy to check `PlainMonthDay` and
 * `PlainYearMonth` reference ISO fields, and Duration's ten fields, under
 * the same exact query equality. Changelog #1519 explicitly keeps equivalent
 * Duration representations unequal for `eq`. Its fixture assigns equality
 * classes from native constructors and intrinsic relations, never from
 * production key encoding. Compiled `eq` and `in` for these classes are
 * checked by the in-evaluator oracle. PlainMonthDay has no natural order, so
 * this file checks its public Collection equality through an unindexed scan.
 * Indexed PlainMonthDay equality remains open. YearMonth and Duration store
 * several classes with identical default display and check indexed add,
 * build, removal, re-add, and public reads.
 * This oracle does not claim all IANA aliases, arbitrary spoofed prototypes,
 * mixed Temporal implementations, joins, live-query publication, or provider
 * behavior.
 */
type Row = { id: string; when: Temporal.ZonedDateTime }
type Sample = {
  id: string
  text: string
  identity: `utc` | `offset` | `later` | `calendar`
  ownShadow?: `tag` | `text` | `epoch` | `calendar`
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
  {
    id: `utc-shadowed-tag`,
    text: `2024-01-15T09:00:00+00:00[UTC]`,
    identity: `utc`,
    ownShadow: `tag`,
  },
  {
    id: `utc-shadowed-text`,
    text: `2024-01-15T09:00:00+00:00[UTC]`,
    identity: `utc`,
    ownShadow: `text`,
  },
  {
    id: `utc-shadowed-epoch`,
    text: `2024-01-15T09:00:00+00:00[UTC]`,
    identity: `utc`,
    ownShadow: `epoch`,
  },
  {
    id: `utc-shadowed-calendar`,
    text: `2024-01-15T09:00:00+00:00[UTC]`,
    identity: `utc`,
    ownShadow: `calendar`,
  },
]

function rows(): Array<Row> {
  return samples.map(({ id, text, ownShadow }) => {
    const when = Temporal.ZonedDateTime.from(text)
    if (ownShadow === `tag`) {
      Object.defineProperty(when, Symbol.toStringTag, { value: `ordinary` })
    } else if (ownShadow === `text`) {
      Object.defineProperty(when, `toString`, {
        value: () => `unrelated text`,
      })
    } else if (ownShadow === `epoch`) {
      Object.defineProperty(when, `epochNanoseconds`, { value: 0n })
    } else if (ownShadow === `calendar`) {
      Object.defineProperty(when, `calendarId`, { value: `gregory` })
    }
    return { id, when }
  })
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

type IntrinsicKind = `PlainMonthDay` | `PlainYearMonth` | `Duration`
type IntrinsicRow = { id: string; when: unknown; identity: string }
type IntrinsicProbe = { when: unknown; identity: string }
type IntrinsicFixture = {
  rows: Array<IntrinsicRow>
  probes: Array<IntrinsicProbe>
  checkNativeRelation: () => void
}

const indexedIntrinsicKinds: ReadonlyArray<
  Exclude<IntrinsicKind, `PlainMonthDay`>
> = [`PlainYearMonth`, `Duration`]

// The fixture identity is a model-only equality class assigned from the
// constructed Temporal fields. It combines no production state. Fresh probes
// distinguish equal copies from different fields with the same display text.
function intrinsicFixture(kind: IntrinsicKind): IntrinsicFixture {
  if (kind === `PlainMonthDay`) {
    const stored = new Temporal.PlainMonthDay(2, 29, `iso8601`, 1972)
    const storedCopy = new Temporal.PlainMonthDay(2, 29, `iso8601`, 1972)
    const equal = new Temporal.PlainMonthDay(2, 29, `iso8601`, 1972)
    const other = new Temporal.PlainMonthDay(2, 29, `iso8601`, 2004)
    return {
      rows: [
        { id: `reference-1972`, when: stored, identity: `1972` },
        { id: `reference-1972-copy`, when: storedCopy, identity: `1972` },
        { id: `reference-2004`, when: other, identity: `2004` },
      ],
      probes: [
        { when: equal, identity: `1972` },
        { when: other, identity: `2004` },
      ],
      checkNativeRelation: () => {
        expect(stored.toString()).toBe(other.toString())
        expect(stored.equals(storedCopy)).toBe(true)
        expect(stored.equals(equal)).toBe(true)
        expect(stored.equals(other)).toBe(false)
      },
    }
  }

  if (kind === `PlainYearMonth`) {
    const stored = new Temporal.PlainYearMonth(2024, 2, `iso8601`, 1)
    const equal = new Temporal.PlainYearMonth(2024, 2, `iso8601`, 1)
    const other = new Temporal.PlainYearMonth(2024, 2, `iso8601`, 20)
    return {
      rows: [
        { id: `reference-day-1`, when: stored, identity: `day-1` },
        { id: `reference-day-1-copy`, when: equal, identity: `day-1` },
        { id: `reference-day-20`, when: other, identity: `day-20` },
      ],
      probes: [
        {
          when: new Temporal.PlainYearMonth(2024, 2, `iso8601`, 1),
          identity: `day-1`,
        },
        {
          when: new Temporal.PlainYearMonth(2024, 2, `iso8601`, 20),
          identity: `day-20`,
        },
      ],
      checkNativeRelation: () => {
        expect(stored.toString()).toBe(other.toString())
        expect(stored.equals(equal)).toBe(true)
        expect(stored.equals(other)).toBe(false)
      },
    }
  }

  const seconds = Temporal.Duration.from({ seconds: 1 })
  const secondsCopy = Temporal.Duration.from({ seconds: 1 })
  const shadowedSeconds = Temporal.Duration.from({ seconds: 1 })
  Object.defineProperty(shadowedSeconds, `seconds`, { value: 2 })
  const milliseconds = Temporal.Duration.from({ milliseconds: 1000 })
  const microseconds = Temporal.Duration.from({ microseconds: 1_000_000 })
  const intrinsicSeconds = Object.getOwnPropertyDescriptor(
    Temporal.Duration.prototype,
    `seconds`,
  )!.get!
  return {
    rows: [
      { id: `seconds`, when: seconds, identity: `seconds` },
      { id: `seconds-copy`, when: secondsCopy, identity: `seconds` },
      { id: `seconds-shadow`, when: shadowedSeconds, identity: `seconds` },
      { id: `milliseconds`, when: milliseconds, identity: `milliseconds` },
      { id: `microseconds`, when: microseconds, identity: `microseconds` },
    ],
    probes: [
      { when: Temporal.Duration.from({ seconds: 1 }), identity: `seconds` },
      {
        when: Temporal.Duration.from({ milliseconds: 1000 }),
        identity: `milliseconds`,
      },
      {
        when: Temporal.Duration.from({ microseconds: 1_000_000 }),
        identity: `microseconds`,
      },
    ],
    checkNativeRelation: () => {
      expect(seconds.toString()).toBe(milliseconds.toString())
      expect(milliseconds.toString()).toBe(microseconds.toString())
      expect(intrinsicSeconds.call(shadowedSeconds)).toBe(1)
      expect(shadowedSeconds.seconds).toBe(2)
      expect(seconds.seconds).toBe(1)
      expect(milliseconds.milliseconds).toBe(1000)
      expect(microseconds.microseconds).toBe(1_000_000)
    },
  }
}

function intrinsicExpectedKeys(
  source: ReadonlyArray<IntrinsicRow>,
  identity: string,
): Set<string> {
  return new Set(
    source.filter((row) => row.identity === identity).map((row) => row.id),
  )
}

it(`distinguishes equivalent aliases and own property shadows from a fixed-offset zone`, () => {
  const [
    utc,
    alias,
    fixed,
    later,
    gregory,
    shadowedTag,
    shadowedText,
    shadowedEpoch,
    shadowedCalendar,
  ] = rows()
  // This checks the fixture against the external Temporal relation. Expected
  // index and query sets still come from the assigned identity classes.
  expect(utc!.when.equals(alias!.when)).toBe(true)
  expect(utc!.when.equals(fixed!.when)).toBe(false)
  expect(utc!.when.equals(later!.when)).toBe(false)
  expect(utc!.when.equals(gregory!.when)).toBe(false)
  expect(
    Temporal.ZonedDateTime.prototype.equals.call(
      shadowedTag!.when,
      alias!.when,
    ),
  ).toBe(true)
  expect(
    Temporal.ZonedDateTime.prototype.equals.call(
      shadowedText!.when,
      alias!.when,
    ),
  ).toBe(true)
  expect(
    Temporal.ZonedDateTime.prototype.equals.call(
      shadowedEpoch!.when,
      alias!.when,
    ),
  ).toBe(true)
  expect(
    Temporal.ZonedDateTime.prototype.equals.call(
      shadowedCalendar!.when,
      alias!.when,
    ),
  ).toBe(true)
  expect(utc!.when.toString()).not.toBe(alias!.when.toString())
  expect(expectedKeys(`utc`)).toEqual(
    new Set([
      `utc`,
      `utc-alias`,
      `utc-shadowed-tag`,
      `utc-shadowed-text`,
      `utc-shadowed-epoch`,
      `utc-shadowed-calendar`,
    ]),
  )
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
      expect(index.equalityLookup(aliasProbe)).toEqual(
        new Set([
          `utc-alias`,
          `utc-shadowed-tag`,
          `utc-shadowed-text`,
          `utc-shadowed-epoch`,
          `utc-shadowed-calendar`,
        ]),
      )
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

it(`keeps PlainMonthDay reference years distinct in an unindexed public equality scan`, async () => {
  const fixture = intrinsicFixture(`PlainMonthDay`)
  fixture.checkNativeRelation()
  const collection = createCollection<IntrinsicRow, string>({
    id: `temporal-monthday-unindexed-equality`,
    getKey: (row) => row.id,
    autoIndex: `off`,
    startSync: true,
    sync: {
      sync: ({ begin, write, commit, markReady }) => {
        begin()
        for (const row of fixture.rows) write({ type: `insert`, value: row })
        commit()
        markReady()
      },
    },
  })

  // The source contains two native-equal copies and a distinct reference
  // year with the same default display. The public scan has no index order
  // obligation; each query must return exactly its modeled equality class.
  await withOracleCleanup(async () => {
    await collection.stateWhenReady()
    expect(collection.indexes.size).toBe(0)
    for (const probe of fixture.probes) {
      const predicate = new Func(`eq`, [
        new PropRef([`when`]),
        new Value(probe.when),
      ])
      const keys = new Set(
        collection
          .currentStateAsChanges({ where: predicate, optimizedOnly: false })
          ?.map(({ value }) => value.id),
      )
      expect(collection.indexes.size).toBe(0)
      expect(keys).toEqual(intrinsicExpectedKeys(fixture.rows, probe.identity))
    }
  }, [() => collection.cleanup()])
})

describe.each(indexTypes)(
  `%s Temporal intrinsic field equality`,
  (indexName, IndexType) => {
    it.each(indexedIntrinsicKinds)(
      `keeps %s exact classes after each add, removal, and re-add`,
      (kind) => {
        const fixture = intrinsicFixture(kind)
        fixture.checkNativeRelation()
        const index = new IndexType(1, new PropRef([`when`]))
        const added: Array<IntrinsicRow> = []

        // Each returned add is a checkpoint. The model recomputes membership
        // from fixture classes, independent of the index's equality key.
        for (const row of fixture.rows) {
          index.add(row.id, row)
          added.push(row)
          for (const probe of fixture.probes) {
            expect(index.equalityLookup(probe.when)).toEqual(
              intrinsicExpectedKeys(added, probe.identity),
            )
          }
        }

        for (const probe of fixture.probes) {
          const expected = intrinsicExpectedKeys(added, probe.identity)
          expect(index.lookup(`eq`, probe.when)).toEqual(expected)
          expect(index.inArrayLookup([probe.when])).toEqual(expected)
        }

        const removed = added.shift()!
        index.remove(removed.id, removed)
        for (const probe of fixture.probes) {
          expect(index.equalityLookup(probe.when)).toEqual(
            intrinsicExpectedKeys(added, probe.identity),
          )
        }

        const freshEqual = fixture.probes.find(
          (probe) => probe.identity === removed.identity,
        )!
        const readded = { ...removed, when: freshEqual.when }
        index.add(readded.id, readded)
        added.push(readded)
        for (const probe of fixture.probes) {
          expect(index.equalityLookup(probe.when)).toEqual(
            intrinsicExpectedKeys(added, probe.identity),
          )
        }
      },
    )

    it.each(indexedIntrinsicKinds)(
      `keeps %s exact classes after build`,
      (kind) => {
        const fixture = intrinsicFixture(kind)
        fixture.checkNativeRelation()
        const index = new IndexType(1, new PropRef([`when`]))
        index.build(
          fixture.rows.map((row): [string, IntrinsicRow] => [row.id, row]),
        )
        for (const probe of fixture.probes) {
          expect(index.equalityLookup(probe.when)).toEqual(
            intrinsicExpectedKeys(fixture.rows, probe.identity),
          )
        }
      },
    )

    it.each(
      indexedIntrinsicKinds.flatMap((kind) => [
        { kind, optimizedOnly: false },
        { kind, optimizedOnly: true },
      ]),
    )(
      `returns $kind exact classes in a public snapshot with optimizedOnly=$optimizedOnly`,
      async ({ kind, optimizedOnly }) => {
        const fixture = intrinsicFixture(kind)
        fixture.checkNativeRelation()
        const collection = createCollection<IntrinsicRow, string>({
          id: `temporal-intrinsic-${kind}-${indexName}-${optimizedOnly}`,
          getKey: (row) => row.id,
          autoIndex: `off`,
          startSync: true,
          sync: {
            sync: ({ begin, write, commit, markReady }) => {
              begin()
              for (const row of fixture.rows)
                write({ type: `insert`, value: row })
              commit()
              markReady()
            },
          },
        })

        // A scan supplies the public control. With optimizedOnly, a spy proves
        // that the same `eq` predicate reaches the explicit index lookup.
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
          for (const probe of fixture.probes) {
            lookup?.mockClear()
            const predicate = new Func(`eq`, [
              new PropRef([`when`]),
              new Value(probe.when),
            ])
            const keys = new Set(
              collection
                .currentStateAsChanges({ where: predicate, optimizedOnly })
                ?.map(({ value }) => value.id),
            )
            if (lookup) expect(lookup).toHaveBeenCalled()
            expect(keys).toEqual(
              intrinsicExpectedKeys(fixture.rows, probe.identity),
            )
          }
        }, [() => collection.cleanup()])
      },
    )
  },
)

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
  const freshOffsetProbe = Temporal.ZonedDateTime.from(
    `2024-01-15T09:00:00+00:00[+00:00]`,
  )
  Object.defineProperty(shadowed, `timeZoneId`, { value: `UTC` })
  expect(aliasProbe.equals(shadowed)).toBe(false)
  expect(shadowed).not.toBe(freshOffsetProbe)
  expect(shadowed.equals(freshOffsetProbe)).toBe(true)
  expect(() => Reflect.apply(aliasProbe.equals, aliasProbe, [fake])).toThrow()

  const source = [
    { id: `forged`, when: fake },
    { id: `shadowed`, when: shadowed },
  ]
  const fakeCopy = { ...fake }
  for (const [, IndexType] of indexTypes) {
    for (const row of source) {
      // One row avoids asking the default ordering comparator to order a
      // forged object and a genuine Temporal value against each other.
      const index = new IndexType(1, new PropRef([`when`]))
      index.add(row.id, row)
      expect(index.equalityLookup(aliasProbe)).toEqual(new Set())
      // Rejecting the forged brand must not discard the ordinary object's
      // exact self-identity. A distinct structural copy stays outside it.
      expect(index.equalityLookup(row.when)).toEqual(new Set([row.id]))
      if (row.id === `forged`) {
        expect(index.equalityLookup(fakeCopy)).toEqual(new Set())
      } else {
        // The own zone accessor must not turn a genuine fixed-offset value
        // into reference-only equality with its native-equal fresh instance.
        expect(index.equalityLookup(freshOffsetProbe)).toEqual(
          new Set([row.id]),
        )
      }
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
    const keysFor = (probe: unknown) => {
      const predicate = new Func(`eq`, [
        new PropRef([`when`]),
        new Value(probe),
      ])
      return new Set(
        collection
          .currentStateAsChanges({ where: predicate })
          ?.map(({ value }) => value.id),
      )
    }
    expect(keysFor(aliasProbe)).toEqual(new Set())
    expect(keysFor(freshOffsetProbe)).toEqual(new Set([`shadowed`]))
    expect(keysFor(fake)).toEqual(new Set([`forged`]))
    expect(keysFor(fakeCopy)).toEqual(new Set())
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
      expect(index.equalityLookup(sample.when)).toEqual(new Set([sample.id]))
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
    const keysFor = (probeValue: unknown) => {
      const predicate = new Func(`eq`, [
        new PropRef([`when`]),
        new Value(probeValue),
      ])
      return new Set(
        collection
          .currentStateAsChanges({ where: predicate })
          ?.map(({ value }) => value.id),
      )
    }
    expect(keysFor(probe)).toEqual(
      new Set([`genuine`, `shadowed-tag`, `shadowed-text`]),
    )
    // An impostor remains an ordinary object: querying by its own reference
    // finds it, while a distinct object with the same display cannot.
    const borrowedCopy = Object.assign(
      Object.create(Temporal.PlainDate.prototype) as object,
      { toString: () => `2024-01-01` },
    )
    for (const [impostor, id, copy] of [
      [fake, `forged-tag`, { ...fake }],
      [borrowed, `borrowed-prototype`, borrowedCopy],
    ] as const) {
      expect(keysFor(impostor)).toEqual(new Set([id]))
      expect(keysFor(copy)).toEqual(new Set())
    }
  }, [() => collection.cleanup()])
})
