// Main API
export { OfflineExecutor, startOfflineExecutor } from "./OfflineExecutor"

// Types
export type {
  OfflineTransaction,
  OfflineConfig,
  StorageAdapter,
  RetryPolicy,
  LeaderElection,
  OnlineDetector,
  CreateOfflineTransactionOptions,
  CreateOfflineActionOptions,
  SerializedError,
  SerializedMutation,
} from "./types"

export { NonRetriableError } from "./types"

// Storage adapters
export { IndexedDBAdapter } from "./storage/IndexedDBAdapter"
export { LocalStorageAdapter } from "./storage/LocalStorageAdapter"

// Retry policies
export { DefaultRetryPolicy } from "./retry/RetryPolicy"
export { BackoffCalculator } from "./retry/BackoffCalculator"

// Coordination
export { WebLocksLeader } from "./coordination/WebLocksLeader"
export { BroadcastChannelLeader } from "./coordination/BroadcastChannelLeader"

// Connectivity
export { DefaultOnlineDetector } from "./connectivity/OnlineDetector"

// API components
export { OfflineTransaction as OfflineTransactionAPI } from "./api/OfflineTransaction"
export { createOfflineAction } from "./api/OfflineAction"

// Outbox management
export { OutboxManager } from "./outbox/OutboxManager"
export { TransactionSerializer } from "./outbox/TransactionSerializer"

// Execution engine
export { KeyScheduler } from "./executor/KeyScheduler"
export { TransactionExecutor } from "./executor/TransactionExecutor"

// Replay
