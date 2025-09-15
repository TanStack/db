import { BaseStorageAdapter } from "./StorageAdapter"

export class LocalStorageAdapter extends BaseStorageAdapter {
  private prefix: string

  constructor(prefix = `offline-tx:`) {
    super()
    this.prefix = prefix
  }

  private getKey(key: string): string {
    return `${this.prefix}${key}`
  }

  get(key: string): Promise<string | null> {
    try {
      return Promise.resolve(localStorage.getItem(this.getKey(key)))
    } catch (error) {
      console.warn(`localStorage get failed:`, error)
      return Promise.resolve(null)
    }
  }

  set(key: string, value: string): Promise<void> {
    try {
      localStorage.setItem(this.getKey(key), value)
      return Promise.resolve()
    } catch (error) {
      if (
        error instanceof DOMException &&
        error.name === `QuotaExceededError`
      ) {
        return Promise.reject(
          new Error(
            `Storage quota exceeded. Consider clearing old transactions.`
          )
        )
      }
      return Promise.reject(error)
    }
  }

  delete(key: string): Promise<void> {
    try {
      localStorage.removeItem(this.getKey(key))
      return Promise.resolve()
    } catch (error) {
      console.warn(`localStorage delete failed:`, error)
      return Promise.resolve()
    }
  }

  keys(): Promise<Array<string>> {
    try {
      const keys: Array<string> = []
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)
        if (key && key.startsWith(this.prefix)) {
          keys.push(key.slice(this.prefix.length))
        }
      }
      return Promise.resolve(keys)
    } catch (error) {
      console.warn(`localStorage keys failed:`, error)
      return Promise.resolve([])
    }
  }

  async clear(): Promise<void> {
    try {
      const keys = await this.keys()
      for (const key of keys) {
        localStorage.removeItem(this.getKey(key))
      }
    } catch (error) {
      console.warn(`localStorage clear failed:`, error)
    }
  }
}
