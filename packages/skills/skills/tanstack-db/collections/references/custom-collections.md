# Custom Collections

Build your own collection type for custom data sources.

## When to Build Custom

- Integrating with unsupported sync engine
- Custom caching requirements
- Specialized data source (WebSocket, IndexedDB, etc.)
- Unique persistence patterns

## Collection Interface

Implement the `Collection` interface from `@tanstack/db`:

```tsx
interface Collection<TData, TKey> {
  // Identity
  id: string

  // Read operations
  get(key: TKey): TData | undefined
  has(key: TKey): boolean
  toArray: TData[]
  size: number

  // Write operations
  insert(item: TData | TData[], options?: MutationOptions): Transaction
  update(key: TKey | TKey[], updater: (draft: TData) => void, options?: MutationOptions): Transaction
  delete(key: TKey | TKey[], options?: MutationOptions): Transaction

  // State
  state: CollectionState

  // Utilities
  utils: CollectionUtils
}
```

## Basic Structure

```tsx
import { createCollection, type CollectionOptions } from '@tanstack/db'

export function myCollectionOptions<TData, TKey>(
  options: MyCollectionConfig<TData, TKey>
): CollectionOptions<TData, TKey> {
  return {
    id: options.id,
    getKey: options.getKey,
    schema: options.schema,

    // Sync configuration
    sync: {
      // Called to start syncing data
      start: async (collection) => {
        // Set up data sync
        const cleanup = subscribeToDataSource((data) => {
          collection.utils.directWrite('insert', data)
        })

        // Return cleanup function
        return cleanup
      },

      // Called to stop syncing
      stop: async (cleanup) => {
        cleanup?.()
      },
    },

    // Mutation handlers
    onInsert: options.onInsert,
    onUpdate: options.onUpdate,
    onDelete: options.onDelete,
  }
}
```

## Example: WebSocket Collection

```tsx
export function websocketCollectionOptions<TData, TKey>(config: {
  id: string
  url: string
  getKey: (item: TData) => TKey
  schema?: StandardSchema
  onInsert?: MutationFn
  onUpdate?: MutationFn
  onDelete?: MutationFn
}): CollectionOptions<TData, TKey> {
  return {
    id: config.id,
    getKey: config.getKey,
    schema: config.schema,

    sync: {
      start: async (collection) => {
        const ws = new WebSocket(config.url)

        ws.onmessage = (event) => {
          const message = JSON.parse(event.data)

          switch (message.type) {
            case 'initial':
              message.data.forEach((item: TData) => {
                collection.utils.directWrite('insert', item)
              })
              break
            case 'insert':
              collection.utils.directWrite('insert', message.data)
              break
            case 'update':
              collection.utils.directWrite('update', message.data)
              break
            case 'delete':
              collection.utils.directWrite('delete', message.key)
              break
          }
        }

        return () => ws.close()
      },
    },

    onInsert: config.onInsert ?? (async ({ transaction }) => {
      // Default: send via WebSocket
      ws.send(JSON.stringify({
        type: 'insert',
        data: transaction.mutations.map((m) => m.modified),
      }))
    }),

    onUpdate: config.onUpdate,
    onDelete: config.onDelete,
  }
}
```

## Example: IndexedDB Collection

```tsx
import { openDB, type IDBPDatabase } from 'idb'

export function indexedDBCollectionOptions<TData, TKey>(config: {
  id: string
  dbName: string
  storeName: string
  getKey: (item: TData) => TKey
  schema?: StandardSchema
}): CollectionOptions<TData, TKey> {
  let db: IDBPDatabase

  return {
    id: config.id,
    getKey: config.getKey,
    schema: config.schema,

    sync: {
      start: async (collection) => {
        db = await openDB(config.dbName, 1, {
          upgrade(db) {
            db.createObjectStore(config.storeName, {
              keyPath: 'id',
            })
          },
        })

        // Load initial data
        const items = await db.getAll(config.storeName)
        items.forEach((item) => {
          collection.utils.directWrite('insert', item)
        })
      },

      stop: async () => {
        db?.close()
      },
    },

    onInsert: async ({ transaction }) => {
      const tx = db.transaction(config.storeName, 'readwrite')
      await Promise.all(
        transaction.mutations.map((m) =>
          tx.store.add(m.modified)
        )
      )
      await tx.done
    },

    onUpdate: async ({ transaction }) => {
      const tx = db.transaction(config.storeName, 'readwrite')
      await Promise.all(
        transaction.mutations.map((m) =>
          tx.store.put(m.modified)
        )
      )
      await tx.done
    },

    onDelete: async ({ transaction }) => {
      const tx = db.transaction(config.storeName, 'readwrite')
      await Promise.all(
        transaction.mutations.map((m) =>
          tx.store.delete(m.key as IDBValidKey)
        )
      )
      await tx.done
    },
  }
}
```

## Direct Write API

Use `directWrite` to update collection from external sources:

```tsx
// Insert item(s)
collection.utils.directWrite('insert', item)
collection.utils.directWrite('insert', [item1, item2])

// Update item(s)
collection.utils.directWrite('update', updatedItem)

// Delete by key
collection.utils.directWrite('delete', key)
collection.utils.directWrite('delete', [key1, key2])
```

## Collection State

Track collection status:

```tsx
interface CollectionState {
  isLoading: boolean
  isError: boolean
  error?: Error
  isSyncing: boolean
}

// Access in components
const state = myCollection.state
if (state.isLoading) return <Loading />
if (state.isError) return <Error error={state.error} />
```

## Testing Custom Collections

```tsx
import { createCollection } from '@tanstack/db'

describe('MyCustomCollection', () => {
  it('loads initial data', async () => {
    const collection = createCollection(
      myCollectionOptions({
        id: 'test',
        getKey: (item) => item.id,
        // ... test config
      })
    )

    // Wait for sync
    await waitFor(() => collection.size > 0)

    expect(collection.toArray).toHaveLength(expectedCount)
  })
})
```

## Reference Implementations

Study existing implementations:
- `@tanstack/query-db-collection` - REST API integration
- `@tanstack/electric-db-collection` - Real-time sync
- Built-in `localOnlyCollectionOptions` - Simple in-memory
- Built-in `localStorageCollectionOptions` - Browser persistence
