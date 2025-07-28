import { IStreamBuilder, KeyValue } from '../types.js'
import { DifferenceStreamReader, DifferenceStreamWriter } from '../graph.js'
import { StreamBuilder } from '../d2.js'
import { ReduceOperator } from './reduce.js'

/**
 * Operator that counts elements by key (version-free)
 */
export class CountOperator<K, V> extends ReduceOperator<K, V, number> {
  constructor(
    id: number,
    inputA: DifferenceStreamReader<[K, V]>,
    output: DifferenceStreamWriter<[K, number]>,
  ) {
    const countInner = (vals: [V, number][]): [number, number][] => {
      let count = 0
      for (const [_, diff] of vals) {
        count += diff
      }
      return [[count, 1]]
    }

    super(id, inputA, output, countInner)
  }
}

/**
 * Counts the number of elements by key (version-free)
 */
export function count<
  K extends T extends KeyValue<infer K, infer _V> ? K : never,
  V extends T extends KeyValue<K, infer V> ? V : never,
  T,
>() {
  return (stream: IStreamBuilder<T>): IStreamBuilder<KeyValue<K, number>> => {
    const output = new StreamBuilder<KeyValue<K, number>>(
      stream.graph,
      new DifferenceStreamWriter<KeyValue<K, number>>(),
    )
    const operator = new CountOperator<K, V>(
      stream.graph.getNextOperatorId(),
      stream.connectReader() as DifferenceStreamReader<KeyValue<K, V>>,
      output.writer,
    )
    stream.graph.addOperator(operator)
    stream.graph.addStream(output.connectReader())
    return output
  }
}
