import type { IStreamBuilder } from "@electric-sql/d2mini"
import type { Collection } from "./collection"
import type { StandardSchemaV1 } from "@standard-schema/spec"
import type { Transaction } from "./transactions"

/**
 * Helper type to extract the output type from a standard schema
 *
 * @internal This is used by the type resolution system
 */
export type InferSchemaOutput<T> = T extends StandardSchemaV1
  ? StandardSchemaV1.InferOutput<T> extends object
    ? StandardSchemaV1.InferOutput<T>
    : Record<string, unknown>
  : Record<string, unknown>

/**
 * Helper type to determine the final type based on priority:
 * 1. Explicit generic TExplicit (if not 'unknown')
 * 2. Schema output type (if schema provided)
 * 3. Fallback type TFallback
 *
 * @remarks
 * This type is used internally to resolve the collection item type based on the provided generics and schema.
 * Users should not need to use this type directly, but understanding the priority order helps when defining collections.
 */
export type ResolveType<
  TExplicit,
  TSchema extends StandardSchemaV1 = never,
  TFallback extends object = Record<string, unknown>,
> = unknown extends TExplicit
  ? [TSchema] extends [never]
    ? TFallback
    : InferSchemaOutput<TSchema>
  : TExplicit extends object
    ? TExplicit
    : Record<string, unknown>

export type TransactionState = `pending` | `persisting` | `completed` | `failed`

/**
 * Represents a utility function that can be attached to a collection
 */
export type Fn = (...args: Array<any>) => any

/**
 * A record of utility functions that can be attached to a collection
 */
export type UtilsRecord = Record<string, Fn>

/**
 * Represents a pending mutation within a transaction
 * Contains information about the original and modified data, as well as metadata
 */
export interface PendingMutation<
  T extends object = Record<string, unknown>,
  TOperation extends OperationType = OperationType,
> {
  mutationId: string
  original: TOperation extends `insert` ? {} : T
  modified: T
  changes: TOperation extends `insert`
    ? T
    : TOperation extends `delete`
      ? T
      : Partial<T>
  globalKey: string
  key: any
  type: OperationType
  metadata: unknown
  syncMetadata: Record<string, unknown>
  createdAt: Date
  updatedAt: Date
  collection: Collection<T, any>
}

/**
 * Configuration options for creating a new transaction
 */
export type MutationFnParams<T extends object = Record<string, unknown>> = {
  transaction: TransactionWithMutations<T>
}

export type MutationFn<T extends object = Record<string, unknown>> = (
  params: MutationFnParams<T>
) => Promise<any>

/**
 * Represents a non-empty array (at least one element)
 */
export type NonEmptyArray<T> = [T, ...Array<T>]

/**
 * Utility type for a Transaction with at least one mutation
 * This is used internally by the Transaction.commit method
 */
export type TransactionWithMutations<
  T extends object = Record<string, unknown>,
  TOperation extends OperationType = OperationType,
> = Transaction<T> & {
  mutations: NonEmptyArray<PendingMutation<T, TOperation>>
}

export interface TransactionConfig<T extends object = Record<string, unknown>> {
  /** Unique identifier for the transaction */
  id?: string
  /* If the transaction should autocommit after a mutate call or should commit be called explicitly */
  autoCommit?: boolean
  mutationFn: MutationFn<T>
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

export interface SyncConfig<
  T extends object = Record<string, unknown>,
  TKey extends string | number = string | number,
> {
  sync: (params: {
    collection: Collection<T, TKey>
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

export interface ChangeMessage<
  T extends object = Record<string, unknown>,
  TKey extends string | number = string | number,
> {
  key: TKey
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

export type UpdateMutationFnParams<T extends object = Record<string, unknown>> =
  {
    transaction: TransactionWithMutations<T, `update`>
  }

export type InsertMutationFnParams<T extends object = Record<string, unknown>> =
  {
    transaction: TransactionWithMutations<T, `insert`>
  }

export type DeleteMutationFnParams<T extends object = Record<string, unknown>> =
  {
    transaction: TransactionWithMutations<T, `delete`>
  }

export type InsertMutationFn<T extends object = Record<string, unknown>> = (
  params: InsertMutationFnParams<T>
) => Promise<any>

export type UpdateMutationFn<T extends object = Record<string, unknown>> = (
  params: UpdateMutationFnParams<T>
) => Promise<any>

export type DeleteMutationFn<T extends object = Record<string, unknown>> = (
  params: DeleteMutationFnParams<T>
) => Promise<any>

/**
 * Collection status values for lifecycle management
 */
export type CollectionStatus =
  | `idle`
  | `loading`
  | `ready`
  | `error`
  | `cleaned-up`

export interface CollectionConfig<
  T extends object = Record<string, unknown>,
  TKey extends string | number = string | number,
  TSchema extends StandardSchemaV1 = StandardSchemaV1,
> {
  // If an id isn't passed in, a UUID will be
  // generated for it.
  id?: string
  sync: SyncConfig<T, TKey>
  schema?: TSchema
  /**
   * Function to extract the ID from an object
   * This is required for update/delete operations which now only accept IDs
   * @param item The item to extract the ID from
   * @returns The ID string for the item
   * @example
   * // For a collection with a 'uuid' field as the primary key
   * getKey: (item) => item.uuid
   */
  getKey: (item: T) => TKey
  /**
   * Time in milliseconds after which the collection will be garbage collected
   * when it has no active subscribers. Defaults to 5 minutes (300000ms).
   */
  gcTime?: number
  /**
   * Whether to start syncing immediately when the collection is created.
   * Defaults to true to maintain backward compatibility. Set to false for lazy loading.
   */
  startSync?: boolean
  /**
   * Optional asynchronous handler function called before an insert operation
   * @param params Object containing transaction and mutation information
   * @returns Promise resolving to any value
   */
  onInsert?: InsertMutationFn<T>
  /**
   * Optional asynchronous handler function called before an update operation
   * @param params Object containing transaction and mutation information
   * @returns Promise resolving to any value
   */
  onUpdate?: UpdateMutationFn<T>
  /**
   * Optional asynchronous handler function called before a delete operation
   * @param params Object containing transaction and mutation information
   * @returns Promise resolving to any value
   */
  onDelete?: DeleteMutationFn<T>
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

export type ChangeListener<
  T extends object = Record<string, unknown>,
  TKey extends string | number = string | number,
> = (changes: Array<ChangeMessage<T, TKey>>) => void
