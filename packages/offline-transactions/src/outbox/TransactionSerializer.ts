import type {
  OfflineTransaction,
  SerializedError,
  SerializedMutation,
} from "../types"

export class TransactionSerializer {
  serialize(transaction: OfflineTransaction): string {
    const serialized = {
      ...transaction,
      createdAt: transaction.createdAt.toISOString(),
      mutations: transaction.mutations.map(this.serializeMutation),
    }
    return JSON.stringify(serialized)
  }

  deserialize(data: string): OfflineTransaction {
    const parsed = JSON.parse(data)
    return {
      ...parsed,
      createdAt: new Date(parsed.createdAt),
      mutations: parsed.mutations.map(this.deserializeMutation),
    }
  }

  private serializeMutation(mutation: any): SerializedMutation {
    return {
      globalKey: mutation.globalKey,
      type: mutation.type,
      modified: this.serializeValue(mutation.modified),
      original: this.serializeValue(mutation.original),
      collectionId: mutation.collection.id,
    }
  }

  private deserializeMutation(data: any): SerializedMutation {
    return {
      globalKey: data.globalKey,
      type: data.type,
      modified: this.deserializeValue(data.modified),
      original: this.deserializeValue(data.original),
      collectionId: data.collectionId,
    }
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
