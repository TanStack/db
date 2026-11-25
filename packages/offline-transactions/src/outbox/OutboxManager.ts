import {
  MissingTemporalConstructorError,
  MutationCodecError,
  TransactionSerializer,
} from './TransactionSerializer'
import type {
  MutationValueCodec,
  OfflineTransaction,
  StorageAdapter,
} from '../types'
import type { Collection } from '@tanstack/db'

export class OutboxTransactionNotFoundError extends Error {}

/**
 * A write's outcome, kept for a writer in another tab: a rejection, or a
 * marker that the write's call is still running after its row was removed.
 * Each recording has its own key, so a recorder withdraws only its own.
 */
export type OutboxOutcome = {
  error?: { name: string; message: string }
  pending?: true
  // When it was recorded, so an outcome no writer reads can be pruned.
  at: number
}

/**
 * How long an outcome record outlives its row. A writer that saved its write
 * longer ago than this cannot read a missing record as success.
 */
export const OUTCOME_RETENTION_MS = 7 * 24 * 60 * 60 * 1000

export class OutboxManager {
  private storage: StorageAdapter
  private serializer: TransactionSerializer
  private keyPrefix = `tx:`
  private outcomePrefix = `outcome:`
  private removalRevision = 0
  private activeReads = new Set<{ revision: number }>()
  private removedAtRevision = new Map<string, number>()

  constructor(
    storage: StorageAdapter,

    collections: Record<string, Collection<any, any, any, any, any>>,
    mutationCodec?: MutationValueCodec,
  ) {
    this.storage = storage
    this.serializer = new TransactionSerializer(collections, mutationCodec)
  }

  private getStorageKey(id: string): string {
    return `${this.keyPrefix}${id}`
  }

  private recordRemovals(ids: Iterable<string>): void {
    this.removalRevision++
    if (this.activeReads.size === 0) return
    for (const id of ids) this.removedAtRevision.set(id, this.removalRevision)
    this.pruneRemovalHistory()
  }

  private pruneRemovalHistory(): void {
    if (this.activeReads.size === 0) {
      this.removedAtRevision.clear()
      return
    }
    let oldestRead = Number.POSITIVE_INFINITY
    for (const read of this.activeReads)
      oldestRead = Math.min(oldestRead, read.revision)
    for (const [id, revision] of this.removedAtRevision)
      if (revision <= oldestRead) this.removedAtRevision.delete(id)
  }

  async add(transaction: OfflineTransaction): Promise<void> {
    const key = this.getStorageKey(transaction.id)
    const serialized = this.serializer.serialize(transaction)
    await this.storage.set(key, serialized)
  }

  async get(id: string): Promise<OfflineTransaction | null> {
    const key = this.getStorageKey(id)
    const data = await this.storage.get(key)
    if (!data) return null

    try {
      return this.serializer.deserialize(data)
    } catch (error) {
      if (
        error instanceof MissingTemporalConstructorError ||
        error instanceof MutationCodecError
      ) {
        error.message = `transaction ${id}: ${error.message}`
        throw error
      }
      console.warn(`Failed to deserialize transaction ${id}:`, error)
      return null
    }
  }

  /**
   * Reads one transaction, or null if it was removed after this read began,
   * so a stale read cannot bring back a transaction that already settled. A
   * row this tab cannot decode, such as one saved under a collection key it
   * does not register, throws instead of reading as absent.
   */
  async getCurrent(id: string): Promise<OfflineTransaction | null> {
    const read = { revision: this.removalRevision }
    this.activeReads.add(read)
    try {
      const data = await this.storage.get(this.getStorageKey(id))
      let transaction: OfflineTransaction | null = null
      if (data) {
        try {
          transaction = this.serializer.deserialize(data)
        } catch (error) {
          throw new Error(
            `Cannot read outbox transaction ${id}: ${(error as Error).message}`,
          )
        }
      }
      return (this.removedAtRevision.get(id) ?? 0) <= read.revision
        ? transaction
        : null
    } finally {
      this.activeReads.delete(read)
      this.pruneRemovalHistory()
    }
  }

  /** Records a rejection before its row is removed; returns its token. */
  async recordRejection(id: string, error: Error): Promise<string> {
    return this.recordOutcome(id, {
      error: { name: error.name, message: error.message },
      at: Date.now(),
    })
  }

  /** Records that a removed write's call is still running. */
  async recordPending(id: string): Promise<string> {
    return this.recordOutcome(id, { pending: true, at: Date.now() })
  }

  private async recordOutcome(
    id: string,
    outcome: OutboxOutcome,
  ): Promise<string> {
    const token = `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`
    await this.storage.set(
      `${this.outcomeKeyPrefix(id)}${token}`,
      JSON.stringify(outcome),
    )
    return token
  }

  /** Removes one recording, leaving any another recorder made. */
  async withdrawOutcome(id: string, token: string): Promise<void> {
    await this.storage.delete(`${this.outcomeKeyPrefix(id)}${token}`)
  }

  /** A rejection if any recording holds one, else a running marker. */
  async getOutcome(id: string): Promise<OutboxOutcome | null> {
    let found: OutboxOutcome | null = null
    for (const key of await this.outcomeKeys(id)) {
      const data = await this.storage.get(key)
      if (data === null) continue
      const outcome = JSON.parse(data) as OutboxOutcome
      if (outcome.error) return outcome
      found = outcome
    }
    return found
  }

  async removeOutcome(id: string): Promise<void> {
    await Promise.all(
      (await this.outcomeKeys(id)).map((key) => this.storage.delete(key)),
    )
  }

  /** Removes outcome records made before `before`. */
  async pruneOutcomes(before: number): Promise<void> {
    const keys = (await this.storage.keys()).filter((key) =>
      key.startsWith(this.outcomePrefix),
    )
    for (const key of keys) {
      const data = await this.storage.get(key)
      if (data !== null && (JSON.parse(data) as OutboxOutcome).at < before)
        await this.storage.delete(key)
    }
  }

  // An encoded id contains no `:`, so one id's prefix never matches another.
  private outcomeKeyPrefix(id: string): string {
    return `${this.outcomePrefix}${encodeURIComponent(id)}:`
  }

  private async outcomeKeys(id: string): Promise<Array<string>> {
    const prefix = this.outcomeKeyPrefix(id)
    return (await this.storage.keys()).filter((key) => key.startsWith(prefix))
  }

  /**
   * Persists a decision to reject a saved row, so any later leader's replay
   * settles it as rejected instead of sending it. A row that already carries
   * a phase keeps it; one that cannot be read is left as it is.
   */
  async markRejected(
    id: string,
    error: Error,
  ): Promise<`marked` | `gone` | `unreadable`> {
    const data = await this.storage.get(this.getStorageKey(id))
    if (data === null) return `gone`
    let transaction: OfflineTransaction
    try {
      transaction = this.serializer.deserialize(data)
    } catch {
      return `unreadable`
    }
    if (transaction.outboxPhase) return `marked`
    await this.add({
      ...transaction,
      outboxPhase: `rejection-pending`,
      lastError: {
        name: error.name,
        message: error.message,
        stack: error.stack,
      },
    })
    return `marked`
  }

  /** Whether a row is saved, without decoding it. */
  async has(id: string): Promise<boolean> {
    return (await this.storage.get(this.getStorageKey(id))) !== null
  }

  /** Ids of the saved transactions, without reading them. */
  async ids(): Promise<Array<string>> {
    return (await this.storage.keys())
      .filter((key) => key.startsWith(this.keyPrefix))
      .map((key) => key.slice(this.keyPrefix.length))
  }

  async getAll(): Promise<Array<OfflineTransaction>> {
    return this.withAll((transactions) => transactions)
  }

  async withAll<T>(
    consume: (transactions: Array<OfflineTransaction>) => T,
  ): Promise<T> {
    const read = { revision: this.removalRevision }
    this.activeReads.add(read)
    try {
      const keys = await this.storage.keys()
      const transactionKeys = keys.filter((key) =>
        key.startsWith(this.keyPrefix),
      )

      const transactions: Array<OfflineTransaction> = []

      for (const key of transactionKeys) {
        const data = await this.storage.get(key)
        if (data) {
          try {
            const transaction = this.serializer.deserialize(data)
            transactions.push(transaction)
          } catch (error) {
            if (
              error instanceof MissingTemporalConstructorError ||
              error instanceof MutationCodecError
            ) {
              error.message = `transaction ${key.slice(this.keyPrefix.length)}: ${error.message}`
              throw error
            }
            console.warn(
              `Failed to deserialize transaction from key ${key}:`,
              error,
            )
          }
        }
      }

      const currentTransactions = transactions
        .filter(
          ({ id }) => (this.removedAtRevision.get(id) ?? 0) <= read.revision,
        )
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      // Keep the read registered until replay admission completes. A durable
      // removal cannot land between filtering and this synchronous consumer.
      return await consume(currentTransactions)
    } finally {
      this.activeReads.delete(read)
      this.pruneRemovalHistory()
    }
  }

  async getByKeys(keys: Array<string>): Promise<Array<OfflineTransaction>> {
    const allTransactions = await this.getAll()
    const keySet = new Set(keys)

    return allTransactions.filter((transaction) =>
      transaction.keys.some((key) => keySet.has(key)),
    )
  }

  async update(
    id: string,
    updates: Partial<OfflineTransaction>,
  ): Promise<void> {
    const existing = await this.get(id)
    if (!existing) {
      throw new OutboxTransactionNotFoundError(`Transaction ${id} not found`)
    }
    await this.add({ ...existing, ...updates })
  }

  async remove(id: string): Promise<void> {
    const key = this.getStorageKey(id)
    await this.storage.delete(key)
    this.recordRemovals([id])
  }

  async removeMany(ids: Array<string>): Promise<void> {
    await Promise.all(ids.map((id) => this.remove(id)))
  }

  async clear(): Promise<void> {
    const keys = await this.storage.keys()
    const transactionKeys = keys.filter((key) => key.startsWith(this.keyPrefix))

    await this.removeMany(
      transactionKeys.map((key) => key.slice(this.keyPrefix.length)),
    )
  }

  async count(): Promise<number> {
    const keys = await this.storage.keys()
    return keys.filter((key) => key.startsWith(this.keyPrefix)).length
  }
}
