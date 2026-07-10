import type {
  Collection,
  MutationFnParams,
  PendingMutation,
  Transaction,
} from '@tanstack/db'

// Extended mutation function that includes idempotency key
export type OfflineMutationFnParams<
  T extends object = Record<string, unknown>,
> = MutationFnParams<T> & {
  idempotencyKey: string
}

export type OfflineMutationFn<T extends object = Record<string, unknown>> = (
  params: OfflineMutationFnParams<T>,
) => Promise<any>

// Simplified mutation structure for serialization
export interface SerializedMutation {
  globalKey: string
  type: string
  modified: any
  original: any
  changes: any
  collectionId: string
}

export interface SerializedError {
  name: string
  message: string
  stack?: string
}

export interface SerializedSpanContext {
  traceId: string
  spanId: string
  traceFlags: number
  traceState?: string
}

// In-memory representation with full PendingMutation objects
export interface OfflineTransaction {
  id: string
  mutationFnName: string
  mutations: Array<PendingMutation>
  keys: Array<string>
  idempotencyKey: string
  createdAt: Date
  retryCount: number
  nextAttemptAt: number
  lastError?: SerializedError
  metadata?: Record<string, any>
  spanContext?: SerializedSpanContext
  version: 1
}

// Serialized representation for storage
export interface SerializedOfflineTransaction {
  id: string
  mutationFnName: string
  mutations: Array<SerializedMutation>
  keys: Array<string>
  idempotencyKey: string
  createdAt: string
  retryCount: number
  nextAttemptAt: number
  lastError?: SerializedError
  metadata?: Record<string, any>
  spanContext?: SerializedSpanContext
  version: 1
}

// Storage diagnostics and mode
export type OfflineMode = `offline` | `online-only`

export type StorageDiagnosticCode =
  | `STORAGE_AVAILABLE`
  | `INDEXEDDB_UNAVAILABLE`
  | `LOCALSTORAGE_UNAVAILABLE`
  | `STORAGE_BLOCKED`
  | `QUOTA_EXCEEDED`
  | `UNKNOWN_ERROR`

export interface StorageDiagnostic {
  code: StorageDiagnosticCode
  mode: OfflineMode
  message: string
  error?: Error
}

export interface ConfirmWriteContext {
  /** Id of the offline transaction whose write just committed. */
  transactionId: string
  /** Name of the mutation function that committed the write. */
  mutationFnName: string
  /** Stable idempotency key used for the committed write. */
  idempotencyKey: string
  /**
   * The mutations that were committed. One optimistic overlay is held per
   * touched collection until the hook settles.
   */
  mutations: Array<PendingMutation>
  /** Whatever the matching mutationFn resolved with (e.g. a server txid). */
  result: unknown
  /** The transaction's metadata, if any was supplied when it was created. */
  metadata?: Record<string, unknown>
}

export interface OfflineConfig {
  collections: Record<string, Collection<any, any, any, any, any>>
  mutationFns: Record<string, OfflineMutationFn>
  storage?: StorageAdapter
  maxConcurrency?: number
  jitter?: boolean
  beforeRetry?: (
    transactions: Array<OfflineTransaction>,
  ) => Array<OfflineTransaction>
  onUnknownMutationFn?: (name: string, tx: OfflineTransaction) => void
  onLeadershipChange?: (isLeader: boolean) => void
  onStorageFailure?: (diagnostic: StorageDiagnostic) => void
  /**
   * Optional post-commit confirmation hook. Runs AFTER a transaction's
   * mutationFn resolves and its outbox entry is removed, but OFF the serial
   * drain path — it does NOT block the next transaction's mutationFn, so a slow
   * confirmation never throttles drain throughput.
   *
   * While the returned promise is pending, the library keeps the just-committed
   * mutations' optimistic state painted (via an internal hold transaction), then
   * releases the hold when it settles (resolve OR reject). Use it to wait for an
   * asynchronous sync stream to echo the write back — e.g. ElectricSQL's
   * `awaitTxId` — so the affected rows don't flicker (disappear then reappear)
   * in the gap between server commit and sync.
   *
   * The hook is never expected to roll back: the write is already durably
   * committed server-side, so a rejection only means the optimistic overlay is
   * dropped early (a possible brief flicker), never data loss. Implement any
   * timeout / verify-by-state logic inside the hook and resolve when done.
   */
  confirmWrite?: (context: ConfirmWriteContext) => void | Promise<void>
  /**
   * Safety cap on simultaneously-held confirmation holds (see `confirmWrite`).
   * Each hold adds one transaction to every touched collection's optimistic
   * recompute, which is O(transactions). Beyond the cap the hold is skipped (the
   * overlay drops at commit instead) to avoid O(n^2) churn on a large, fast
   * drain. Set to 0 to run the hook without retaining optimistic holds.
   * Non-finite or negative values fall back to the default of 1000.
   */
  maxConfirmationHolds?: number
  leaderElection?: LeaderElection
  /**
   * Custom online detector implementation.
   * Defaults to WebOnlineDetector for browser environments.
   * The '@tanstack/offline-transactions/react-native' entry point uses ReactNativeOnlineDetector automatically.
   */
  onlineDetector?: OnlineDetector
}

export interface StorageAdapter {
  get: (key: string) => Promise<string | null>
  set: (key: string, value: string) => Promise<void>
  delete: (key: string) => Promise<void>
  keys: () => Promise<Array<string>>
  clear: () => Promise<void>
}

export interface RetryPolicy {
  calculateDelay: (retryCount: number) => number
  shouldRetry: (error: Error, retryCount: number) => boolean
}

export interface LeaderElection {
  requestLeadership: () => Promise<boolean>
  releaseLeadership: () => void
  isLeader: () => boolean
  onLeadershipChange: (callback: (isLeader: boolean) => void) => () => void
}

export interface TransactionSignaler {
  resolveTransaction: (transactionId: string, result: any) => void
  rejectTransaction: (transactionId: string, error: Error) => void
  registerRestorationTransaction: (
    offlineTransactionId: string,
    restorationTransaction: Transaction,
    releaseRestorationTransaction: () => void,
  ) => void
  isOnline: () => boolean
}

export interface OnlineDetector {
  subscribe: (callback: () => void) => () => void
  notifyOnline: () => void
  isOnline: () => boolean
  dispose: () => void
}

export interface CreateOfflineTransactionOptions {
  id?: string
  mutationFnName: string
  autoCommit?: boolean
  idempotencyKey?: string
  metadata?: Record<string, any>
}

export interface CreateOfflineActionOptions<T> {
  mutationFnName: string
  onMutate: (variables: T) => void
}

export class NonRetriableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = `NonRetriableError`
  }
}
