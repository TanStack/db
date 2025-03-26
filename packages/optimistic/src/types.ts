import type { Collection } from "../src/collection"
import type { Deferred } from "../src/deferred"
import type { StandardSchemaV1 } from "@standard-schema/spec"

export type TransactionState =
  | `queued`
  | `pending`
  | `persisting`
  | `persisted_awaiting_sync`
  | `completed`
  | `failed`

export interface PendingMutation {
  mutationId: string
  original: Record<string, unknown>
  modified: Record<string, unknown>
  changes: Record<string, unknown>
  key: string
  type: OperationType
  metadata: unknown
  syncMetadata: Record<string, unknown>
  createdAt: Date
  updatedAt: Date
}

export interface Transaction {
  id: string
  state: TransactionState
  createdAt: Date
  updatedAt: Date
  mutations: Array<PendingMutation>
  strategy: MutationStrategy
  metadata: Record<string, unknown>
  queuedBehind?: string
  isSynced?: Deferred<boolean>
  isPersisted?: Deferred<boolean>
  error?: {
    transactionId?: string // For dependency failures
    message: string
    error: Error
  }
  /**
   * Get a plain object representation of the transaction
   * This is useful for creating clones or serializing the transaction
   */
  toObject: () => Omit<Transaction, `toObject`>
}

export type TransactionWithoutToObject = Omit<Transaction, `toObject`>

type Value<TExtensions = never> =
  | string
  | number
  | boolean
  | bigint
  | null
  | TExtensions
  | Array<Value<TExtensions>>
  | { [key: string]: Value<TExtensions> }

export type Row<TExtensions = never> = Record<string, Value<TExtensions>>

export type OperationType = `insert` | `update` | `delete`

export interface SyncConfig<T extends object = Record<string, unknown>> {
  sync: (params: {
    collection: Collection<T>
    begin: () => void
    write: (message: ChangeMessage<T>) => void
    commit: () => void
  }) => void

  /**
   * Get the sync metadata for insert operations
   * @returns Record containing primaryKey and relation information
   */
  getSyncMetadata?: () => Record<string, unknown>
}

export interface ChangeMessage<T extends object = Record<string, unknown>> {
  key: string
  value: T
  type: OperationType
  metadata?: Record<string, unknown>
}

export interface MutationFn<T extends object = Record<string, unknown>> {
  persist: (params: {
    transaction: Transaction
    collection: Collection<T>
  }) => Promise<any>

  // Set timeout for awaiting sync (default is 2 seconds)
  awaitSyncTimeoutMs?: number
  awaitSync?: (params: {
    transaction: Transaction
    collection: Collection<T>

    persistResult: any
  }) => Promise<void>
}

export interface MutationStrategy {
  type: `ordered` | `parallel`
  merge?: (
    syncedData: Record<string, unknown>,
    pendingMutations: Array<PendingMutation>
  ) => Record<string, unknown>
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
  key?: string | Array<string | undefined>
  metadata?: Record<string, unknown>
}

export interface CollectionConfig<T extends object = Record<string, unknown>> {
  id: string
  sync: SyncConfig<T>
  mutationFn: MutationFn<T>
  schema?: StandardSchema<T>
}
