import { topKWithFractionalIndex } from './topKWithFractionalIndex.js'
import { orderedWindow } from './ordered-window.js'
import type { KeyValue } from '../types.js'
import type { OrderedTopK } from './ordered-window.js'
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
  return orderedWindow<T, Ve>(
    valueExtractor,
    options,
    topKWithFractionalIndex as OrderedTopK<T>,
  )
}
