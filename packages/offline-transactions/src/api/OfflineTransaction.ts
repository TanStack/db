import { createTransaction, safeRandomUUID } from '@tanstack/db'
import type { PendingMutation, Transaction } from '@tanstack/db'
import type {
  CreateOfflineTransactionOptions,
  OfflineMutationFn,
  OfflineTransaction as OfflineTransactionType,
} from '../types'

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
    executor: any,
  ) {
    this.offlineId = safeRandomUUID()
    this.mutationFnName = options.mutationFnName
    this.autoCommit = options.autoCommit ?? true
    this.idempotencyKey = options.idempotencyKey ?? safeRandomUUID()
    this.metadata = options.metadata ?? {}
    this.persistTransaction = persistTransaction
    this.executor = executor
  }

  mutate(callback: () => void): Transaction {
    // One offline transaction is one transaction, and its id is unique among
    // live transactions. Repeated calls add to it while it is pending. With
    // autoCommit, it commits after this callback and reports a failure
    // through isPersisted, so a later call throws: it is no longer pending.
    const created = this.transaction === null
    this.transaction ??= createTransaction({
      id: this.offlineId,
      autoCommit: this.autoCommit,
      mutationFn: async () => {
        // This is the blocking mutationFn that waits for the executor
        // First persist the transaction to the outbox
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
          spanContext: undefined,
          version: 1,
        }

        const completionPromise = this.executor.waitForTransactionCompletion(
          this.offlineId,
        )

        try {
          // Persistence also drives the shared queue. This transaction can finish
          // before that queue drains; observe both promises from the outset.
          await Promise.race([
            this.persistTransaction(offlineTransaction),
            completionPromise,
          ])
          // A queue pause (offline or retry) is not transaction completion.
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
    // A transaction without mutations completes, and one rolled back before
    // it commits fails, without its mutation function, so the executor never
    // settles its waiter. Settle it here with the same outcome; the executor
    // has already settled every other transaction.
    if (created)
      void this.transaction.isPersisted.promise.then(
        () => this.executor.resolveTransaction(this.offlineId, undefined),
        (error: Error) =>
          this.executor.rejectTransaction(this.offlineId, error),
      )

    this.transaction.mutate(() => {
      callback()
    })

    return this.transaction
  }

  async commit(): Promise<Transaction> {
    if (!this.transaction) {
      throw new Error(`No mutations to commit. Call mutate() first.`)
    }

    // The mutationFn persists the transaction and waits for the executor. A
    // failed commit has already rolled the transaction back.
    await this.transaction.commit()
    return this.transaction
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
