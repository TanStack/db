import { UnaryOperator } from '../graph.js'
import { unaryOperator } from '../unary-operator.js'
import { TopKState, topKBatch } from './topKState.js'
import { createKeyedComparator } from './topKArray.js'
import type { IndexedValue } from './topKArray.js'
import type {
  DifferenceStreamReader,
  DifferenceStreamWriter,
} from '../graph.js'
import type { PipedOperator } from '../types.js'

export interface TopKWithFractionalIndexOptions {
  limit?: number
  offset?: number
  setSizeCallback?: SetSizeCallback
  setWindowFn?: (
    windowFn: (options: { offset?: number; limit?: number }) => void,
  ) => void
}

/**
 * Receives the window size. Given a predicate that holds for a prefix of the
 * window order, the getter counts only the leading values that satisfy it.
 */
export type SetSizeCallback = (
  getSize: (counts?: (value: unknown) => boolean) => number,
) => void

/**
 * Operator for fractional indexed topK operations
 * This operator maintains fractional indices for sorted elements
 * and only updates indices when elements move position
 */
export class TopKWithFractionalIndexOperator<
  K extends string | number,
  T,
> extends UnaryOperator<[K, T], [K, IndexedValue<T>]> {
  #state: TopKState<K, T>

  constructor(
    id: number,
    inputA: DifferenceStreamReader<[K, T]>,
    output: DifferenceStreamWriter<[K, IndexedValue<T>]>,
    comparator: (a: T, b: T) => number,
    options: TopKWithFractionalIndexOptions,
  ) {
    super(id, inputA, output)
    this.#state = new TopKState(
      options.offset ?? 0,
      options.limit ?? Infinity,
      createKeyedComparator(comparator),
    )
    options.setSizeCallback?.((counts) =>
      counts
        ? this.#state.countLeadingInWindow(([, value]) => counts(value))
        : this.#state.size,
    )
    options.setWindowFn?.(this.moveTopK.bind(this))
  }

  /**
   * Moves the topK window based on the provided offset and limit.
   * Any changes to the topK are sent to the output.
   */
  moveTopK({ offset, limit }: { offset?: number; limit?: number }) {
    const result: Array<[[K, IndexedValue<T>], number]> = []
    if (this.#state.moveWindow({ offset, limit }, result)) {
      // There are changes to the topK
      // it could be that moveIns and moveOuts are empty
      // because the collection is lazy, so we will run the graph again to load the data
      this.output.sendData(result)
    }
  }

  run(): void {
    const result: Array<[[K, IndexedValue<T>], number]> = []
    for (const [[key, value], multiplicity] of topKBatch(
      this.inputMessages(),
    )) {
      this.processElement(key, value, multiplicity, result)
    }

    if (result.length > 0) {
      this.output.sendData(result)
    }
  }

  processElement(
    key: K,
    value: T,
    multiplicity: number,
    result: Array<[[K, IndexedValue<T>], number]>,
  ): void {
    this.#state.processElement(key, value, multiplicity, result)
  }
}

/**
 * Limits the number of results based on a comparator, with optional offset.
 * Uses fractional indexing to minimize the number of changes when elements move positions.
 * Each element is assigned a fractional index that is lexicographically sortable.
 * When elements move, only the indices of the moved elements are updated, not all elements.
 *
 * @param comparator - A function that compares two elements
 * @param options - An optional object containing limit and offset properties
 * @returns A piped operator that orders the elements and limits the number of results
 */
export function topKWithFractionalIndex<KType extends string | number, T>(
  comparator: (a: T, b: T) => number,
  options?: TopKWithFractionalIndexOptions,
): PipedOperator<[KType, T], [KType, IndexedValue<T>]> {
  return unaryOperator(
    TopKWithFractionalIndexOperator<KType, T>,
    comparator,
    options || {},
  )
}
