import { generateKeyBetween } from 'fractional-indexing'
import { binarySearch, compareKeys } from '../utils.js'

// Abstraction for fractionally indexed values
export type FractionalIndex = string
export type IndexedValue<V> = [V, FractionalIndex]

/**
 * Creates a comparator for [key, value] tuples that first compares values,
 * then uses the row key as a stable tie-breaker.
 */
export function createKeyedComparator<K extends string | number, T>(
  comparator: (a: T, b: T) => number,
): (a: [K, T], b: [K, T]) => number {
  return ([aKey, aVal], [bKey, bVal]) => {
    // First compare on the value
    const valueComparison = comparator(aVal, bVal)
    if (valueComparison !== 0) {
      return valueComparison
    }
    // If the values are equal, use the row key as tie-breaker
    // This provides stable, deterministic ordering since keys are string | number
    return compareKeys(aKey, bKey)
  }
}

export type TopKChanges<V> = {
  /** Indicates which element moves into the topK (if any) */
  moveIn: IndexedValue<V> | null
  /** Indicates which element moves out of the topK (if any) */
  moveOut: IndexedValue<V> | null
}

export type TopKMoveChanges<V> = {
  /** Flag that marks whether there were any changes to the topK */
  changes: boolean
  /** Indicates which elements move into the topK (if any) */
  moveIns: Array<IndexedValue<V>>
  /** Indicates which elements move out of the topK (if any) */
  moveOuts: Array<IndexedValue<V>>
}

/**
 * A topK data structure that supports insertions and deletions
 * and returns changes to the topK.
 */
export interface TopK<V> {
  size: number
  /**
   * The number of leading window values that satisfy a predicate that holds
   * for a prefix of the window order. Optional; a caller falls back to size.
   */
  countLeadingInWindow?: (predicate: (value: V) => boolean) => number
  insert: (value: V) => TopKChanges<V>
  delete: (value: V) => TopKChanges<V>
}

/**
 * Implementation of a topK data structure.
 * Uses a sorted array internally to store the values and keeps a topK window over that array.
 * Inserts and deletes are O(n) operations because worst case an element is inserted/deleted
 * at the start of the array which causes all the elements to shift to the right/left.
 */
export class TopKArray<V> implements TopK<V> {
  #sortedValues: Array<IndexedValue<V>> = []
  #comparator: (a: IndexedValue<V>, b: V) => number
  #topKStart: number
  #topKLimit: number

  get #topKEnd(): number {
    return this.#topKStart + this.#topKLimit
  }

  constructor(
    offset: number,
    limit: number,
    comparator: (a: V, b: V) => number,
  ) {
    this.#topKStart = offset
    this.#topKLimit = limit
    this.#comparator = ([row], target) => comparator(row, target)
  }

  get size(): number {
    return Math.max(
      0,
      Math.min(this.#topKLimit, this.#sortedValues.length - this.#topKStart),
    )
  }

  countLeadingInWindow(predicate: (value: V) => boolean): number {
    let count = 0
    const end = this.#topKStart + this.size
    for (let index = this.#topKStart; index < end; index++) {
      if (!predicate(this.#sortedValues[index]![0])) break
      count++
    }
    return count
  }

  /**
   * Moves the topK window
   */
  move({
    offset,
    limit,
  }: {
    offset?: number
    limit?: number
  }): TopKMoveChanges<V> {
    const oldOffset = this.#topKStart
    const oldLimit = this.#topKLimit
    const oldEnd = this.#topKEnd
    this.#topKStart = offset ?? oldOffset
    this.#topKLimit = limit ?? oldLimit

    // A window minus another window has at most two intervals. Slice the rows
    // directly: slice clamps to installed ranks without enumerating absent ones.
    // Keep authored bounds exact for future inserts and partial moves.
    const outside = (
      start: number,
      end: number,
      otherStart: number,
      otherEnd: number,
    ) =>
      this.#sortedValues
        .slice(start, Math.min(end, otherStart))
        .concat(this.#sortedValues.slice(Math.max(start, otherEnd), end))
    const moveIns = outside(this.#topKStart, this.#topKEnd, oldOffset, oldEnd)
    const moveOuts = outside(oldOffset, oldEnd, this.#topKStart, this.#topKEnd)

    // It could be that there are changes (i.e. moveIns or moveOuts)
    // but that the collection is lazy so we don't have the data yet that needs to move in/out
    // so `moveIns` and `moveOuts` will be empty but `changes` will be true
    // this will tell the caller that it needs to run the graph to load more data
    const changes =
      (oldLimit > 0 || this.#topKLimit > 0) &&
      (oldOffset !== this.#topKStart || oldLimit !== this.#topKLimit)
    return { moveIns, moveOuts, changes }
  }

  insert(value: V): TopKChanges<V> {
    // Lookup insert position
    const index = this.#findIndex(value)
    // Generate fractional index based on the fractional indices of the elements before and after it
    const fractionalIndex = generateKeyBetween(
      this.#sortedValues[index - 1]?.[1] ?? null,
      this.#sortedValues[index]?.[1] ?? null,
    )

    // Insert the value at the correct position
    const val: IndexedValue<V> = [value, fractionalIndex]
    // Splice is O(n) where n = all elements in the collection (i.e. n >= k) !
    this.#sortedValues.splice(index, 0, val)

    return this.#windowChanges(index, true)
  }

  /**
   * Deletes a value that may or may not be in the topK.
   * IMPORTANT: this assumes that the value is present in the collection
   *            if it's not the case it will remove the element
   *            that is on the position where the provided `value` would be.
   */
  delete(value: V): TopKChanges<V> {
    // Lookup delete position
    const index = this.#findIndex(value)
    // Remove the value at that position
    const [removedElem] = this.#sortedValues.splice(index, 1)

    return this.#windowChanges(index, false, removedElem)
  }

  // Insertion shifts retained rows right; deletion shifts them left. Only a
  // change before the exclusive end can cross either window boundary.
  #windowChanges(
    index: number,
    inserting: boolean,
    removed?: IndexedValue<V>,
  ): TopKChanges<V> {
    const start = this.#topKStart
    const end = this.#topKEnd
    if (start === end || index >= end) return { moveIn: null, moveOut: null }
    const moveIn =
      this.#sortedValues[inserting ? Math.max(index, start) : end - 1] ?? null
    // A deletion before the window ejects its first row, now at start - 1;
    // a deletion inside it ejects the removed row. Insertion ejects the last
    // row, now at end.
    const moveOut = inserting
      ? this.#sortedValues[end]
      : index < start
        ? this.#sortedValues[start - 1]
        : removed
    return { moveIn, moveOut: moveOut ?? null }
  }

  #findIndex(value: V): number {
    return binarySearch(this.#sortedValues, value, this.#comparator)
  }
}
