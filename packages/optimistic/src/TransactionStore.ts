import { openDB } from "idb"
import type { DBSchema, IDBPDatabase } from "idb"
import type { Transaction, TransactionWithoutToObject } from "./types"

/**
 * Interface defining the database schema for transaction storage
 */
interface SyncDB extends DBSchema {
  transactions: {
    key: string
    value: TransactionWithoutToObject
  }
}

/**
 * Provides persistent storage for transactions using IndexedDB
 */
export class TransactionStore {
  private dbName = `sync-transactions`
  private version = 1
  private db: IDBPDatabase<SyncDB> | null = null

  /**
   * Gets or initializes the IndexedDB database connection
   *
   * @returns Promise resolving to the database connection
   */
  private async getDB(): Promise<IDBPDatabase<SyncDB>> {
    if (this.db) return this.db

    this.db = await openDB<SyncDB>(this.dbName, this.version, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(`transactions`)) {
          db.createObjectStore(`transactions`, { keyPath: `id` })
        }
      },
    })

    return this.db
  }

  /**
   * Retrieves all transactions from the store
   *
   * @returns Promise resolving to an array of all transactions
   */
  async getTransactions(): Promise<Array<TransactionWithoutToObject>> {
    const db = await this.getDB()
    return db.getAll(`transactions`)
  }

  /**
   * Stores a transaction in the database
   *
   * @param tx - The transaction to store
   * @returns Promise that resolves when the operation is complete
   */
  async putTransaction(tx: Transaction): Promise<void> {
    const db = await this.getDB()

    const { isSynced, isPersisted, toObject, ...restOfTx } = tx
    await db.put(`transactions`, restOfTx)
  }

  /**
   * Deletes a transaction from the store
   *
   * @param id - The ID of the transaction to delete
   * @returns Promise that resolves when the operation is complete
   */
  async deleteTransaction(id: string): Promise<void> {
    const db = await this.getDB()
    await db.delete(`transactions`, id)
  }

  /**
   * Clears all transactions from the store
   * Helper method primarily used for testing
   *
   * @returns Promise that resolves when all transactions are deleted
   */
  async clearAll(): Promise<void> {
    const db = await this.getDB()
    const txIds = await db.getAllKeys(`transactions`)
    await Promise.all(txIds.map((id) => this.deleteTransaction(id)))
  }
}
