import { compareHashValues } from '../hashing/hash.js'
import { TopKArray } from './topKArray.js'
import type { MultiSet } from '../multiset.js'
import type { IndexedValue } from './topKArray.js'

type TopKOutput<K, T> = Array<[[K, IndexedValue<T>], number]>

/** Apply a keyed batch's retractions before additions. An outer join can emit
 * a replacement in the opposite order; key multiplicity alone would hide it.
 * Consolidate first so a transient value added and removed in this same turn
 * cannot be mistaken for the final replacement. Use structural identity of
 * row values: map can allocate a fresh value for each side of a cancelling
 * pair, and -0 and 0 are distinct row values (maintainer decision
 * 2026-11-02), so a change of only a zero's sign is a replacement.
 * No state survives the run.
 */
export function* topKBatch<K, T>(messages: Array<MultiSet<[K, T]>>) {
  const keyed = new Map<K, Array<[[K, T], number]>>()
  for (const message of messages) {
    for (const [value, weight] of message.getInner()) {
      const entries = keyed.get(value[0])
      if (!entries) {
        keyed.set(value[0], [[value, weight]])
        continue
      }
      // Compare only versions of the same key. A per-key scan keeps normal
      // replacements cheap and never merges keys on a hash collision.
      const previous = entries.find(([candidate]) =>
        compareHashValues(candidate[1], value[1], true),
      )
      if (previous) previous[1] += weight
      else entries.push([value, weight])
    }
  }
  for (const entries of keyed.values())
    for (const entry of entries) if (entry[1] < 0) yield entry
  for (const entries of keyed.values())
    for (const entry of entries) if (entry[1] > 0) yield entry
}

/**
 * An array window with keyed support tracking and signed output projection.
 *
 * This class is used by both TopKWithFractionalIndexOperator (single instance)
 * and GroupedTopKWithFractionalIndexOperator (one instance per group).
 */
export class TopKState<K extends string | number, T> extends TopKArray<[K, T]> {
  #multiplicities: Map<K, number> = new Map()

  get isEmpty(): boolean {
    // Installed rows are exactly the keys with positive support. Negative
    // support remains recorded, so an empty map also means an empty array.
    return this.#multiplicities.size === 0
  }

  /**
   * Process an element update (insert or delete based on multiplicity change).
   * Append the signed changes to the topK window to the caller's output.
   */
  processElement(
    key: K,
    value: T,
    multiplicity: number,
    result: TopKOutput<K, T>,
  ): void {
    const oldMultiplicity = this.#multiplicities.get(key) ?? 0
    const newMultiplicity = oldMultiplicity + multiplicity
    if (multiplicity !== 0) {
      if (newMultiplicity === 0) this.#multiplicities.delete(key)
      else this.#multiplicities.set(key, newMultiplicity)
    }

    // Crossing positive support inserts or removes a row. Other changes leave
    // visibility unchanged and produce no window delta.
    if (oldMultiplicity > 0 !== newMultiplicity > 0) {
      const changes =
        newMultiplicity > 0
          ? super.insert([key, value])
          : super.delete([key, value])
      appendMove(changes.moveIn, result, 1)
      appendMove(changes.moveOut, result, -1)
    }
  }

  /**
   * Move the array window and append its signed changes.
   */
  moveWindow(
    options: { offset?: number; limit?: number },
    result: TopKOutput<K, T>,
  ): boolean {
    const changes = super.move(options)
    for (const value of changes.moveIns) appendMove(value, result, 1)
    for (const value of changes.moveOuts) appendMove(value, result, -1)
    return changes.changes
  }
}

/**
 * Both operators expose the same signed, fractionally indexed row shape.
 * Keep its projection beside the shared state transition that produces it.
 */
function appendMove<K extends string | number, T>(
  change: IndexedValue<[K, T]> | null,
  result: TopKOutput<K, T>,
  weight: number,
): void {
  if (change) {
    const [[key, value], index] = change
    result.push([[key, [value, index]], weight])
  }
}
