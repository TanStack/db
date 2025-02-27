import { Collection } from "./collection"
import { Deferred } from "./deferred"

export type TransactionState =
  | `queued`
  | `pending`
  | `persisting`
  | `persisted_awaiting_sync`
  | `completed`
  | `failed`

export interface Attempt {
  id: string
  startedAt: Date
  completedAt?: Date
  error?: Error
  retryScheduledFor?: Date
}

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
  attempts: Attempt[]
  currentAttempt: number
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
  toObject(): Omit<Transaction, `toObject`>
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

export type ChangeMessage<T extends Row<unknown> = Row> = {
  key: string
  value: T
  type: OperationType
  metadata?: Record<string, unknown>
}

export interface SyncConfig {
  id: string
  sync: (params: {
    collection: Collection
    begin: () => void
    write: (message: ChangeMessage) => void
    commit: () => void
  }) => void
}

export interface MutationFn {
  persist: (params: {
    attempt: number
    transaction: Transaction
    collection: Collection
  }) => Promise<void>

  awaitSync?: (params: {
    transaction: Transaction
    collection: Collection
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
export interface StandardSchema<T = unknown> {
  /** The Standard Schema properties. */
  readonly "~standard": {
    /** The version number of the standard. */
    readonly version: 1
    /** The vendor name of the schema library. */
    readonly vendor: string
    /** Validates unknown input values. */
    readonly validate: (value: unknown) =>
      | { value: T; issues?: undefined }
      | {
          issues: Array<{
            message: string
            path?: Array<string | number | symbol>
          }>
        }
    /** Inferred types associated with the schema. */
    readonly types?: {
      /** The input type of the schema. */
      readonly input: T
      /** The output type of the schema. */
      readonly output: T
    }
  }
}

/**
 * Type alias for StandardSchema
 */
export type StandardSchemaAlias<T = unknown> = StandardSchema<T>
