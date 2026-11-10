import { expect } from 'vitest'
import { fc } from '@fast-check/vitest'
import { hash } from '../src/hashing/hash.js'
import { differs, pass } from '../../db/tests/oracle-property.js'
import { declareOracle } from '../../db/tests/oracle-declaration.js'
import type { Observation, Verdict } from '../../db/tests/oracle-property.js'
import type { HashValue } from './hash-support.js'

/**
 * Flat-value hashing compares results from independent equivalent constructors.
 * This shared judgment preserves exact SameValue comparisons of numeric hashes,
 * plus the original construction guards for an observed key permutation.
 * It claims no digest injectivity or graph-topology law.
 */
export type ComparisonRelation =
  `same value` | `different value` | `same structure` | `different structure`
export type ComparisonRecorder = (
  actual: unknown,
  reference: unknown,
  relation?: ComparisonRelation,
) => void
type Comparison = {
  actual: unknown
  reference: unknown
  relation: ComparisonRelation
}

// Each reference is the existing alternate execution or independently built
// value. The model never calls production to derive another expected value.
export function comparisonReferences(
  _values: unknown,
  trace: ReadonlyArray<Observation>,
): Array<unknown> {
  return trace.map(({ value }) => (value as Comparison).reference)
}

export function checkHashComparisons(
  _values: unknown,
  trace: ReadonlyArray<Observation>,
  references: Array<unknown>,
): Verdict {
  for (const [at, { checkpoint, value }] of trace.entries()) {
    const { actual, relation } = value as Comparison
    const reference = references[at]
    const structural = relation.endsWith(`structure`)
    const equal = structural
      ? differs(checkpoint, relation, actual, reference) === undefined
      : Object.is(actual, reference)
    const mismatch = differs(
      checkpoint,
      relation,
      equal,
      relation.startsWith(`same`),
    )
    if (mismatch) return mismatch
  }
  return pass
}

// Prefixing preserves arbitrary strings while excluding integer-index keys.
// At least two unique entries make reversal observable. The collation ties
// preserve the original challenge to locale-dependent object-key traversal.
const collationTies = [`\u00C5`, `A\u030A`, `\u00E9`, `e\u0301`, `\u212B`]
export const arbitraryNonIndexEntries = fc.uniqueArray(
  fc.tuple(
    fc
      .oneof(fc.string(), fc.constantFrom(...collationTies))
      .map((key) => `key:${key}`),
    fc.integer(),
  ),
  { minLength: 2, maxLength: 5, selector: ([key]) => key },
)

export function observePermutedHashes(
  entries: Array<[string, number]>,
  record: ComparisonRecorder,
  hashValue: HashValue = hash,
): void {
  const original = Object.fromEntries(entries)
  const reversed = Object.fromEntries([...entries].reverse())
  record(Object.keys(original), Object.keys(reversed), `different structure`)
  record(original, reversed, `same structure`)
  record(hashValue(original), hashValue(reversed))
}

// Checker calibration and generated production execution share this judgment.
export function expectPermutedHashes(
  entries: Array<[string, number]>,
  hashValue: HashValue = hash,
): void {
  const trace: Array<Observation> = []
  observePermutedHashes(
    entries,
    (actual, reference, relation = `same value`) => {
      trace.push({
        checkpoint: `comparison ${trace.length}`,
        value: { actual, reference, relation },
      })
    },
    hashValue,
  )
  const verdict = checkHashComparisons(
    entries,
    trace,
    comparisonReferences(entries, trace),
  )
  expect(
    verdict,
    verdict.kind === `violation` ? verdict.difference : undefined,
  ).toEqual(pass)
}

declareOracle({
  check: [checkHashComparisons, expectPermutedHashes],
  model: [comparisonReferences],
  grammar: [arbitraryNonIndexEntries],
})
