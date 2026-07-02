import { DifferenceStreamWriter, UnaryOperator } from '../graph.js'
import { StreamBuilder } from '../d2.js'
import { MultiSet } from '../multiset.js'
import { isPerfEnabled, recordPerfCount, startPerfSpan } from '../perf.js'
import type { IStreamBuilder, PipedOperator } from '../types.js'

/**
 * Operator that consolidates collections
 */
export class ConsolidateOperator<T> extends UnaryOperator<T> {
  run(): void {
    const shouldTrace = isPerfEnabled()
    const tags = shouldTrace
      ? {
          operatorId: this.id,
          operator: this.constructor.name,
        }
      : undefined
    const span = shouldTrace
      ? startPerfSpan(`operator.consolidate.run`, tags)
      : undefined
    const messages = this.inputMessages()
    if (messages.length === 0) {
      span?.end()
      return
    }

    // Combine all messages into a single MultiSet
    const combined = new MultiSet<T>()
    let inputRows = 0
    for (const message of messages) {
      inputRows += message.getInner().length
      combined.extend(message)
    }

    // Consolidate the combined MultiSet
    const consolidated = combined.consolidate()

    // Only send if there are results
    if (consolidated.getInner().length > 0) {
      this.output.sendData(consolidated)
    }
    if (shouldTrace) {
      recordPerfCount(`operator.consolidate.messages`, messages.length, tags)
      recordPerfCount(`operator.consolidate.inputRows`, inputRows, tags)
      recordPerfCount(
        `operator.consolidate.outputRows`,
        consolidated.getInner().length,
        tags,
      )
      span?.end()
    }
  }
}

/**
 * Consolidates the elements in the stream
 */
export function consolidate<T>(): PipedOperator<T, T> {
  return (stream: IStreamBuilder<T>): IStreamBuilder<T> => {
    const output = new StreamBuilder<T>(
      stream.graph,
      new DifferenceStreamWriter<T>(),
    )
    const operator = new ConsolidateOperator<T>(
      stream.graph.getNextOperatorId(),
      stream.connectReader(),
      output.writer,
    )
    stream.graph.addOperator(operator)
    return output
  }
}
