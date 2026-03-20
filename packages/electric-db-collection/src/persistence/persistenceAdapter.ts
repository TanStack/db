import type { Row } from "@electric-sql/client"

/**
 * Storage API interface - subset of DOM Storage that we need
 * Matches the pattern used in @tanstack/db local-storage implementation
 */
export type StorageApi = Pick<Storage, `getItem` | `setItem` | `removeItem`>

/**
 * Internal storage format that includes version tracking
 * Matches the pattern used in localStorage implementation
 */
export interface StoredItem<T> {
  versionKey: string
  data: T
}

/**
 * Generate a UUID for version tracking
 * @returns A unique identifier string for tracking data versions
 */
export function generateVersionKey(): string {
  return crypto.randomUUID()
}

/**
 * Load data from storage and return as a Map
 * @param storageKey - The key used to store data in the storage API
 * @param storage - The storage API to load from (localStorage, sessionStorage, etc.)
 * @returns Map of stored items with version tracking, or empty Map if loading fails
 */
export function loadFromStorage<T extends Row<unknown>>(
  storageKey: string,
  storage: StorageApi
): Map<string | number, StoredItem<T>> {
  try {
    const rawData = storage.getItem(storageKey)
    if (!rawData) {
      return new Map()
    }

    const parsed = JSON.parse(rawData)
    const dataMap = new Map<string | number, StoredItem<T>>()

    // Handle object format where keys map to StoredItem values
    if (
      typeof parsed === `object` &&
      parsed !== null &&
      !Array.isArray(parsed)
    ) {
      Object.entries(parsed).forEach(([key, value]) => {
        // Runtime check to ensure the value has the expected StoredItem structure
        if (
          value &&
          typeof value === `object` &&
          `versionKey` in value &&
          `data` in value
        ) {
          const storedItem = value as StoredItem<T>
          dataMap.set(key, storedItem)
        } else {
          console.warn(
            `[ElectricPersistence] Invalid data format for key "${key}" in storage key "${storageKey}"`
          )
        }
      })
    } else {
      console.warn(
        `[ElectricPersistence] Invalid storage object format for key "${storageKey}"`
      )
    }

    return dataMap
  } catch (error) {
    console.warn(
      `[ElectricPersistence] Error loading data from storage key "${storageKey}":`,
      error
    )
    return new Map()
  }
}

/**
 * Save data to storage
 * @param storageKey - The key to use for storing data
 * @param storage - The storage API to save to
 * @param dataMap - Map of items with version tracking to save to storage
 */
export function saveToStorage<T extends Row<unknown>>(
  storageKey: string,
  storage: StorageApi,
  dataMap: Map<string | number, StoredItem<T>>
): void {
  try {
    // Convert Map to object format for storage
    const objectData: Record<string, StoredItem<T>> = {}
    dataMap.forEach((storedItem, key) => {
      objectData[String(key)] = storedItem
    })
    const serialized = JSON.stringify(objectData)
    storage.setItem(storageKey, serialized)
  } catch (error) {
    console.error(
      `[ElectricPersistence] Error saving data to storage key "${storageKey}":`,
      error
    )
    throw error
  }
}

/**
 * Validates that a value can be JSON serialized
 * @param value - The value to validate for JSON serialization
 * @param operation - The operation type being performed (for error messages)
 * @throws Error if the value cannot be JSON serialized
 */
export function validateJsonSerializable(value: any, operation: string): void {
  try {
    JSON.stringify(value)
  } catch (error) {
    throw new Error(
      `Cannot serialize value for ${operation}: ${
        error instanceof Error ? error.message : String(error)
      }`
    )
  }
}
