import type {
  Collection,
  MutationFnParams,
  PendingMutation,
} from "@tanstack/db"

// Extended mutation function that includes idempotency key
export type OfflineMutationFnParams<
  T extends object = Record<string, unknown>,
> = MutationFnParams<T> & {
  idempotencyKey: string
}

export type OfflineMutationFn<T extends object = Record<string, unknown>> = (
  params: OfflineMutationFnParams<T>
) => Promise<any>

// Simplified mutation structure for serialization
export interface SerializedMutation {
  globalKey: string
  type: string
  modified: any
  original: any
  collectionId: string
}

export interface SerializedError {
  name: string
  message: string
  stack?: string
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
  version: 1
}

// Serialized representation for storage
export interface SerializedOfflineTransaction {
  id: string
  mutationFnName: string
  mutations: Array<SerializedMutation>
  keys: Array<string>
  idempotencyKey: string
  createdAt: Date
  retryCount: number
  nextAttemptAt: number
  lastError?: SerializedError
  metadata?: Record<string, any>
  version: 1
}

export interface OfflineConfig {
  collections: Record<string, Collection>
  mutationFns: Record<string, OfflineMutationFn>
  storage?: StorageAdapter
  maxConcurrency?: number
  jitter?: boolean
  beforeRetry?: (
    transactions: Array<OfflineTransaction>
  ) => Array<OfflineTransaction>
  onUnknownMutationFn?: (name: string, tx: OfflineTransaction) => void
  onLeadershipChange?: (isLeader: boolean) => void
  leaderElection?: LeaderElection
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

export interface OnlineDetector {
  subscribe: (callback: () => void) => () => void
  notifyOnline: () => void
}

export interface CreateOfflineTransactionOptions {
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
