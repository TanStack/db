import { createTransaction } from "@tanstack/db"
import { NonRetriableError } from "../types"
import type { Transaction } from "@tanstack/db"
import type {
  CreateOfflineTransactionOptions,
  OfflineMutationFn,
  OfflineTransaction as OfflineTransactionType,
} from "../types"

export class OfflineTransaction {
  private offlineId: string
  private mutationFnName: string
  private autoCommit: boolean
  private idempotencyKey: string
  private metadata: Record<string, any>
  private transaction: Transaction | null = null
  private mutationFn: OfflineMutationFn
  private persistTransaction: (tx: OfflineTransactionType) => Promise<void>

  constructor(
    options: CreateOfflineTransactionOptions,
    mutationFn: OfflineMutationFn,
    persistTransaction: (tx: OfflineTransactionType) => Promise<void>
  ) {
    this.offlineId = crypto.randomUUID()
    this.mutationFnName = options.mutationFnName
    this.autoCommit = options.autoCommit ?? true
    this.idempotencyKey = options.idempotencyKey ?? crypto.randomUUID()
    this.metadata = options.metadata ?? {}
    this.mutationFn = mutationFn
    this.persistTransaction = persistTransaction
  }

  mutate(callback: () => void): Transaction {
    this.transaction = createTransaction({
      id: this.offlineId,
      autoCommit: false,
      mutationFn: async (params) => {
        return this.mutationFn({
          ...params,
          idempotencyKey: this.idempotencyKey,
        })
      },
      metadata: this.metadata,
    })

    this.transaction.mutate(callback)

    if (this.autoCommit) {
      // Note: this will need to be handled differently since commit is now async
      // For now, returning the transaction and letting caller handle commit
      this.commit().catch((error) => {
        console.error(`Auto-commit failed:`, error)
      })
    }

    return this.transaction
  }

  async commit(): Promise<Transaction> {
    if (!this.transaction) {
      throw new Error(`No mutations to commit. Call mutate() first.`)
    }

    const offlineTransaction: OfflineTransactionType = {
      id: this.offlineId,
      mutationFnName: this.mutationFnName,
      mutations: this.serializeMutations(this.transaction.mutations),
      keys: this.extractKeys(this.transaction.mutations),
      idempotencyKey: this.idempotencyKey,
      createdAt: new Date(),
      retryCount: 0,
      nextAttemptAt: Date.now(),
      metadata: this.metadata,
      version: 1,
    }

    try {
      // Persist to outbox first - this triggers the retry system
      await this.persistTransaction(offlineTransaction)

      // Only commit to TanStack DB after successful persistence
      await this.transaction.commit()
      return this.transaction
    } catch (error) {
      // Only rollback for NonRetriableError - other errors should allow retry
      if (error instanceof NonRetriableError) {
        this.transaction.rollback()
      }
      throw error
    }
  }

  rollback(): void {
    if (this.transaction) {
      this.transaction.rollback()
    }
  }

  private extractKeys(mutations: Array<any>): Array<string> {
    return mutations.map((mutation) => mutation.globalKey)
  }

  private serializeMutations(mutations: Array<any>): Array<any> {
    return mutations.map((mutation) => ({
      globalKey: mutation.globalKey,
      type: mutation.type,
      modified: mutation.modified,
      original: mutation.original,
      collectionId: mutation.collection.id,
    }))
  }

  get id(): string {
    return this.offlineId
  }
}
