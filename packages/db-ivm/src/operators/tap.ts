import { DifferenceStreamWriter, LinearUnaryOperator } from "../graph.js"
import { StreamBuilder } from "../d2.js"
import type { IStreamBuilder, PipedOperator } from "../types.js"
import type { DifferenceStreamReader } from "../graph.js"
import type { MultiSet } from "../multiset.js"

/**
 * Operator that applies a function to each element in the input stream
 */
export class TapOperator<T> extends LinearUnaryOperator<T, T> {
  #f: (data: T) => void

  constructor(
    id: number,
    inputA: DifferenceStreamReader<T>,
    output: DifferenceStreamWriter<T>,
    f: (data: T) => void
  ) {
    super(id, inputA, output)
    this.#f = f
  }

  inner(collection: MultiSet<T>): MultiSet<T> {
    return collection.map((data) => {
      this.#f(data)
      return data
    })
  }
}

/**
 * Invokes a function for each element in the input stream.
 * This operator doesn't modify the stream and is used to perform side effects.
 * @param f - The function to invoke on each element
 * @returns The input stream
 */
export function tap<T>(f: (data: T) => void): PipedOperator<T, T> {
  return (stream: IStreamBuilder<T>): IStreamBuilder<T> => {
    const output = new StreamBuilder<T>(
      stream.graph,
      new DifferenceStreamWriter<T>()
    )
    const operator = new TapOperator<T>(
      stream.graph.getNextOperatorId(),
      stream.connectReader(),
      output.writer,
      f
    )
    stream.graph.addOperator(operator)
    stream.graph.addStream(output.connectReader())
    return output
  }
}
