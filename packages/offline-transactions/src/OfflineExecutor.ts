// Storage adapters
import { createOptimisticAction, createTransaction } from "@tanstack/db"
import { IndexedDBAdapter } from "./storage/IndexedDBAdapter"
import { LocalStorageAdapter } from "./storage/LocalStorageAdapter"

// Core components
import { OutboxManager } from "./outbox/OutboxManager"
import { KeyScheduler } from "./executor/KeyScheduler"
import { TransactionExecutor } from "./executor/TransactionExecutor"

// Coordination
import { WebLocksLeader } from "./coordination/WebLocksLeader"
import { BroadcastChannelLeader } from "./coordination/BroadcastChannelLeader"

// Connectivity
import { DefaultOnlineDetector } from "./connectivity/OnlineDetector"

// API
import { OfflineTransaction as OfflineTransactionAPI } from "./api/OfflineTransaction"
import { createOfflineAction } from "./api/OfflineAction"

// TanStack DB primitives

// Replay
import { withNestedSpan, withSpan } from "./telemetry/tracer"
import type {
  CreateOfflineActionOptions,
  CreateOfflineTransactionOptions,
  LeaderElection,
  OfflineConfig,
  OfflineTransaction,
  StorageAdapter,
} from "./types"
import type { Transaction } from "@tanstack/db"

export class OfflineExecutor {
  private config: OfflineConfig
  private storage: StorageAdapter
  private outbox: OutboxManager
  private scheduler: KeyScheduler
  private executor: TransactionExecutor
  private leaderElection: LeaderElection
  private onlineDetector: DefaultOnlineDetector
  private isLeaderState = false
  private unsubscribeOnline: (() => void) | null = null
  private unsubscribeLeadership: (() => void) | null = null

  // Coordination mechanism for blocking transactions
  private pendingTransactionPromises: Map<
    string,
    {
      promise: Promise<any>
      resolve: (result: any) => void
      reject: (error: Error) => void
    }
  > = new Map()

  constructor(config: OfflineConfig) {
    this.config = config
    this.storage = this.createStorage()
    this.outbox = new OutboxManager(this.storage, this.config.collections)
    this.scheduler = new KeyScheduler()
    this.executor = new TransactionExecutor(
      this.scheduler,
      this.outbox,
      this.config,
      this
    )
    this.leaderElection = this.createLeaderElection()
    this.onlineDetector = new DefaultOnlineDetector()

    this.setupEventListeners()
    this.initialize()
  }

  private createStorage(): StorageAdapter {
    if (this.config.storage) {
      return this.config.storage
    }

    try {
      return new IndexedDBAdapter()
    } catch (error) {
      console.warn(
        `IndexedDB not available, falling back to localStorage:`,
        error
      )
      return new LocalStorageAdapter()
    }
  }

  private createLeaderElection(): LeaderElection {
    if (this.config.leaderElection) {
      return this.config.leaderElection
    }

    if (WebLocksLeader.isSupported()) {
      return new WebLocksLeader()
    } else if (BroadcastChannelLeader.isSupported()) {
      return new BroadcastChannelLeader()
    } else {
      // Fallback: always be leader in environments without multi-tab support
      return {
        requestLeadership: () => Promise.resolve(true),
        releaseLeadership: () => {},
        isLeader: () => true,
        onLeadershipChange: () => () => {},
      }
    }
  }

  private setupEventListeners(): void {
    this.unsubscribeLeadership = this.leaderElection.onLeadershipChange(
      (isLeader) => {
        this.isLeaderState = isLeader

        if (this.config.onLeadershipChange) {
          this.config.onLeadershipChange(isLeader)
        }

        if (isLeader) {
          this.loadAndReplayTransactions()
        }
      }
    )

    this.unsubscribeOnline = this.onlineDetector.subscribe(() => {
      if (this.isOfflineEnabled) {
        // Reset retry delays so transactions can execute immediately when back online
        this.executor.resetRetryDelays()
        this.executor.executeAll().catch((error) => {
          console.warn(
            `Failed to execute transactions on connectivity change:`,
            error
          )
        })
      }
    })
  }

  private async initialize(): Promise<void> {
    return withSpan(`executor.initialize`, {}, async (span) => {
      try {
        const isLeader = await this.leaderElection.requestLeadership()
        span.setAttribute(`isLeader`, isLeader)

        if (isLeader) {
          await this.loadAndReplayTransactions()
        }
      } catch (error) {
        console.warn(`Failed to initialize offline executor:`, error)
      }
    })
  }

  private async loadAndReplayTransactions(): Promise<void> {
    try {
      await this.executor.loadPendingTransactions()
      await this.executor.executeAll()
    } catch (error) {
      console.warn(`Failed to load and replay transactions:`, error)
    }
  }

  get isOfflineEnabled(): boolean {
    return this.isLeaderState
  }

  createOfflineTransaction(
    options: CreateOfflineTransactionOptions
  ): Transaction | OfflineTransactionAPI {
    const mutationFn = this.config.mutationFns[options.mutationFnName]

    if (!mutationFn) {
      throw new Error(`Unknown mutation function: ${options.mutationFnName}`)
    }

    // Check leadership immediately and use the appropriate primitive
    if (!this.isOfflineEnabled) {
      // Non-leader: use createTransaction directly with the resolved mutation function
      // We need to wrap it to add the idempotency key
      return createTransaction({
        autoCommit: options.autoCommit ?? true,
        mutationFn: (params) =>
          mutationFn({
            ...params,
            idempotencyKey: options.idempotencyKey || crypto.randomUUID(),
          }),
        metadata: options.metadata,
      })
    }

    // Leader: use OfflineTransaction wrapper for offline persistence
    return new OfflineTransactionAPI(
      options,
      mutationFn,
      this.persistTransaction.bind(this),
      this
    )
  }

  createOfflineAction<T>(options: CreateOfflineActionOptions<T>) {
    const mutationFn = this.config.mutationFns[options.mutationFnName]

    if (!mutationFn) {
      throw new Error(`Unknown mutation function: ${options.mutationFnName}`)
    }

    // Return a wrapper that checks leadership status at call time
    return (variables: T) => {
      // Check leadership when action is called, not when it's created
      if (!this.isOfflineEnabled) {
        // Non-leader: use createOptimisticAction directly
        const action = createOptimisticAction({
          mutationFn: (vars, params) =>
            mutationFn({
              ...vars,
              ...params,
              idempotencyKey: crypto.randomUUID(),
            }),
          onMutate: options.onMutate,
        })
        return action(variables)
      }

      // Leader: use the offline action wrapper
      const action = createOfflineAction(
        options,
        mutationFn,
        this.persistTransaction.bind(this),
        this
      )
      return action(variables)
    }
  }

  private async persistTransaction(
    transaction: OfflineTransaction
  ): Promise<void> {
    return withNestedSpan(
      `executor.persistTransaction`,
      {
        "transaction.id": transaction.id,
        "transaction.mutationFnName": transaction.mutationFnName,
      },
      async (span) => {
        if (!this.isOfflineEnabled) {
          span.setAttribute(`result`, `skipped_not_leader`)
          this.resolveTransaction(transaction.id, undefined)
          return
        }

        try {
          await this.outbox.add(transaction)
          await this.executor.execute(transaction)
          span.setAttribute(`result`, `persisted`)
        } catch (error) {
          console.error(
            `Failed to persist offline transaction ${transaction.id}:`,
            error
          )
          span.setAttribute(`result`, `failed`)
          throw error
        }
      }
    )
  }

  // Method for OfflineTransaction to wait for completion
  async waitForTransactionCompletion(transactionId: string): Promise<any> {
    const existing = this.pendingTransactionPromises.get(transactionId)
    if (existing) {
      return existing.promise
    }

    const deferred: {
      promise: Promise<any>
      resolve: (result: any) => void
      reject: (error: Error) => void
    } = {} as any

    deferred.promise = new Promise((resolve, reject) => {
      deferred.resolve = resolve
      deferred.reject = reject
    })

    this.pendingTransactionPromises.set(transactionId, deferred)
    return deferred.promise
  }

  // Method for TransactionExecutor to signal completion
  resolveTransaction(transactionId: string, result: any): void {
    const deferred = this.pendingTransactionPromises.get(transactionId)
    if (deferred) {
      deferred.resolve(result)
      this.pendingTransactionPromises.delete(transactionId)
    }
  }

  // Method for TransactionExecutor to signal failure
  rejectTransaction(transactionId: string, error: Error): void {
    const deferred = this.pendingTransactionPromises.get(transactionId)
    if (deferred) {
      deferred.reject(error)
      this.pendingTransactionPromises.delete(transactionId)
    }
  }

  async removeFromOutbox(id: string): Promise<void> {
    await this.outbox.remove(id)
  }

  async peekOutbox(): Promise<Array<OfflineTransaction>> {
    return this.outbox.getAll()
  }

  async clearOutbox(): Promise<void> {
    await this.outbox.clear()
    this.executor.clear()
  }

  notifyOnline(): void {
    this.onlineDetector.notifyOnline()
  }

  getPendingCount(): number {
    return this.executor.getPendingCount()
  }

  getRunningCount(): number {
    return this.executor.getRunningCount()
  }

  getOnlineDetector(): DefaultOnlineDetector {
    return this.onlineDetector
  }

  dispose(): void {
    if (this.unsubscribeOnline) {
      this.unsubscribeOnline()
      this.unsubscribeOnline = null
    }

    if (this.unsubscribeLeadership) {
      this.unsubscribeLeadership()
      this.unsubscribeLeadership = null
    }

    this.leaderElection.releaseLeadership()
    this.onlineDetector.dispose()

    if (`dispose` in this.leaderElection) {
      ;(this.leaderElection as any).dispose()
    }
  }
}

export function startOfflineExecutor(config: OfflineConfig): OfflineExecutor {
  return new OfflineExecutor(config)
}
