import { withSpan } from "../telemetry/tracer"
import { TransactionSerializer } from "./TransactionSerializer"
import type { OfflineTransaction, StorageAdapter } from "../types"
import type { Collection } from "@tanstack/db"

export class OutboxManager {
  private storage: StorageAdapter
  private serializer: TransactionSerializer
  private keyPrefix = `tx:`

  constructor(
    storage: StorageAdapter,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    collections: Record<string, Collection<any, any, any, any, any>>
  ) {
    this.storage = storage
    this.serializer = new TransactionSerializer(collections)
  }

  private getStorageKey(id: string): string {
    return `${this.keyPrefix}${id}`
  }

  async add(transaction: OfflineTransaction): Promise<void> {
    return withSpan(
      `outbox.add`,
      {
        "transaction.id": transaction.id,
        "transaction.mutationFnName": transaction.mutationFnName,
        "transaction.keyCount": transaction.keys.length,
      },
      async () => {
        const key = this.getStorageKey(transaction.id)
        const serialized = this.serializer.serialize(transaction)
        await this.storage.set(key, serialized)
      }
    )
  }

  async get(id: string): Promise<OfflineTransaction | null> {
    return withSpan(`outbox.get`, { "transaction.id": id }, async (span) => {
      const key = this.getStorageKey(id)
      const data = await this.storage.get(key)

      if (!data) {
        span.setAttribute(`result`, `not_found`)
        return null
      }

      try {
        const transaction = this.serializer.deserialize(data)
        span.setAttribute(`result`, `found`)
        return transaction
      } catch (error) {
        console.warn(`Failed to deserialize transaction ${id}:`, error)
        span.setAttribute(`result`, `deserialize_error`)
        return null
      }
    })
  }

  async getAll(): Promise<Array<OfflineTransaction>> {
    return withSpan(`outbox.getAll`, {}, async (span) => {
      const keys = await this.storage.keys()
      const transactionKeys = keys.filter((key) =>
        key.startsWith(this.keyPrefix)
      )

      span.setAttribute(`transactionCount`, transactionKeys.length)

      const transactions: Array<OfflineTransaction> = []

      for (const key of transactionKeys) {
        const data = await this.storage.get(key)
        if (data) {
          try {
            const transaction = this.serializer.deserialize(data)
            transactions.push(transaction)
          } catch (error) {
            console.warn(
              `Failed to deserialize transaction from key ${key}:`,
              error
            )
          }
        }
      }

      return transactions.sort(
        (a, b) => a.createdAt.getTime() - b.createdAt.getTime()
      )
    })
  }

  async getByKeys(keys: Array<string>): Promise<Array<OfflineTransaction>> {
    const allTransactions = await this.getAll()
    const keySet = new Set(keys)

    return allTransactions.filter((transaction) =>
      transaction.keys.some((key) => keySet.has(key))
    )
  }

  async update(
    id: string,
    updates: Partial<OfflineTransaction>
  ): Promise<void> {
    return withSpan(`outbox.update`, { "transaction.id": id }, async () => {
      const existing = await this.get(id)
      if (!existing) {
        throw new Error(`Transaction ${id} not found`)
      }

      const updated = { ...existing, ...updates }
      await this.add(updated)
    })
  }

  async remove(id: string): Promise<void> {
    return withSpan(`outbox.remove`, { "transaction.id": id }, async () => {
      const key = this.getStorageKey(id)
      await this.storage.delete(key)
    })
  }

  async removeMany(ids: Array<string>): Promise<void> {
    return withSpan(`outbox.removeMany`, { count: ids.length }, async () => {
      await Promise.all(ids.map((id) => this.remove(id)))
    })
  }

  async clear(): Promise<void> {
    const keys = await this.storage.keys()
    const transactionKeys = keys.filter((key) => key.startsWith(this.keyPrefix))

    await Promise.all(transactionKeys.map((key) => this.storage.delete(key)))
  }

  async count(): Promise<number> {
    const keys = await this.storage.keys()
    return keys.filter((key) => key.startsWith(this.keyPrefix)).length
  }
}
