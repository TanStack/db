import { expect } from 'vitest'
import { MessageTracker } from '../test-utils.js'
import type { MultiSet } from '../../src/multiset.js'

/**
 * # What does the signed top-K oracle remember?
 *
 * A top-K operator emits signed changes. A positive weight inserts one entry.
 * A negative weight retracts one matching entry. The oracle adds these weights
 * across all messages and keeps nonzero residue.
 *
 * A valid visible result has weight one for every live entry. Numeric indexes
 * must equal the requested offset and position. Fractional string indexes are
 * opaque, so the oracle checks only their strict order.
 *
 * This model covers finite scalar keys, scalar indexes, and rows with numeric
 * IDs and string values. It does not define identity for rich or cyclic values.
 */

type Row = { id: number; value: string }
type Entry<K, I> = [K, [Row, I]]
type Expected<K> = Array<[K, number, string]>

// Identity includes every scalar field that can distinguish two modeled
// entries. A zero weight removes an entry. Every other weight stays visible to
// the checker, including negative and duplicate residue.
export class TopKRelation<
  K extends string | number | null,
  I extends number | string,
> {
  private entries = new Map<string, { entry: Entry<K, I>; weight: number }>()

  add(messages: Array<[Entry<K, I>, number]>) {
    for (const [[key, [row, index]], weight] of messages) {
      expect(Number.isInteger(weight)).toBe(true)
      // JSON encodes NaN as null, so reject it outside the model's domain.
      if (typeof key === `number`) expect(Number.isFinite(key)).toBe(true)
      const identity = JSON.stringify([key, row.id, row.value, index])
      const next = (this.entries.get(identity)?.weight ?? 0) + weight
      if (next === 0) this.entries.delete(identity)
      else
        this.entries.set(identity, {
          entry: [key, [{ id: row.id, value: row.value }, index]],
          weight: next,
        })
    }
  }

  expectRows(expected: Expected<K>, numericOffset?: number) {
    const rows = [...this.entries.values()]
    for (const row of rows) expect(row.weight).toBe(1)
    rows.sort((a, b) =>
      a.entry[1][1] < b.entry[1][1]
        ? -1
        : a.entry[1][1] > b.entry[1][1]
          ? 1
          : 0,
    )
    expect(
      rows.map(({ entry: [key, [row]] }) => [key, row.id, row.value]),
    ).toEqual(expected)
    const indices = rows.map(({ entry }) => entry[1][1])
    if (numericOffset !== undefined) {
      expect(indices).toEqual(expected.map((_, index) => numericOffset + index))
    } else {
      for (const index of indices) expect(typeof index).toBe(`string`)
      for (let i = 1; i < indices.length; i++)
        expect(indices[i - 1]! < indices[i]!).toBe(true)
    }
  }
}

// MessageTracker measures transfer work and can reset. The semantic relation
// must persist across that reset so later checks still include earlier changes.
export class TopKMessageTracker<
  K extends string | number | null,
  I extends number | string,
> extends MessageTracker<Entry<K, I>> {
  readonly relation = new TopKRelation<K, I>()

  override addMessage(message: MultiSet<Entry<K, I>>) {
    this.relation.add(message.getInner())
    super.addMessage(message)
  }
}
