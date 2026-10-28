import { PropRef } from '../src/query/ir.js'
import type { OrderBy } from '../src/query/ir.js'

/**
 * Column-indexed ordering for cursor tests: term `i` orders `column${i}`. The
 * cursor oracle and the ordinary cursor tests share this helper.
 */
export type Term = {
  direction: `asc` | `desc`
  nulls: `first` | `last`
}

export function orderBy(terms: ReadonlyArray<Term>): OrderBy {
  return terms.map((compareOptions, index) => ({
    expression: new PropRef([`column${index}`]),
    compareOptions,
  }))
}
