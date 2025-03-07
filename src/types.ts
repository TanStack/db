import { Collection } from "./collection"
import { Deferred } from "./deferred"
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
  mutations: PendingMutation[]
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
  toObject?: () => Omit<Transaction, `toObject`>
}

type Value<Extensions = never> =
  | string
  | number
  | boolean
  | bigint
  | null
  | Extensions
  | Value<Extensions>[]
  | { [key: string]: Value<Extensions> }

export type Row<Extensions = never> = Record<string, Value<Extensions>>

type OperationType = `insert` | `update` | `delete`

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
    // eslint-disable-next-line
  }) => Promise<any>

  // Set timeout for awaiting sync (default is 2 seconds)
  awaitSyncTimeoutMs?: number
  awaitSync?: (params: {
    transaction: Transaction
    collection: Collection<T>
    // eslint-disable-next-line
    persistResult: any
  }) => Promise<void>
}

export interface MutationStrategy {
  type: `ordered` | `parallel`
  merge?: (
    syncedData: Record<string, unknown>,
    pendingMutations: PendingMutation[]
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
  key?: string | (string | undefined)[]
  metadata?: Record<string, unknown>
}
