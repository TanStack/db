import type {
  OfflineTransaction,
  SerializedError,
  SerializedMutation,
  SerializedOfflineTransaction,
} from '../types'
import type { Collection, PendingMutation } from '@tanstack/db'

const temporalConstructorNames = [
  `Duration`,
  `Instant`,
  `PlainDate`,
  `PlainDateTime`,
  `PlainMonthDay`,
  `PlainTime`,
  `PlainYearMonth`,
  `ZonedDateTime`,
] as const

type TemporalConstructorName = (typeof temporalConstructorNames)[number]
type TemporalConstructor = {
  from: (value: string) => unknown
  prototype?: { toString?: () => string }
}

function getTemporalConstructorName(
  type: unknown,
): TemporalConstructorName | undefined {
  if (typeof type !== `string` || !type.startsWith(`Temporal.`)) return
  const constructorName = type.slice(
    `Temporal.`.length,
  ) as TemporalConstructorName
  return temporalConstructorNames.includes(constructorName)
    ? constructorName
    : undefined
}

function requireTemporalConstructor(
  name: TemporalConstructorName,
): TemporalConstructor {
  const constructor = (
    globalThis as {
      Temporal?: Partial<Record<TemporalConstructorName, TemporalConstructor>>
    }
  ).Temporal?.[name]
  if (typeof constructor?.from !== `function`)
    throw new MissingTemporalConstructorError(
      `Missing global Temporal.${name} constructor`,
    )
  return constructor
}

function serializeTemporalValue(
  value: object,
  name: TemporalConstructorName,
): string | undefined {
  const constructor = requireTemporalConstructor(name)
  const toString = constructor.prototype?.toString
  if (typeof toString !== `function` || toString === Object.prototype.toString)
    return
  try {
    const serialized = toString.call(value)
    return typeof serialized === `string` ? serialized : undefined
  } catch {
    // Temporal prototype methods brand-check their receiver. A matching
    // Symbol.toStringTag without the corresponding internal slots is user data.
    return
  }
}

export class MissingTemporalConstructorError extends Error {}

function setDataProperty(
  object: Record<string, unknown>,
  key: string,
  value: unknown,
): void {
  if (key !== `__proto__`) object[key] = value
  else
    Object.defineProperty(object, key, {
      value,
      enumerable: true,
      configurable: true,
      writable: true,
    })
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
      valueEncoding: 3,
      createdAt: transaction.createdAt.toISOString(),
      metadata: this.serializeValue(transaction.metadata, `metadata`),
      mutations: transaction.mutations.map((mutation) =>
        this.serializeMutation(mutation),
      ),
    }
    return JSON.stringify(serialized)
  }

  deserialize(data: string): OfflineTransaction {
    // Old records retain their Date-marker meaning. New records also escape
    // marker-shaped user objects; the encoding tag is not application metadata.
    const {
      valueEncoding,
      ...parsed
    }: Omit<SerializedOfflineTransaction, `valueEncoding`> & {
      valueEncoding?: unknown
    } = JSON.parse(data)
    if (
      valueEncoding !== undefined &&
      valueEncoding !== 2 &&
      valueEncoding !== 3
    ) {
      throw new Error(
        `Unsupported transaction value encoding: ${valueEncoding}`,
      )
    }

    const createdAt = new Date(parsed.createdAt)
    if (isNaN(createdAt.getTime())) {
      throw new Error(
        `Failed to deserialize transaction: invalid createdAt value "${parsed.createdAt}"`,
      )
    }

    return {
      ...parsed,
      createdAt,
      metadata:
        valueEncoding === 3
          ? this.deserializeValue(parsed.metadata, valueEncoding)
          : parsed.metadata,
      mutations: parsed.mutations.map((mutationData) =>
        this.deserializeMutation(mutationData, valueEncoding),
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

  private deserializeMutation(
    data: SerializedMutation,
    valueEncoding: 2 | 3 | undefined,
  ): PendingMutation {
    const collection = this.collections[data.collectionId]
    if (!collection) {
      throw new Error(`Collection with id ${data.collectionId} not found`)
    }

    const modified = this.deserializeValue(data.modified, valueEncoding)

    // Extract the key from the modified data using the collection's getKey function
    // This is needed for optimistic state restoration to work correctly
    const key = modified ? collection.getKeyFromItem(modified) : null

    // Create a partial PendingMutation - we can't fully reconstruct it but
    // we provide what we can. The executor will need to handle the rest.
    return {
      globalKey: data.globalKey,
      type: data.type as any,
      modified,
      original: this.deserializeValue(data.original, valueEncoding),
      changes: this.deserializeValue(data.changes, valueEncoding) ?? {},
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

  private serializeValue(
    value: any,
    jsonKey?: string | false,
    ancestors = new WeakSet<object>(),
  ): any {
    if (value === null || typeof value !== `object`) return value

    if (jsonKey !== false && value instanceof Date) {
      return { __type: `Date`, value: value.toISOString() }
    }

    const temporalConstructorName =
      jsonKey !== false
        ? getTemporalConstructorName(value[Symbol.toStringTag])
        : undefined
    if (temporalConstructorName) {
      const temporalValue = serializeTemporalValue(
        value,
        temporalConstructorName,
      )
      if (temporalValue !== undefined)
        return {
          __type: `Temporal`,
          type: `Temporal.${temporalConstructorName}`,
          value: temporalValue,
        }
    }

    const toJSON = typeof jsonKey === `string` && value.toJSON
    if (typeof toJSON === `function`)
      return this.serializeValue(toJSON.call(value, jsonKey), false, ancestors)
    if (
      jsonKey !== undefined &&
      (value instanceof Boolean ||
        value instanceof BigInt ||
        value instanceof Number ||
        value instanceof String)
    ) {
      return value.valueOf()
    }

    if (ancestors.has(value))
      throw new TypeError(`Converting circular structure to JSON`)
    ancestors.add(value)

    const isArray = Array.isArray(value)
    const result: any = isArray ? [] : {}
    try {
      if (isArray) {
        const length = value.length
        for (let index = 0; index < length; index++) {
          const key = String(index)
          setDataProperty(
            result,
            key,
            this.serializeValue(
              value[index],
              jsonKey === undefined ? undefined : key,
              ancestors,
            ),
          )
        }
      } else {
        for (const key of Object.keys(value)) {
          setDataProperty(
            result,
            key,
            this.serializeValue(
              value[key],
              jsonKey === undefined ? undefined : key,
              ancestors,
            ),
          )
        }
      }
    } finally {
      ancestors.delete(value)
    }
    if (jsonKey === false && typeof result.toJSON === `function`)
      delete result.toJSON
    return !isArray && Object.prototype.hasOwnProperty.call(value, `__type`)
      ? { __type: `Object`, value: result }
      : result
  }

  private deserializeValue(value: any, valueEncoding: 2 | 3 | undefined): any {
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

    if (
      valueEncoding === 3 &&
      typeof value === `object` &&
      value.__type === `Temporal`
    ) {
      const constructorName = getTemporalConstructorName(value.type)
      if (!constructorName)
        throw new Error(`Corrupted Temporal marker: invalid type field`)
      if (typeof value.value !== `string`)
        throw new Error(`Corrupted Temporal marker: missing value field`)
      return requireTemporalConstructor(constructorName).from(value.value)
    }

    if (typeof value === `object`) {
      // Unwrap once, then decode only the fields: the object's own __type is data.
      if (valueEncoding !== undefined && value.__type === `Object`) {
        if (
          value.value === null ||
          typeof value.value !== `object` ||
          Array.isArray(value.value)
        ) {
          throw new Error(`Corrupted Object marker: expected an object value`)
        }
        value = value.value
      }
      const result: any = Array.isArray(value) ? [] : {}
      for (const key in value) {
        if (Object.prototype.hasOwnProperty.call(value, key)) {
          setDataProperty(
            result,
            key,
            this.deserializeValue(value[key], valueEncoding),
          )
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
