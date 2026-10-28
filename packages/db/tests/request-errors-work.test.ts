import { describe, expect, it } from 'vitest'
import { RequestErrors } from '../src/collection/lifecycle.js'

/**
 * Work witness for request-error bookkeeping. The request error bookkeeping
 * lane of the source-health oracle owns what a node shows; this file only
 * checks what it costs.
 *
 * A failed lazy segment reports one request error per needed key, all with
 * the segment's one error, and a later load settles them one by one. Each
 * report and each settle must cost constant work while the shown problem does
 * not change, so a segment of K keys costs O(K), not O(K²).
 *
 * The counter is deterministic: while the tracker runs, it counts every sort
 * comparison and every element that an array or Map/Set iteration helper
 * visits. Timing is not used.
 */
function countWork(run: () => void): number {
  let work = 0
  const arrayProto = Array.prototype as unknown as Record<
    string,
    (...args: Array<unknown>) => unknown
  >
  const visiting = [
    `find`,
    `findIndex`,
    `flat`,
    `filter`,
    `map`,
    `every`,
    `some`,
    `indexOf`,
    `includes`,
    `forEach`,
    `reduce`,
  ]
  const originals = new Map<string, (...args: Array<unknown>) => unknown>()
  for (const name of visiting) {
    const original = arrayProto[name]!
    originals.set(name, original)
    arrayProto[name] = function (this: Array<unknown>, ...args) {
      work += this.length
      return original.apply(this, args)
    }
  }
  const sort = Array.prototype.sort
  Array.prototype.sort = function <T>(
    this: Array<T>,
    compare?: (a: T, b: T) => number,
  ) {
    return sort.call(this, (a: T, b: T) => {
      work++
      return compare ? compare(a, b) : String(a) < String(b) ? -1 : 1
    }) as Array<T>
  }
  const iterators = [Map.prototype, Set.prototype] as Array<{
    values: () => IterableIterator<unknown>
    size: number
  }>
  const values = iterators.map((proto) => proto.values)
  iterators.forEach((proto, index) => {
    proto.values = function (this: { size: number }) {
      work += this.size
      return values[index]!.call(this)
    }
  })
  try {
    run()
  } finally {
    for (const [name, original] of originals) arrayProto[name] = original
    Array.prototype.sort = sort
    iterators.forEach((proto, index) => (proto.values = values[index]!))
  }
  return work
}

describe(`request error bookkeeping work`, () => {
  it(`costs linear work for one failed segment of many keys`, () => {
    const keys = 2_000
    const error = new Error(`segment failed`)
    const tracker = new RequestErrors()
    let changes = 0
    const work = countWork(() => {
      for (let key = 0; key < keys; key++)
        if (tracker.fail(`plan:${key}`, [error])) changes++
      for (let key = 0; key < keys; key++)
        if (tracker.settle(`plan:${key}`)) changes++
    })
    // The problem appears once and clears once.
    expect(changes).toBe(2)
    expect(tracker.problem).toBeNull()
    expect(work).toBeLessThan(20 * keys)
  })
})
