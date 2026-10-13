import { describe, expect, it } from 'vitest'
import { fc } from '@fast-check/vitest'
import { D2 } from '../../src/d2.js'
import { MultiSet } from '../../src/multiset.js'
import { reduce } from '../../src/operators/reduce.js'
import { output } from '../../src/operators/output.js'

/**
 * # Does the reduce fast path emit what the general path emits?
 *
 * A reduce operator diffs each changed key's new outputs against its old
 * ones. The general path builds two Maps keyed by output value, so outputs
 * compare by SameValueZero (`NaN` equals `NaN`, and `-0` is stored and
 * emitted as `0`). When a key has at most one output before and after, the
 * operator compares the two directly instead. Law: for every history, both
 * paths emit the same entries after every graph run, each with the same
 * multiplicity, and with values equal under `Object.is`, so `-0` and `0`
 * stay distinguishable in the comparison. Entries are compared one by one,
 * not summed, so an extra zero entry or a split -1/+1 pair is a difference.
 * Their order within one message is not part of the law: a MultiSet is
 * unordered.
 *
 * Model: the same reducer forced through the general path. A second
 * operator runs the reducer with one extra sentinel output on every key, so
 * every key has two or more outputs; its emitted entries, without the
 * sentinel, are the expected entries. The two operators share no state.
 *
 * Grammar: up to six runs of up to four signed input changes to two keys.
 * Each key's reducer outputs are chosen from its current inputs: none, one
 * or two values from `NaN`, `-0`, `0`, `1`, two fixed objects, a structurally
 * equal copy of one of them, and two `[prefix, payload]` arrays, each with
 * multiplicity -1, 0, 1 or 2. So a key keeps, replaces, removes and re-adds
 * its outputs, including an unchanged `NaN`, a `-0`/`0` swap, a zero or
 * negative multiplicity, and outputs that the output index merges by hash.
 * A key with two outputs takes the general path in both operators, so keys
 * also move between the two paths.
 */

const OBJECT_A = { name: `A` }
const OBJECT_B = { name: `B` }
// Equal to OBJECT_A by hash, but a different reference.
const OBJECT_A_COPY = { name: `A` }
const PREFIXED_X = [1, `x`]
const PREFIXED_Y = [1, `y`]
const OUTPUTS: ReadonlyArray<unknown> = [
  Number.NaN,
  -0,
  0,
  1,
  OBJECT_A,
  OBJECT_B,
  OBJECT_A_COPY,
  PREFIXED_X,
  PREFIXED_Y,
]
const SENTINEL = Symbol(`general path`)

type Step = { key: `k1` | `k2`; value: number; multiplicity: number }

/** None, one or two outputs, chosen from the key's current inputs. */
function choose(values: Array<[number, number]>): Array<[unknown, number]> {
  let sum = 0
  let count = 0
  for (const [value, multiplicity] of values) {
    sum += value * multiplicity
    count += multiplicity
  }
  if (count <= 0 || sum % 7 === 6) return []
  const first: [unknown, number] = [
    OUTPUTS[sum % OUTPUTS.length],
    (count % 4) - 1,
  ]
  if (sum % 3 !== 0) return [first]
  return [first, [OUTPUTS[(sum + count) % OUTPUTS.length], (sum % 2) + 1]]
}

/** A value's class under Object.is: -0 and 0 differ, NaN is one class. */
function identity(value: unknown): string {
  if (value === OBJECT_A) return `A`
  if (value === OBJECT_B) return `B`
  if (value === OBJECT_A_COPY) return `A-copy`
  if (value === PREFIXED_X) return `[1,x]`
  if (value === PREFIXED_Y) return `[1,y]`
  if (Object.is(value, -0)) return `-0`
  return String(value)
}

/** Each run's emitted entries, sorted, without the sentinel. */
function emitted(
  runs: Array<Array<Step>>,
  withSentinel: boolean,
): Array<Array<string>> {
  const graph = new D2()
  const input = graph.newInput<[string, number]>()
  const runsEmitted: Array<Array<string>> = []
  let current: Array<string> = []
  input.pipe(
    reduce((values: Array<[number, number]>) =>
      withSentinel ? [...choose(values), [SENTINEL, 1]] : choose(values),
    ),
    output((message) => {
      for (const [[key, value], multiplicity] of message.getInner()) {
        if (value === SENTINEL) continue
        current.push(`${key}:${identity(value)}:${multiplicity}`)
      }
    }),
  )
  graph.finalize()
  for (const run of runs) {
    input.sendData(
      new MultiSet(
        run.map(({ key, value, multiplicity }) => [[key, value], multiplicity]),
      ),
    )
    graph.run()
    runsEmitted.push(current.sort())
    current = []
  }
  return runsEmitted
}

const stepArbitrary: fc.Arbitrary<Step> = fc.record({
  key: fc.constantFrom(`k1` as const, `k2` as const),
  value: fc.nat(6),
  multiplicity: fc.constantFrom(-1, 1, 2),
})

describe(`reduce fast path`, () => {
  it(`emits the general path's entries after every run`, () => {
    fc.assert(
      fc.property(
        fc.array(fc.array(stepArbitrary, { minLength: 1, maxLength: 4 }), {
          minLength: 1,
          maxLength: 6,
        }),
        (runs) => {
          expect(emitted(runs, false)).toEqual(emitted(runs, true))
        },
      ),
      { numRuns: 1000 },
    )
  })
})
