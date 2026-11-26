// Storage adapters
import {
  createOptimisticAction,
  createTransaction,
  safeRandomUUID,
} from '@tanstack/db'
import { IndexedDBAdapter } from './storage/IndexedDBAdapter'
import { LocalStorageAdapter } from './storage/LocalStorageAdapter'

// Core components
import { OUTCOME_RETENTION_MS, OutboxManager } from './outbox/OutboxManager'
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
import { NonRetriableError } from './types'
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

/** Messages between tabs that share an outbox with durable follower writes. */
type OutboxMessage =
  | { type: `added`; id: string }
  | { type: `settled`; id: string; error?: { name: string; message: string } }
  | { type: `leader` }
  // A follower asks the leader to remove saved writes, and hears back.
  | { type: `remove`; request: string; ids: Array<string> }
  | {
      type: `removed`
      request: string
      error?: { name: string; message: string }
      // The leader stopped leading before it decided; ask again.
      retry?: true
    }

function outboxMessageError(error: { name: string; message: string }): Error {
  const restored =
    error.name === `NonRetriableError`
      ? new NonRetriableError(error.message)
      : new Error(error.message)
  restored.name = error.name
  return restored
}

function removedError(): Error {
  return new NonRetriableError(`Transaction removed from the outbox`)
}

/** How many settled ids an executor remembers to reject late waiters. */
const SETTLED_TRANSACTIONS_REMEMBERED = 1000

// Pending callers and restored optimism belong to surviving Collections, even
// when their executor is replaced. Adapter objects can change over one store.
// Weak keys keep this coordination local to the Collections' runtime lifetime.
const completionOwners = new WeakMap<
  OfflineConfig[`collections`][string],
  Set<OfflineExecutor>
>()

// Executors with a call running, by Collection, so a later replacement can
// tell a write is still being sent after its row went.
const callIssuers = new WeakMap<
  OfflineConfig[`collections`][string],
  Set<OfflineExecutor>
>()

/** A replacement may add Collections while retaining every prior registry entry. */
function retainsCollections(
  configured: OfflineConfig[`collections`],
  prior: OfflineConfig[`collections`],
): boolean {
  return Object.entries(prior).every(
    ([name, collection]) => configured[name] === collection,
  )
}

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
  private disposed = false
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
  // Follower writes this leader could not read; retried on connectivity.
  private readonly unadmitted = new Set<string>()
  // A follower's outbox check failed; it runs again on connectivity.
  private reconcileFailed = false
  // Only the newest outbox check sets or clears reconcileFailed.
  private sweeps = 0
  private outboxChannelName: string | null = null
  private initialized = false
  private term = 0
  // Saves in progress; true once removeFromOutbox or clearOutbox removed one.
  private readonly saving = new Map<string, boolean>()
  // Ids whose call this executor is running.
  private readonly issued = new Set<string>()
  // Running markers this leader recorded for removed writes, by id; each
  // overlapping removal leaves its own.
  private readonly runningRemovals = new Map<string, Set<string>>()
  // Removals this follower asked the leader for, by request.
  private readonly removals = new Map<
    string,
    {
      ids: Array<string>
      resolve: () => void
      reject: (error: Error) => void
    }
  >()
  private pendingTransactionPromises: Map<
    string,
    {
      promise: Promise<any>
      resolve: (result: any) => void
      reject: (error: Error) => void
      // Set once this tab's save starts; resolves to whether it succeeded.
      saved?: Promise<boolean>
      savedAt?: number
    }
  > = new Map()

  /**
   * Ids this executor settled, oldest first. A waiter for one of them has
   * nothing left to wait for. An unknown id can still arrive from another tab.
   */
  private readonly settledTransactions = new Set<string>()

  // Track restoration transactions for cleanup when offline transactions complete
  private restorationTransactions: Map<string, Transaction> = new Map()

  // Carries follower writes to the leader and their outcomes back.
  private outboxChannel: BroadcastChannel | null = null
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
    // Handle constructor-started rejection; waitForInit still observes it.
    void this.initPromise.catch(() => {})
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
          // A custom elector may repeat the initial result while replay is active.
          if (this.disposed || isLeader === this.isLeaderState) return
          this.isLeaderState = isLeader
          if (isLeader) this.term++
          // Its unstarted queue goes; the next leader loads the outbox.
          else this.executor!.dropPending()

          if (this.config.onLeadershipChange) {
            this.config.onLeadershipChange(isLeader)
          }

          if (isLeader) {
            this.loadAndReplayTransactions().catch((error) => {
              console.warn(`Failed to load and replay transactions:`, error)
            })
          }
        },
      )
    }

    this.unsubscribeOnline = this.onlineDetector.subscribe(() => {
      if (this.reconcileFailed) this.reconcileFollowerWrites()
      if (this.isOfflineEnabled && this.executor) {
        this.executor.resetRetryDelays()
        // A failed replay of this term runs again; admissions wait for it.
        if (this.executor.replayFailed)
          this.loadAndReplayTransactions().catch((error) => {
            console.warn(`Failed to load and replay transactions:`, error)
          })
        this.retryAdmissions()
        void this.executor.retryFailedCleanups()

        if (this.scheduler.getPendingCount() > 0) {
          const barrierPromise = this.executor.executeAll()

          for (const collection of Object.values(this.config.collections)) {
            collection.deferDataRefresh = barrierPromise
          }

          barrierPromise
            .catch((error) => {
              console.warn(
                `Failed to execute transactions on connectivity change:`,
                error,
              )
            })
            .finally(() => {
              for (const collection of Object.values(this.config.collections)) {
                if (collection.deferDataRefresh === barrierPromise) {
                  collection.deferDataRefresh = null
                }
              }
            })
        } else {
          this.executor.executeAll().catch((error) => {
            console.warn(
              `Failed to execute transactions on connectivity change:`,
              error,
            )
          })
        }
      }
    })
  }

  private async initialize(): Promise<void> {
    try {
      // Probe storage and create adapter
      const { storage, diagnostic } = await this.createStorage()
      if (this.disposed) {
        this.initResolve()
        return
      }

      // Cast to writable to set readonly properties
      ;(this as any).storage = storage
      ;(this as any).storageDiagnostic = diagnostic
      ;(this as any).mode = diagnostic.mode

      if (!storage) {
        // Online-only mode - notify callback and skip offline setup
        if (this.config.onStorageFailure) {
          this.config.onStorageFailure(diagnostic)
        }
        this.initResolve()
        return
      }

      // Storage available - set up offline components
      this.outbox = new OutboxManager(
        storage,
        this.config.collections,
        this.config.mutationCodec,
      )
      this.executor = new TransactionExecutor(
        this.scheduler,
        this.outbox,
        this.config,
        this,
      )
      this.leaderElection = this.createLeaderElection()
      this.openOutboxChannel()

      // Request leadership first
      const isLeader = await this.leaderElection.requestLeadership()
      // Disposal may have run while leadership was pending.
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (this.disposed) {
        this.leaderElection.releaseLeadership()
        this.initResolve()
        return
      }
      this.isLeaderState = isLeader

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
      this.initialized = true
      // A replacement executor settles saved writes its predecessor left.
      if (!isLeader) this.reconcileFollowerWrites()
      this.initResolve()
    } catch (error) {
      console.warn(`Failed to initialize offline executor:`, error)
      // A failed start releases what it opened, without waiting for dispose().
      this.unsubscribeOnline?.()
      this.unsubscribeOnline = null
      this.unsubscribeLeadership?.()
      this.unsubscribeLeadership = null
      this.outboxChannel?.close()
      this.outboxChannel = null
      this.leaderElection?.releaseLeadership()
      this.initReject(error instanceof Error ? error : new Error(String(error)))
    }
  }

  private async loadAndReplayTransactions(): Promise<void> {
    if (!this.executor) {
      return
    }

    const term = this.term
    // Startup must observe a failed read instead of reporting an empty outbox.
    await this.executor.loadPendingTransactions()
    // Outcomes no writer read within the retention window go.
    if (this.recordsOutcomes)
      this.outbox!.pruneOutcomes(Date.now() - OUTCOME_RETENTION_MS).catch(
        (error) => {
          console.warn(`Failed to prune outcome records:`, error)
        },
      )

    // A leader that closed can leave a removed row with an undelivered outcome.
    if (this.outboxChannel) {
      this.outboxChannel.postMessage({
        type: `leader`,
      } satisfies OutboxMessage)
    }
    this.reconcileFollowerWrites()
    // Removals this tab asked a former leader for are now its own to make,
    // unless it stopped leading during the replay; they then stay with the
    // current leader.

    if (this.isOfflineEnabled && term === this.term)
      for (const [request, removal] of [...this.removals]) {
        this.removals.delete(request)
        this.removeOrForward(removal.ids).then(removal.resolve, removal.reject)
      }
    else
      for (const [request, removal] of this.removals)
        this.postRemoval(request, removal.ids)

    // Replay completion is separate from initialization and durable admission.
    this.executor.executeAll().catch((error) => {
      console.warn(`Failed to execute transactions:`, error)
    })
  }

  private openOutboxChannel(): void {
    if (
      this.config.followerWrites !== `durable` ||
      typeof BroadcastChannel === `undefined`
    ) {
      return
    }
    // Tabs that share an outbox register the same keys; their collection
    // ids may differ.
    const registryKeys = Object.keys(this.config.collections).sort()
    this.outboxChannelName = `tanstack-offline-outbox:${registryKeys.join(`,`)}`
    this.outboxChannel = new BroadcastChannel(this.outboxChannelName)
    this.outboxChannel.onmessage = (event: MessageEvent<OutboxMessage>) => {
      this.handleOutboxMessage(event.data)
    }
  }

  private handleOutboxMessage(message: OutboxMessage): void {
    if (message.type === `leader`) {
      this.reconcileFollowerWrites()
      // A new leader may not have heard earlier removal requests.
      for (const [request, removal] of this.removals)
        this.postRemoval(request, removal.ids)
    } else if (message.type === `remove`) {
      this.removeForFollower(message.request, message.ids)
    } else if (message.type === `removed`) {
      const removal = this.removals.get(message.request)
      if (!removal) return
      if (message.retry) {
        this.postRemoval(message.request, removal.ids)
        return
      }
      this.removals.delete(message.request)
      if (message.error) removal.reject(outboxMessageError(message.error))
      else removal.resolve()
    } else if (message.type === `added`) {
      this.admitFollowerWrite(message.id)
    } else {
      this.settleFollowerWrite(
        message.id,
        message.error && outboxMessageError(message.error),
      )
    }
  }

  // Only the leader knows whether a write's call started, so it removes.
  private removeForFollower(request: string, ids: Array<string>): void {
    if (!this.isOfflineEnabled) return
    this.removeSaved(ids).then(
      (yielded) => {
        this.outboxChannel?.postMessage({
          type: `removed`,
          request,
          ...(yielded.length > 0 ? { retry: true as const } : {}),
        } satisfies OutboxMessage)
      },
      (error: unknown) => {
        console.warn(`Failed to remove transactions for a follower:`, error)
        const failure =
          error instanceof Error ? error : new Error(String(error))
        this.outboxChannel?.postMessage({
          type: `removed`,
          request,
          error: { name: failure.name, message: failure.message },
        } satisfies OutboxMessage)
      },
    )
  }

  private postRemoval(request: string, ids: Array<string>): void {
    this.outboxChannel?.postMessage({
      type: `remove`,
      request,
      ids,
    } satisfies OutboxMessage)
  }

  // An initialized follower that shares the outbox asks the leader.
  private get forwardsRemovals(): boolean {
    return this.writesToSharedOutbox && !this.isOfflineEnabled
  }

  private forwardRemoval(ids: Array<string>): Promise<void> {
    const request = safeRandomUUID()
    return new Promise<void>((resolve, reject) => {
      this.removals.set(request, {
        ids,
        // Only a confirmed removal stops a save of this tab that lands late.
        resolve: () => {
          for (const id of ids)
            if (this.saving.has(id)) this.saving.set(id, true)
          resolve()
        },
        reject,
      })
      this.postRemoval(request, ids)
    })
  }

  private admitFollowerWrite(id: string): void {
    this.unadmitted.delete(id)
    // Only the leader sends; a later leader loads the row from the outbox.
    if (!this.isOfflineEnabled) return
    this.executor!.admitTransaction(id).catch((error) => {
      console.warn(`Failed to run follower write:`, error)
      // The row is still saved. This leader reads it again when
      // connectivity changes.
      this.unadmitted.add(id)
    })
  }

  private retryAdmissions(): void {
    for (const id of [...this.unadmitted]) this.admitFollowerWrite(id)
  }

  // Every tab hears a settlement; only the writer removes its outcome record.
  private settleFollowerWrite(id: string, error?: Error): void {
    const own = this.ownsWrite(id)
    this.settleTransaction(id, undefined, error)
    if (own) this.outbox!.removeOutcome(id).catch(() => {})
  }

  /**
   * This executor, or one in this runtime that it settles, saved the
   * transaction and waits for it; an observer does not.
   */
  ownsWrite(id: string): boolean {
    // One it settled as the writer stays its own, so a later cleanup leaves
    // no record for it.
    if (this.ownSettled.has(id)) return true
    return this.settlementOwners(id).some(
      (owner) => owner.pendingTransactionPromises.get(id)?.saved !== undefined,
    )
  }

  private reconcileFollowerWrites(): void {
    void this.settleRemovedWrites()
  }

  // A saved write that left the outbox was settled by a leader whose message
  // never arrived. The leader recorded a rejection before removing the row; a
  // row removed with no record completed. A failed read leaves that write
  // pending, and the check runs again when connectivity changes.
  private async settleRemovedWrites(): Promise<void> {
    // Without recorded outcomes a missing row could be either outcome, so the
    // waiter keeps waiting for this tab's own settlement.
    if (!this.recordsOutcomes) return
    const sweep = ++this.sweeps
    let failed = false
    // A predecessor this executor settles may have left saved writes; each is
    // checked against the outbox its executor saved it to.
    const waiters = this.relatedExecutors().flatMap((owner) =>
      [...owner.pendingTransactionPromises].map(
        ([id, waiter]) => [owner, id, waiter] as const,
      ),
    )
    for (const [owner, id, waiter] of waiters) {
      try {
        if (!(await waiter.saved)) continue
        // Absence means success only where rejections are recorded, and not
        // while this runtime still runs the write's call.
        if (!owner.recordsOutcomes || this.callRunning(id, owner)) continue
        const outbox = owner.outbox!
        // A row that cannot be decoded is still there.
        if (await outbox.has(id)) continue
        const outcome = await outbox.getOutcome(id)
        // Its call is still running after a removal.
        if (outcome?.pending) continue
        const error = outcome?.error
        // A record older than the retention window may have been pruned, so
        // no record cannot mean success.
        if (!error && Date.now() - waiter.savedAt! > OUTCOME_RETENTION_MS)
          continue
        owner.settleFollowerWrite(id, error && outboxMessageError(error))
      } catch (error) {
        failed = true
        console.warn(`Failed to reconcile follower writes:`, error)
      }
    }
    if (sweep === this.sweeps) this.reconcileFailed = failed
  }

  /** Rejections are recorded for writers in other tabs. */
  get recordsOutcomes(): boolean {
    return this.outboxChannelName !== null
  }

  /** Counts later leadership gains, so work begun in an earlier term can tell. */
  get leadershipTerm(): number {
    return this.term
  }

  // Tells the leader about a saved write, even when this tab was disposed
  // while the save ran.
  private announceAdded(id: string): void {
    const message = { type: `added`, id } satisfies OutboxMessage
    if (this.outboxChannel) {
      this.outboxChannel.postMessage(message)
      return
    }
    if (this.outboxChannelName === null) return
    const channel = new BroadcastChannel(this.outboxChannelName)
    channel.postMessage(message)
    channel.close()
  }

  private announceSettled(
    id: string,
    error: Error | undefined,
    own: boolean,
  ): void {
    // This tab's own rejected write needs no record for another tab.
    if (own && this.recordsOutcomes)
      this.outbox?.removeOutcome(id).catch(() => {})
    if (this.outboxChannel) {
      this.outboxChannel.postMessage({
        type: `settled`,
        id,
        ...(error
          ? { error: { name: error.name, message: error.message } }
          : {}),
      } satisfies OutboxMessage)
    }
  }

  // A write made before initialization keeps the online path.
  private get writesToSharedOutbox(): boolean {
    return this.outboxChannel !== null && this.initialized
  }

  get isOfflineEnabled(): boolean {
    return !this.disposed && this.mode === `offline` && this.isLeaderState
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
    if (!this.isOfflineEnabled && !this.writesToSharedOutbox) {
      // Non-leader: use createTransaction directly with the resolved mutation function
      // We need to wrap it to add the idempotency key
      return createTransaction({
        autoCommit: options.autoCommit ?? true,
        mutationFn: (params) =>
          mutationFn({
            ...params,
            idempotencyKey: options.idempotencyKey || safeRandomUUID(),
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
      if (!this.isOfflineEnabled && !this.writesToSharedOutbox) {
        // Non-leader: use createOptimisticAction directly
        const action = createOptimisticAction({
          mutationFn: (vars, params) =>
            mutationFn({
              ...vars,
              ...params,
              idempotencyKey: safeRandomUUID(),
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

    if (
      (!this.isOfflineEnabled && !this.writesToSharedOutbox) ||
      !this.outbox ||
      !this.executor
    ) {
      throw new NonRetriableError(`Offline transaction was not admitted`)
    }

    try {
      const term = this.term
      // A follower's save goes to the shared outbox for whichever tab leads;
      // this executor's own faults only stop work it would run itself.
      if (this.isOfflineEnabled || !this.writesToSharedOutbox)
        this.executor.assertHealthy()
      const saved = this.outbox.add(transaction)
      // The transaction registered this waiter before it asked to persist.
      const waiter = this.pendingTransactionPromises.get(transaction.id)!
      waiter.savedAt = Date.now()
      waiter.saved = saved.then(
        () => true,
        () => false,
      )
      this.saving.set(transaction.id, false)
      let removed: boolean | undefined
      try {
        await saved
      } finally {
        removed = this.saving.get(transaction.id)
        this.saving.delete(transaction.id)
      }
      if (removed) {
        // Removed while it was saved: a row that landed after the removal
        // goes too, and the write never runs.
        await this.outbox.remove(transaction.id)
        this.rejectTransaction(transaction.id, removedError())
        return
      }
      if (!this.isOfflineEnabled) {
        this.announceAdded(transaction.id)
        return
      }
      // Leadership changed while the row was saved: another leader may have
      // sent and removed it, so admit it only if it is still there.
      if (term !== this.term) {
        this.admitFollowerWrite(transaction.id)
        return
      }
      // A shared queue error belongs to its execution, not every caller
      // that durably admitted a transaction. Per-ID signals settle callers.
      this.executor.execute(transaction).catch((error) => {
        console.warn(`Failed to execute transactions:`, error)
      })
    } catch (error) {
      console.error(
        `Failed to persist offline transaction ${transaction.id}:`,
        error,
      )
      throw error
    }
  }

  // Ids this executor settled as their writer, oldest first: a record a
  // later leader writes for one again is still its own to remove.
  private readonly ownSettled = new Set<string>()

  private rememberOwnSettled(transactionId: string): void {
    this.ownSettled.add(transactionId)
    if (this.ownSettled.size > SETTLED_TRANSACTIONS_REMEMBERED)
      this.ownSettled.delete(this.ownSettled.values().next().value!)
  }

  private rememberSettled(transactionId: string): void {
    this.settledTransactions.add(transactionId)
    if (this.settledTransactions.size > SETTLED_TRANSACTIONS_REMEMBERED)
      this.settledTransactions.delete(
        this.settledTransactions.values().next().value!,
      )
  }

  // Method for OfflineTransaction to wait for completion
  async waitForTransactionCompletion(transactionId: string): Promise<any> {
    const existing = this.pendingTransactionPromises.get(transactionId)
    if (existing) {
      return existing.promise
    }
    if (this.settledTransactions.has(transactionId))
      throw new Error(
        `Offline transaction ${transactionId} already settled; wait for it before it settles`,
      )

    const deferred: {
      promise: Promise<any>
      resolve: (result: any) => void
      reject: (error: Error) => void
    } = {} as any

    deferred.promise = new Promise((resolve, reject) => {
      deferred.resolve = resolve
      deferred.reject = reject
    })

    this.trackCompletion()
    this.pendingTransactionPromises.set(transactionId, deferred)
    return deferred.promise
  }

  // Method for TransactionExecutor to signal completion
  resolveTransaction(transactionId: string, result: any): void {
    try {
      this.settleTransaction(transactionId, result)
    } finally {
      this.announceSettled(transactionId, undefined, false)
    }
  }

  // Method for TransactionExecutor to signal failure. A local fault that is
  // not the write's outcome stays unannounced.
  rejectTransaction(
    transactionId: string,
    error: Error,
    announce = true,
  ): void {
    const own = this.ownsWrite(transactionId)
    try {
      this.settleTransaction(transactionId, undefined, error)
    } finally {
      if (announce) this.announceSettled(transactionId, error, own)
    }
  }

  private trackCompletion(): void {
    if (
      this.pendingTransactionPromises.size > 0 ||
      this.restorationTransactions.size > 0
    )
      return
    for (const collection of Object.values(this.config.collections)) {
      let owners = completionOwners.get(collection)
      if (!owners) completionOwners.set(collection, (owners = new Set()))
      owners.add(this)
    }
  }

  private settleTransaction(
    transactionId: string,
    result: unknown,
    error?: Error,
  ): void {
    // Select every recipient before publication can reenter this executor.
    const owners = this.settlementOwners(transactionId)

    const cleanupErrors: Array<unknown> = []
    for (const owner of owners) {
      owner.rememberSettled(transactionId)
      const deferred = owner.pendingTransactionPromises.get(transactionId)
      if (deferred?.saved !== undefined) owner.rememberOwnSettled(transactionId)
      owner.pendingTransactionPromises.delete(transactionId)
      if (error) deferred?.reject(error)
      else deferred?.resolve(result)
      // Publication can throw from user subscribers. Every owner still receives
      // its durable outcome before that exception leaves this operation.
      try {
        owner.cleanupRestorationTransaction(transactionId, !!error)
      } catch (cleanupError) {
        cleanupErrors.push(cleanupError)
      }

      if (
        owner.pendingTransactionPromises.size === 0 &&
        owner.restorationTransactions.size === 0
      ) {
        for (const collection of Object.values(owner.config.collections))
          completionOwners.get(collection)?.delete(owner)
      }
    }
    if (cleanupErrors.length > 0) throw cleanupErrors[0]
  }

  /** The executors in this runtime that receive this transaction's outcome. */
  private settlementOwners(transactionId: string): Array<OfflineExecutor> {
    return this.relatedExecutors().filter(
      (owner) =>
        owner === this ||
        owner.pendingTransactionPromises.has(transactionId) ||
        owner.restorationTransactions.has(transactionId),
    )
  }

  trackIssued(id: string, active: boolean): void {
    if (active) this.issued.add(id)
    else this.issued.delete(id)
    for (const collection of Object.values(this.config.collections)) {
      let issuers = callIssuers.get(collection)
      if (!issuers) callIssuers.set(collection, (issuers = new Set()))
      if (this.issued.size > 0) issuers.add(this)
      else issuers.delete(this)
    }
  }

  /**
   * Whether an executor in this runtime over the waiter owner's Collections
   * runs the write's call; replacements may each add other Collections.
   */
  private callRunning(id: string, owner: OfflineExecutor): boolean {
    if (this.issued.has(id)) return true
    for (const collection of Object.values(owner.config.collections)) {
      for (const issuer of callIssuers.get(collection) ?? [])
        if (
          issuer.issued.has(id) &&
          (retainsCollections(
            issuer.config.collections,
            owner.config.collections,
          ) ||
            retainsCollections(
              owner.config.collections,
              issuer.config.collections,
            ))
        )
          return true
    }
    return false
  }

  /** This executor and those in this runtime whose outcomes it delivers. */
  private relatedExecutors(): Array<OfflineExecutor> {
    const candidates = new Set<OfflineExecutor>([this])
    for (const collection of Object.values(this.config.collections)) {
      for (const owner of completionOwners.get(collection) ?? [])
        candidates.add(owner)
    }
    return [...candidates].filter(
      (owner) =>
        owner === this ||
        // Either executor may deliver the outcome: a retired issued call or
        // its successor's replay. An ancillary overlap alone is insufficient.
        retainsCollections(this.config.collections, owner.config.collections) ||
        retainsCollections(owner.config.collections, this.config.collections),
    )
  }

  // Method for TransactionExecutor to register restoration transactions
  registerRestorationTransaction(
    offlineTransactionId: string,
    restorationTransaction: Transaction,
  ): void {
    this.trackCompletion()
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

    // A sibling rollback can settle this snapshot before its durable work.
    if (restorationTx.state !== `pending`) return

    // Mark as completed: every Collection that tracked it recomputes and
    // releases it. The actual data will come from the sync.
    restorationTx.completeWithoutCommit()
    restorationTx.touchCollection()
  }

  async removeFromOutbox(id: string): Promise<void> {
    if (!this.outbox) {
      return
    }
    if (this.forwardsRemovals) await this.forwardRemoval([id])
    else await this.removeOrForward([id])
  }

  /** Removes here, or asks the leader for removals this tab yielded. */
  private async removeOrForward(ids: Array<string>): Promise<void> {
    const yielded = await this.removeSaved(ids)
    if (yielded.length === 0) return
    if (this.forwardsRemovals) return this.forwardRemoval(yielded)
    throw new Error(`Leadership moved before the removal was decided`)
  }

  /**
   * Removes saved transactions. A write that has not started fails with a
   * removal error, which a writer in another tab also reads from its record;
   * a started call keeps the provider's outcome.
   */
  /**
   * Removes saved transactions; returns those it left to the next leader
   * because it stopped leading before deciding them.
   */
  private async removeSaved(ids: Array<string>): Promise<Array<string>> {
    const outbox = this.outbox!
    const error = removedError()
    // Off the queue before any await, so this tab cannot start them
    // meanwhile; the one already running keeps the provider's outcome.
    const unstarted = new Set(this.scheduler.removePendingTransactions(ids))
    // A leader's removal yields if it stops leading before its decision is
    // recorded; the term only counts gains.
    const term = this.term
    const leading = this.isOfflineEnabled
    const stillLeads = () =>
      // Leadership can end during the awaits this check follows.
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      !leading || (this.isOfflineEnabled && term === this.term)
    // A writer in another tab reads a record; this tab's own needs none.
    const records = (id: string) => this.recordsOutcomes && !this.ownsWrite(id)
    const failures: Array<unknown> = []
    const yielded: Array<string> = []
    // Each id settles by its own deletion.
    await Promise.all(
      ids.map(async (id) => {
        let committed = false
        try {
          if (!(await outbox.has(id))) {
            if (this.saving.has(id)) this.saving.set(id, true)
            return
          }
          if (!unstarted.has(id)) {
            // A writer in another tab reads that the call it cannot see is
            // still running. The marker is registered before the row goes,
            // and withdrawn at once if the call already finished.
            const token = records(id)
              ? await outbox.recordPending(id)
              : undefined
            if (token !== undefined) {
              if (this.scheduler.isRunning(id)) {
                let tokens = this.runningRemovals.get(id)
                if (!tokens) this.runningRemovals.set(id, (tokens = new Set()))
                tokens.add(token)
              } else await outbox.withdrawOutcome(id, token).catch(() => {})
            }
            await outbox.remove(id)
            if (this.saving.has(id)) this.saving.set(id, true)
            return
          }
          // A row whose call already settled keeps that outcome.
          const row = await outbox.get(id).catch(() => null)
          if (row?.outboxPhase) {
            const outcome =
              row.outboxPhase === `rejection-pending` && row.lastError
                ? outboxMessageError(row.lastError)
                : undefined
            if (outcome && records(id))
              await outbox.recordRejection(id, outcome)
            await outbox.remove(id)
            if (outcome) this.rejectTransaction(id, outcome)
            else this.resolveTransaction(id, undefined)
            return
          }
          // The decision is recorded beside the row first, so a later
          // leader's replay settles the row rather than send it. One that
          // does not commit while this tab leads is withdrawn. Without
          // recorded outcomes there are no decisions, and a write the next
          // leader now decides is left to it.
          const decision = this.recordsOutcomes
            ? await outbox.recordDecision(id, error)
            : undefined
          if (!stillLeads()) {
            if (decision !== undefined)
              await outbox.removeDecision(id, decision).catch(() => {})
            yielded.push(id)
            return
          }
          // Only a persisted decision commits a removal; without one, a failed
          // deletion is reported and the write stays eligible.
          committed = decision !== undefined
          // No admission runs it while its deletion is pending.
          if (committed) this.executor!.exclude(id)
          if (records(id)) await outbox.recordRejection(id, error)
          await outbox.remove(id)
          if (decision !== undefined)
            await outbox.removeDecision(id, decision).catch(() => {})
        } catch (removalError) {
          if (!committed) {
            failures.push(removalError)
            // The row is read again, so a write another leader settled
            // meanwhile is not queued again.
            this.executor!.admitTransaction(id).catch(() => {})
            return
          }
          // A committed removal stands; its deletion is retried.
          this.executor!.retryDecided(id, error)
        }
        if (this.saving.has(id)) this.saving.set(id, true)
        this.rejectTransaction(id, error)
      }),
    )
    if (failures.length > 0) throw failures[0]
    return yielded
  }

  /** Withdraws the running markers of a removed write whose call finished. */
  async finishRunningRemoval(id: string): Promise<void> {
    const tokens = this.runningRemovals.get(id)
    if (!tokens) return
    this.runningRemovals.delete(id)
    await Promise.all(
      [...tokens].map((token) =>
        this.outbox!.withdrawOutcome(id, token).catch(() => {}),
      ),
    )
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
    // Only the ids it removes leave the queue; a write saved after the
    // snapshot stays queued.
    const ids = await this.outbox.ids()
    if (this.forwardsRemovals) await this.forwardRemoval(ids)
    else await this.removeOrForward(ids)
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

  isOnline(): boolean {
    return this.onlineDetector.isOnline()
  }

  dispose(): void {
    this.disposed = true
    for (const removal of this.removals.values())
      removal.reject(
        new Error(`Offline executor disposed before the leader removed it`),
      )
    this.removals.clear()
    this.executor?.pause()
    for (const collection of Object.values(this.config.collections)) {
      collection.deferDataRefresh = null
    }

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

    if (this.outboxChannel) {
      this.outboxChannel.close()
      this.outboxChannel = null
    }

    this.onlineDetector.dispose()
  }
}

export function startOfflineExecutor(config: OfflineConfig): OfflineExecutor {
  return new OfflineExecutor(config)
}
