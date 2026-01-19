import { TopKArray } from './topKArray.js'
import type {
  IndexedValue,
  TopK,
  TopKChanges,
  TopKMoveChanges,
} from './topKArray.js'

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
