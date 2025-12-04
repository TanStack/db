import {
  createSingleRowRefProxy,
  toExpression,
} from "../query/builder/ref-proxy"
import type { StandardSchemaV1 } from "@standard-schema/spec"
import type { BaseIndex, IndexConstructor } from "../indexes/base-index"
import type { ChangeMessage } from "../types"
import type { IndexOptions } from "../indexes/index-options"
import type { SingleRowRefProxy } from "../query/builder/ref-proxy"
import type { CollectionLifecycleManager } from "./lifecycle"
import type { CollectionStateManager } from "./state"

export class CollectionIndexesManager<
  TOutput extends object = Record<string, unknown>,
  TKey extends string | number = string | number,
  TSchema extends StandardSchemaV1 = StandardSchemaV1,
  TInput extends object = TOutput,
> {
  private lifecycle!: CollectionLifecycleManager<TOutput, TKey, TSchema, TInput>
  private state!: CollectionStateManager<TOutput, TKey, TSchema, TInput>
  private defaultIndexType: IndexConstructor<TKey> | undefined

  public indexes = new Map<number, BaseIndex<TKey>>()
  public indexCounter = 0

  constructor() {}

  setDeps(deps: {
    state: CollectionStateManager<TOutput, TKey, TSchema, TInput>
    lifecycle: CollectionLifecycleManager<TOutput, TKey, TSchema, TInput>
    defaultIndexType?: IndexConstructor<TKey>
  }) {
    this.state = deps.state
    this.lifecycle = deps.lifecycle
    this.defaultIndexType = deps.defaultIndexType
  }

  /**
   * Creates an index on a collection for faster queries.
   *
   * @example
   * ```ts
   * // With explicit index type (recommended for tree-shaking)
   * import { BasicIndex } from '@tanstack/db/indexing'
   * collection.createIndex((row) => row.userId, { indexType: BasicIndex })
   *
   * // With collection's default index type
   * collection.createIndex((row) => row.userId)
   * ```
   */
  public createIndex<TIndexType extends IndexConstructor<TKey>>(
    indexCallback: (row: SingleRowRefProxy<TOutput>) => any,
    config: IndexOptions<TIndexType> = {}
  ): BaseIndex<TKey> {
    this.lifecycle.validateCollectionUsable(`createIndex`)

    const indexId = ++this.indexCounter
    const singleRowRefProxy = createSingleRowRefProxy<TOutput>()
    const indexExpression = indexCallback(singleRowRefProxy)
    const expression = toExpression(indexExpression)

    // Use provided index type, or fall back to collection's default
    const IndexType = config.indexType ?? this.defaultIndexType
    if (!IndexType) {
      throw new Error(
        `No index type specified and no defaultIndexType set on collection. ` +
          `Either pass indexType in config, or set defaultIndexType on the collection:\n` +
          `  import { BasicIndex } from '@tanstack/db/indexing'\n` +
          `  createCollection({ defaultIndexType: BasicIndex, ... })`
      )
    }

    // Create index synchronously
    const index = new IndexType(
      indexId,
      expression,
      config.name,
      config.options
    )

    // Build with current data
    index.build(this.state.entries())

    this.indexes.set(indexId, index)

    return index
  }

  /**
   * Updates all indexes when the collection changes
   */
  public updateIndexes(changes: Array<ChangeMessage<TOutput, TKey>>): void {
    for (const index of this.indexes.values()) {
      for (const change of changes) {
        switch (change.type) {
          case `insert`:
            index.add(change.key, change.value)
            break
          case `update`:
            if (change.previousValue) {
              index.update(change.key, change.previousValue, change.value)
            } else {
              index.add(change.key, change.value)
            }
            break
          case `delete`:
            index.remove(change.key, change.value)
            break
        }
      }
    }
  }

  /**
   * Clean up indexes
   */
  public cleanup(): void {
    this.indexes.clear()
  }
}
