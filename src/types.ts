export type TransactionState =
  | `queued`
  | `pending`
  | `persisting`
  | `persisted_awaiting_sync`
  | `completed`
  | `failed`

export interface Attempt {
  id: string
  started_at: Date
  completed_at?: Date
  error?: Error
  retry_scheduled_for?: Date
}

export interface PendingMutation {
  mutationId: string
  original: Record<string, unknown>
  modified: Record<string, unknown>
  changes: Record<string, unknown>
  metadata: unknown
  created_at: Date
  updated_at: Date
  state: `created` | `persisting` | `synced`
}

export interface Transaction {
  id: string
  state: TransactionState
  created_at: Date
  updated_at: Date
  mutations: PendingMutation[]
  attempts: Attempt[]
  current_attempt: number
  strategy: MutationStrategy
  metadata?: Record<string, unknown>
  queued_behind?: string
  error?: {
    transaction_id?: string // For dependency failures
    message: string
    error: Error
  }
}

export interface SyncConfig {
  id: string
  setup: (params: {
    onUpdate: (data: Record<string, unknown>) => void
  }) => Promise<{
    data: Record<string, unknown>
  }>
}

export interface MutationFn {
  persist: (params: {
    changes: Record<string, unknown>
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
