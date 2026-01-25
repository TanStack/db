/**
 * IndexedDB Database Wrapper
 *
 * This module provides promise-based utilities for working with IndexedDB.
 * All functions return promises and wrap IndexedDB errors with descriptive messages.
 */

/**
 * Gets the IndexedDB factory, with cross-environment support.
 * @param idbFactory - Optional custom IDBFactory for testing
 * @returns The IDBFactory to use
 * @throws Error if IndexedDB is not available
 */
function getIDBFactory(idbFactory?: IDBFactory): IDBFactory {
  if (idbFactory) {
    return idbFactory
  }

  // Try window.indexedDB first (browser environment)
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- runtime check needed
  if (typeof window !== 'undefined' && window.indexedDB) {
    return window.indexedDB
  }

  // Try globalThis.indexedDB (modern environments, including Node.js with polyfill)
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- runtime check needed
  if (typeof globalThis !== 'undefined' && globalThis.indexedDB) {
    return globalThis.indexedDB
  }

  throw new Error(
    'IndexedDB is not available in this environment. ' +
      'Ensure you are running in a browser or provide a custom IDBFactory for testing.',
  )
}

/**
 * Opens an IndexedDB database with the specified name and version.
 *
 * @param name - The name of the database to open
 * @param version - The version number of the database schema
 * @param onUpgrade - Optional callback that runs during the onupgradeneeded event.
 *                    Use this to create object stores and indexes.
 * @param idbFactory - Optional IDBFactory for testing/mocking (defaults to window.indexedDB or globalThis.indexedDB)
 * @returns A promise that resolves to the IDBDatabase instance
 *
 * @example
 * ```typescript
 * const db = await openDatabase('myApp', 1, (db, oldVersion, newVersion, transaction) => {
 *   if (oldVersion < 1) {
 *     db.createObjectStore('todos', { keyPath: 'id' })
 *   }
 * })
 * ```
 */
export function openDatabase(
  name: string,
  version: number,
  onUpgrade?: (
    db: IDBDatabase,
    oldVersion: number,
    newVersion: number,
    transaction: IDBTransaction,
  ) => void,
  idbFactory?: IDBFactory,
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let factory: IDBFactory
    try {
      factory = getIDBFactory(idbFactory)
    } catch (error) {
      reject(error)
      return
    }

    let request: IDBOpenDBRequest
    try {
      request = factory.open(name, version)
    } catch (error) {
      reject(
        new Error(
          `Failed to open IndexedDB database "${name}": ${error instanceof Error ? error.message : String(error)}`,
        ),
      )
      return
    }

    request.onupgradeneeded = (event) => {
      const db = request.result
      const transaction = request.transaction
      if (onUpgrade && transaction) {
        try {
          onUpgrade(
            db,
            event.oldVersion,
            event.newVersion ?? version,
            transaction,
          )
        } catch (error) {
          // If the upgrade callback throws, abort the transaction
          transaction.abort()
          reject(
            new Error(
              `Database upgrade failed for "${name}": ${error instanceof Error ? error.message : String(error)}`,
            ),
          )
        }
      }
    }

    request.onsuccess = () => {
      resolve(request.result)
    }

    request.onerror = () => {
      const errorMessage = request.error?.message || 'Unknown error'
      reject(
        new Error(`Failed to open IndexedDB database "${name}": ${errorMessage}`),
      )
    }

    request.onblocked = () => {
      reject(
        new Error(
          `Opening IndexedDB database "${name}" was blocked. ` +
            'Close other tabs/connections to this database and try again.',
        ),
      )
    }
  })
}

/**
 * Creates an object store during a database upgrade.
 *
 * This function must be called within an onupgradeneeded callback
 * (i.e., within a versionchange transaction). Calling it outside of
 * an upgrade context will throw an error.
 *
 * @param db - The IDBDatabase instance
 * @param storeName - The name of the object store to create
 * @param options - Optional configuration for the object store (keyPath, autoIncrement)
 * @returns The created IDBObjectStore
 * @throws Error if not called during a version change transaction
 *
 * @example
 * ```typescript
 * const db = await openDatabase('myApp', 1, (db) => {
 *   createObjectStore(db, 'todos', { keyPath: 'id' })
 *   createObjectStore(db, 'users', { keyPath: 'id', autoIncrement: true })
 * })
 * ```
 */
export function createObjectStore(
  db: IDBDatabase,
  storeName: string,
  options?: IDBObjectStoreParameters,
): IDBObjectStore {
  try {
    return db.createObjectStore(storeName, options)
  } catch (error) {
    // Check if this is being called outside of a version change transaction
    if (
      error instanceof DOMException &&
      error.name === 'InvalidStateError'
    ) {
      throw new Error(
        `Cannot create object store "${storeName}": This operation is only allowed during a database upgrade. ` +
          'Ensure you are calling createObjectStore within the onUpgrade callback of openDatabase.',
      )
    }

    // Check if the object store already exists
    if (
      error instanceof DOMException &&
      error.name === 'ConstraintError'
    ) {
      throw new Error(
        `Object store "${storeName}" already exists in the database. ` +
          'Check the database version and only create stores when needed.',
      )
    }

    throw new Error(
      `Failed to create object store "${storeName}": ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

/**
 * Executes a callback within an IndexedDB transaction.
 *
 * This function handles transaction lifecycle automatically:
 * - Creates the transaction with the specified mode
 * - Provides the transaction and object stores to the callback
 * - Waits for the transaction to complete (or abort)
 * - Returns the callback's result or rejects with an error
 *
 * @template T - The return type of the callback
 * @param db - The IDBDatabase instance
 * @param storeNames - A single store name or array of store names to include in the transaction
 * @param mode - The transaction mode ('readonly', 'readwrite', or 'readwriteflush')
 * @param callback - A function that performs operations within the transaction.
 *                   Receives the transaction and a record of object stores keyed by name.
 *                   Can be sync or async.
 * @returns A promise that resolves to the callback's return value when the transaction completes
 *
 * @example
 * ```typescript
 * // Single store
 * const result = await executeTransaction(db, 'todos', 'readwrite', (tx, stores) => {
 *   stores.todos.put({ id: 1, text: 'Buy milk' })
 *   return 'done'
 * })
 *
 * // Multiple stores
 * await executeTransaction(db, ['todos', 'users'], 'readwrite', (tx, stores) => {
 *   stores.todos.put({ id: 1, text: 'Task' })
 *   stores.users.put({ id: 1, name: 'Alice' })
 * })
 * ```
 */
export function executeTransaction<T>(
  db: IDBDatabase,
  storeNames: string | Array<string>,
  mode: IDBTransactionMode,
  callback: (
    transaction: IDBTransaction,
    stores: Record<string, IDBObjectStore>,
  ) => T | Promise<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const storeNamesArray = Array.isArray(storeNames) ? storeNames : [storeNames]
    let transaction: IDBTransaction

    try {
      transaction = db.transaction(storeNamesArray, mode)
    } catch (error) {
      reject(
        new Error(
          `Failed to create transaction for stores [${storeNamesArray.join(', ')}]: ${error instanceof Error ? error.message : String(error)}`,
        ),
      )
      return
    }

    // Build the stores record
    const stores: Record<string, IDBObjectStore> = {}
    for (const storeName of storeNamesArray) {
      try {
        stores[storeName] = transaction.objectStore(storeName)
      } catch {
        reject(
          new Error(
            `Object store "${storeName}" not found in the database. ` +
              'Ensure the store was created during the database upgrade.',
          ),
        )
        return
      }
    }

    let callbackResult: T
    let callbackError: Error | undefined

    // Handle transaction completion
    transaction.oncomplete = () => {
      if (callbackError) {
        reject(callbackError)
      } else {
        resolve(callbackResult)
      }
    }

    transaction.onerror = () => {
      const errorMessage = transaction.error?.message || 'Unknown error'
      reject(new Error(`Transaction failed: ${errorMessage}`))
    }

    transaction.onabort = () => {
      const errorMessage = transaction.error?.message || 'Transaction was aborted'
      reject(new Error(`Transaction aborted: ${errorMessage}`))
    }

    // Execute the callback
    try {
      const result = callback(transaction, stores)

      // Handle async callbacks
      if (result instanceof Promise) {
        result
          .then((value) => {
            callbackResult = value
          })
          .catch((error) => {
            callbackError = error instanceof Error ? error : new Error(String(error))
            // Abort the transaction on callback error
            try {
              transaction.abort()
            } catch {
              // Transaction may already be finished
            }
          })
      } else {
        callbackResult = result
      }
    } catch (error) {
      callbackError = error instanceof Error ? error : new Error(String(error))
      // Abort the transaction on callback error
      try {
        transaction.abort()
      } catch {
        // Transaction may already be finished
      }
    }
  })
}

/**
 * Retrieves all items from an object store.
 *
 * Uses the native `getAll()` method for efficient bulk retrieval.
 *
 * @template T - The type of items in the object store
 * @param objectStore - The IDBObjectStore to read from
 * @returns A promise that resolves to an array of all items in the store
 *
 * @example
 * ```typescript
 * await executeTransaction(db, 'todos', 'readonly', async (tx, stores) => {
 *   const allTodos = await getAll<Todo>(stores.todos)
 *   console.log('All todos:', allTodos)
 * })
 * ```
 */
export function getAll<T>(objectStore: IDBObjectStore): Promise<Array<T>> {
  return new Promise((resolve, reject) => {
    let request: IDBRequest<Array<T>>
    try {
      request = objectStore.getAll()
    } catch (error) {
      reject(
        new Error(
          `Failed to get all items from object store "${objectStore.name}": ${error instanceof Error ? error.message : String(error)}`,
        ),
      )
      return
    }

    request.onsuccess = () => {
      resolve(request.result)
    }

    request.onerror = () => {
      const errorMessage = request.error?.message || 'Unknown error'
      reject(
        new Error(
          `Failed to get all items from object store "${objectStore.name}": ${errorMessage}`,
        ),
      )
    }
  })
}

/**
 * Retrieves all keys from an object store.
 *
 * Uses the native `getAllKeys()` method for efficient bulk key retrieval.
 *
 * @param objectStore - The IDBObjectStore to read keys from
 * @returns A promise that resolves to an array of all keys in the store
 *
 * @example
 * ```typescript
 * await executeTransaction(db, 'todos', 'readonly', async (tx, stores) => {
 *   const allKeys = await getAllKeys(stores.todos)
 *   console.log('All keys:', allKeys)
 * })
 * ```
 */
export function getAllKeys(objectStore: IDBObjectStore): Promise<Array<IDBValidKey>> {
  return new Promise((resolve, reject) => {
    let request: IDBRequest<Array<IDBValidKey>>
    try {
      request = objectStore.getAllKeys()
    } catch (error) {
      reject(
        new Error(
          `Failed to get all keys from object store "${objectStore.name}": ${error instanceof Error ? error.message : String(error)}`,
        ),
      )
      return
    }

    request.onsuccess = () => {
      resolve(request.result)
    }

    request.onerror = () => {
      const errorMessage = request.error?.message || 'Unknown error'
      reject(
        new Error(
          `Failed to get all keys from object store "${objectStore.name}": ${errorMessage}`,
        ),
      )
    }
  })
}

/**
 * Retrieves a single item by its key from an object store.
 *
 * @template T - The type of the item
 * @param objectStore - The IDBObjectStore to read from
 * @param key - The key of the item to retrieve
 * @returns A promise that resolves to the item, or undefined if not found
 *
 * @example
 * ```typescript
 * await executeTransaction(db, 'todos', 'readonly', async (tx, stores) => {
 *   const todo = await getByKey<Todo>(stores.todos, 1)
 *   if (todo) {
 *     console.log('Found todo:', todo)
 *   }
 * })
 * ```
 */
export function getByKey<T>(
  objectStore: IDBObjectStore,
  key: IDBValidKey,
): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    let request: IDBRequest<T | undefined>
    try {
      request = objectStore.get(key)
    } catch (error) {
      reject(
        new Error(
          `Failed to get item with key "${String(key)}" from object store "${objectStore.name}": ${error instanceof Error ? error.message : String(error)}`,
        ),
      )
      return
    }

    request.onsuccess = () => {
      resolve(request.result)
    }

    request.onerror = () => {
      const errorMessage = request.error?.message || 'Unknown error'
      reject(
        new Error(
          `Failed to get item with key "${String(key)}" from object store "${objectStore.name}": ${errorMessage}`,
        ),
      )
    }
  })
}

/**
 * Writes an item to an object store using upsert semantics.
 *
 * If an item with the same key exists, it will be replaced.
 * If no item with the key exists, a new one will be created.
 *
 * @template T - The type of the item
 * @param objectStore - The IDBObjectStore to write to
 * @param value - The item to write
 * @param key - Optional key for the item. Required if the object store doesn't have a keyPath.
 * @returns A promise that resolves to the key of the written item
 *
 * @example
 * ```typescript
 * // With keyPath (key extracted from value)
 * await executeTransaction(db, 'todos', 'readwrite', async (tx, stores) => {
 *   const key = await put(stores.todos, { id: 1, text: 'Buy milk' })
 *   console.log('Wrote item with key:', key)
 * })
 *
 * // Without keyPath (explicit key)
 * await executeTransaction(db, 'items', 'readwrite', async (tx, stores) => {
 *   const key = await put(stores.items, { text: 'Some data' }, 'myKey')
 *   console.log('Wrote item with key:', key)
 * })
 * ```
 */
export function put<T>(
  objectStore: IDBObjectStore,
  value: T,
  key?: IDBValidKey,
): Promise<IDBValidKey> {
  return new Promise((resolve, reject) => {
    let request: IDBRequest<IDBValidKey>
    try {
      // Use the key parameter if provided, otherwise rely on keyPath
      request = key !== undefined ? objectStore.put(value, key) : objectStore.put(value)
    } catch (error) {
      reject(
        new Error(
          `Failed to write item to object store "${objectStore.name}": ${error instanceof Error ? error.message : String(error)}`,
        ),
      )
      return
    }

    request.onsuccess = () => {
      resolve(request.result)
    }

    request.onerror = () => {
      const errorMessage = request.error?.message || 'Unknown error'
      reject(
        new Error(
          `Failed to write item to object store "${objectStore.name}": ${errorMessage}`,
        ),
      )
    }
  })
}

/**
 * Deletes an item by its key from an object store.
 *
 * @param objectStore - The IDBObjectStore to delete from
 * @param key - The key of the item to delete
 * @returns A promise that resolves when the item is deleted
 *
 * @example
 * ```typescript
 * await executeTransaction(db, 'todos', 'readwrite', async (tx, stores) => {
 *   await deleteByKey(stores.todos, 1)
 *   console.log('Todo deleted')
 * })
 * ```
 */
export function deleteByKey(
  objectStore: IDBObjectStore,
  key: IDBValidKey,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let request: IDBRequest<undefined>
    try {
      request = objectStore.delete(key)
    } catch (error) {
      reject(
        new Error(
          `Failed to delete item with key "${String(key)}" from object store "${objectStore.name}": ${error instanceof Error ? error.message : String(error)}`,
        ),
      )
      return
    }

    request.onsuccess = () => {
      resolve()
    }

    request.onerror = () => {
      const errorMessage = request.error?.message || 'Unknown error'
      reject(
        new Error(
          `Failed to delete item with key "${String(key)}" from object store "${objectStore.name}": ${errorMessage}`,
        ),
      )
    }
  })
}

/**
 * Removes all items from an object store.
 *
 * @param objectStore - The IDBObjectStore to clear
 * @returns A promise that resolves when all items are removed
 *
 * @example
 * ```typescript
 * await executeTransaction(db, 'todos', 'readwrite', async (tx, stores) => {
 *   await clear(stores.todos)
 *   console.log('All todos cleared')
 * })
 * ```
 */
export function clear(objectStore: IDBObjectStore): Promise<void> {
  return new Promise((resolve, reject) => {
    let request: IDBRequest<undefined>
    try {
      request = objectStore.clear()
    } catch (error) {
      reject(
        new Error(
          `Failed to clear object store "${objectStore.name}": ${error instanceof Error ? error.message : String(error)}`,
        ),
      )
      return
    }

    request.onsuccess = () => {
      resolve()
    }

    request.onerror = () => {
      const errorMessage = request.error?.message || 'Unknown error'
      reject(
        new Error(
          `Failed to clear object store "${objectStore.name}": ${errorMessage}`,
        ),
      )
    }
  })
}

/**
 * Deletes an entire IndexedDB database.
 *
 * Use with caution - this removes the database and all of its object stores and data.
 *
 * @param name - The name of the database to delete
 * @param idbFactory - Optional IDBFactory for testing/mocking
 * @returns A promise that resolves when the database is deleted
 *
 * @example
 * ```typescript
 * await deleteDatabase('myApp')
 * console.log('Database deleted')
 * ```
 */
export function deleteDatabase(
  name: string,
  idbFactory?: IDBFactory,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let factory: IDBFactory
    try {
      factory = getIDBFactory(idbFactory)
    } catch (error) {
      reject(error)
      return
    }

    let request: IDBOpenDBRequest
    try {
      request = factory.deleteDatabase(name)
    } catch (error) {
      reject(
        new Error(
          `Failed to delete IndexedDB database "${name}": ${error instanceof Error ? error.message : String(error)}`,
        ),
      )
      return
    }

    request.onsuccess = () => {
      resolve()
    }

    request.onerror = () => {
      const errorMessage = request.error?.message || 'Unknown error'
      reject(
        new Error(`Failed to delete IndexedDB database "${name}": ${errorMessage}`),
      )
    }

    request.onblocked = () => {
      reject(
        new Error(
          `Deleting IndexedDB database "${name}" was blocked. ` +
            'Close all connections to this database and try again.',
        ),
      )
    }
  })
}
