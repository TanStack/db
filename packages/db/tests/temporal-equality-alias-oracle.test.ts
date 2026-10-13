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
 * including a normal subclass with inherited Temporal methods.
 * Fixture-assigned classes,
 * independent of production normalization, predict exact key sets. Direct
 * BasicIndex/BTreeIndex add, build, and removal histories compare those sets
 * after each returned action. Public Collection
 * reads compare an unindexed scan and an optimized-only indexed snapshot after
 * readiness.
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
 * build, removal, re-add, and public reads. Duration also varies years,
 * months, weeks, days, and nanoseconds one field at a time; a key that omits
 * any one of those fields would merge its distinct fixture classes.
 * This oracle does not claim all IANA aliases, subclasses with replaced
 * Temporal methods, malformed Temporal lookalikes or deliberately shadowed
 * Temporal members,
 * mixed Temporal implementations, joins, live-query publication, or provider
 * behavior.
 */
type Row = { id: string; when: Temporal.ZonedDateTime }
type Sample = {
  id: string
  text: string
  identity: `utc` | `offset` | `later` | `calendar`
  subclass?: boolean
}

class ZonedDateTimeSubclass extends Temporal.ZonedDateTime {}

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
    id: `utc-subclass`,
    text: `2024-01-15T09:00:00+00:00[UTC]`,
    identity: `utc`,
    subclass: true,
  },
]

function rows(): Array<Row> {
  return samples.map(({ id, text, subclass }) => {
    const base = Temporal.ZonedDateTime.from(text)
    const when = subclass
      ? new ZonedDateTimeSubclass(
          base.epochNanoseconds,
          base.timeZoneId,
          base.calendarId,
        )
      : base
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
const subclassProbe = new ZonedDateTimeSubclass(
  aliasProbe.epochNanoseconds,
  `UTC`,
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
  const milliseconds = Temporal.Duration.from({ milliseconds: 1000 })
  const microseconds = Temporal.Duration.from({ microseconds: 1_000_000 })
  return {
    rows: [
      { id: `seconds`, when: seconds, identity: `seconds` },
      { id: `seconds-copy`, when: secondsCopy, identity: `seconds` },
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
      expect(seconds.seconds).toBe(1)
      expect(milliseconds.milliseconds).toBe(1000)
      expect(microseconds.microseconds).toBe(1_000_000)
    },
  }
}

function variedDurationFixture(): IntrinsicFixture {
  const fields = {
    years: 1,
    months: 1,
    weeks: 1,
    days: 1,
    nanoseconds: 1,
  }
  const baseline = Temporal.Duration.from(fields)
  const variedFields = [
    `years`,
    `months`,
    `weeks`,
    `days`,
    `nanoseconds`,
  ] as const
  const variants = variedFields.map((field) => ({
    field,
    when: Temporal.Duration.from({ ...fields, [field]: 2 }),
  }))
  const allFields = [
    `years`,
    `months`,
    `weeks`,
    `days`,
    `hours`,
    `minutes`,
    `seconds`,
    `milliseconds`,
    `microseconds`,
    `nanoseconds`,
  ] as const
  const getters = allFields.map(
    (field) =>
      Object.getOwnPropertyDescriptor(Temporal.Duration.prototype, field)!.get!,
  )
  return {
    rows: [
      { id: `mixed`, when: baseline, identity: `mixed` },
      {
        id: `mixed-copy`,
        when: Temporal.Duration.from(fields),
        identity: `mixed`,
      },
      ...variants.map(({ field, when }) => ({
        id: `mixed-${field}`,
        when,
        identity: `mixed-${field}`,
      })),
    ],
    probes: [
      { when: Temporal.Duration.from(fields), identity: `mixed` },
      ...variants.map(({ field }) => ({
        when: Temporal.Duration.from({ ...fields, [field]: 2 }),
        identity: `mixed-${field}`,
      })),
    ],
    checkNativeRelation: () => {
      // Each class differs from mixed in exactly one intrinsic field. Dropping
      // that field from an exact key would merge the two classes.
      for (const { field, when } of variants) {
        expect(
          allFields.filter(
            (_, index) =>
              Reflect.apply(getters[index]!, baseline, []) !==
              Reflect.apply(getters[index]!, when, []),
          ),
        ).toEqual([field])
      }
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

it(`distinguishes equivalent aliases from a fixed-offset zone`, () => {
  const [utc, alias, fixed, later, gregory, subclass] = rows()
  // This checks the fixture against the external Temporal relation. Expected
  // index and query sets still come from the assigned identity classes.
  expect(utc!.when.equals(alias!.when)).toBe(true)
  expect(utc!.when.equals(fixed!.when)).toBe(false)
  expect(utc!.when.equals(later!.when)).toBe(false)
  expect(utc!.when.equals(gregory!.when)).toBe(false)
  // A subclass inherits Temporal's slot-checking method. The fixture assigns
  // it the UTC class independently of the production classifier.
  expect(Object.getPrototypeOf(subclass!.when)).toBe(
    ZonedDateTimeSubclass.prototype,
  )
  expect(
    Temporal.ZonedDateTime.prototype.equals.call(subclass!.when, alias!.when),
  ).toBe(true)
  expect(
    Temporal.ZonedDateTime.prototype.equals.call(subclass!.when, fixed!.when),
  ).toBe(false)
  expect(
    Temporal.ZonedDateTime.prototype.equals.call(subclassProbe, alias!.when),
  ).toBe(true)
  expect(utc!.when.toString()).not.toBe(alias!.when.toString())
  expect(expectedKeys(`utc`)).toEqual(
    new Set([`utc`, `utc-alias`, `utc-subclass`]),
  )
  expect(expectedKeys(`offset`)).toEqual(new Set([`fixed-offset`]))
})

describe.each(indexTypes)(`%s Temporal alias equality`, (_name, IndexType) => {
  it.each([`add`, `build`] as const)(
    `finds the exact equality class after %s and representative removals`,
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
      for (const probe of [aliasProbe, subclassProbe]) {
        expect(index.equalityLookup(probe)).toEqual(expectedKeys(`utc`))
        expect(index.lookup(`eq`, probe)).toEqual(expectedKeys(`utc`))
      }
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

      // Removing the subclass itself must retract one member of the class.
      // Each native-equal probe still finds every remaining UTC alias.
      const remainingUtc = expectedKeys(`utc`)
      for (const [id, probe] of [
        [`utc`, aliasProbe],
        [`utc-subclass`, subclassProbe],
      ] as const) {
        const row = source.find((candidate) => candidate.id === id)!
        index.remove(row.id, row)
        remainingUtc.delete(id)
        expect(index.equalityLookup(probe)).toEqual(remainingUtc)
      }
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
      const readKeys = (probe: Temporal.ZonedDateTime) => {
        const predicate = new Func(`eq`, [
          new PropRef([`when`]),
          new Value(probe),
        ])
        return new Set(
          collection
            .currentStateAsChanges({ where: predicate, optimizedOnly })
            ?.map(({ value }) => value.id),
        )
      }

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
        for (const probe of [aliasProbe, subclassProbe]) {
          lookup?.mockClear()
          const result = readKeys(probe)
          if (lookup) expect(lookup).toHaveBeenCalled()
          expect(result).toEqual(expectedKeys(`utc`))
        }
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

it(`keeps five additional Duration fields distinct in an unindexed public equality scan`, async () => {
  const fixture = variedDurationFixture()
  fixture.checkNativeRelation()
  const collection = createCollection<IntrinsicRow, string>({
    id: `temporal-duration-varied-unindexed-equality`,
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

  // The scan reads exact classes without asking Temporal to order calendar
  // units, which would require relativeTo.
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
      expect(keys).toEqual(intrinsicExpectedKeys(fixture.rows, probe.identity))
    }
  }, [() => collection.cleanup()])
})

it.each(indexTypes)(
  `%s keeps five additional Duration fields in exact index equality`,
  (_name, IndexType) => {
    const fixture = variedDurationFixture()
    fixture.checkNativeRelation()
    // A lexical display comparator supplies only the index's required total
    // order. The independently assigned classes judge exact equality.
    const compareText = (left: unknown, right: unknown) => {
      const a = String(left)
      const b = String(right)
      return a < b ? -1 : a > b ? 1 : 0
    }
    const index = new IndexType(1, new PropRef([`when`]), undefined, {
      compareFn: compareText,
    })
    index.build(
      fixture.rows.map((row): [string, IntrinsicRow] => [row.id, row]),
    )
    for (const probe of fixture.probes) {
      const expected = intrinsicExpectedKeys(fixture.rows, probe.identity)
      expect(index.equalityLookup(probe.when)).toEqual(expected)
      expect(index.lookup(`eq`, probe.when)).toEqual(expected)
      expect(index.inArrayLookup([probe.when])).toEqual(expected)
    }
  },
)

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
