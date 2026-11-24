import { compareHashValues } from '../hashing/hash.js'
import { TopKArray } from './topKArray.js'
import type { MultiSet } from '../multiset.js'
import type { IndexedValue } from './topKArray.js'

type TopKOutput<K, T> = Array<[[K, IndexedValue<T>], number]>

/** Two structurally equal versions of a key that a batch cancelled. */
export type TopKReplacement<K, T> = { key: K; retracted: T; added: T }

/** Apply a keyed batch's retractions before additions. An outer join can emit
 * a replacement in the opposite order; key multiplicity alone would hide it.
 * Consolidate first so a transient value added and removed in this same turn
 * cannot be mistaken for the final replacement. Use structural identity of
 * row values: map can allocate a fresh value for each side of a cancelling
 * pair, and -0 and 0 are distinct row values (maintainer decision
 * 2026-11-02), so a change of only a zero's sign is a replacement.
 * No state survives the run.
 *
 * A caller that distinguishes instances passes `replacements`, which receives
 * each cancelled group of a key's versions, with its first retraction and last
 * addition. The batch itself is the same with or without it.
 */
export function* topKBatch<K, T>(
  messages: Array<MultiSet<[K, T]>>,
  replacements?: Array<TopKReplacement<K, T>>,
) {
  const keyed = new Map<K, Array<[[K, T], number]>>()
  const versions = new Map<[[K, T], number], { retracted?: T; added?: T }>()
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
      if (previous) {
        if (replacements) {
          let sides = versions.get(previous)
          if (!sides) {
            sides =
              previous[1] < 0
                ? { retracted: previous[0][1] }
                : { added: previous[0][1] }
            versions.set(previous, sides)
          }
          if (weight > 0) sides.added = value[1]
          else sides.retracted ??= value[1]
        }
        previous[1] += weight
      } else entries.push([value, weight])
    }
  }
  for (const [entry, sides] of versions) {
    if (entry[1] === 0) {
      replacements!.push({
        key: entry[0][0],
        retracted: sides.retracted!,
        added: sides.added!,
      })
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
   * Whether this key's stored row is the version `retracted` stands for, so a
   * cancelled pair replaces it. A transient pair names some other version.
   */
  holdsVersion(
    key: K,
    retracted: T,
    replacesRow: (previous: T, next: T) => boolean,
  ): boolean {
    const stored = this.find([key, retracted])
    return (
      stored !== undefined &&
      stored[0] === key &&
      !replacesRow(stored[1], retracted)
    )
  }

  /**
   * Install an instance that replaces a structurally equal row. The batch
   * cancelled the pair, but readers of the row's instance need the new one,
   * and its order can differ when it depends on state hashing does not read.
   */
  replaceElement(
    key: K,
    retracted: T,
    added: T,
    result: TopKOutput<K, T>,
  ): void {
    const stored = this.find([key, retracted])!
    const removed = super.delete(stored)
    appendMove(removed.moveIn, result, 1)
    appendMove(removed.moveOut, result, -1)
    const inserted = super.insert([key, added])
    appendMove(inserted.moveIn, result, 1)
    appendMove(inserted.moveOut, result, -1)
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
