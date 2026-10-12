import { PropRef } from '../src/query/ir.js'
import type { OrderBy } from '../src/query/ir.js'

// Shared request syntax only. Each oracle computes its own expected rows and
// observes its own Collection subscription.
export function valueOrderBy(direction: `asc` | `desc` = `asc`): OrderBy {
  return [
    {
      expression: new PropRef([`value`]),
      compareOptions: { direction, nulls: `first` },
    },
  ]
}
