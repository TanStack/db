/**
 * Ordinary regression tests for index metadata snapshots: mutable records in a
 * returned metadata literal stay isolated, and native literals keep their type.
 * The signature law is owned by collection-index-value-oracle.test.ts.
 */
import { afterEach, expect, it } from 'vitest'
import { Temporal } from 'temporal-polyfill'
import { IR, coalesce } from '../src'
import { collections, createSource } from './collection-index-value-fixture.js'

afterEach(async () => {
  await Promise.all(
    collections.splice(0).map((collection) => collection.cleanup()),
  )
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
