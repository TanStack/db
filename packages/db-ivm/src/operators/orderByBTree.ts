import { KeyValue } from '../types.js'
import { OrderByOptions, orderByWithFractionalIndexBase } from './orderBy.js'
import { topKWithFractionalIndexBTree } from './topKWithFractionalIndexBTree.js'

export function orderByWithFractionalIndexBTree<
  T extends KeyValue<unknown, unknown>,
  Ve = unknown,
>(
  valueExtractor: (
    value: T extends KeyValue<unknown, infer V> ? V : never,
  ) => Ve,
  options?: OrderByOptions<Ve>,
) {
  return orderByWithFractionalIndexBase(
    topKWithFractionalIndexBTree,
    valueExtractor,
    options,
  )
}
