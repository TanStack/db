import type {
  OfflineTransaction,
  SerializedError,
  SerializedMutation,
  SerializedOfflineTransaction,
} from '../types'
import type { Collection, PendingMutation } from '@tanstack/db'

const temporalConstructors = {
  'Temporal.Duration': `Duration`,
  'Temporal.Instant': `Instant`,
  'Temporal.PlainDate': `PlainDate`,
  'Temporal.PlainDateTime': `PlainDateTime`,
  'Temporal.PlainMonthDay': `PlainMonthDay`,
  'Temporal.PlainTime': `PlainTime`,
  'Temporal.PlainYearMonth': `PlainYearMonth`,
  'Temporal.ZonedDateTime': `ZonedDateTime`,
} as const

type TemporalType = keyof typeof temporalConstructors
type TemporalConstructorName = (typeof temporalConstructors)[TemporalType]
type TemporalConstructor = {
  from: (value: string) => unknown
}

interface TemporalLike {
  readonly [Symbol.toStringTag]: TemporalType
  toString: () => string
}

interface SerializedTemporalValue {
  __type: `Temporal`
  type: TemporalType
  value: string
}

function isTemporalType(type: string): type is TemporalType {
  return Object.prototype.hasOwnProperty.call(temporalConstructors, type)
}

function isTemporalValue(value: unknown): value is TemporalLike {
  if (value === null || typeof value !== `object`) {
    return false
  }

  const tag = (value as Record<symbol, unknown>)[Symbol.toStringTag]
  return typeof tag === `string` && isTemporalType(tag)
}

function getTemporalConstructor(type: TemporalType): TemporalConstructor {
  const temporalGlobal = (
    globalThis as {
      Temporal?: Partial<Record<TemporalConstructorName, TemporalConstructor>>
    }
  ).Temporal
  const constructorName = temporalConstructors[type]
  const constructor = temporalGlobal?.[constructorName]

  if (!constructor) {
    throw new Error(
      `Failed to deserialize Temporal marker: globalThis.Temporal.${constructorName} is not available`,
    )
  }

  return constructor
}

export class TransactionSerializer {
  private collections: Record<string, Collection<any, any, any, any, any>>
  private collectionIdToKey: Map<string, string>

  constructor(
    collections: Record<string, Collection<any, any, any, any, any>>,
  ) {
    this.collections = collections
    // Create reverse lookup from collection.id to registry key
    this.collectionIdToKey = new Map()
    for (const [key, collection] of Object.entries(collections)) {
      this.collectionIdToKey.set(collection.id, key)
    }
  }

  serialize(transaction: OfflineTransaction): string {
    const serialized: SerializedOfflineTransaction = {
      ...transaction,
      createdAt: transaction.createdAt.toISOString(),
      metadata: this.serializeValue(transaction.metadata) as
        | Record<string, any>
        | undefined,
      mutations: transaction.mutations.map((mutation) =>
        this.serializeMutation(mutation),
      ),
    }
    return JSON.stringify(serialized)
  }

  deserialize(data: string): OfflineTransaction {
    // Parse without a reviver - let deserializeValue handle dates in mutation data
    // using the { __type: 'Date' } marker system
    const parsed: SerializedOfflineTransaction = JSON.parse(data)

    const createdAt = new Date(parsed.createdAt)
    if (isNaN(createdAt.getTime())) {
      throw new Error(
        `Failed to deserialize transaction: invalid createdAt value "${parsed.createdAt}"`,
      )
    }

    return {
      ...parsed,
      createdAt,
      metadata: this.deserializeValue(parsed.metadata) as
        | Record<string, any>
        | undefined,
      mutations: parsed.mutations.map((mutationData) =>
        this.deserializeMutation(mutationData),
      ),
    }
  }

  private serializeMutation(mutation: PendingMutation): SerializedMutation {
    const registryKey = this.collectionIdToKey.get(mutation.collection.id)
    if (!registryKey) {
      throw new Error(
        `Collection with id ${mutation.collection.id} not found in registry`,
      )
    }

    return {
      globalKey: mutation.globalKey,
      type: mutation.type,
      modified: this.serializeValue(mutation.modified),
      original: this.serializeValue(mutation.original),
      changes: this.serializeValue(mutation.changes),
      collectionId: registryKey, // Store registry key instead of collection.id
    }
  }

  private deserializeMutation(data: SerializedMutation): PendingMutation {
    const collection = this.collections[data.collectionId]
    if (!collection) {
      throw new Error(`Collection with id ${data.collectionId} not found`)
    }

    const modified = this.deserializeValue(data.modified)

    // Extract the key from the modified data using the collection's getKey function
    // This is needed for optimistic state restoration to work correctly
    const key = modified ? collection.getKeyFromItem(modified) : null

    // Create a partial PendingMutation - we can't fully reconstruct it but
    // we provide what we can. The executor will need to handle the rest.
    return {
      globalKey: data.globalKey,
      type: data.type as any,
      modified,
      original: this.deserializeValue(data.original),
      changes: this.deserializeValue(data.changes) ?? {},
      collection,
      // These fields would need to be reconstructed by the executor
      mutationId: ``, // Will be regenerated
      key,
      metadata: undefined,
      syncMetadata: {},
      optimistic: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as PendingMutation
  }

  private serializeValue(value: any): any {
    if (value === null || value === undefined) {
      return value
    }

    if (value instanceof Date) {
      return { __type: `Date`, value: value.toISOString() }
    }

    if (isTemporalValue(value)) {
      return {
        __type: `Temporal`,
        type: value[Symbol.toStringTag],
        value: value.toString(),
      } satisfies SerializedTemporalValue
    }

    if (typeof value === `object`) {
      const result: any = Array.isArray(value) ? [] : {}
      for (const key in value) {
        if (Object.prototype.hasOwnProperty.call(value, key)) {
          result[key] = this.serializeValue(value[key])
        }
      }
      return result
    }

    return value
  }

  private deserializeValue(value: any): any {
    if (value === null || value === undefined) {
      return value
    }

    if (typeof value === `object` && value.__type === `Date`) {
      if (value.value === undefined || value.value === null) {
        throw new Error(`Corrupted Date marker: missing value field`)
      }
      const date = new Date(value.value)
      if (isNaN(date.getTime())) {
        throw new Error(
          `Failed to deserialize Date marker: invalid date value "${value.value}"`,
        )
      }
      return date
    }

    if (typeof value === `object` && value.__type === `Temporal`) {
      if (typeof value.type !== `string` || !isTemporalType(value.type)) {
        throw new Error(`Corrupted Temporal marker: invalid type field`)
      }

      if (typeof value.value !== `string`) {
        throw new Error(`Corrupted Temporal marker: missing value field`)
      }

      return getTemporalConstructor(value.type).from(value.value)
    }

    if (typeof value === `object`) {
      const result: any = Array.isArray(value) ? [] : {}
      for (const key in value) {
        if (Object.prototype.hasOwnProperty.call(value, key)) {
          result[key] = this.deserializeValue(value[key])
        }
      }
      return result
    }

    return value
  }

  serializeError(error: Error): SerializedError {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    }
  }

  deserializeError(data: SerializedError): Error {
    const error = new Error(data.message)
    error.name = data.name
    error.stack = data.stack
    return error
  }
}
