---
name: db-core/custom-adapter
description: >
  Building custom collection adapters for new backends. SyncConfig interface:
  sync function receiving begin, write, commit, markReady, truncate, metadata
  primitives. ChangeMessage format (insert, update, delete). loadSubset for
  on-demand sync. LoadSubsetOptions (where, orderBy, limit, cursor). Expression
  parsing: parseWhereExpression, parseOrderByExpression,
  extractSimpleComparisons, parseLoadSubsetOptions. Collection options creator
  pattern. rowUpdateMode (partial vs full). Subscription lifecycle and cleanup
  functions. Persisted sync metadata API (metadata.row and metadata.collection)
  for storing per-row and per-collection adapter state.
type: sub-skill
library: db
library_version: '0.6.0'
sources:
  - 'TanStack/db:docs/guides/collection-options-creator.md'
  - 'TanStack/db:packages/db/src/collection/sync.ts'
---

This skill builds on db-core and db-core/collection-setup. Read those first.

# Custom Adapter Authoring

## Setup

```ts
import { createCollection } from '@tanstack/db'
import type { SyncConfig, CollectionConfig } from '@tanstack/db'

interface MyItem {
  id: string
  name: string
}

function myBackendCollectionOptions<T>(config: {
  endpoint: string
  getKey: (item: T) => string
}): CollectionConfig<T, string, {}> {
  return {
    getKey: config.getKey,
    sync: {
      sync: ({ begin, write, commit, markReady, metadata, collection }) => {
        let isInitialSyncComplete = false
        const bufferedEvents: Array<any> = []

        // 1. Subscribe to real-time events FIRST
        const unsubscribe = myWebSocket.subscribe(config.endpoint, (event) => {
          if (!isInitialSyncComplete) {
            bufferedEvents.push(event)
            return
          }
          begin()
          write({ type: event.type, key: event.id, value: event.data })
          commit()
        })

        // 2. Fetch initial data
        fetch(config.endpoint).then(async (res) => {
          const items = await res.json()
          begin()
          for (const item of items) {
            write({ type: 'insert', value: item })
          }
          commit()

          // 3. Process buffered events
          isInitialSyncComplete = true
          for (const event of bufferedEvents) {
            begin()
            write({ type: event.type, key: event.id, value: event.data })
            commit()
          }

          // 4. Signal readiness
          markReady()
        })

        // 5. Return cleanup function
        return () => {
          unsubscribe()
        }
      },
      rowUpdateMode: 'partial',
    },
    onInsert: async ({ transaction }) => {
      await fetch(config.endpoint, {
        method: 'POST',
        body: JSON.stringify(transaction.mutations[0].modified),
      })
    },
    onUpdate: async ({ transaction }) => {
      const mut = transaction.mutations[0]
      await fetch(`${config.endpoint}/${mut.key}`, {
        method: 'PATCH',
        body: JSON.stringify(mut.changes),
      })
    },
    onDelete: async ({ transaction }) => {
      await fetch(`${config.endpoint}/${transaction.mutations[0].key}`, {
        method: 'DELETE',
      })
    },
  }
}
```

## Core Patterns

### ChangeMessage format

```ts
// Insert
write({ type: 'insert', value: item })

// Update (partial — only changed fields)
write({ type: 'update', key: itemId, value: partialItem })

// Update (full row replacement)
write({ type: 'update', key: itemId, value: fullItem })
// Set rowUpdateMode: "full" in sync config

// Delete
write({ type: 'delete', key: itemId, value: item })
```

### On-demand sync with loadSubset

```ts
import { parseLoadSubsetOptions } from "@tanstack/db"

sync: {
  sync: ({ begin, write, commit, markReady }) => {
    // Initial sync...
    markReady()
    return () => {}
  },
  loadSubset: async (options) => {
    const { filters, sorts, limit, offset } = parseLoadSubsetOptions(options)
    // filters: [{ field: ['category'], operator: 'eq', value: 'electronics' }]
    // sorts:   [{ field: ['price'], direction: 'asc', nulls: 'last' }]
    const params = new URLSearchParams()
    for (const f of filters) {
      params.set(f.field.join("."), `${f.operator}:${f.value}`)
    }
    const res = await fetch(`/api/items?${params}`)
    return res.json()
  },
}
```

### Managing optimistic state duration

Mutation handlers must not resolve until server changes have synced back to the collection. Five strategies:

1. **Refetch** (simplest): `await collection.utils.refetch()`
2. **Transaction ID**: return `{ txid }` and track via sync stream
3. **ID-based tracking**: await specific record ID appearing in sync stream
4. **Version/timestamp**: wait until sync stream catches up to mutation time
5. **Provider method**: `await backend.waitForPendingWrites()`

### Persisted sync metadata

The `metadata` API on the sync config allows adapters to store per-row and per-collection metadata that persists across sync transactions. This is useful for tracking resume tokens, cursors, LSNs, or other adapter-specific state.

The `metadata` object is available as a property on the sync config argument alongside `begin`, `write`, `commit`, etc.

```ts
sync: ({ begin, write, commit, markReady, metadata }) => {
  // Row metadata: store per-row state (e.g. server version, ETag)
  metadata.row.get(key) // => unknown | undefined
  metadata.row.set(key, { version: 3, etag: 'abc' })
  metadata.row.delete(key)

  // Collection metadata: store per-collection state (e.g. resume cursor)
  metadata.collection.get('cursor') // => unknown | undefined
  metadata.collection.set('cursor', 'token_abc123')
  metadata.collection.delete('cursor')
  metadata.collection.list() // => [{ key: 'cursor', value: 'token_abc123' }]
  metadata.collection.list('resume') // filter by prefix
}
```

Row metadata writes are tied to the current transaction. When a row is deleted via `write({ type: 'delete', ... })`, its row metadata is automatically deleted. When a row is inserted, its metadata is set from `message.metadata` if provided, or deleted otherwise.

Collection metadata writes staged before `truncate()` are preserved and commit atomically with the truncate transaction.

**Typical usage — resume token:**

```ts
sync: ({ begin, write, commit, markReady, metadata }) => {
  const lastCursor = metadata.collection.get('cursor') as string | undefined

  const stream = subscribeFromCursor(lastCursor)
  stream.on('data', (batch) => {
    begin()
    for (const item of batch.items) {
      write({ type: item.type, key: item.id, value: item.data })
    }
    metadata.collection.set('cursor', batch.cursor)
    commit()
  })

  stream.on('ready', () => markReady())
  return () => stream.close()
}
```

### Expression parsing for predicate push-down

```ts
import {
  parseWhereExpression,
  parseOrderByExpression,
  extractSimpleComparisons,
} from '@tanstack/db'

// In loadSubset or queryFn:
const comparisons = extractSimpleComparisons(options.where)
// Returns: [{ field: ['name'], operator: 'eq', value: 'John' }]

const orderBy = parseOrderByExpression(options.orderBy)
// Returns: [{ field: ['created_at'], direction: 'desc', nulls: 'last' }]
```

## Common Mistakes

### CRITICAL Not calling markReady() in sync implementation

Wrong:

```ts
sync: ({ begin, write, commit }) => {
  fetchData().then((items) => {
    begin()
    items.forEach((item) => write({ type: 'insert', value: item }))
    commit()
    // forgot markReady()!
  })
}
```

Correct:

```ts
sync: ({ begin, write, commit, markReady }) => {
  fetchData().then((items) => {
    begin()
    items.forEach((item) => write({ type: 'insert', value: item }))
    commit()
    markReady()
  })
}
```

`markReady()` transitions the collection to "ready" status. Without it, live queries never resolve and `useLiveSuspenseQuery` hangs forever in Suspense.

Source: docs/guides/collection-options-creator.md

### HIGH Race condition: subscribing after initial fetch

Wrong:

```ts
sync: ({ begin, write, commit, markReady }) => {
  fetchAll().then((data) => {
    writeAll(data)
    subscribe(onChange) // changes during fetch are LOST
    markReady()
  })
}
```

Correct:

```ts
sync: ({ begin, write, commit, markReady }) => {
  const buffer = []
  subscribe((event) => {
    if (!ready) {
      buffer.push(event)
      return
    }
    begin()
    write(event)
    commit()
  })
  fetchAll().then((data) => {
    writeAll(data)
    ready = true
    buffer.forEach((e) => {
      begin()
      write(e)
      commit()
    })
    markReady()
  })
}
```

Subscribe to real-time events before fetching initial data. Buffer events during the fetch, then replay them after the initial sync completes.

Source: docs/guides/collection-options-creator.md

### HIGH write() called without begin()

Wrong:

```ts
onMessage((event) => {
  write({ type: event.type, key: event.id, value: event.data })
  commit()
})
```

Correct:

```ts
onMessage((event) => {
  begin()
  write({ type: event.type, key: event.id, value: event.data })
  commit()
})
```

Sync data must be written within a transaction (`begin` → `write` → `commit`). Calling `write()` without `begin()` throws `NoPendingSyncTransactionWriteError`.

Source: packages/db/src/collection/sync.ts:110

## Tension: Simplicity vs. Correctness in Sync

Getting-started simplicity (localOnly, eager mode) conflicts with production correctness (on-demand sync, race condition prevention, proper markReady handling). Agents optimizing for quick setup tend to skip buffering, markReady, and cleanup functions.

See also: db-core/collection-setup/SKILL.md -- for built-in adapter patterns to model after.
