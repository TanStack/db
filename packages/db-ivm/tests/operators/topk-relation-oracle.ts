import { expect } from 'vitest'
import { MessageTracker } from '../test-utils.js'
import type { MultiSet } from '../../src/multiset.js'

type Row = { id: number; value: string }
type Entry<K, I> = [K, [Row, I]]
type Expected<K> = Array<[K, number, string]>

/** Independent signed relation for the finite scalar, unit-live-row tests.
 * Unlike the work tracker, it never resets, drops negatives or merges weight 2
 * into one row. Exact fractional tokens are not an expected-result authority.
 */
export class TopKRelation<K extends number | null, I extends number | string> {
  private entries = new Map<string, { entry: Entry<K, I>; weight: number }>()

  add(messages: Array<[Entry<K, I>, number]>) {
    for (const [[key, [row, index]], weight] of messages) {
      expect(Number.isInteger(weight)).toBe(true)
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

// Keep existing resettable transfer-work observations. Only the separate
// semantic relation persists through reset; it uses no MultiSet consolidation.
export class TopKMessageTracker<
  K extends number | null,
  I extends number | string,
> extends MessageTracker<Entry<K, I>> {
  readonly relation = new TopKRelation<K, I>()

  override addMessage(message: MultiSet<Entry<K, I>>) {
    this.relation.add(message.getInner())
    super.addMessage(message)
  }
}
