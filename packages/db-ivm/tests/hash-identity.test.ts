// Ordinary hash identity tests: fixed Temporal-shaped, RegExp, realm, and
// colliding-control checks. Each compares production with literal expectations
// and reaches no declared part. hash-identity-oracle.property.test.ts owns the
// identity law and declares its checks and model.
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { MultiSet } from '../src/multiset.js'
import { equalHashValues, hash } from '../src/hashing/hash.js'
import { colliding, collidingTopKBatch } from './hash-collision-support.js'

describe(`hash identity oracle`, () => {
  // Real Temporal types print distinct formats, so only a polyfill-shaped
  // value can share text across types. The contract still names the tag.
  it(`Temporal-shaped values with the same text and different types differ`, () => {
    const temporalLike = (tag: string) =>
      new (class {
        get [Symbol.toStringTag]() {
          return tag
        }
        toString() {
          return `2024-01`
        }
      })()
    const date = temporalLike(`Temporal.PlainDate`)
    const month = temporalLike(`Temporal.PlainYearMonth`)
    expect(equalHashValues(date, temporalLike(`Temporal.PlainDate`))).toBe(true)
    expect(hash(date)).toBe(hash(temporalLike(`Temporal.PlainDate`)))
    expect(equalHashValues(date, month)).toBe(false)
  })

  // Current behavior outside the grammar: equality compares RegExp fields
  // with `===`, so a NaN `lastIndex` never equals itself, and `-0` equals `0`.
  // Hashing normalizes both, so the NaN pair hashes equal.
  it(`compares RegExp lastIndex with strict equality`, () => {
    const withLastIndex = (lastIndex: number) =>
      Object.assign(/a/g, { lastIndex })
    expect(equalHashValues(withLastIndex(NaN), withLastIndex(NaN))).toBe(false)
    expect(equalHashValues(withLastIndex(-0), withLastIndex(0))).toBe(true)
  })

  // Current behavior outside the grammar: an array from another realm takes
  // the object marker, but equality still compares array lengths.
  it(`keeps the equality length check for arrays from another realm`, () => {
    const withHole = runInNewContext(`const a = [1]; a.length = 2; a`)
    const short = runInNewContext(`[1]`)
    expect(equalHashValues(withHole, short)).toBe(false)
    expect(
      equalHashValues(runInNewContext(`[1, 2]`), runInNewContext(`[1, 2]`)),
    ).toBe(true)
  })

  // The colliding copy is only a useful control if its markers collide.
  it(`gives every type marker the same hash number in the colliding module`, () => {
    const empty = [
      new Map(),
      new Set(),
      {},
      Object.assign(new RegExp(``), { lastIndex: 0 }),
    ]
    const hashes = new Set(empty.map((value) => colliding.hash(value)))
    expect(hashes.size).toBe(2) // A RegExp still hashes its header fields.
    expect(colliding.hash(new Map())).toBe(colliding.hash(new Set()))
    expect(colliding.hash(new Map())).toBe(colliding.hash({}))
  })

  it(`keeps a Map-to-Set replacement in topKBatch when markers collide`, () => {
    const batch = collidingTopKBatch([
      new MultiSet<[number, unknown]>([
        [[1, new Map()], -1],
        [[1, new Set()], 1],
      ]),
    ])
    expect(
      [...batch].map(([[, value], weight]) => [
        value instanceof Map ? `map` : value instanceof Set ? `set` : `other`,
        weight,
      ]),
    ).toEqual([
      [`map`, -1],
      [`set`, 1],
    ])
  })
})
