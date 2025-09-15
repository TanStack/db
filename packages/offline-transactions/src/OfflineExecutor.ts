// Storage adapters
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

// Replay
import { TransactionReplay } from "./replay/TransactionReplay"
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
  private replay: TransactionReplay
  private isLeaderState = false
  private unsubscribeOnline: (() => void) | null = null
  private unsubscribeLeadership: (() => void) | null = null

  constructor(config: OfflineConfig) {
    this.config = config
    this.storage = this.createStorage()
    this.outbox = new OutboxManager(this.storage)
    this.scheduler = new KeyScheduler()
    this.executor = new TransactionExecutor(
      this.scheduler,
      this.outbox,
      this.config
    )
    this.leaderElection = this.createLeaderElection()
    this.onlineDetector = new DefaultOnlineDetector()
    this.replay = new TransactionReplay(this.config.collections)

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
    if (WebLocksLeader.isSupported()) {
      return new WebLocksLeader()
    } else if (BroadcastChannelLeader.isSupported()) {
      return new BroadcastChannelLeader()
    } else {
      // Fallback: always be leader in environments without multi-tab support
      return {
        requestLeadership: async () => true,
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
    try {
      const isLeader = await this.leaderElection.requestLeadership()

      if (isLeader) {
        await this.loadAndReplayTransactions()
      }
    } catch (error) {
      console.warn(`Failed to initialize offline executor:`, error)
    }
  }

  private async loadAndReplayTransactions(): Promise<void> {
    try {
      await this.executor.loadPendingTransactions()

      const allTransactions = await this.outbox.getAll()
      await this.replay.replayAll(allTransactions)

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
  ): OfflineTransactionAPI {
    return new OfflineTransactionAPI(
      options,
      this.isOfflineEnabled ? this.persistTransaction.bind(this) : undefined
    )
  }

  createOfflineAction<T>(
    options: CreateOfflineActionOptions<T>
  ): (vars: T) => Transaction {
    return createOfflineAction(
      options,
      this.isOfflineEnabled ? this.persistTransaction.bind(this) : undefined
    )
  }

  private async persistTransaction(
    transaction: OfflineTransaction
  ): Promise<void> {
    if (!this.isOfflineEnabled) {
      return
    }

    try {
      await this.outbox.add(transaction)
      await this.executor.execute(transaction)
    } catch (error) {
      console.error(`Failed to persist offline transaction:`, error)
      throw error
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
