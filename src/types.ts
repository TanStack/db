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
  createdAt: Date
  updatedAt: Date
  state: `created` | `persisting` | `synced`
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
  metadata?: Record<string, unknown>
  queuedBehind?: string
  isSynced?: Deferred<boolean>
  isPersisted?: Deferred<boolean>
  error?: {
    transactionId?: string // For dependency failures
    message: string
    error: Error
  }
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

type Row<Extensions = never> = Record<string, Value<Extensions>>

type OperationType = `insert` | `update` | `delete`

export type ChangeMessage<T extends Row<unknown> = Row> = {
  key: string
  value: T
  type: OperationType
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
    changes: Record<string, unknown>[]
    attempt: number
    transaction: Transaction
  }) => Promise<void>

  awaitSync?: (params: {
    changes: Record<string, unknown>
    transaction: Transaction
    sync: SyncConfig
  }) => Promise<void>
}

export interface MutationStrategy {
  type: `ordered` | `parallel`
  merge?: (
    syncedData: Record<string, unknown>,
    pendingMutations: PendingMutation[]
  ) => Record<string, unknown>
}
