import { IndexProxy, LazyIndexWrapper } from '../indexes/lazy-index'
import {
  createSingleRowRefProxy,
  toExpression,
} from '../query/builder/ref-proxy'
import { BTreeIndex } from '../indexes/btree-index'
import type { StandardSchemaV1 } from '@standard-schema/spec'
import type { BaseIndex, IndexResolver } from '../indexes/base-index'
import type { ChangeMessage } from '../types'
import type { IndexOptions } from '../indexes/index-options'
import type { SingleRowRefProxy } from '../query/builder/ref-proxy'
import type { CollectionLifecycleManager } from './lifecycle'
import type { CollectionStateManager } from './state'
import type { BasicExpression } from '../query/ir'
import type {
  CollectionEventsManager,
  CollectionIndexMetadata,
  CollectionIndexResolverMetadata,
  CollectionIndexSerializableValue,
} from './events'

const INDEX_SIGNATURE_VERSION = 1 as const

function isConstructorResolver<TKey extends string | number>(
  resolver: IndexResolver<TKey>,
): boolean {
  return typeof resolver === `function` && resolver.prototype !== undefined
}

function resolveResolverMetadata<TKey extends string | number>(
  resolver: IndexResolver<TKey>,
): CollectionIndexResolverMetadata {
  if (isConstructorResolver(resolver)) {
    return {
      kind: `constructor`,
      ...(resolver.name ? { name: resolver.name } : {}),
    }
  }

  return {
    kind: `async`,
  }
}

function toSerializableIndexValue(
  value: unknown,
): CollectionIndexSerializableValue | undefined {
  if (value == null) {
    return value
  }

  switch (typeof value) {
    case `string`:
    case `boolean`:
      return value
    case `number`:
      return Number.isFinite(value) ? value : null
    case `bigint`:
      return { __type: `bigint`, value: value.toString() }
    case `function`:
      return {
        __type: `function`,
        name: value.name || `anonymous`,
      }
    case `symbol`:
      return {
        __type: `symbol`,
        value: value.description ?? ``,
      }
    case `undefined`:
      return undefined
  }

  if (Array.isArray(value)) {
    return value.map((entry) => toSerializableIndexValue(entry) ?? null)
  }

  if (value instanceof Date) {
    return {
      __type: `date`,
      value: value.toISOString(),
    }
  }

  if (value instanceof Set) {
    const serializedValues = Array.from(value)
      .map((entry) => toSerializableIndexValue(entry) ?? null)
      .sort((a, b) =>
        stableStringifyCollectionIndexValue(a).localeCompare(
          stableStringifyCollectionIndexValue(b),
        ),
      )
    return {
      __type: `set`,
      values: serializedValues,
    }
  }

  if (value instanceof Map) {
    const serializedEntries = Array.from(value.entries())
      .map(([mapKey, mapValue]) => ({
        key: toSerializableIndexValue(mapKey) ?? null,
        value: toSerializableIndexValue(mapValue) ?? null,
      }))
      .sort((a, b) =>
        stableStringifyCollectionIndexValue(a.key).localeCompare(
          stableStringifyCollectionIndexValue(b.key),
        ),
      )

    return {
      __type: `map`,
      entries: serializedEntries,
    }
  }

  if (value instanceof RegExp) {
    return {
      __type: `regexp`,
      value: value.toString(),
    }
  }

  const serializedObject: Record<string, CollectionIndexSerializableValue> = {}
  const entries = Object.entries(value as Record<string, unknown>).sort(
    ([leftKey], [rightKey]) => leftKey.localeCompare(rightKey),
  )

  for (const [key, entryValue] of entries) {
    const serializedEntry = toSerializableIndexValue(entryValue)
    if (serializedEntry !== undefined) {
      serializedObject[key] = serializedEntry
    }
  }

  return serializedObject
}

function stableStringifyCollectionIndexValue(
  value: CollectionIndexSerializableValue,
): string {
  if (value === null) {
    return `null`
  }

  if (Array.isArray(value)) {
    return `[${value.map(stableStringifyCollectionIndexValue).join(`,`)}]`
  }

  if (typeof value !== `object`) {
    return JSON.stringify(value)
  }

  const sortedKeys = Object.keys(value).sort((left, right) =>
    left.localeCompare(right),
  )
  const serializedEntries = sortedKeys.map(
    (key) =>
      `${JSON.stringify(key)}:${stableStringifyCollectionIndexValue(value[key]!)}`,
  )
  return `{${serializedEntries.join(`,`)}}`
}

function createCollectionIndexMetadata<TKey extends string | number>(
  indexId: number,
  expression: BasicExpression,
  name: string | undefined,
  resolver: IndexResolver<TKey>,
  options: unknown,
): CollectionIndexMetadata {
  const resolverMetadata = resolveResolverMetadata(resolver)
  const serializedExpression = toSerializableIndexValue(expression) ?? null
  const serializedOptions = toSerializableIndexValue(options)
  const signatureInput = toSerializableIndexValue({
    signatureVersion: INDEX_SIGNATURE_VERSION,
    expression: serializedExpression,
    resolver: resolverMetadata,
    options: serializedOptions ?? null,
  })
  const normalizedSignatureInput = signatureInput ?? null
  const signature = stableStringifyCollectionIndexValue(
    normalizedSignatureInput,
  )

  return {
    signatureVersion: INDEX_SIGNATURE_VERSION,
    signature,
    indexId,
    name,
    expression,
    resolver: resolverMetadata,
    ...(serializedOptions === undefined ? {} : { options: serializedOptions }),
  }
}

export class CollectionIndexesManager<
  TOutput extends object = Record<string, unknown>,
  TKey extends string | number = string | number,
  TSchema extends StandardSchemaV1 = StandardSchemaV1,
  TInput extends object = TOutput,
> {
  private lifecycle!: CollectionLifecycleManager<TOutput, TKey, TSchema, TInput>
  private state!: CollectionStateManager<TOutput, TKey, TSchema, TInput>
  private events!: CollectionEventsManager

  public lazyIndexes = new Map<number, LazyIndexWrapper<TKey>>()
  public resolvedIndexes = new Map<number, BaseIndex<TKey>>()
  public indexMetadata = new Map<number, CollectionIndexMetadata>()
  public isIndexesResolved = false
  public indexCounter = 0

  constructor() {}

  setDeps(deps: {
    state: CollectionStateManager<TOutput, TKey, TSchema, TInput>
    lifecycle: CollectionLifecycleManager<TOutput, TKey, TSchema, TInput>
    events: CollectionEventsManager
  }) {
    this.state = deps.state
    this.lifecycle = deps.lifecycle
    this.events = deps.events
  }

  /**
   * Creates an index on a collection for faster queries.
   */
  public createIndex<TResolver extends IndexResolver<TKey> = typeof BTreeIndex>(
    indexCallback: (row: SingleRowRefProxy<TOutput>) => any,
    config: IndexOptions<TResolver> = {},
  ): IndexProxy<TKey> {
    this.lifecycle.validateCollectionUsable(`createIndex`)

    const indexId = ++this.indexCounter
    const singleRowRefProxy = createSingleRowRefProxy<TOutput>()
    const indexExpression = indexCallback(singleRowRefProxy)
    const expression = toExpression(indexExpression)

    // Default to BTreeIndex if no type specified
    const resolver = config.indexType ?? (BTreeIndex as unknown as TResolver)

    // Create lazy wrapper
    const lazyIndex = new LazyIndexWrapper<TKey>(
      indexId,
      expression,
      config.name,
      resolver,
      config.options,
      this.state.entries(),
    )

    this.lazyIndexes.set(indexId, lazyIndex)
    const metadata = createCollectionIndexMetadata(
      indexId,
      expression,
      config.name,
      resolver,
      config.options,
    )
    this.indexMetadata.set(indexId, metadata)

    // For BTreeIndex, resolve immediately and synchronously
    if ((resolver as unknown) === BTreeIndex) {
      try {
        const resolvedIndex = lazyIndex.getResolved()
        this.resolvedIndexes.set(indexId, resolvedIndex)
      } catch (error) {
        console.warn(`Failed to resolve BTreeIndex:`, error)
      }
    } else if (typeof resolver === `function` && resolver.prototype) {
      // Other synchronous constructors - resolve immediately
      try {
        const resolvedIndex = lazyIndex.getResolved()
        this.resolvedIndexes.set(indexId, resolvedIndex)
      } catch {
        // Fallback to async resolution
        this.resolveSingleIndex(indexId, lazyIndex).catch((error) => {
          console.warn(`Failed to resolve single index:`, error)
        })
      }
    } else if (this.isIndexesResolved) {
      // Async loader but indexes are already resolved - resolve this one
      this.resolveSingleIndex(indexId, lazyIndex).catch((error) => {
        console.warn(`Failed to resolve single index:`, error)
      })
    }

    this.events.emitIndexAdded(metadata)

    return new IndexProxy(indexId, lazyIndex)
  }

  /**
   * Removes an index from this collection.
   * Returns true when an index existed and was removed, false otherwise.
   */
  public removeIndex(indexOrId: IndexProxy<TKey> | number): boolean {
    this.lifecycle.validateCollectionUsable(`removeIndex`)

    const indexId = typeof indexOrId === `number` ? indexOrId : indexOrId.id
    const lazyIndex = this.lazyIndexes.get(indexId)
    if (!lazyIndex) {
      return false
    }

    if (
      indexOrId instanceof IndexProxy &&
      lazyIndex !== indexOrId._getLazyWrapper()
    ) {
      // Same numeric id from another collection should not remove this index.
      return false
    }

    this.lazyIndexes.delete(indexId)
    this.resolvedIndexes.delete(indexId)

    const metadata = this.indexMetadata.get(indexId)
    this.indexMetadata.delete(indexId)
    if (metadata) {
      this.events.emitIndexRemoved(metadata)
    }

    return true
  }

  /**
   * Resolve all lazy indexes (called when collection first syncs)
   */
  public async resolveAllIndexes(): Promise<void> {
    if (this.isIndexesResolved) return

    const resolutionPromises = Array.from(this.lazyIndexes.entries()).map(
      async ([indexId, lazyIndex]) => {
        const resolvedIndex = await lazyIndex.resolve()

        // Build index with current data
        resolvedIndex.build(this.state.entries())

        if (this.lazyIndexes.has(indexId)) {
          this.resolvedIndexes.set(indexId, resolvedIndex)
        }
        return { indexId, resolvedIndex }
      },
    )

    await Promise.all(resolutionPromises)
    this.isIndexesResolved = true
  }

  /**
   * Resolve a single index immediately
   */
  private async resolveSingleIndex(
    indexId: number,
    lazyIndex: LazyIndexWrapper<TKey>,
  ): Promise<BaseIndex<TKey>> {
    const resolvedIndex = await lazyIndex.resolve()
    resolvedIndex.build(this.state.entries())
    if (this.lazyIndexes.has(indexId)) {
      this.resolvedIndexes.set(indexId, resolvedIndex)
    }
    return resolvedIndex
  }

  /**
   * Get resolved indexes for query optimization
   */
  get indexes(): Map<number, BaseIndex<TKey>> {
    return this.resolvedIndexes
  }

  /**
   * Updates all indexes when the collection changes
   */
  public updateIndexes(changes: Array<ChangeMessage<TOutput, TKey>>): void {
    for (const index of this.resolvedIndexes.values()) {
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
   * Clean up the collection by stopping sync and clearing data
   * This can be called manually or automatically by garbage collection
   */
  public cleanup(): void {
    this.lazyIndexes.clear()
    this.resolvedIndexes.clear()
    this.indexMetadata.clear()
  }
}
