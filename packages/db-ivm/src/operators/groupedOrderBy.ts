import { groupedTopKWithFractionalIndex } from './groupedTopKWithFractionalIndex.js'
import { orderedWindow } from './ordered-window.js'
import type { IStreamBuilder, KeyValue } from '../types.js'
import type { OrderedTopK } from './ordered-window.js'

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

  return orderedWindow<T, Ve>(
    valueExtractor,
    options,
    groupedTopKWithFractionalIndex as OrderedTopK<T>,
  ) as (
    stream: IStreamBuilder<T>,
  ) => IStreamBuilder<[KeyType, [ValueType, string]]>
}
