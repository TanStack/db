import { StreamBuilder } from './d2.js'
import { DifferenceStreamWriter } from './graph.js'
import type { DifferenceStreamReader, UnaryOperator } from './graph.js'
import type { PipedOperator } from './types.js'

// Share graph wiring, while each public operator keeps its own constructor,
// inheritance and run/inner dispatch.
export function unaryOperator<T, U, Args extends Array<unknown>>(
  Operator: new (
    id: number,
    input: DifferenceStreamReader<T>,
    output: DifferenceStreamWriter<U>,
    ...args: Args
  ) => UnaryOperator<T | U>,
  ...args: Args
): PipedOperator<T, U> {
  return (stream) => {
    const output = new StreamBuilder<U>(
      stream.graph,
      new DifferenceStreamWriter<U>(),
    )
    stream.graph.addOperator(
      new Operator(
        stream.graph.getNextOperatorId(),
        stream.connectReader(),
        output.writer,
        ...args,
      ),
    )
    return output
  }
}
