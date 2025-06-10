import type { IStreamBuilder } from "@electric-sql/d2ts"
import type { Collection } from "./collection"
import type { StandardSchemaV1 } from "@standard-schema/spec"
import type { Transaction } from "./transactions"

export type TransactionState = `pending` | `persisting` | `completed` | `failed`

/**
 * Represents a pending mutation within a transaction
 * Contains information about the original and modified data, as well as metadata
 */
export interface PendingMutation<T extends object = Record<string, unknown>> {
  mutationId: string
  original: Record<string, unknown>
  modified: Record<string, unknown>
  changes: Record<string, unknown>
  key: any
  type: OperationType
  metadata: unknown
  syncMetadata: Record<string, unknown>
  createdAt: Date
  updatedAt: Date
  collection: Collection<T>
}

/**
 * Configuration options for creating a new transaction
 */
export type MutationFnParams = {
  transaction: Transaction
}

export type MutationFn = (params: MutationFnParams) => Promise<any>

/**
 * Utility type for a Transaction with at least one mutation
 * This is used internally by the Transaction.commit method
 */
export type TransactionWithMutations<
  T extends object = Record<string, unknown>,
> = Transaction & {
  mutations: [PendingMutation<T>, ...Array<PendingMutation<T>>]
}

export interface TransactionConfig {
  /** Unique identifier for the transaction */
  id?: string
  /* If the transaction should autocommit after a mutate call or should commit be called explicitly */
  autoCommit?: boolean
  mutationFn: MutationFn
  /** Custom metadata to associate with the transaction */
  metadata?: Record<string, unknown>
}

export type { Transaction }

type Value<TExtensions = never> =
  | string
  | number
  | boolean
  | bigint
  | null
  | TExtensions
  | Array<Value<TExtensions>>
  | { [key: string | number | symbol]: Value<TExtensions> }

export type Row<TExtensions = never> = Record<string, Value<TExtensions>>

export type OperationType = `insert` | `update` | `delete`

export interface SyncConfig<T extends object = Record<string, unknown>> {
  sync: (params: {
    collection: Collection<T>
    begin: () => void
    write: (message: Omit<ChangeMessage<T>, `key`>) => void
    commit: () => void
  }) => void

  /**
   * Get the sync metadata for insert operations
   * @returns Record containing relation information
   */
  getSyncMetadata?: () => Record<string, unknown>
}

export interface ChangeMessage<T extends object = Record<string, unknown>> {
  key: any
  value: T
  previousValue?: T
  type: OperationType
  metadata?: Record<string, unknown>
}

export interface OptimisticChangeMessage<
  T extends object = Record<string, unknown>,
> extends ChangeMessage<T> {
  // Is this change message part of an active transaction. Only applies to optimistic changes.
  isActive?: boolean
}

/**
 * The Standard Schema interface.
 * This follows the standard-schema specification: https://github.com/standard-schema/standard-schema
 */
export type StandardSchema<T> = StandardSchemaV1 & {
  "~standard": {
    types?: {
      input: T
      output: T
    }
  }
}

/**
 * Type alias for StandardSchema
 */
export type StandardSchemaAlias<T = unknown> = StandardSchema<T>

export interface OperationConfig {
  metadata?: Record<string, unknown>
}

export interface InsertConfig {
  metadata?: Record<string, unknown>
}

export interface CollectionConfig<T extends object = Record<string, unknown>> {
  // If an id isn't passed in, a UUID will be
  // generated for it.
  id?: string
  sync: SyncConfig<T>
  schema?: StandardSchema<T>
  /**
   * Function to extract the ID from an object
   * This is required for update/delete operations which now only accept IDs
   * @param item The item to extract the ID from
   * @returns The ID string for the item
   * @example
   * // For a collection with a 'uuid' field as the primary key
   * getId: (item) => item.uuid
   */
  getId: (item: T) => any
  /**
   * Optional asynchronous handler function called before an insert operation
   * @param params Object containing transaction and mutation information
   * @returns Promise resolving to any value
   */
  onInsert?: MutationFn
  /**
   * Optional asynchronous handler function called before an update operation
   * @param params Object containing transaction and mutation information
   * @returns Promise resolving to any value
   */
  onUpdate?: MutationFn
  /**
   * Optional asynchronous handler function called before a delete operation
   * @param params Object containing transaction and mutation information
   * @returns Promise resolving to any value
   */
  onDelete?: MutationFn
}

export type ChangesPayload<T extends object = Record<string, unknown>> = Array<
  ChangeMessage<T>
>

/**
 * An input row from a collection
 */
export type InputRow = [unknown, Record<string, unknown>]

/**
 * A keyed stream is a stream of rows
 * This is used as the inputs from a collection to a query
 */
export type KeyedStream = IStreamBuilder<InputRow>

/**
 * A namespaced row is a row withing a pipeline that had each table wrapped in its alias
 */
export type NamespacedRow = Record<string, Record<string, unknown>>

/**
 * A keyed namespaced row is a row with a key and a namespaced row
 * This is the main representation of a row in a query pipeline
 */
export type KeyedNamespacedRow = [unknown, NamespacedRow]

/**
 * A namespaced and keyed stream is a stream of rows
 * This is used throughout a query pipeline and as the output from a query without
 * a `select` clause.
 */
export type NamespacedAndKeyedStream = IStreamBuilder<KeyedNamespacedRow>
