import { DifferenceStreamWriter, UnaryOperator } from '../graph.js'
import { StreamBuilder } from '../d2.js'
import { MultiSet } from '../multiset.js'
import { TopKState, handleMoveIn, handleMoveOut } from './topKState.js'
import { TopKArray, createKeyedComparator } from './topKArray.js'
import type { IndexedValue, TopK } from './topKArray.js'
import type { DifferenceStreamReader } from '../graph.js'
import type { IStreamBuilder, PipedOperator } from '../types.js'

export interface TopKWithFractionalIndexOptions {
  limit?: number
  offset?: number
  setSizeCallback?: (getSize: () => number) => void
  setWindowFn?: (
    windowFn: (options: { offset?: number; limit?: number }) => void,
  ) => void
}

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
    const limit = options.limit ?? Infinity
    const offset = options.offset ?? 0
    const topK = this.createTopK(
      offset,
      limit,
      createKeyedComparator(comparator),
    )
    this.#state = new TopKState(topK)
    options.setSizeCallback?.(() => this.#state.size)
    options.setWindowFn?.(this.moveTopK.bind(this))
  }

  protected createTopK(
    offset: number,
    limit: number,
    comparator: (a: [K, T], b: [K, T]) => number,
  ): TopK<[K, T]> {
    return new TopKArray(offset, limit, comparator)
  }

  /**
   * Moves the topK window based on the provided offset and limit.
   * Any changes to the topK are sent to the output.
   */
  moveTopK({ offset, limit }: { offset?: number; limit?: number }) {
    const result: Array<[[K, IndexedValue<T>], number]> = []
    const diff = this.#state.move({ offset, limit })

    diff.moveIns.forEach((moveIn) => handleMoveIn(moveIn, result))
    diff.moveOuts.forEach((moveOut) => handleMoveOut(moveOut, result))

    if (diff.changes) {
      // There are changes to the topK
      // it could be that moveIns and moveOuts are empty
      // because the collection is lazy, so we will run the graph again to load the data
      this.output.sendData(new MultiSet(result))
    }
  }

  run(): void {
    const result: Array<[[K, IndexedValue<T>], number]> = []
    for (const message of this.inputMessages()) {
      for (const [item, multiplicity] of message.getInner()) {
        const [key, value] = item
        this.processElement(key, value, multiplicity, result)
      }
    }

    if (result.length > 0) {
      this.output.sendData(new MultiSet(result))
    }
  }

  processElement(
    key: K,
    value: T,
    multiplicity: number,
    result: Array<[[K, IndexedValue<T>], number]>,
  ): void {
    const changes = this.#state.processElement(key, value, multiplicity)
    handleMoveIn(changes.moveIn, result)
    handleMoveOut(changes.moveOut, result)
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
  const opts = options || {}

  return (
    stream: IStreamBuilder<[KType, T]>,
  ): IStreamBuilder<[KType, IndexedValue<T>]> => {
    const output = new StreamBuilder<[KType, IndexedValue<T>]>(
      stream.graph,
      new DifferenceStreamWriter<[KType, IndexedValue<T>]>(),
    )
    const operator = new TopKWithFractionalIndexOperator<KType, T>(
      stream.graph.getNextOperatorId(),
      stream.connectReader(),
      output.writer,
      comparator,
      opts,
    )
    stream.graph.addOperator(operator)
    return output
  }
}
