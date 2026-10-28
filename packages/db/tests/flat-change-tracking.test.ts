/**
 * Ordinary flat change-tracking regressions: fallback to the proxy, detached
 * assignments, and descriptor-shaped change sets. The law and its model are
 * owned by flat-change-tracking-oracle.property.test.ts.
 */
import { describe, expect, it } from 'vitest'
import { withChangeTracking, withFlatChangeTracking } from '../src/proxy.js'
import {
  FRESH_OBJECT,
  MISSING,
  buildRow,
  plainRow,
} from './flat-change-tracking-fixture.js'
import type { Row, RowShape } from './flat-change-tracking-fixture.js'

const firstDraft = (draft: Array<Row> | Row) =>
  Array.isArray(draft) ? draft[0]! : draft

const descriptorLaws: ReadonlyArray<{
  name: string
  shape: RowShape
  callback: (draft: Array<Row> | Row) => void
  expected: Row
}> = [
  {
    name: `an enumerable accessor defined in the callback reports its value`,
    shape: plainRow([1, MISSING, MISSING]),
    callback: (draft) => {
      Object.defineProperty(firstDraft(draft), `g`, {
        get: () => 7,
        enumerable: true,
        configurable: true,
      })
    },
    expected: { g: 7 },
  },
  {
    name: `defining a field with its own value is not a change`,
    shape: plainRow([1, MISSING, MISSING]),
    callback: (draft) => {
      Object.defineProperty(firstDraft(draft), `a`, {
        value: 1,
        enumerable: true,
        writable: true,
        configurable: true,
      })
    },
    expected: {},
  },
  {
    name: `an equal object written to a non-enumerable object field is not a change`,
    shape: { ...plainRow([1, MISSING, MISSING]), hidden: FRESH_OBJECT },
    callback: (draft) => {
      firstDraft(draft).h = { nested: 1 }
    },
    expected: {},
  },
  {
    name: `a non-enumerable field written and then deleted is not a change`,
    shape: { ...plainRow([1, MISSING, MISSING]), hidden: `x` },
    callback: (draft) => {
      firstDraft(draft).h = `y`
      delete firstDraft(draft).h
    },
    expected: {},
  },
]

// Each history isolates one place a plausible flat diff goes wrong.

describe(`flat change tracking oracle`, () => {
  it(`falls back to the proxy for rows that are not flat`, () => {
    const callback = () => {}
    for (const row of [
      { a: { nested: 1 } },
      { a: [1] },
      { a: new Date(0) },
      { [Symbol(`s`)]: 1 },
      new (class Row {
        a = 1
      })(),
      // A getter can return a new value on each read, so only the proxy,
      // which reads it once, reports a stable change set.
      Object.defineProperty({}, `a`, { get: () => 1, enumerable: true }),
    ]) {
      expect(withFlatChangeTracking([row], callback, true)).toBeUndefined()
    }
  })

  it(`detaches an assigned object from later mutation`, () => {
    const assigned = { nested: 1 }
    const [changes] = withFlatChangeTracking(
      [{ a: 1 }],
      (drafts) => {
        ;(drafts as Array<Row>)[0]!.a = assigned
      },
      true,
    )!
    assigned.nested = 2
    expect(changes).toStrictEqual({ a: { nested: 1 } })
  })
})

describe(`flat change tracking oracle`, () => {
  for (const { name, shape, callback, expected } of descriptorLaws) {
    it(`reports the same change set when ${name}`, () => {
      expect(
        withFlatChangeTracking([buildRow(shape)], callback, false),
        `flat`,
      ).toStrictEqual([expected])
      expect(
        withChangeTracking(buildRow(shape), callback),
        `proxy`,
      ).toStrictEqual(expected)
    })
  }
})
