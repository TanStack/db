import { DifferenceStreamWriter, UnaryOperator } from '../graph.js'
import { StreamBuilder } from '../d2.js'
import { MultiSet } from '../multiset.js'
import {
  TopKArray,
  createKeyedComparator,
} from './topKWithFractionalIndex.js'
import type { DifferenceStreamReader } from '../graph.js'
import type { IStreamBuilder, PipedOperator } from '../types.js'
import type {
  IndexedValue,
  TopK,
  TopKChanges,
  TopKMoveChanges,
} from './topKWithFractionalIndex.js'

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
 * State for a single group in the grouped topK operator.
 * Each group maintains its own multiplicity index and topK data structure.
 */
type GroupState<K extends string | number, T> = {
  /** Maps element keys to their multiplicities within this group */
  multiplicities: Map<K, number>
  /** The topK data structure for this group */
  topK: TopK<[K, T]>
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
  #groupStates: Map<unknown, GroupState<K, T>> = new Map()
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

  /**
   * Creates a new TopK data structure for a group.
   * Can be overridden in subclasses to use different implementations (e.g., B+ tree).
   */
  protected createTopK(
    offset: number,
    limit: number,
    comparator: (a: [K, T], b: [K, T]) => number,
  ): TopK<[K, T]> {
    return new TopKArray(offset, limit, comparator)
  }

  #getTotalSize(): number {
    let size = 0
    for (const state of this.#groupStates.values()) {
      size += state.topK.size
    }
    return size
  }

  #getOrCreateGroupState(groupKey: unknown): GroupState<K, T> {
    let state = this.#groupStates.get(groupKey)
    if (!state) {
      state = {
        multiplicities: new Map(),
        topK: this.createTopK(this.#offset, this.#limit, this.#comparator),
      }
      this.#groupStates.set(groupKey, state)
    }
    return state
  }

  #updateMultiplicity(
    state: GroupState<K, T>,
    key: K,
    multiplicity: number,
  ): { oldMultiplicity: number; newMultiplicity: number } {
    if (multiplicity === 0) {
      const current = state.multiplicities.get(key) ?? 0
      return { oldMultiplicity: current, newMultiplicity: current }
    }

    const oldMultiplicity = state.multiplicities.get(key) ?? 0
    const newMultiplicity = oldMultiplicity + multiplicity
    if (newMultiplicity === 0) {
      state.multiplicities.delete(key)
    } else {
      state.multiplicities.set(key, newMultiplicity)
    }
    return { oldMultiplicity, newMultiplicity }
  }

  #cleanupGroupIfEmpty(groupKey: unknown, state: GroupState<K, T>): void {
    if (state.multiplicities.size === 0 && state.topK.size === 0) {
      this.#groupStates.delete(groupKey)
    }
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
      if (!(state.topK instanceof TopKArray)) {
        throw new Error(
          `Cannot move B+-tree implementation of GroupedTopK with fractional index`,
        )
      }

      const diff: TopKMoveChanges<[K, T]> = state.topK.move({
        offset: this.#offset,
        limit: this.#limit,
      })

      diff.moveIns.forEach((moveIn) => this.#handleMoveIn(moveIn, result))
      diff.moveOuts.forEach((moveOut) => this.#handleMoveOut(moveOut, result))

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
    for (const message of this.inputMessages()) {
      for (const [item, multiplicity] of message.getInner()) {
        const [key, value] = item
        this.#processElement(key, value, multiplicity, result)
      }
    }

    if (result.length > 0) {
      this.output.sendData(new MultiSet(result))
    }
  }

  #processElement(
    key: K,
    value: T,
    multiplicity: number,
    result: Array<[[K, IndexedValue<T>], number]>,
  ): void {
    const groupKey = this.#groupKeyFn(key, value)
    const state = this.#getOrCreateGroupState(groupKey)

    const { oldMultiplicity, newMultiplicity } = this.#updateMultiplicity(
      state,
      key,
      multiplicity,
    )

    let res: TopKChanges<[K, T]> = {
      moveIn: null,
      moveOut: null,
    }
    if (oldMultiplicity <= 0 && newMultiplicity > 0) {
      // The value was invisible but should now be visible
      // Need to insert it into the array of sorted values
      res = state.topK.insert([key, value])
    } else if (oldMultiplicity > 0 && newMultiplicity <= 0) {
      // The value was visible but should now be invisible
      // Need to remove it from the array of sorted values
      res = state.topK.delete([key, value])
    }
    // else: The value was invisible and remains invisible,
    // or was visible and remains visible - no topK change

    this.#handleMoveIn(res.moveIn, result)
    this.#handleMoveOut(res.moveOut, result)

    // Cleanup empty groups to prevent memory leaks
    this.#cleanupGroupIfEmpty(groupKey, state)
  }

  #handleMoveIn(
    moveIn: IndexedValue<[K, T]> | null,
    result: Array<[[K, IndexedValue<T>], number]>,
  ): void {
    if (moveIn) {
      const [[key, value], index] = moveIn
      result.push([[key, [value, index]], 1])
    }
  }

  #handleMoveOut(
    moveOut: IndexedValue<[K, T]> | null,
    result: Array<[[K, IndexedValue<T>], number]>,
  ): void {
    if (moveOut) {
      const [[key, value], index] = moveOut
      result.push([[key, [value, index]], -1])
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
  return (
    stream: IStreamBuilder<[K, T]>,
  ): IStreamBuilder<[K, IndexedValue<T>]> => {
    const output = new StreamBuilder<[K, IndexedValue<T>]>(
      stream.graph,
      new DifferenceStreamWriter<[K, IndexedValue<T>]>(),
    )
    const operator = new GroupedTopKWithFractionalIndexOperator<K, T>(
      stream.graph.getNextOperatorId(),
      stream.connectReader(),
      output.writer,
      comparator,
      options,
    )
    stream.graph.addOperator(operator)
    return output
  }
}
