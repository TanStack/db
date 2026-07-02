import { DifferenceStreamWriter, UnaryOperator } from '../graph.js'
import { StreamBuilder } from '../d2.js'
import { hash } from '../hashing/index.js'
import { MultiSet } from '../multiset.js'
import { isPerfEnabled, recordPerfCount, startPerfSpan } from '../perf.js'
import type { Hash } from '../hashing/index.js'
import type { DifferenceStreamReader } from '../graph.js'
import type { IStreamBuilder, KeyValue } from '../types.js'

type Multiplicity = number

type GetValue<T> = T extends KeyValue<any, infer V> ? V : never

/**
 * Operator that removes duplicates
 */
export class DistinctOperator<
  T extends KeyValue<any, any>,
> extends UnaryOperator<T, KeyValue<number, GetValue<T>>> {
  #by: (value: T) => any
  #values: Map<Hash, Multiplicity> // keeps track of the number of times each value has been seen

  constructor(
    id: number,
    input: DifferenceStreamReader<T>,
    output: DifferenceStreamWriter<KeyValue<number, GetValue<T>>>,
    by: (value: T) => any = (value: T) => value,
  ) {
    super(id, input, output)
    this.#by = by
    this.#values = new Map()
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
      ? startPerfSpan(`operator.distinct.run`, tags)
      : undefined
    const updatedValues = new Map<Hash, [Multiplicity, T]>()
    let inputRows = 0

    // Compute the new multiplicity for each value
    for (const message of this.inputMessages()) {
      for (const [value, diff] of message.getInner()) {
        inputRows++
        const hashedValue = hash(this.#by(value))

        const oldMultiplicity =
          updatedValues.get(hashedValue)?.[0] ??
          this.#values.get(hashedValue) ??
          0
        const newMultiplicity = oldMultiplicity + diff
        updatedValues.set(hashedValue, [newMultiplicity, value])
      }
    }

    const result: Array<[KeyValue<number, GetValue<T>>, number]> = []

    // Check which values became visible or disappeared
    for (const [
      hashedValue,
      [newMultiplicity, value],
    ] of updatedValues.entries()) {
      const oldMultiplicity = this.#values.get(hashedValue) ?? 0

      if (newMultiplicity === 0) {
        this.#values.delete(hashedValue)
      } else {
        this.#values.set(hashedValue, newMultiplicity)
      }

      if (oldMultiplicity <= 0 && newMultiplicity > 0) {
        // The value wasn't present in the stream
        // but with this change it is now present in the stream
        result.push([[hash(this.#by(value)), value[1]], 1])
      } else if (oldMultiplicity > 0 && newMultiplicity <= 0) {
        // The value was present in the stream
        // but with this change it is no longer present in the stream
        result.push([[hash(this.#by(value)), value[1]], -1])
      }
    }

    if (result.length > 0) {
      this.output.sendData(new MultiSet(result))
    }
    if (shouldTrace) {
      recordPerfCount(`operator.distinct.inputRows`, inputRows, tags)
      recordPerfCount(`operator.distinct.keysTouched`, updatedValues.size, tags)
      recordPerfCount(`operator.distinct.outputRows`, result.length, tags)
      span?.end()
    }
  }
}

/**
 * Removes duplicate values
 */
export function distinct<T extends KeyValue<any, any>>(
  by: (value: T) => any = (value: T) => value,
) {
  return (stream: IStreamBuilder<T>): IStreamBuilder<T> => {
    const output = new StreamBuilder<T>(
      stream.graph,
      new DifferenceStreamWriter<T>(),
    )
    const operator = new DistinctOperator<T>(
      stream.graph.getNextOperatorId(),
      stream.connectReader(),
      output.writer,
      by,
    )
    stream.graph.addOperator(operator)
    return output
  }
}
