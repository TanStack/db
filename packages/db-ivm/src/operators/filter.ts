import { DifferenceStreamWriter, LinearUnaryOperator } from '../graph.js'
import { StreamBuilder } from '../d2.js'
import { isPerfEnabled, recordPerfCount, startPerfSpan } from '../perf.js'
import type { IStreamBuilder, PipedOperator } from '../types.js'
import type { DifferenceStreamReader } from '../graph.js'
import type { MultiSet } from '../multiset.js'

/**
 * Operator that filters elements from the input stream
 */
export class FilterOperator<T> extends LinearUnaryOperator<T, T> {
  #f: (data: T) => boolean

  constructor(
    id: number,
    inputA: DifferenceStreamReader<T>,
    output: DifferenceStreamWriter<T>,
    f: (data: T) => boolean,
  ) {
    super(id, inputA, output)
    this.#f = f
  }

  inner(collection: MultiSet<T>): MultiSet<T> {
    if (!isPerfEnabled()) {
      return collection.filter(this.#f)
    }

    const tags = {
      operatorId: this.id,
      operator: this.constructor.name,
    }
    let rowsPassed = 0
    const rowsIn = collection.getInner().length
    const span = startPerfSpan(`operator.filter.predicate`, tags)
    const result = collection.filter((data) => {
      const passed = this.#f(data)
      if (passed) rowsPassed++
      return passed
    })
    span.end()
    recordPerfCount(`operator.filter.rowsIn`, rowsIn, tags)
    recordPerfCount(`operator.filter.rowsPassed`, rowsPassed, tags)
    return result
  }
}

/**
 * Filters elements from the input stream
 * @param f - The predicate to filter elements
 */
export function filter<T>(f: (data: T) => boolean): PipedOperator<T, T> {
  return (stream: IStreamBuilder<T>): IStreamBuilder<T> => {
    const output = new StreamBuilder<T>(
      stream.graph,
      new DifferenceStreamWriter<T>(),
    )
    const operator = new FilterOperator<T>(
      stream.graph.getNextOperatorId(),
      stream.connectReader(),
      output.writer,
      f,
    )
    stream.graph.addOperator(operator)
    return output
  }
}
