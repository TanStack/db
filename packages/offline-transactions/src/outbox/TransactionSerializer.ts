import type {
  OfflineTransaction,
  SerializedError,
  SerializedMutation,
  SerializedOfflineTransaction,
} from '../types'
import type { Collection, PendingMutation } from '@tanstack/db'

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
