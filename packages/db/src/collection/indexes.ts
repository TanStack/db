import {
  createSingleRowRefProxy,
  toExpression,
} from '../query/builder/ref-proxy'
import { CollectionConfigurationError } from '../errors'
import type { StandardSchemaV1 } from '@standard-schema/spec'
import type { BaseIndex, IndexConstructor } from '../indexes/base-index'
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

function compareStringsCodePoint(left: string, right: string): number {
  if (left === right) {
    return 0
  }

  return left < right ? -1 : 1
}

function resolveResolverMetadata<TKey extends string | number>(
  resolver: IndexConstructor<TKey>,
): CollectionIndexResolverMetadata {
  return {
    kind: `constructor`,
    ...(resolver.name ? { name: resolver.name } : {}),
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
    case `symbol`:
      // Function and symbol identity are process-local and not stable across runtimes.
      // Dropping them keeps signatures deterministic; we may skip index reuse, which is acceptable.
      return undefined
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
        compareStringsCodePoint(
          stableStringifyCollectionIndexValue(a),
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
        compareStringsCodePoint(
          stableStringifyCollectionIndexValue(a.key),
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
    ([leftKey], [rightKey]) => compareStringsCodePoint(leftKey, rightKey),
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
    compareStringsCodePoint(left, right),
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
  resolver: IndexConstructor<TKey>,
  options: unknown,
): CollectionIndexMetadata {
  const resolverMetadata = resolveResolverMetadata(resolver)
  const serializedExpression = toSerializableIndexValue(expression) ?? null
  const serializedOptions = toSerializableIndexValue(options)
  const signatureInput = toSerializableIndexValue({
    signatureVersion: INDEX_SIGNATURE_VERSION,
    expression: serializedExpression,
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

function cloneSerializableIndexValue(
  value: CollectionIndexSerializableValue,
): CollectionIndexSerializableValue {
  if (value === null || typeof value !== `object`) {
    return value
  }

  if (Array.isArray(value)) {
    return value.map((entry) => cloneSerializableIndexValue(entry))
  }

  const cloned: Record<string, CollectionIndexSerializableValue> = {}
  for (const [key, entryValue] of Object.entries(value)) {
    cloned[key] = cloneSerializableIndexValue(entryValue)
  }
  return cloned
}

function cloneExpression(expression: BasicExpression): BasicExpression {
  return JSON.parse(JSON.stringify(expression)) as BasicExpression
}

export class CollectionIndexesManager<
  TOutput extends object = Record<string, unknown>,
  TKey extends string | number = string | number,
  TSchema extends StandardSchemaV1 = StandardSchemaV1,
  TInput extends object = TOutput,
> {
  private lifecycle!: CollectionLifecycleManager<TOutput, TKey, TSchema, TInput>
  private state!: CollectionStateManager<TOutput, TKey, TSchema, TInput>
  private defaultIndexType: IndexConstructor<TKey> | undefined
  private events!: CollectionEventsManager

  public indexes = new Map<number, BaseIndex<TKey>>()
  public indexMetadata = new Map<number, CollectionIndexMetadata>()
  public indexCounter = 0

  constructor() {}

  setDeps(deps: {
    state: CollectionStateManager<TOutput, TKey, TSchema, TInput>
    lifecycle: CollectionLifecycleManager<TOutput, TKey, TSchema, TInput>
    defaultIndexType?: IndexConstructor<TKey>
    events: CollectionEventsManager
  }) {
    this.state = deps.state
    this.lifecycle = deps.lifecycle
    this.defaultIndexType = deps.defaultIndexType
    this.events = deps.events
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
    config: IndexOptions<TIndexType> = {},
  ): BaseIndex<TKey> {
    this.lifecycle.validateCollectionUsable(`createIndex`)

    const indexId = ++this.indexCounter
    const singleRowRefProxy = createSingleRowRefProxy<TOutput>()
    const indexExpression = indexCallback(singleRowRefProxy)
    const expression = toExpression(indexExpression)

    // Use provided index type, or fall back to collection's default
    const IndexType = config.indexType ?? this.defaultIndexType
    if (!IndexType) {
      throw new CollectionConfigurationError(
        `No index type specified and no defaultIndexType set on collection. ` +
          `Either pass indexType in config, or set defaultIndexType on the collection:\n` +
          `  import { BasicIndex } from '@tanstack/db/indexing'\n` +
          `  createCollection({ defaultIndexType: BasicIndex, ... })`,
      )
    }

    // Create index synchronously
    const index = new IndexType(
      indexId,
      expression,
      config.name,
      config.options,
    )

    // Build with current data
    index.build(this.state.entries())

    this.indexes.set(indexId, index)

    // Track metadata and emit event
    const metadata = createCollectionIndexMetadata(
      indexId,
      expression,
      config.name,
      IndexType,
      config.options,
    )
    this.indexMetadata.set(indexId, metadata)
    this.events.emitIndexAdded(metadata)

    return index
  }

  /**
   * Removes an index from this collection.
   * Returns true when an index existed and was removed, false otherwise.
   */
  public removeIndex(indexOrId: BaseIndex<TKey> | number): boolean {
    this.lifecycle.validateCollectionUsable(`removeIndex`)

    const indexId = typeof indexOrId === `number` ? indexOrId : indexOrId.id
    const index = this.indexes.get(indexId)
    if (!index) {
      return false
    }

    if (typeof indexOrId !== `number` && index !== indexOrId) {
      // Passed a different index instance with the same id — do not remove.
      return false
    }

    this.indexes.delete(indexId)

    const metadata = this.indexMetadata.get(indexId)
    this.indexMetadata.delete(indexId)
    if (metadata) {
      this.events.emitIndexRemoved(metadata)
    }

    return true
  }

  /**
   * Returns a sorted snapshot of index metadata.
   * This allows persisted wrappers to bootstrap from indexes that were created
   * before they attached lifecycle listeners.
   */
  public getIndexMetadataSnapshot(): Array<CollectionIndexMetadata> {
    return Array.from(this.indexMetadata.values())
      .sort((left, right) => left.indexId - right.indexId)
      .map((metadata) => ({
        ...metadata,
        expression: cloneExpression(metadata.expression),
        resolver: { ...metadata.resolver },
        ...(metadata.options === undefined
          ? {}
          : { options: cloneSerializableIndexValue(metadata.options) }),
      }))
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
    this.indexMetadata.clear()
  }
}
