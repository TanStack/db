import { hash } from '../hashing/index.js'
import { equalHashValues } from '../hashing/hash.js'
import { TopKArray } from './topKArray.js'
import type { MultiSet } from '../multiset.js'
import type {
  IndexedValue,
  TopK,
  TopKChanges,
  TopKMoveChanges,
} from './topKArray.js'

/** Apply a keyed batch's retractions before additions. An outer join can emit
 * a replacement in the opposite order; key multiplicity alone would hide it.
 * Consolidate first so a transient value added and removed in this same turn
 * cannot be mistaken for the final replacement. Use structural relation
 * identity: map can allocate a fresh value for each side of a cancelling pair.
 * No state survives the run.
 */
export function* topKBatch<K, T>(messages: Array<MultiSet<[K, T]>>) {
  const keyed = new Map<K, Array<[[K, T], number]>>()
  for (const message of messages) {
    for (const [value, weight] of message.getInner()) {
      const entries = keyed.get(value[0])
      if (entries) entries.push([value, weight])
      else keyed.set(value[0], [[value, weight]])
    }
  }
  const batch: Array<[[K, T], number]> = []
  for (const entries of keyed.values()) {
    // Ordering distinct keys needs only the caller's comparator. In particular,
    // do not traverse irrelevant payloads or merge keys on a hash collision.
    if (entries.length === 1) {
      batch.push(entries[0]!)
      continue
    }
    const consolidated = new Map<number, Array<[[K, T], number]>>()
    for (const [value, weight] of entries) {
      const identity = hash(value)
      const collisions = consolidated.get(identity)
      const previous = collisions?.find(([candidate]) =>
        equalHashValues(candidate[1], value[1]),
      )
      if (previous) previous[1] += weight
      else if (collisions) collisions.push([value, weight])
      else consolidated.set(identity, [[value, weight]])
    }
    for (const collisions of consolidated.values()) batch.push(...collisions)
  }
  for (const entry of batch) if (entry[1] < 0) yield entry
  for (const entry of batch) if (entry[1] > 0) yield entry
}

/**
 * Helper class that manages the state for a single topK window.
 * Encapsulates the multiplicity tracking and topK data structure,
 * providing a clean interface for processing elements and moving the window.
 *
 * This class is used by both TopKWithFractionalIndexOperator (single instance)
 * and GroupedTopKWithFractionalIndexOperator (one instance per group).
 */
export class TopKState<K extends string | number, T> {
  #multiplicities: Map<K, number> = new Map()
  #topK: TopK<[K, T]>

  constructor(topK: TopK<[K, T]>) {
    this.#topK = topK
  }

  get size(): number {
    return this.#topK.size
  }

  get isEmpty(): boolean {
    return this.#multiplicities.size === 0 && this.#topK.size === 0
  }

  /**
   * Process an element update (insert or delete based on multiplicity change).
   * Returns the changes to the topK window.
   */
  processElement(key: K, value: T, multiplicity: number): TopKChanges<[K, T]> {
    const { oldMultiplicity, newMultiplicity } = this.#updateMultiplicity(
      key,
      multiplicity,
    )

    if (oldMultiplicity <= 0 && newMultiplicity > 0) {
      // The value was invisible but should now be visible
      return this.#topK.insert([key, value])
    } else if (oldMultiplicity > 0 && newMultiplicity <= 0) {
      // The value was visible but should now be invisible
      return this.#topK.delete([key, value])
    }
    // The value was invisible and remains invisible,
    // or was visible and remains visible - no topK change
    return { moveIn: null, moveOut: null }
  }

  /**
   * Move the topK window. Only works with TopKArray implementation.
   */
  move(options: { offset?: number; limit?: number }): TopKMoveChanges<[K, T]> {
    if (!(this.#topK instanceof TopKArray)) {
      throw new Error(
        `Cannot move B+-tree implementation of TopK with fractional index`,
      )
    }
    return this.#topK.move(options)
  }

  #updateMultiplicity(
    key: K,
    multiplicity: number,
  ): { oldMultiplicity: number; newMultiplicity: number } {
    if (multiplicity === 0) {
      const current = this.#multiplicities.get(key) ?? 0
      return { oldMultiplicity: current, newMultiplicity: current }
    }

    const oldMultiplicity = this.#multiplicities.get(key) ?? 0
    const newMultiplicity = oldMultiplicity + multiplicity
    if (newMultiplicity === 0) {
      this.#multiplicities.delete(key)
    } else {
      this.#multiplicities.set(key, newMultiplicity)
    }
    return { oldMultiplicity, newMultiplicity }
  }
}

/**
 * Handles a moveIn change by adding it to the result array.
 */
export function handleMoveIn<K extends string | number, T>(
  moveIn: IndexedValue<[K, T]> | null,
  result: Array<[[K, IndexedValue<T>], number]>,
): void {
  if (moveIn) {
    const [[key, value], index] = moveIn
    result.push([[key, [value, index]], 1])
  }
}

/**
 * Handles a moveOut change by adding it to the result array.
 */
export function handleMoveOut<K extends string | number, T>(
  moveOut: IndexedValue<[K, T]> | null,
  result: Array<[[K, IndexedValue<T>], number]>,
): void {
  if (moveOut) {
    const [[key, value], index] = moveOut
    result.push([[key, [value, index]], -1])
  }
}
