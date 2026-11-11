import { createClient } from '@supabase/supabase-js'
import { fc, test as fcTest } from '@fast-check/vitest'
import { describe, expect, test } from 'vitest'
import { z } from 'zod'
import { supabaseCollectionOptions } from '../src/index'
import { SUPABASE_KEY, SUPABASE_URL } from './test.utils'

// Collection keys are built from the configured key columns, whose values are
// strings. Two rows must share a key exactly when every key column is equal;
// otherwise one row overwrites the other in the collection.

const columns = [`a`, `b`, `c`] as const

const getKeyFor = (keys: Array<(typeof columns)[number]>) =>
  supabaseCollectionOptions({
    tableName: `rows`,
    keys,
    schema: z.object({ a: z.string(), b: z.string(), c: z.string() }),
    supabase: createClient(SUPABASE_URL, SUPABASE_KEY),
  }).getKey

const rowOf = (values: Array<string>) => ({
  a: values[0] ?? ``,
  b: values[1] ?? ``,
  c: values[2] ?? ``,
})

// Short strings over separator-like characters.
const unit = fc.constantFrom(`a`, `-`, `"`, `\\`, `,`, `[`, `]`)
const value = fc.string({ unit, maxLength: 3 })

// Splits `text` into `width` parts at the given cut points.
const split = (text: string, cuts: Array<number>): Array<string> => {
  const bounds = [0, ...cuts.sort((x, y) => x - y), text.length]
  return bounds.slice(1).map((end, index) => text.slice(bounds[index], end))
}

// Two tuples of `width` values cut from the same text. Independently drawn
// tuples almost never line up, so this is what makes distinct tuples with
// overlapping contents (`['a-', 'b']` and `['a', '-b']`) common. Equal cuts
// give equal tuples.
const compositePair = fc
  .tuple(fc.integer({ min: 2, max: 3 }), fc.string({ unit, maxLength: 6 }))
  .chain(([width, text]) => {
    const cuts = fc.array(fc.integer({ min: 0, max: text.length }), {
      minLength: width - 1,
      maxLength: width - 1,
    })
    return fc
      .tuple(cuts, cuts)
      .map(([left, right]) => [split(text, left), split(text, right)] as const)
  })

describe(`collection keys`, () => {
  fcTest.prop([compositePair], { numRuns: 500 })(
    `composite keys are equal exactly when every key column is equal`,
    ([left, right]) => {
      const getKey = getKeyFor(columns.slice(0, left.length))
      const sameKey = getKey(rowOf(left)) === getKey(rowOf(right))
      expect(sameKey).toBe(left.every((part, index) => part === right[index]))
    },
  )

  test(`a collection without key columns is rejected`, () => {
    // With no key columns an update or delete would have no row filter, and
    // PostgREST would apply it to every row the policy allows.
    expect(() => getKeyFor([])).toThrow(/at least one key column/)
  })

  fcTest.prop([value], { numRuns: 100 })(
    `a single key column is the column value itself`,
    (id) => {
      expect(getKeyFor([`a`])(rowOf([id]))).toBe(id)
    },
  )
})
