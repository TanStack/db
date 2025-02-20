import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { Transaction } from './types'

interface SyncDB extends DBSchema {
  transactions: {
    key: string
    value: Transaction
  }
}

export class TransactionStore {
  private dbName = 'sync-transactions'
  private version = 1
  private db: IDBPDatabase<SyncDB> | null = null

  private async getDB(): Promise<IDBPDatabase<SyncDB>> {
    if (this.db) return this.db

    this.db = await openDB<SyncDB>(this.dbName, this.version, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('transactions')) {
          db.createObjectStore('transactions', { keyPath: 'id' })
        }
      },
    })

    return this.db
  }

  async getTransactions(): Promise<Transaction[]> {
    const db = await this.getDB()
    return db.getAll('transactions')
  }

  async putTransaction(tx: Transaction): Promise<void> {
    const db = await this.getDB()
    await db.put('transactions', tx)
  }

  async deleteTransaction(id: string): Promise<void> {
    const db = await this.getDB()
    await db.delete('transactions', id)
  }

  // Helper method for tests to clean up
  async clearAll(): Promise<void> {
    const db = await this.getDB()
    const txIds = await db.getAllKeys('transactions')
    await Promise.all(txIds.map(id => this.deleteTransaction(id)))
  }
}
