import type { StorageAdapter } from "../types"

export abstract class BaseStorageAdapter implements StorageAdapter {
  abstract get(key: string): Promise<string | null>
  abstract set(key: string, value: string): Promise<void>
  abstract delete(key: string): Promise<void>
  abstract keys(): Promise<Array<string>>
  abstract clear(): Promise<void>
}

export { type StorageAdapter }
