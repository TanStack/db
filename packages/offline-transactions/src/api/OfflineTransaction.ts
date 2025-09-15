import { createTransaction } from "@tanstack/db"
import type { Transaction } from "@tanstack/db"
import type {
  CreateOfflineTransactionOptions,
  OfflineTransaction as OfflineTransactionType,
} from "../types"

export class OfflineTransaction {
  private offlineId: string
  private mutationFnName: string
  private autoCommit: boolean
  private idempotencyKey: string
  private metadata: Record<string, any>
  private transaction: Transaction | null = null
  private onPersist?: (
    offlineTransaction: OfflineTransactionType
  ) => Promise<void>

  constructor(
    options: CreateOfflineTransactionOptions,
    onPersist?: (offlineTransaction: OfflineTransactionType) => Promise<void>
  ) {
    this.offlineId = crypto.randomUUID()
    this.mutationFnName = options.mutationFnName
    this.autoCommit = options.autoCommit ?? true
    this.idempotencyKey = options.idempotencyKey ?? crypto.randomUUID()
    this.metadata = options.metadata ?? {}
    this.onPersist = onPersist
  }

  mutate(callback: () => void): Transaction {
    this.transaction = createTransaction({
      id: this.offlineId,
      autoCommit: false,
      mutationFn: async () => {
        // This will be handled by the offline executor
      },
      metadata: this.metadata,
    })

    this.transaction.mutate(callback)

    if (this.autoCommit) {
      return this.commit()
    }

    return this.transaction
  }

  commit(): Transaction {
    if (!this.transaction) {
      throw new Error(`No mutations to commit. Call mutate() first.`)
    }

    if (this.onPersist) {
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

      this.onPersist(offlineTransaction).catch((error) => {
        console.error(`Failed to persist offline transaction:`, error)
        this.transaction?.rollback()
      })
    }

    this.transaction.commit()
    return this.transaction
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
