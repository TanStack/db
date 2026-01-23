// Storage adapters
import { createOptimisticAction, createTransaction } from '@tanstack/db'
import { IndexedDBAdapter } from './storage/IndexedDBAdapter'
import { LocalStorageAdapter } from './storage/LocalStorageAdapter'

// Core components
import { OutboxManager } from './outbox/OutboxManager'
import { KeyScheduler } from './executor/KeyScheduler'
import { TransactionExecutor } from './executor/TransactionExecutor'

// Coordination
import { WebLocksLeader } from './coordination/WebLocksLeader'
import { BroadcastChannelLeader } from './coordination/BroadcastChannelLeader'

// Connectivity
import { WebOnlineDetector } from './connectivity/OnlineDetector'

// API
import { OfflineTransaction as OfflineTransactionAPI } from './api/OfflineTransaction'
import { createOfflineAction } from './api/OfflineAction'

// TanStack DB primitives

// Replay
import { withNestedSpan, withSpan } from './telemetry/tracer'
import type {
  CreateOfflineActionOptions,
  CreateOfflineTransactionOptions,
  LeaderElection,
  OfflineConfig,
  OfflineMode,
  OfflineTransaction,
  OnlineDetector,
  StorageAdapter,
  StorageDiagnostic,
} from './types'
import type { Transaction } from '@tanstack/db'

export class OfflineExecutor {
  private config: OfflineConfig

  // @ts-expect-error - Set during async initialization in initialize()
  private storage: StorageAdapter | null
  private outbox: OutboxManager | null
  private scheduler: KeyScheduler
  private executor: TransactionExecutor | null
  private leaderElection: LeaderElection | null
  private onlineDetector: OnlineDetector
  private isLeaderState = false
  private unsubscribeOnline: (() => void) | null = null
  private unsubscribeLeadership: (() => void) | null = null

  // Public diagnostic properties
  public readonly mode: OfflineMode
  public readonly storageDiagnostic: StorageDiagnostic

  // Track initialization completion
  private initPromise: Promise<void>
  private initResolve!: () => void
  private initReject!: (error: Error) => void

  // Coordination mechanism for blocking transactions
  private pendingTransactionPromises: Map<
    string,
    {
      promise: Promise<any>
      resolve: (result: any) => void
      reject: (error: Error) => void
    }
  > = new Map()

  // Track restoration transactions for cleanup when offline transactions complete
  private restorationTransactions: Map<string, Transaction> = new Map()

  constructor(config: OfflineConfig) {
    this.config = config
    this.scheduler = new KeyScheduler()
    this.onlineDetector = config.onlineDetector ?? new WebOnlineDetector()

    // Initialize as pending - will be set by async initialization
    this.storage = null
    this.outbox = null
    this.executor = null
    this.leaderElection = null

    // Temporary diagnostic - will be updated by async initialization
    this.mode = `offline`
    this.storageDiagnostic = {
      code: `STORAGE_AVAILABLE`,
      mode: `offline`,
      message: `Initializing storage...`,
    }

    // Create initialization promise
    this.initPromise = new Promise((resolve, reject) => {
      this.initResolve = resolve
      this.initReject = reject
    })

    this.initialize()
  }

  /**
   * Probe storage availability and create appropriate adapter.
   * Returns null if no storage is available (online-only mode).
   */
  private async createStorage(): Promise<{
    storage: StorageAdapter | null
    diagnostic: StorageDiagnostic
  }> {
    // If user provided custom storage, use it without probing
    if (this.config.storage) {
      return {
        storage: this.config.storage,
        diagnostic: {
          code: `STORAGE_AVAILABLE`,
          mode: `offline`,
          message: `Using custom storage adapter`,
        },
      }
    }

    // Probe IndexedDB first
    const idbProbe = await IndexedDBAdapter.probe()
    if (idbProbe.available) {
      return {
        storage: new IndexedDBAdapter(),
        diagnostic: {
          code: `STORAGE_AVAILABLE`,
          mode: `offline`,
          message: `Using IndexedDB for offline storage`,
        },
      }
    }

    // IndexedDB failed, try localStorage
    const lsProbe = LocalStorageAdapter.probe()
    if (lsProbe.available) {
      return {
        storage: new LocalStorageAdapter(),
        diagnostic: {
          code: `INDEXEDDB_UNAVAILABLE`,
          mode: `offline`,
          message: `IndexedDB unavailable, using localStorage fallback`,
          error: idbProbe.error,
        },
      }
    }

    // Both failed - determine the diagnostic code
    const isSecurityError =
      idbProbe.error?.name === `SecurityError` ||
      lsProbe.error?.name === `SecurityError`
    const isQuotaError =
      idbProbe.error?.name === `QuotaExceededError` ||
      lsProbe.error?.name === `QuotaExceededError`

    let code: StorageDiagnostic[`code`]
    let message: string

    if (isSecurityError) {
      code = `STORAGE_BLOCKED`
      message = `Storage blocked (private mode or security restrictions). Running in online-only mode.`
    } else if (isQuotaError) {
      code = `QUOTA_EXCEEDED`
      message = `Storage quota exceeded. Running in online-only mode.`
    } else {
      code = `UNKNOWN_ERROR`
      message = `Storage unavailable due to unknown error. Running in online-only mode.`
    }

    return {
      storage: null,
      diagnostic: {
        code,
        mode: `online-only`,
        message,
        error: idbProbe.error || lsProbe.error,
      },
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
    // Only set up leader election listeners if we have storage
    if (this.leaderElection) {
      this.unsubscribeLeadership = this.leaderElection.onLeadershipChange(
        (isLeader) => {
          this.isLeaderState = isLeader

          if (this.config.onLeadershipChange) {
            this.config.onLeadershipChange(isLeader)
          }

          if (isLeader) {
            this.loadAndReplayTransactions()
          }
        },
      )
    }

    this.unsubscribeOnline = this.onlineDetector.subscribe(() => {
      if (this.isOfflineEnabled && this.executor) {
        // Reset retry delays so transactions can execute immediately when back online
        this.executor.resetRetryDelays()
        this.executor.executeAll().catch((error) => {
          console.warn(
            `Failed to execute transactions on connectivity change:`,
            error,
          )
        })
      }
    })
  }

  private async initialize(): Promise<void> {
    return withSpan(`executor.initialize`, {}, async (span) => {
      try {
        // Probe storage and create adapter
        const { storage, diagnostic } = await this.createStorage()

        // Cast to writable to set readonly properties
        ;(this as any).storage = storage
        ;(this as any).storageDiagnostic = diagnostic
        ;(this as any).mode = diagnostic.mode

        span.setAttribute(`storage.mode`, diagnostic.mode)
        span.setAttribute(`storage.code`, diagnostic.code)

        if (!storage) {
          // Online-only mode - notify callback and skip offline setup
          if (this.config.onStorageFailure) {
            this.config.onStorageFailure(diagnostic)
          }
          span.setAttribute(`result`, `online-only`)
          this.initResolve()
          return
        }

        // Storage available - set up offline components
        this.outbox = new OutboxManager(storage, this.config.collections)
        this.executor = new TransactionExecutor(
          this.scheduler,
          this.outbox,
          this.config,
          this,
        )
        this.leaderElection = this.createLeaderElection()

        // Request leadership first
        const isLeader = await this.leaderElection.requestLeadership()
        this.isLeaderState = isLeader
        span.setAttribute(`isLeader`, isLeader)

        // Set up event listeners after leadership is established
        // This prevents the callback from being called multiple times
        this.setupEventListeners()

        // Notify initial leadership state
        if (this.config.onLeadershipChange) {
          this.config.onLeadershipChange(isLeader)
        }

        if (isLeader) {
          await this.loadAndReplayTransactions()
        }
        span.setAttribute(`result`, `offline-enabled`)
        this.initResolve()
      } catch (error) {
        console.warn(`Failed to initialize offline executor:`, error)
        span.setAttribute(`result`, `failed`)
        this.initReject(
          error instanceof Error ? error : new Error(String(error)),
        )
      }
    })
  }

  private async loadAndReplayTransactions(): Promise<void> {
    if (!this.executor) {
      return
    }

    try {
      // Load pending transactions and restore optimistic state
      await this.executor.loadPendingTransactions()

      // Start execution in the background - don't await to avoid blocking initialization
      // The transactions will execute and complete asynchronously
      this.executor.executeAll().catch((error) => {
        console.warn(`Failed to execute transactions:`, error)
      })
    } catch (error) {
      console.warn(`Failed to load and replay transactions:`, error)
    }
  }

  get isOfflineEnabled(): boolean {
    return this.mode === `offline` && this.isLeaderState
  }

  /**
   * Wait for the executor to fully initialize.
   * This ensures that pending transactions are loaded and optimistic state is restored.
   */
  async waitForInit(): Promise<void> {
    return this.initPromise
  }

  createOfflineTransaction(
    options: CreateOfflineTransactionOptions,
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
      this,
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
        this,
      )
      return action(variables)
    }
  }

  private async persistTransaction(
    transaction: OfflineTransaction,
  ): Promise<void> {
    // Wait for initialization to complete
    await this.initPromise

    return withNestedSpan(
      `executor.persistTransaction`,
      {
        'transaction.id': transaction.id,
        'transaction.mutationFnName': transaction.mutationFnName,
      },
      async (span) => {
        if (!this.isOfflineEnabled || !this.outbox || !this.executor) {
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
            error,
          )
          span.setAttribute(`result`, `failed`)
          throw error
        }
      },
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

    // Clean up the restoration transaction - the sync will provide authoritative data
    this.cleanupRestorationTransaction(transactionId)
  }

  // Method for TransactionExecutor to signal failure
  rejectTransaction(transactionId: string, error: Error): void {
    const deferred = this.pendingTransactionPromises.get(transactionId)
    if (deferred) {
      deferred.reject(error)
      this.pendingTransactionPromises.delete(transactionId)
    }

    // Clean up the restoration transaction and rollback optimistic state
    this.cleanupRestorationTransaction(transactionId, true)
  }

  // Method for TransactionExecutor to register restoration transactions
  registerRestorationTransaction(
    offlineTransactionId: string,
    restorationTransaction: Transaction,
  ): void {
    this.restorationTransactions.set(
      offlineTransactionId,
      restorationTransaction,
    )
  }

  private cleanupRestorationTransaction(
    transactionId: string,
    shouldRollback = false,
  ): void {
    const restorationTx = this.restorationTransactions.get(transactionId)
    if (!restorationTx) {
      return
    }

    this.restorationTransactions.delete(transactionId)

    if (shouldRollback) {
      restorationTx.rollback()
      return
    }

    // Mark as completed so recomputeOptimisticState removes it from consideration.
    // The actual data will come from the sync.
    restorationTx.setState(`completed`)

    // Remove from each collection's transaction map and recompute
    const touchedCollections = new Set<string>()
    for (const mutation of restorationTx.mutations) {
      // Defensive check for corrupted deserialized data
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (!mutation.collection) {
        continue
      }
      const collectionId = mutation.collection.id
      if (touchedCollections.has(collectionId)) {
        continue
      }
      touchedCollections.add(collectionId)
      mutation.collection._state.transactions.delete(restorationTx.id)
      mutation.collection._state.recomputeOptimisticState(false)
    }
  }

  async removeFromOutbox(id: string): Promise<void> {
    if (!this.outbox) {
      return
    }
    await this.outbox.remove(id)
  }

  async peekOutbox(): Promise<Array<OfflineTransaction>> {
    if (!this.outbox) {
      return []
    }
    return this.outbox.getAll()
  }

  async clearOutbox(): Promise<void> {
    if (!this.outbox || !this.executor) {
      return
    }
    await this.outbox.clear()
    this.executor.clear()
  }

  notifyOnline(): void {
    this.onlineDetector.notifyOnline()
  }

  getPendingCount(): number {
    if (!this.executor) {
      return 0
    }
    return this.executor.getPendingCount()
  }

  getRunningCount(): number {
    if (!this.executor) {
      return 0
    }
    return this.executor.getRunningCount()
  }

  getOnlineDetector(): OnlineDetector {
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

    if (this.leaderElection) {
      this.leaderElection.releaseLeadership()

      if (`dispose` in this.leaderElection) {
        ;(this.leaderElection as any).dispose()
      }
    }

    this.onlineDetector.dispose()
  }
}

export function startOfflineExecutor(config: OfflineConfig): OfflineExecutor {
  return new OfflineExecutor(config)
}
