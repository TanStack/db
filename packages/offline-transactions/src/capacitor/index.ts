// Re-export from main entry (types, utilities, etc.)
export {
  // Types
  type OfflineTransaction,
  type OfflineConfig,
  type OfflineMode,
  type StorageAdapter,
  type StorageDiagnostic,
  type StorageDiagnosticCode,
  type RetryPolicy,
  type LeaderElection,
  type OnlineDetector,
  type CreateOfflineTransactionOptions,
  type CreateOfflineActionOptions,
  type SerializedError,
  type SerializedMutation,
  NonRetriableError,
  // Storage adapters
  IndexedDBAdapter,
  LocalStorageAdapter,
  // Retry policies
  DefaultRetryPolicy,
  BackoffCalculator,
  // Coordination
  WebLocksLeader,
  BroadcastChannelLeader,
  // Connectivity - export web detector too for flexibility
  WebOnlineDetector,
  DefaultOnlineDetector,
  // API components
  OfflineTransactionAPI,
  createOfflineAction,
  // Outbox management
  OutboxManager,
  TransactionSerializer,
  // Execution engine
  KeyScheduler,
  TransactionExecutor,
} from '../index'

// Export RN-specific detector
export { CapacitorOnlineDetector } from '../connectivity/CapacitorOnlineDetector'

// Export Capacitor-configured executor
export { OfflineExecutor, startOfflineExecutor } from './OfflineExecutor'
