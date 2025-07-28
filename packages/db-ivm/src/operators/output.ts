import { IStreamBuilder, PipedOperator } from '../types.js'
import {
  DifferenceStreamReader,
  DifferenceStreamWriter,
  UnaryOperator,
} from '../graph.js'
import { StreamBuilder } from '../d2.js'
import { MultiSet } from '../multiset.js'

/**
 * Operator that outputs the messages in the stream
 */
export class OutputOperator<T> extends UnaryOperator<T> {
  #fn: (data: MultiSet<T>) => void

  constructor(
    id: number,
    inputA: DifferenceStreamReader<T>,
    output: DifferenceStreamWriter<T>,
    fn: (data: MultiSet<T>) => void,
  ) {
    super(id, inputA, output)
    this.#fn = fn
  }

  run(): void {
    for (const message of this.inputMessages()) {
      this.#fn(message)
      this.output.sendData(message)
    }
  }
}

/**
 * Outputs the messages in the stream
 * @param fn - The function to call with each message
 */
export function output<T>(
  fn: (data: MultiSet<T>) => void,
): PipedOperator<T, T> {
  return (stream: IStreamBuilder<T>): IStreamBuilder<T> => {
    const output = new StreamBuilder<T>(
      stream.graph,
      new DifferenceStreamWriter<T>(),
    )
    const operator = new OutputOperator<T>(
      stream.graph.getNextOperatorId(),
      stream.connectReader(),
      output.writer,
      fn,
    )
    stream.graph.addOperator(operator)
    stream.graph.addStream(output.connectReader())
    return output
  }
}
