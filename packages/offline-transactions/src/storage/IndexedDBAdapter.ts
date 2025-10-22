import { BaseStorageAdapter } from "./StorageAdapter"

export class IndexedDBAdapter extends BaseStorageAdapter {
  private dbName: string
  private storeName: string
  private db: IDBDatabase | null = null

  constructor(dbName = `offline-transactions`, storeName = `transactions`) {
    super()
    this.dbName = dbName
    this.storeName = storeName
  }

  /**
   * Probe IndexedDB availability by attempting to open a test database.
   * This catches private mode and other restrictions that block IndexedDB.
   */
  static async probe(): Promise<{ available: boolean; error?: Error }> {
    // Check if IndexedDB exists
    if (typeof indexedDB === `undefined`) {
      return {
        available: false,
        error: new Error(`IndexedDB is not available in this environment`),
      }
    }

    // Try to actually open a test database to verify it works
    try {
      const testDbName = `__offline-tx-probe__`
      const request = indexedDB.open(testDbName, 1)

      return new Promise((resolve) => {
        request.onerror = () => {
          const error = request.error || new Error(`IndexedDB open failed`)
          resolve({ available: false, error })
        }

        request.onsuccess = () => {
          // Clean up test database
          const db = request.result
          db.close()
          indexedDB.deleteDatabase(testDbName)
          resolve({ available: true })
        }

        request.onblocked = () => {
          resolve({
            available: false,
            error: new Error(`IndexedDB is blocked`),
          })
        }
      })
    } catch (error) {
      return {
        available: false,
        error: error instanceof Error ? error : new Error(String(error)),
      }
    }
  }

  private async openDB(): Promise<IDBDatabase> {
    if (this.db) {
      return this.db
    }

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, 1)

      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        this.db = request.result
        resolve(this.db)
      }

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName)
        }
      }
    })
  }

  private async getStore(
    mode: IDBTransactionMode = `readonly`
  ): Promise<IDBObjectStore> {
    const db = await this.openDB()
    const transaction = db.transaction([this.storeName], mode)
    return transaction.objectStore(this.storeName)
  }

  async get(key: string): Promise<string | null> {
    try {
      const store = await this.getStore(`readonly`)
      return new Promise((resolve, reject) => {
        const request = store.get(key)
        request.onerror = () => reject(request.error)
        request.onsuccess = () => resolve(request.result ?? null)
      })
    } catch (error) {
      console.warn(`IndexedDB get failed:`, error)
      return null
    }
  }

  async set(key: string, value: string): Promise<void> {
    try {
      const store = await this.getStore(`readwrite`)
      return new Promise((resolve, reject) => {
        const request = store.put(value, key)
        request.onerror = () => reject(request.error)
        request.onsuccess = () => resolve()
      })
    } catch (error) {
      if (
        error instanceof DOMException &&
        error.name === `QuotaExceededError`
      ) {
        throw new Error(
          `Storage quota exceeded. Consider clearing old transactions.`
        )
      }
      throw error
    }
  }

  async delete(key: string): Promise<void> {
    try {
      const store = await this.getStore(`readwrite`)
      return new Promise((resolve, reject) => {
        const request = store.delete(key)
        request.onerror = () => reject(request.error)
        request.onsuccess = () => resolve()
      })
    } catch (error) {
      console.warn(`IndexedDB delete failed:`, error)
    }
  }

  async keys(): Promise<Array<string>> {
    try {
      const store = await this.getStore(`readonly`)
      return new Promise((resolve, reject) => {
        const request = store.getAllKeys()
        request.onerror = () => reject(request.error)
        request.onsuccess = () => resolve(request.result as Array<string>)
      })
    } catch (error) {
      console.warn(`IndexedDB keys failed:`, error)
      return []
    }
  }

  async clear(): Promise<void> {
    try {
      const store = await this.getStore(`readwrite`)
      return new Promise((resolve, reject) => {
        const request = store.clear()
        request.onerror = () => reject(request.error)
        request.onsuccess = () => resolve()
      })
    } catch (error) {
      console.warn(`IndexedDB clear failed:`, error)
    }
  }
}
