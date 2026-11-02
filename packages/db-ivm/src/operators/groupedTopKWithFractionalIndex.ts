import { UnaryOperator } from '../graph.js'
import { unaryOperator } from '../unary-operator.js'
import { MultiSet } from '../multiset.js'
import {
  TopKState,
  handleMoveIn,
  handleMoveOut,
  topKBatch,
} from './topKState.js'
import { TopKArray, createKeyedComparator } from './topKArray.js'
import type { IndexedValue } from './topKArray.js'
import type {
  DifferenceStreamReader,
  DifferenceStreamWriter,
} from '../graph.js'
import type { PipedOperator } from '../types.js'

export interface GroupedTopKWithFractionalIndexOptions<K, T> {
  limit?: number
  offset?: number
  setSizeCallback?: (getSize: () => number) => void
  setWindowFn?: (
    windowFn: (options: { offset?: number; limit?: number }) => void,
  ) => void
  /**
   * Function to extract a group key from the element's key and value.
   * Elements with the same group key will be sorted and limited together.
   */
  groupKeyFn: (key: K, value: T) => unknown
}

/**
 * Operator for grouped fractional indexed topK operations.
 * This operator maintains separate topK windows for each group,
 * allowing per-group limits and ordering.
 *
 * The input is a keyed stream [K, T] and outputs [K, IndexedValue<T>].
 * Elements are grouped by the groupKeyFn, and each group maintains
 * its own sorted collection with independent limit/offset.
 */
export class GroupedTopKWithFractionalIndexOperator<
  K extends string | number,
  T,
> extends UnaryOperator<[K, T], [K, IndexedValue<T>]> {
  #groupStates: Map<unknown, TopKState<K, T>> = new Map()
  #groupKeyFn: (key: K, value: T) => unknown
  #comparator: (a: [K, T], b: [K, T]) => number
  #offset: number
  #limit: number

  constructor(
    id: number,
    inputA: DifferenceStreamReader<[K, T]>,
    output: DifferenceStreamWriter<[K, IndexedValue<T>]>,
    comparator: (a: T, b: T) => number,
    options: GroupedTopKWithFractionalIndexOptions<K, T>,
  ) {
    super(id, inputA, output)
    this.#groupKeyFn = options.groupKeyFn
    this.#limit = options.limit ?? Infinity
    this.#offset = options.offset ?? 0
    this.#comparator = createKeyedComparator(comparator)
    options.setSizeCallback?.(() => this.#getTotalSize())
    options.setWindowFn?.(this.#moveTopK.bind(this))
  }

  #getTotalSize(): number {
    let size = 0
    for (const state of this.#groupStates.values()) {
      size += state.size
    }
    return size
  }

  /**
   * Moves the topK window for all groups based on the provided offset and limit.
   * Any changes to the topK are sent to the output.
   */
  #moveTopK({ offset, limit }: { offset?: number; limit?: number }): void {
    if (offset !== undefined) {
      this.#offset = offset
    }
    if (limit !== undefined) {
      this.#limit = limit
    }

    const result: Array<[[K, IndexedValue<T>], number]> = []
    let hasChanges = false

    for (const state of this.#groupStates.values()) {
      const diff = state.move({ offset: this.#offset, limit: this.#limit }) // TODO: think we should just pass offset and limit

      diff.moveIns.forEach((moveIn) => handleMoveIn(moveIn, result))
      diff.moveOuts.forEach((moveOut) => handleMoveOut(moveOut, result))

      if (diff.changes) {
        hasChanges = true
      }
    }

    if (hasChanges) {
      this.output.sendData(new MultiSet(result))
    }
  }

  run(): void {
    const result: Array<[[K, IndexedValue<T>], number]> = []
    for (const [[key, value], multiplicity] of topKBatch(
      this.inputMessages(),
    )) {
      const groupKey = this.#groupKeyFn(key, value)
      let state = this.#groupStates.get(groupKey)
      if (!state) {
        state = new TopKState(
          new TopKArray(this.#offset, this.#limit, this.#comparator),
        )
        this.#groupStates.set(groupKey, state)
      }

      const changes = state.processElement(key, value, multiplicity)
      handleMoveIn(changes.moveIn, result)
      handleMoveOut(changes.moveOut, result)

      // Cleanup empty groups to prevent memory leaks
      if (state.isEmpty) this.#groupStates.delete(groupKey)
    }

    if (result.length > 0) {
      this.output.sendData(new MultiSet(result))
    }
  }
}

/**
 * Limits the number of results per group based on a comparator, with optional offset.
 * Uses fractional indexing to minimize the number of changes when elements move positions.
 * Each element is assigned a fractional index that is lexicographically sortable.
 * When elements move, only the indices of the moved elements are updated, not all elements.
 *
 * This operator groups elements by the provided groupKeyFn and applies the limit/offset
 * independently to each group.
 *
 * @param comparator - A function that compares two elements for ordering
 * @param options - Configuration including groupKeyFn, limit, and offset
 * @returns A piped operator that orders elements per group and limits results per group
 */
export function groupedTopKWithFractionalIndex<K extends string | number, T>(
  comparator: (a: T, b: T) => number,
  options: GroupedTopKWithFractionalIndexOptions<K, T>,
): PipedOperator<[K, T], [K, IndexedValue<T>]> {
  return unaryOperator(
    GroupedTopKWithFractionalIndexOperator<K, T>,
    comparator,
    options,
  )
}
