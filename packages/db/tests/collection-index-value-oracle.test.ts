/**
 * Index metadata snapshots must isolate mutable records, and signatures must
 * distinguish the literal meanings preserved by these snapshots. The public
 * createIndex/getIndexMetadata contract supplies these two laws.
 *
 * This bounded model assigns independent equivalence classes to native values,
 * ordinary records shaped like native tags, nested combinations, and reordered
 * record keys. Equal classes require equal signatures; different classes require
 * distinct signatures at getIndexMetadata. It does not claim function identity,
 * unsupported custom classes, all core value types, or persisted-index planning.
 *
 * A second history mutates a returned metadata literal, then reads metadata
 * again. An independent original payload supplies the expected snapshot. Plain
 * and null-prototype own-tag records must follow ordinary record isolation.
 * Genuine immutable native values retain their type and value. Production
 * serializers and comparators do not supply the model's expected classes.
 */
import { afterEach, expect, it } from 'vitest'
import { Temporal } from 'temporal-polyfill'
import { BasicIndex, IR, coalesce, createCollection } from '../src'
import type { Collection } from '../src'

type Row = { id: string; stamp: unknown }
const collections: Array<Collection<Row, string>> = []
afterEach(async () => {
  await Promise.all(
    collections.splice(0).map((collection) => collection.cleanup()),
  )
})

function createSource() {
  const result = createCollection({
    getKey: (row: Row) => row.id,
    sync: { sync: ({ markReady }) => markReady() },
    defaultIndexType: BasicIndex,
  })
  collections.push(result)
  return result
}

it(`distinguishes native literals from ordinary tags in index signatures`, () => {
  const instant = Temporal.Instant.from(`2026-01-02T00:00:00Z`)
  const date = Temporal.PlainDate.from(`2026-01-02`)
  const tag = { __type: `Temporal.Instant`, value: String(instant) }
  const fixtures: Array<{ group: string; value: unknown }> = [
    { group: `instant`, value: instant },
    { group: `instant`, value: Temporal.Instant.from(String(instant)) },
    { group: `date`, value: date },
    { group: `tag`, value: tag },
    {
      group: `tag`,
      value: { value: String(instant), __type: `Temporal.Instant` },
    },
    {
      group: `date-tag`,
      value: { __type: `Temporal.PlainDate`, value: String(date) },
    },
    { group: `escaped-tag`, value: { __type: `object`, value: tag } },
    { group: `native-pair`, value: [instant, instant] },
    { group: `mixed-pair`, value: [instant, tag] },
    { group: `nested-native`, value: { a: instant, b: 1 } },
    { group: `nested-native`, value: { b: 1, a: instant } },
    { group: `nested-tag`, value: { a: tag, b: 1 } },
  ]
  const source = createSource()
  for (const fixture of fixtures)
    source.createIndex((row) =>
      coalesce(row.stamp, new IR.Value(fixture.value)),
    )
  const metadata = source.getIndexMetadata()
  expect(metadata).toHaveLength(fixtures.length)
  for (let left = 0; left < fixtures.length; left++) {
    for (let right = 0; right < fixtures.length; right++) {
      expect(metadata[left]!.signature === metadata[right]!.signature).toBe(
        fixtures[left]!.group === fixtures[right]!.group,
      )
    }
  }
})

it.each([`plain`, `null`] as const)(
  `isolates ordinary own-tag metadata records / %s`,
  (prototype) => {
    const value = {
      payload: { label: `original` },
      [Symbol.toStringTag]: `Temporal.Instant`,
    }
    if (prototype === `null`) Object.setPrototypeOf(value, null)
    const source = createSource()
    source.createIndex((row) => coalesce(row.stamp, new IR.Value(value)))
    const snapshot = source.getIndexMetadata()[0]!
    const literal = (snapshot.expression as IR.Func).args[1] as IR.Value<
      typeof value
    >
    literal.value.payload.label = `changed`
    const next = (source.getIndexMetadata()[0]!.expression as IR.Func)
      .args[1] as IR.Value
    expect(next.value).toEqual({ payload: { label: `original` } })
  },
)

it(`retains immutable native literals in metadata snapshots`, () => {
  const source = createSource()
  const value = Temporal.Instant.from(`2026-01-02T00:00:00.000000001Z`)
  source.createIndex((row) => coalesce(row.stamp, new IR.Value(value)))
  const literal = (source.getIndexMetadata()[0]!.expression as IR.Func)
    .args[1] as IR.Value
  expect(literal.value).toBeInstanceOf(Temporal.Instant)
  expect(String(literal.value)).toBe(`2026-01-02T00:00:00.000000001Z`)
})
