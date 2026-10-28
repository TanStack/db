// Ordinary structural-identity tests: hand-written collision pairs that a
// missing length prefix would merge, and a cyclic value with no identity. Both
// compare production with fixed expectations. structural-identity-oracle.property.test.ts
// owns the identity law (agreement with D2 value identity) and its checks.
import { describe, expect, it } from 'vitest'
import { equalHashValues, structuralIdentity } from '../src/hashing/hash.js'

// Different values whose parts, read without lengths, join to the same text.
// A random four-character string never embeds a whole later part, so these
// pairs pin the cases that a missing length prefix would merge.
const collisionPairs: Array<[string, unknown, unknown]> = [
  [`string spans a later key`, { a: `x|1:b="y` }, { a: `x`, b: `y` }],
  [`key spans a later key`, { [`a="1:x|b`]: `y` }, { a: `x`, b: `y` }],
  [`string spans a later element`, [`x|1:1="y`, ``], [`x`, `y`]],
  [`header spans the body`, [`#1`], [1]],
]

describe(`structuralIdentity`, () => {
  it.each(collisionPairs)(
    `gives different values different identities: %s`,
    (_, left, right) => {
      expect(equalHashValues(left, right)).toBe(false)
      const leftIdentity = structuralIdentity(left)
      expect(leftIdentity).toBeDefined()
      expect(leftIdentity).not.toBe(structuralIdentity(right))
    },
  )

  it(`returns no identity for a cyclic value`, () => {
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(structuralIdentity(cyclic)).toBeUndefined()
  })
})
