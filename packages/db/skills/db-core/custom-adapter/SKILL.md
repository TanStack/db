---
name: db-core/custom-adapter
description: >
  Building custom collection adapters for new backends. SyncConfig interface:
  sync function receiving begin, write, commit, markReady, markError, truncate, metadata
  primitives and returning cleanup, loadSubset, and optional unloadSubset
  handlers.
  ChangeMessage format (insert, update, delete). On-demand LoadSubsetOptions
  (where, orderBy, limit, offset, cursor). Expression parsing:
  parseWhereExpression, parseOrderByExpression,
  extractSimpleComparisons, parseLoadSubsetOptions. Collection options creator
  pattern. rowUpdateMode (partial vs full). Subscription lifecycle and cleanup
  functions. Persisted sync metadata API (metadata.row and metadata.collection)
  for storing per-row and per-collection adapter state.
type: sub-skill
library: db
library_version: '0.6.17'
sources:
  - 'TanStack/db:docs/guides/collection-options-creator.md'
  - 'TanStack/db:packages/db/src/collection/sync.ts'
---

This skill builds on db-core and db-core/collection-setup. Read those first.

# Custom Adapter Authoring

## Setup

```ts
import { createCollection } from '@tanstack/db'
import type { CollectionConfig } from '@tanstack/db'

interface MyItem {
  id: string
  name: string
}

interface BackendEvent<T> {
  type: 'insert' | 'update' | 'delete'
  id: string
  data: T
}

function myBackendCollectionOptions<T extends object>(config: {
  endpoint: string
  getKey: (item: T) => string
}): CollectionConfig<T, string> {
  return {
    getKey: config.getKey,
    sync: {
      sync: ({ begin, write, commit, markReady, markError, collection }) => {
        let isInitialSyncComplete = false
        const bufferedEvents: Array<BackendEvent<T>> = []
        const initialSyncAbort = new AbortController()

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
        void fetch(config.endpoint, { signal: initialSyncAbort.signal })
          .then(async (res) => {
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

            // 4. Signal that a usable snapshot exists
            markReady()
          })
          .catch((error) => {
            if (initialSyncAbort.signal.aborted) return
            console.error('Initial sync failed:', error)
            // Only initial startup owns collection readiness. A later refetch
            // failure must keep the last ready snapshot usable.
            if (collection.status === 'loading') markError(error)
          })

        // 5. Return cleanup function
        return () => {
          initialSyncAbort.abort()
          unsubscribe()
        }
      },
      rowUpdateMode: 'partial',
    },
    onInsert: async ({ transaction }) => {
      const response = await fetch(config.endpoint, {
        method: 'POST',
        body: JSON.stringify(transaction.mutations[0].modified),
      })
      await waitForServerObservation(response)
    },
    onUpdate: async ({ transaction }) => {
      const mut = transaction.mutations[0]
      const response = await fetch(`${config.endpoint}/${mut.key}`, {
        method: 'PATCH',
        body: JSON.stringify(mut.changes),
      })
      await waitForServerObservation(response)
    },
    onDelete: async ({ transaction }) => {
      const response = await fetch(
        `${config.endpoint}/${transaction.mutations[0].key}`,
        {
          method: 'DELETE',
        },
      )
      await waitForServerObservation(response)
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
import { parseLoadSubsetOptions } from '@tanstack/db'

syncMode: 'on-demand',
sync: {
  sync: ({ begin, write, commit, markReady, collection }) => {
    const stopSync = subscribeToBackendChanges()
    markReady()

    return {
      cleanup: stopSync,
      loadSubset: async (options) => {
        const { filters, sorts, limit } = parseLoadSubsetOptions(options)
        const items = await api.items.list({
          filters,
          sorts,
          limit,
          offset: options.offset,
          // Translate cursor.whereFrom/whereCurrent expressions for your API.
          cursor: translateCursorExpressions(options.cursor),
        })

        begin()
        for (const item of items) {
          const key = collection.config.getKey(item)
          write(
            collection.has(key)
              ? { type: 'update', key, value: item }
              : { type: 'insert', value: item },
          )
        }
        commit()
      },
    }
  },
  rowUpdateMode: 'full',
}
```

`sync()` returns the handlers in a `SyncConfigRes` object. `loadSubset()` must
write fetched rows through `begin()` → `write()` → `commit()` and resolve
`void` (or return `true` for an immediate synchronous result); it does not
return the fetched rows. `parseLoadSubsetOptions()` returns only `filters`,
`sorts`, and `limit`. Read `offset` and `cursor` from the original options.
`cursor` contains query expressions (`whereFrom` and `whereCurrent`), not an
opaque backend cursor; translate or combine those expressions for your API.
Return `unloadSubset` only when `loadSubset` creates an ongoing resource, such
as a per-subset server subscription, that must be released.
Ownership transfers to core only when `loadSubset` returns `true` or a promise.
If it throws synchronously after partial setup, release that partial resource
before throwing; core will not call `unloadSubset` for a request that never
returned. A must-refetch can call `loadSubset` again with the same options. Each
successful return is a fresh acquisition: core releases the previous
acquisition when its replacement returns, then releases the current one when
the demand ends.

### Managing optimistic state duration

Mutation handlers must not resolve until server changes have synced back to the collection. Five strategies:

1. **Refetch** (simplest): `await collection.utils.refetch()`
2. **Transaction ID**: return `{ txid }` and track via sync stream
3. **ID-based tracking**: await specific record ID appearing in sync stream
4. **Version/timestamp**: wait until sync stream catches up to mutation time
5. **Provider method**: `await backend.waitForPendingWrites()`

### Persisted sync metadata

The `metadata` API on the sync config allows adapters to store per-row and per-collection metadata that persists across sync transactions. This is useful for tracking resume tokens, cursors, LSNs, or other adapter-specific state.

The `metadata` object is available on the sync config argument alongside
`begin`, `write`, and `commit`. Core supplies it at runtime, but its public type
is optional, so strict TypeScript code must guard it or assert its presence.
Without persistence the metadata is in-memory only and does not survive
reloads. With persistence, it is durable across sessions.

```ts
sync: ({ begin, write, commit, markReady, markError, metadata }) => {
  if (!metadata) throw new Error('Sync metadata API is unavailable')

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

Row metadata writes are tied to the current transaction. Deleting a row also
deletes its metadata. An insert sets metadata from `message.metadata`. A
metadata-less insert deletes stale metadata unless `metadata.row.set()` already
queued an explicit value for that key in the same transaction; that queued
value wins.

Collection metadata writes staged before `truncate()` are preserved and commit atomically with the truncate transaction.

**Typical usage — resume token:**

```ts
sync: ({ begin, write, commit, markReady, metadata }) => {
  if (!metadata) throw new Error('Sync metadata API is unavailable')

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
  stream.on('initial-error', (error) => markError(error))
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

### CRITICAL Defining loadSubset beside sync()

Wrong:

```ts
sync: {
  sync: ({ markReady }) => markReady(),
  loadSubset: async () => fetch('/items').then((response) => response.json()),
}
```

Correct: return `{ loadSubset, cleanup }` from `sync()` and apply loaded rows
with the sync transaction primitives, as shown above. Add `unloadSubset` when
each loaded subset owns a resource that must be released.

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

If initial sync fails before it produces a usable snapshot, call
`markError(error)` instead. This rejects readiness waits with the supplied cause
and moves dependent live queries to the error state. Calling `markError()`
without a cause remains supported and rejects with a generic collection-state
error. A later successful sync can call `markReady()` to recover.

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

### HIGH Inserting a different value for an existing synced key

An `insert` for an existing synced key is normalized to an update only when
the value is unchanged. A different value throws `DuplicateKeySyncError`,
including for plain custom configs with no `utils`.

Emit an `update`, or delete/truncate the old row before inserting the new one.

## Tension: Simplicity vs. Correctness in Sync

Getting-started simplicity (localOnly, eager mode) conflicts with production correctness (on-demand sync, race condition prevention, proper markReady handling). Agents optimizing for quick setup tend to skip buffering, markReady, and cleanup functions.

See also: db-core/collection-setup/SKILL.md — for built-in adapter patterns to model after.
