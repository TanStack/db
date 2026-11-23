// Fixed examples for how value classes order and which objects are excluded.
// The law and its generated histories are owned by
// serialized-value-equality-oracle.property.test.ts.
import { describe, expect, it } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import { BasicIndex } from '../../src/indexes/basic-index.js'
import { BTreeIndex } from '../../src/indexes/btree-index.js'
import { Func, PropRef, Value } from '../../src/query/ir.js'
import {
  compareValues,
  normalizeValue,
  serializedClassValue,
} from '../../src/utils/comparison.js'
import { mockSyncCollectionOptions } from '../utils.js'

class Bound {
  constructor(
    readonly json: string,
    readonly rank: number,
  ) {}
  toJSON() {
    return this.json
  }
  valueOf() {
    return this.rank
  }
}

const throwing = <T extends object>(target: T): T =>
  Object.defineProperty(target, `toJSON`, {
    get() {
      throw new Error(`toJSON was read`)
    },
  })

describe(`compareValues with value classes`, () => {
  it(`orders by the serialized value, not valueOf`, () => {
    expect(compareValues(new Bound(`b`, 1), new Bound(`a`, 9))).toBe(1)
    expect(compareValues(new Bound(`a`, 9), new Bound(`b`, 1))).toBe(-1)
    expect(compareValues(new Bound(`a`, 1), new Bound(`a`, 9))).toBe(0)
  })

  it(`puts primitives before a value class and other objects after it`, () => {
    expect(compareValues(new Bound(`a`, -1), 100)).toBe(1)
    expect(compareValues(100, new Bound(`a`, 999))).toBe(-1)
    expect(compareValues(new Bound(`a`, 999), new Map())).toBe(-1)
    expect(compareValues(new Map(), new Bound(`a`, 999))).toBe(1)
  })

  it(`compares arrays that hold value classes by those values`, () => {
    expect(compareValues([new Bound(`b`, 1)], [new Bound(`a`, 9)])).toBe(1)
    expect(compareValues([new Bound(`a`, 1)], [new Bound(`a`, 9)])).toBe(0)
  })

  it(`leaves values without a value class to the native operators`, () => {
    expect(compareValues(2, 10)).toBe(-1)
    expect(compareValues(`b`, `a`)).toBe(1)
    expect(compareValues(new Date(2), new Date(1))).toBe(1)
    expect(compareValues([2], [10])).toBe(1)
  })
})

describe(`excluded objects with a throwing toJSON accessor`, () => {
  const excluded = (): Array<[string, object]> => [
    [`plain record`, throwing({ a: 1 })],
    [`null-prototype record`, throwing(Object.create(null))],
    [`array`, throwing([1])],
    [`Date`, throwing(new Date(1))],
    [`Map`, throwing(new Map())],
    [`Set`, throwing(new Set())],
    [`ArrayBuffer`, throwing(new ArrayBuffer(1))],
    [`typed array`, throwing(new Uint8Array(1))],
  ]

  it.each(excluded())(`does not read it on a %s`, (_name, value) => {
    expect(serializedClassValue(value)).toBeUndefined()
    expect(() => normalizeValue(value)).not.toThrow()
  })

  it.each([
    [`no index`, undefined],
    [`BasicIndex`, BasicIndex],
    [`BTreeIndex`, BTreeIndex],
  ] as const)(`keeps reference equality with %s`, async (_name, indexType) => {
    type Row = { id: string; ref: object }
    const ref = throwing({ a: 1 })
    const collection = createCollection(
      mockSyncCollectionOptions<Row>({
        id: `excluded-accessor-${_name}`,
        getKey: (row) => row.id,
        initialData: [
          { id: `same`, ref },
          { id: `other`, ref: throwing({ a: 1 }) },
        ],
        autoIndex: `off`,
        ...(indexType === undefined ? {} : { defaultIndexType: indexType }),
      }),
    )
    await collection.stateWhenReady()
    if (indexType !== undefined) collection.createIndex((row) => row.ref)
    const where = new Func<boolean>(`eq`, [
      new PropRef([`ref`]),
      new Value(ref),
    ])
    expect(
      collection.currentStateAsChanges({ where })!.map((change) => change.key),
    ).toEqual([`same`])
    await collection.cleanup()
  })
})
