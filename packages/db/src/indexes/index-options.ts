import type { IndexConstructor } from './base-index.js'

/**
 * Options for creating an index
 */
export interface IndexOptions<
  TIndexType extends IndexConstructor = IndexConstructor,
> {
  /** Optional name for the index */
  name?: string
  /** Index type to use (e.g., BasicIndex, BTreeIndex) */
  indexType?: TIndexType
  /** Options passed to the index constructor */
  options?: TIndexType extends new (
    id: number,
    expr: any,
    name?: string,
    options?: infer O,
  ) => any
    ? O
    : never
}
