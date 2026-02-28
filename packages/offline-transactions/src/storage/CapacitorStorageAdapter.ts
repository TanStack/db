import { Preferences } from '@capacitor/preferences'
import { BaseStorageAdapter } from './StorageAdapter'

export class CapacitorStorageAdapter extends BaseStorageAdapter {
  private prefix: string

  constructor(prefix = `offline-tx:`) {
    super()
    this.prefix = prefix
  }

  static async probe(): Promise<{ available: boolean; error?: Error }> {
    try {
      const testKey = `__offline-tx-probe__`
      const testValue = `test`

      await Preferences.set({ key: testKey, value: testValue })
      const { value: retrieved } = await Preferences.get({ key: testKey })
      await Preferences.remove({ key: testKey })

      if (retrieved !== testValue) {
        return {
          available: false,
          error: new Error(`Capacitor Preferences read/write verification failed`),
        }
      }

      return { available: true }
    } catch (error) {
      return {
        available: false,
        error: error instanceof Error ? error : new Error(String(error)),
      }
    }
  }

  private getKey(key: string): string {
    return `${this.prefix}${key}`
  }

  async get(key: string): Promise<string | null> {
    try {
      const { value } = await Preferences.get({ key: this.getKey(key) })
      return value
    } catch (error) {
      console.warn(`Capacitor Preferences get failed:`, error)
      return null
    }
  }

  async set(key: string, value: string): Promise<void> {
    await Preferences.set({ key: this.getKey(key), value })
  }

  async delete(key: string): Promise<void> {
    try {
      await Preferences.remove({ key: this.getKey(key) })
    } catch (error) {
      console.warn(`Capacitor Preferences delete failed:`, error)
    }
  }

  async keys(): Promise<Array<string>> {
    try {
      const { keys } = await Preferences.keys()
      return keys
        .filter((key) => key.startsWith(this.prefix))
        .map((key) => key.slice(this.prefix.length))
    } catch (error) {
      console.warn(`Capacitor Preferences keys failed:`, error)
      return []
    }
  }

  async clear(): Promise<void> {
    try {
      const prefixedKeys = await this.keys()
      await Promise.all(
        prefixedKeys.map((key) => Preferences.remove({ key: this.getKey(key) }))
      )
    } catch (error) {
      console.warn(`Capacitor Preferences clear failed:`, error)
    }
  }
}
