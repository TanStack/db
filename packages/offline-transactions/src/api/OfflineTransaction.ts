import { context, trace } from "@opentelemetry/api"
import { createTransaction } from "@tanstack/db"
import { NonRetriableError } from "../types"
import type { PendingMutation, Transaction } from "@tanstack/db"
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
  private persistTransaction: (tx: OfflineTransactionType) => Promise<void>
  private executor: any // Will be typed properly - reference to OfflineExecutor

  constructor(
    options: CreateOfflineTransactionOptions,
    mutationFn: OfflineMutationFn,
    persistTransaction: (tx: OfflineTransactionType) => Promise<void>,
    executor: any
  ) {
    this.offlineId = crypto.randomUUID()
    this.mutationFnName = options.mutationFnName
    this.autoCommit = options.autoCommit ?? true
    this.idempotencyKey = options.idempotencyKey ?? crypto.randomUUID()
    this.metadata = options.metadata ?? {}
    this.persistTransaction = persistTransaction
    this.executor = executor
  }

  mutate(callback: () => void): Transaction {
    this.transaction = createTransaction({
      id: this.offlineId,
      autoCommit: false,
      mutationFn: async () => {
        // This is the blocking mutationFn that waits for the executor
        // First persist the transaction to the outbox
        const activeSpan = trace.getSpan(context.active())
        const spanContext = activeSpan?.spanContext()

        const offlineTransaction: OfflineTransactionType = {
          id: this.offlineId,
          mutationFnName: this.mutationFnName,
          mutations: this.transaction!.mutations,
          keys: this.extractKeys(this.transaction!.mutations),
          idempotencyKey: this.idempotencyKey,
          createdAt: new Date(),
          retryCount: 0,
          nextAttemptAt: Date.now(),
          metadata: this.metadata,
          spanContext: spanContext
            ? {
                traceId: spanContext.traceId,
                spanId: spanContext.spanId,
                traceFlags: spanContext.traceFlags,
                traceState: spanContext.traceState?.serialize(),
              }
            : undefined,
          version: 1,
        }

        const completionPromise = this.executor.waitForTransactionCompletion(
          this.offlineId
        )

        try {
          await this.persistTransaction(offlineTransaction)
          // Now block and wait for the executor to complete the real mutation
          await completionPromise
        } catch (error) {
          const normalizedError =
            error instanceof Error ? error : new Error(String(error))
          this.executor.rejectTransaction(this.offlineId, normalizedError)
          throw error
        }

        return
      },
      metadata: this.metadata,
    })

    this.transaction.mutate(() => {
      callback()
    })

    if (this.autoCommit) {
      // Auto-commit for direct OfflineTransaction usage
      this.commit().catch((error) => {
        console.error(`Auto-commit failed:`, error)
        throw error
      })
    }

    return this.transaction
  }

  async commit(): Promise<Transaction> {
    if (!this.transaction) {
      throw new Error(`No mutations to commit. Call mutate() first.`)
    }

    try {
      // Commit the TanStack DB transaction
      // This will trigger the mutationFn which handles persistence and waiting
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

  private extractKeys(mutations: Array<PendingMutation>): Array<string> {
    return mutations.map((mutation) => mutation.globalKey)
  }

  get id(): string {
    return this.offlineId
  }
}
