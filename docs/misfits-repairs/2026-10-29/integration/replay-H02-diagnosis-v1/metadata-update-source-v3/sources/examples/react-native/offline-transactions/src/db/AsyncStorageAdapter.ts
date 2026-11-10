import AsyncStorage from '@react-native-async-storage/async-storage'
import type { StorageAdapter } from '@tanstack/offline-transactions'

/**
 * AsyncStorage adapter for React Native offline transactions.
 * Implements the StorageAdapter interface using @react-native-async-storage/async-storage.
 */
export class AsyncStorageAdapter implements StorageAdapter {
  private prefix: string

  constructor(prefix = `offline-tx:`) {
    this.prefix = prefix
  }

  private getKey(key: string): string {
    return `${this.prefix}${key}`
  }

  async get(key: string): Promise<string | null> {
    return AsyncStorage.getItem(this.getKey(key))
  }

  async set(key: string, value: string): Promise<void> {
    await AsyncStorage.setItem(this.getKey(key), value)
  }

  async delete(key: string): Promise<void> {
    await AsyncStorage.removeItem(this.getKey(key))
  }

  async keys(): Promise<Array<string>> {
    const allKeys = await AsyncStorage.getAllKeys()
    return allKeys
      .filter((k) => k.startsWith(this.prefix))
      .map((k) => k.slice(this.prefix.length))
  }

  async clear(): Promise<void> {
    const keys = await this.keys()
    const prefixedKeys = keys.map((k) => this.getKey(k))
    if (prefixedKeys.length > 0) {
      await AsyncStorage.multiRemove(prefixedKeys)
    }
  }
}
