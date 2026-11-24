import { consolidate } from './consolidate.js'
import type { IStreamBuilder, KeyValue, PipedOperator } from '../types.js'
import type {
  SetSizeCallback,
  TopKWithFractionalIndexOptions,
} from './topKWithFractionalIndex.js'

type StreamKey<T> = T extends KeyValue<infer K, unknown> ? K : never
type StreamValue<T> = T extends KeyValue<unknown, infer V> ? V : never
type OrderedRow<T> = [StreamKey<T>, [StreamValue<T>, string]]

export type OrderedTopK<T extends KeyValue<unknown, unknown>> = (
  comparator: (a: StreamValue<T>, b: StreamValue<T>) => number,
  options: TopKWithFractionalIndexOptions & {
    groupKeyFn?: (key: StreamKey<T>, value: StreamValue<T>) => unknown
  },
) => PipedOperator<T, OrderedRow<T>>

/** Capture authored options once, then share the ordering pipeline recipe. */
export function orderedWindow<T extends KeyValue<unknown, unknown>, Ve>(
  valueExtractor: (value: StreamValue<T>) => Ve,
  options:
    | {
        comparator?: (a: Ve, b: Ve) => number
        limit?: number
        offset?: number
        setSizeCallback?: SetSizeCallback
        setWindowFn?: TopKWithFractionalIndexOptions[`setWindowFn`]
        groupKeyFn?: (key: StreamKey<T>, value: StreamValue<T>) => unknown
      }
    | undefined,
  topK: OrderedTopK<T>,
) {
  const windowOptions = {
    limit: options?.limit ?? Infinity,
    offset: options?.offset ?? 0,
    setSizeCallback: options?.setSizeCallback,
    setWindowFn: options?.setWindowFn,
    groupKeyFn: options?.groupKeyFn,
  }
  const comparator =
    options?.comparator ??
    ((a, b) => {
      // Default to JS-like ordering.
      if (a === b) return 0
      if (a < b) return -1
      return 1
    })

  return (stream: IStreamBuilder<T>): IStreamBuilder<OrderedRow<T>> =>
    stream.pipe(
      topK(
        (a, b) => comparator(valueExtractor(a), valueExtractor(b)),
        windowOptions,
      ),
      consolidate(),
    )
}
