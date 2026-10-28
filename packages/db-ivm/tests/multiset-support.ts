// Shared by the MultiSet consolidation oracle and its ordinary tests: the
// tagged encoding of record contents that detects a replaced input record.
import type { MultiSetArray } from '../src/multiset.js'

export type Data = unknown

// A tagged encoding of every record's contents. Reusing identities across
// snapshots exposes replacement by a distinct reference with equal contents.
// Symbol and function identities remain distinct; tags keep `-0`, `NaN`, and
// `undefined` distinct.
export function contentsOf(
  records: MultiSetArray<Data>,
  ids: Map<object | symbol, number>,
): string {
  const encode = (value: Data): Data => {
    if (typeof value === `symbol` || typeof value === `function`) {
      if (!ids.has(value)) ids.set(value, ids.size)
      return [typeof value, ids.get(value)]
    }
    if (value === null || typeof value !== `object`)
      return [typeof value, Object.is(value, -0) ? `-0` : String(value)]
    if (!ids.has(value)) ids.set(value, ids.size)
    return [
      ids.get(value),
      Object.entries(value).map(([key, item]) => [key, encode(item)]),
    ]
  }
  return JSON.stringify(records.map(([data, m]) => [encode(data), m]))
}
