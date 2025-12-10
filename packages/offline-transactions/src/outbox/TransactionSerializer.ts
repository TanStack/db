import type {
  OfflineTransaction,
  SerializedError,
  SerializedMutation,
  SerializedOfflineTransaction,
} from "../types"
import type { Collection, PendingMutation } from "@tanstack/db"

export class TransactionSerializer {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private collections: Record<string, Collection<any, any, any, any, any>>
  private collectionIdToKey: Map<string, string>

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(
    collections: Record<string, Collection<any, any, any, any, any>>
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
      createdAt: transaction.createdAt,
      mutations: transaction.mutations.map((mutation) =>
        this.serializeMutation(mutation)
      ),
    }
    // Convert the whole object to JSON, handling dates
    return JSON.stringify(serialized, (key, value) => {
      if (value instanceof Date) {
        return value.toISOString()
      }
      return value
    })
  }

  deserialize(data: string): OfflineTransaction {
    const parsed: SerializedOfflineTransaction = JSON.parse(
      data,
      (key, value) => {
        // Parse ISO date strings back to Date objects
        if (
          typeof value === `string` &&
          /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value)
        ) {
          return new Date(value)
        }
        return value
      }
    )

    return {
      ...parsed,
      mutations: parsed.mutations.map((mutationData) =>
        this.deserializeMutation(mutationData)
      ),
    }
  }

  private serializeMutation(mutation: PendingMutation): SerializedMutation {
    const registryKey = this.collectionIdToKey.get(mutation.collection.id)
    if (!registryKey) {
      throw new Error(
        `Collection with id ${mutation.collection.id} not found in registry`
      )
    }

    return {
      globalKey: mutation.globalKey,
      type: mutation.type,
      modified: this.serializeValue(mutation.modified),
      original: this.serializeValue(mutation.original),
      collectionId: registryKey, // Store registry key instead of collection.id
    }
  }

  private deserializeMutation(data: SerializedMutation): PendingMutation {
    const collection = this.collections[data.collectionId]
    if (!collection) {
      throw new Error(`Collection with id ${data.collectionId} not found`)
    }

    // Create a partial PendingMutation - we can't fully reconstruct it but
    // we provide what we can. The executor will need to handle the rest.
    return {
      globalKey: data.globalKey,
      type: data.type as any,
      modified: this.deserializeValue(data.modified),
      original: this.deserializeValue(data.original),
      collection,
      // These fields would need to be reconstructed by the executor
      mutationId: ``, // Will be regenerated
      key: null, // Will be extracted from the data
      changes: {}, // Will be recalculated
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
        if (value.hasOwnProperty(key)) {
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
      return new Date(value.value)
    }

    if (typeof value === `object`) {
      const result: any = Array.isArray(value) ? [] : {}
      for (const key in value) {
        if (value.hasOwnProperty(key)) {
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
