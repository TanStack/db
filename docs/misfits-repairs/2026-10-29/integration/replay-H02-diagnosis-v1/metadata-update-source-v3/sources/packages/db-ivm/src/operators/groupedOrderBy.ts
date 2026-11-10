import { groupedTopKWithFractionalIndex } from './groupedTopKWithFractionalIndex.js'
import { consolidate } from './consolidate.js'
import type { IStreamBuilder, KeyValue } from '../types.js'

export interface GroupedOrderByOptions<Ve> {
  comparator?: (a: Ve, b: Ve) => number
  limit?: number
  offset?: number
}

export interface GroupedOrderByWithFractionalIndexOptions<
  Ve,
  KeyType = unknown,
  ValueType = unknown,
> extends GroupedOrderByOptions<Ve> {
  setSizeCallback?: (getSize: () => number) => void
  setWindowFn?: (
    windowFn: (options: { offset?: number; limit?: number }) => void,
  ) => void
  /**
   * Function to extract a group key from the element's key and value.
   * Elements with the same group key will be sorted and limited together.
   */
  groupKeyFn: (key: KeyType, value: ValueType) => unknown
}

/**
 * Orders the elements per group and limits the number of results per group, with optional offset and
 * annotates the value with a fractional index.
 * This requires a keyed stream, and uses the `groupedTopKWithFractionalIndex` operator to order elements within each group.
 *
 * Elements are grouped by the provided groupKeyFn, and each group maintains its own sorted collection
 * with independent limit/offset.
 *
 * @param valueExtractor - A function that extracts the value to order by from the element
 * @param options - Configuration including groupKeyFn, comparator, limit, and offset
 * @returns A piped operator that orders the elements per group and limits the number of results per group
 */
export function groupedOrderByWithFractionalIndex<
  T extends KeyValue<unknown, unknown>,
  Ve = unknown,
>(
  valueExtractor: (
    value: T extends KeyValue<unknown, infer V> ? V : never,
  ) => Ve,
  options: GroupedOrderByWithFractionalIndexOptions<
    Ve,
    T extends KeyValue<infer K, unknown> ? K : never,
    T extends KeyValue<unknown, infer V> ? V : never
  >,
) {
  type KeyType = T extends KeyValue<infer K, unknown> ? K : never
  type ValueType = T extends KeyValue<unknown, infer V> ? V : never

  const limit = options.limit ?? Infinity
  const offset = options.offset ?? 0
  const setSizeCallback = options.setSizeCallback
  const setWindowFn = options.setWindowFn
  const groupKeyFn = options.groupKeyFn
  const comparator =
    options.comparator ??
    ((a, b) => {
      // Default to JS like ordering
      if (a === b) return 0
      if (a < b) return -1
      return 1
    })

  return (
    stream: IStreamBuilder<T>,
  ): IStreamBuilder<[KeyType, [ValueType, string]]> => {
    // Cast to the expected key type for groupedTopKWithFractionalIndex
    type StreamKey = KeyType extends string | number ? KeyType : string | number

    return stream.pipe(
      groupedTopKWithFractionalIndex<StreamKey, ValueType>(
        (a: ValueType, b: ValueType) =>
          comparator(valueExtractor(a), valueExtractor(b)),
        {
          limit,
          offset,
          setSizeCallback,
          setWindowFn,
          groupKeyFn: groupKeyFn as (
            key: StreamKey,
            value: ValueType,
          ) => unknown,
        },
      ) as (
        stream: IStreamBuilder<T>,
      ) => IStreamBuilder<[KeyType, [ValueType, string]]>,
      consolidate(),
    )
  }
}
