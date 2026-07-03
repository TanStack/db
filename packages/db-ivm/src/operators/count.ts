import { DifferenceStreamWriter, UnaryOperator } from '../graph.js'
import { StreamBuilder } from '../d2.js'
import { MultiSet } from '../multiset.js'
import { isPerfEnabled, recordPerfCount, startPerfSpan } from '../perf.js'
import type { DifferenceStreamReader } from '../graph.js'
import type { IStreamBuilder, KeyValue } from '../types.js'

/**
 * Operator that counts elements by key (version-free)
 */
export class CountOperator<K, V> extends UnaryOperator<[K, V], [K, number]> {
  #counts = new Map<K, number>()
  #hasOutput = new Set<K>()

  constructor(
    id: number,
    inputA: DifferenceStreamReader<[K, V]>,
    output: DifferenceStreamWriter<[K, number]>,
  ) {
    super(id, inputA, output)
  }

  run(): void {
    const shouldTrace = isPerfEnabled()
    const tags = shouldTrace
      ? {
          operatorId: this.id,
          operator: this.constructor.name,
        }
      : undefined
    const span = shouldTrace
      ? startPerfSpan(`operator.count.run`, tags)
      : undefined

    const deltas = new Map<K, number>()
    let inputRows = 0
    for (const message of this.inputMessages()) {
      for (const [item, multiplicity] of message.getInner()) {
        inputRows++
        const [key] = item
        deltas.set(key, (deltas.get(key) ?? 0) + multiplicity)
      }
    }

    const result: Array<[[K, number], number]> = []
    for (const [key, delta] of deltas) {
      const oldCount = this.#counts.get(key) ?? 0
      const newCount = oldCount + delta
      const hasOutput = this.#hasOutput.has(key)

      if (!hasOutput) {
        result.push([[key, newCount], 1])
        this.#hasOutput.add(key)
      } else if (oldCount !== newCount) {
        result.push([[key, oldCount], -1])
        result.push([[key, newCount], 1])
      }

      if (newCount === 0) {
        this.#counts.delete(key)
      } else {
        this.#counts.set(key, newCount)
      }
    }

    if (result.length > 0) {
      this.output.sendData(new MultiSet(result))
    }
    if (shouldTrace) {
      recordPerfCount(`operator.count.inputRows`, inputRows, tags)
      recordPerfCount(`operator.count.changedKeys`, deltas.size, tags)
      recordPerfCount(`operator.count.outputRows`, result.length, tags)
      span?.end({ outputRows: result.length })
    }
  }
}

/**
 * Counts the number of elements by key (version-free)
 */
export function count<
  KType extends T extends KeyValue<infer K, infer _V> ? K : never,
  VType extends T extends KeyValue<KType, infer V> ? V : never,
  T,
>() {
  return (
    stream: IStreamBuilder<T>,
  ): IStreamBuilder<KeyValue<KType, number>> => {
    const output = new StreamBuilder<KeyValue<KType, number>>(
      stream.graph,
      new DifferenceStreamWriter<KeyValue<KType, number>>(),
    )
    const operator = new CountOperator<KType, VType>(
      stream.graph.getNextOperatorId(),
      stream.connectReader() as DifferenceStreamReader<KeyValue<KType, VType>>,
      output.writer,
    )
    stream.graph.addOperator(operator)
    return output
  }
}
