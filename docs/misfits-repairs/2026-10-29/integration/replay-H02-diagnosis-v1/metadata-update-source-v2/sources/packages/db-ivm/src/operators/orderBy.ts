import { topKWithFractionalIndex } from './topKWithFractionalIndex.js'
import { consolidate } from './consolidate.js'
import type { IStreamBuilder, KeyValue } from '../types.js'
import type { SetSizeCallback } from './topKWithFractionalIndex.js'

export interface OrderByOptions<Ve> {
  comparator?: (a: Ve, b: Ve) => number
  limit?: number
  offset?: number
}

type OrderByWithFractionalIndexOptions<Ve> = OrderByOptions<Ve> & {
  setSizeCallback?: SetSizeCallback
  setWindowFn?: (
    windowFn: (options: { offset?: number; limit?: number }) => void,
  ) => void
}

/**
 * Orders the elements and limits the number of results, with optional offset and
 * annotates the value with a fractional index.
 * This requires a keyed stream, and uses the `topKWithFractionalIndex` operator to order all the elements.
 *
 * @param valueExtractor - A function that extracts the value to order by from the element
 * @param options - An optional object containing comparator, limit and offset properties
 * @returns A piped operator that orders the elements and limits the number of results
 */
export function orderByWithFractionalIndex<
  T extends KeyValue<unknown, unknown>,
  Ve = unknown,
>(
  valueExtractor: (
    value: T extends KeyValue<unknown, infer V> ? V : never,
  ) => Ve,
  options?: OrderByWithFractionalIndexOptions<Ve>,
) {
  type KeyType = T extends KeyValue<infer K, unknown> ? K : never
  type ValueType = T extends KeyValue<unknown, infer V> ? V : never

  const limit = options?.limit ?? Infinity
  const offset = options?.offset ?? 0
  const setSizeCallback = options?.setSizeCallback
  const setWindowFn = options?.setWindowFn
  const comparator =
    options?.comparator ??
    ((a, b) => {
      // Default to JS like ordering
      if (a === b) return 0
      if (a < b) return -1
      return 1
    })

  return (
    stream: IStreamBuilder<T>,
  ): IStreamBuilder<[KeyType, [ValueType, string]]> => {
    return stream.pipe(
      topKWithFractionalIndex(
        (a: ValueType, b: ValueType) =>
          comparator(valueExtractor(a), valueExtractor(b)),
        {
          limit,
          offset,
          setSizeCallback,
          setWindowFn,
        },
      ),
      consolidate(),
    )
  }
}
