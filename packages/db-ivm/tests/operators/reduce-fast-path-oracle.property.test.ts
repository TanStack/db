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
 * paths emit the same delta after every graph run, with values equal under
 * `Object.is`, so `-0` and `0` stay distinguishable in the comparison.
 *
 * Model: the same reducer forced through the general path. A second
 * operator runs the reducer with one extra sentinel output on every key, so
 * every key has two or more outputs; its emitted deltas, without the
 * sentinel, are the expected deltas. The two operators share no state.
 *
 * Grammar: up to six runs of up to four signed input changes to two keys.
 * Each key's reducer output is chosen from its current inputs: no output, or
 * one value from `NaN`, `-0`, `0`, `1` and two fixed objects, with
 * multiplicity 0, 1 or 2. So a key keeps, replaces, removes and re-adds its
 * output, including an unchanged `NaN`, a `-0`/`0` swap and a zero
 * multiplicity.
 */

const OBJECT_A = { name: `A` }
const OBJECT_B = { name: `B` }
const OUTPUTS: ReadonlyArray<unknown> = [
  Number.NaN,
  -0,
  0,
  1,
  OBJECT_A,
  OBJECT_B,
]
const SENTINEL = Symbol(`general path`)

type Step = { key: `k1` | `k2`; value: number; multiplicity: number }

/** At most one output, chosen from the key's current inputs. */
function choose(values: Array<[number, number]>): Array<[unknown, number]> {
  let sum = 0
  let count = 0
  for (const [value, multiplicity] of values) {
    sum += value * multiplicity
    count += multiplicity
  }
  if (count <= 0 || sum % 7 === 6) return []
  return [[OUTPUTS[sum % OUTPUTS.length], count % 3]]
}

/** A value's class under Object.is: -0 and 0 differ, NaN is one class. */
function identity(value: unknown): string {
  if (value === OBJECT_A) return `A`
  if (value === OBJECT_B) return `B`
  if (Object.is(value, -0)) return `-0`
  return String(value)
}

function emitted(
  runs: Array<Array<Step>>,
  withSentinel: boolean,
): Array<Map<string, number>> {
  const graph = new D2()
  const input = graph.newInput<[string, number]>()
  const deltas: Array<Map<string, number>> = []
  let current = new Map<string, number>()
  input.pipe(
    reduce((values: Array<[number, number]>) =>
      withSentinel ? [...choose(values), [SENTINEL, 1]] : choose(values),
    ),
    output((message) => {
      for (const [[key, value], multiplicity] of message.getInner()) {
        if (value === SENTINEL) continue
        const id = `${key}:${identity(value)}`
        current.set(id, (current.get(id) ?? 0) + multiplicity)
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
    deltas.push(new Map([...current].filter(([, sum]) => sum !== 0)))
    current = new Map()
  }
  return deltas
}

const stepArbitrary: fc.Arbitrary<Step> = fc.record({
  key: fc.constantFrom(`k1` as const, `k2` as const),
  value: fc.nat(6),
  multiplicity: fc.constantFrom(-1, 1, 2),
})

describe(`reduce fast path`, () => {
  it(`emits the general path's delta after every run`, () => {
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
      { numRuns: 500 },
    )
  })
})
