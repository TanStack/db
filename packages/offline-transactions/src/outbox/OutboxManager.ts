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
 * A write's rejection, kept for a writer in another tab, or `pending` when a
 * record cannot be read and the outcome is unknown. Each recording has its
 * own key.
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

/** A stored error, or undefined when the value does not hold one. */
function readError(
  value: unknown,
): { name: string; message: string } | undefined {
  if (typeof value !== `object` || value === null) return undefined
  const { name, message } = value as Record<string, unknown>
  return typeof name === `string` && typeof message === `string`
    ? { name, message }
    : undefined
}

/** A stored outcome, or undefined when it cannot be read. */
function readOutcome(data: string): OutboxOutcome | undefined {
  let value: unknown
  try {
    value = JSON.parse(data)
  } catch {
    return undefined
  }
  if (typeof value !== `object` || value === null) return undefined
  const { error, at } = value as Record<string, unknown>
  if (typeof at !== `number`) return undefined
  const recorded = readError(error)
  return recorded ? { error: recorded, at } : undefined
}

export class OutboxManager {
  private storage: StorageAdapter
  private serializer: TransactionSerializer
  private keyPrefix = `tx:`
  private outcomePrefix = `outcome:`
  private decisionPrefix = `decision:`
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

  /** Records a rejection before its row is removed. */
  async recordRejection(id: string, error: Error): Promise<void> {
    const token = `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`
    const outcome: OutboxOutcome = {
      error: { name: error.name, message: error.message },
      at: Date.now(),
    }
    await this.storage.set(
      `${this.outcomeKeyPrefix(id)}${token}`,
      JSON.stringify(outcome),
    )
  }

  /**
   * A rejection if any recording holds one. A record that cannot be decoded
   * leaves the outcome unknown, so it reads as pending; a failed read is
   * thrown unless a later record holds a rejection.
   */
  async getOutcome(id: string): Promise<OutboxOutcome | null> {
    let found: OutboxOutcome | null = null
    let failure: { error: unknown } | undefined
    for (const key of await this.outcomeKeys(id)) {
      let data: string | null
      try {
        data = await this.storage.get(key)
      } catch (error) {
        failure ??= { error }
        continue
      }
      // Its writer or a prune removed it meanwhile.
      if (data === null) continue
      const outcome = readOutcome(data) ?? { pending: true, at: 0 }
      if (outcome.error) return outcome
      found = outcome
    }
    if (failure) throw failure.error
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
      const outcome = data === null ? undefined : readOutcome(data)
      if (outcome && outcome.at < before) await this.storage.delete(key)
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
   * Records a decision to reject a saved write, beside its row, which it
   * never rewrites; returns its token. A replay settles a row that has any
   * decision instead of sending it; a decision whose row is gone means
   * nothing. Each recorder has its own key, so one that withdraws its
   * decision leaves any other tab's, such as a successor's adoption.
   */
  async recordDecision(id: string, error: Error): Promise<string> {
    const token = `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`
    await this.storage.set(
      `${this.decisionKeyPrefix(id)}${token}`,
      JSON.stringify({
        error: { name: error.name, message: error.message },
        at: Date.now(),
      }),
    )
    return token
  }

  /** Withdraws one recorder's decision. */
  async removeDecision(id: string, token: string): Promise<void> {
    await this.storage.delete(`${this.decisionKeyPrefix(id)}${token}`)
  }

  /** Removes every decision for a write. */
  async removeDecisions(id: string): Promise<void> {
    const prefix = this.decisionKeyPrefix(id)
    await Promise.all(
      (await this.storage.keys())
        .filter((key) => key.startsWith(prefix))
        .map((key) => this.storage.delete(key)),
    )
  }

  private decisionKeyPrefix(id: string): string {
    return `${this.decisionPrefix}${encodeURIComponent(id)}:`
  }

  /**
   * A saved row's phase and stored error, read without decoding its
   * mutations; null when no row is stored. A failed read, or a phase this
   * version does not know, throws. A row that is not JSON was never sent.
   */
  async getPhase(
    id: string,
  ): Promise<Pick<OfflineTransaction, `outboxPhase` | `lastError`> | null> {
    const data = await this.storage.get(this.getStorageKey(id))
    if (data === null) return null
    let row: unknown
    try {
      row = JSON.parse(data)
    } catch {
      return {}
    }
    if (typeof row !== `object` || row === null) return {}
    const { outboxPhase, lastError } = row as Record<string, unknown>
    if (outboxPhase === undefined) return {}
    if (
      outboxPhase !== `deletion-pending` &&
      outboxPhase !== `rejection-pending`
    )
      throw new Error(`Unsupported transaction outbox phase`)
    return { outboxPhase, lastError: readError(lastError) }
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
    // Filled from the same key listing with every recorded decision.
    decisions?: Map<string, { name: string; message: string }>,
  ): Promise<T> {
    const read = { revision: this.removalRevision }
    this.activeReads.add(read)
    try {
      const keys = await this.storage.keys()
      if (decisions) {
        // Only a decision whose row is stored is read; one that cannot be
        // read still blocks its row. One whose row is gone is deleted
        // unread, whether or not this tab can decode that row.
        const stored = new Set(
          keys
            .filter((key) => key.startsWith(this.keyPrefix))
            .map((key) => key.slice(this.keyPrefix.length)),
        )
        for (const key of keys) {
          if (!key.startsWith(this.decisionPrefix)) continue
          const id = decodeURIComponent(
            key.slice(this.decisionPrefix.length).split(`:`)[0]!,
          )
          if (!stored.has(id)) {
            this.storage.delete(key).catch(() => {})
            continue
          }
          let error: { name: string; message: string } | undefined
          try {
            const data = await this.storage.get(key)
            if (data === null) continue
            error = readError((JSON.parse(data) as { error?: unknown }).error)
          } catch {
            // The unread decision still rejects its row.
          }
          // Another decision's readable error wins over the fallback.
          if (error) decisions.set(id, error)
          else if (!decisions.has(id))
            decisions.set(id, {
              name: `NonRetriableError`,
              message: `Transaction rejected by a recorded decision`,
            })
        }
      }
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
