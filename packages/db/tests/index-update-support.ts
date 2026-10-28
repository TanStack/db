import { BasicIndex } from '../src/indexes/basic-index.js'
import { BTreeIndex } from '../src/indexes/btree-index.js'
import type { BaseIndex } from '../src/indexes/base-index.js'
import type { CompareOptions } from '../src/query/builder/types.js'
import type { BasicExpression } from '../src/query/ir.js'

export type IndexConstructor = new (
  id: number,
  expression: BasicExpression,
  name?: string,
  options?: {
    compareFn?: (left: unknown, right: unknown) => number
    compareOptions?: CompareOptions
  },
) => BaseIndex<string>

export const indexTypes: Array<[string, IndexConstructor]> = [
  [`BasicIndex`, BasicIndex as IndexConstructor],
  [`BTreeIndex`, BTreeIndex as IndexConstructor],
]

export async function withCollectionCleanup(
  collection: { cleanup: () => Promise<void> },
  check: () => void | Promise<void>,
): Promise<void> {
  let primaryFailure: unknown
  let failed = false
  try {
    await check()
  } catch (error) {
    primaryFailure = error
    failed = true
  }
  try {
    await collection.cleanup()
  } catch (cleanupError) {
    if (failed)
      throw new AggregateError([cleanupError], `Index oracle cleanup failed`, {
        cause: primaryFailure,
      })
    throw cleanupError
  }
  if (failed) throw primaryFailure
}
