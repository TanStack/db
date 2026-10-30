import { LinearUnaryOperator } from '../graph.js'
import { unaryOperator } from '../unary-operator.js'
import type { PipedOperator } from '../types.js'
import type {
  DifferenceStreamReader,
  DifferenceStreamWriter,
} from '../graph.js'
import type { MultiSet } from '../multiset.js'

/**
 * Operator that applies a function to each multi-set in the input stream
 */
export class TapOperator<T> extends LinearUnaryOperator<T, T> {
  #f: (data: MultiSet<T>) => void

  constructor(
    id: number,
    inputA: DifferenceStreamReader<T>,
    output: DifferenceStreamWriter<T>,
    f: (data: MultiSet<T>) => void,
  ) {
    super(id, inputA, output)
    this.#f = f
  }

  inner(collection: MultiSet<T>): MultiSet<T> {
    this.#f(collection)
    return collection
  }
}

/**
 * Invokes a function for each multi-set in the input stream.
 * This operator doesn't modify the stream and is used to perform side effects.
 * @param f - The function to invoke on each multi-set
 * @returns The input stream
 */
export function tap<T>(f: (data: MultiSet<T>) => void): PipedOperator<T, T> {
  return unaryOperator(TapOperator<T>, f)
}
