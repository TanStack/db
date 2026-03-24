---
title: RxDB Collection
---

# RxDB Collection

RxDB collections provide seamless integration between TanStack DB and [RxDB](https://rxdb.info), enabling automatic synchronization between your in-memory TanStack DB collections and RxDB's local-first database. Giving you offline-ready persistence, and powerful sync capabilities with a wide range of backends.


## Overview

The `@tanstack/rxdb-db-collection` package allows you to create collections that:
- Automatically mirror the state of an underlying RxDB collection
- Reactively update when RxDB documents change
- Support optimistic mutations with rollback on error
- Provide persistence handlers to keep RxDB in sync with TanStack DB transactions
- Sync across browser tabs - changes in one tab are reflected in RxDB and TanStack DB collections in all tabs
- Use one of RxDB's [storage engines](https://rxdb.info/rx-storage.html).
- Work with RxDB's [replication features](https://rxdb.info/replication.html) for offline-first and sync scenarios
- Leverage RxDB's [replication plugins](https://rxdb.info/replication.html) to sync with CouchDB, MongoDB, Supabase, REST APIs, GraphQL, WebRTC (P2P) and more.


### 1. Installation

Install the RxDB collection packages along with your preferred framework integration.

```bash
npm install @tanstack/rxdb-db-collection rxdb @tanstack/react-db
```


### 2. Create an RxDatabase and RxCollection

```ts
import { createRxDatabase, addRxPlugin } from 'rxdb/plugins/core'

/**
 * Here we use the localStorage based storage for RxDB.
 * RxDB has a wide range of storages based on Dexie.js, IndexedDB, SQLite, and more.
 */
import { getRxStorageLocalstorage } from 'rxdb/plugins/storage-localstorage'

// add json-schema validation (optional)
import { wrappedValidateAjvStorage } from 'rxdb/plugins/validate-ajv';

// Enable dev mode (optional, recommended during development)
import { RxDBDevModePlugin } from 'rxdb/plugins/dev-mode'
addRxPlugin(RxDBDevModePlugin)

type Todo = { id: string; text: string; completed: boolean }

const db = await createRxDatabase({
  name: 'my-todos',
  storage: wrappedValidateAjvStorage({
    storage: getRxStorageLocalstorage()
  })
})

await db.addCollections({
  todos: {
    schema: {
      title: 'todos',
      version: 0,
      type: 'object',
      primaryKey: 'id',
      properties: {
        id: { type: 'string', maxLength: 100 },
        text: { type: 'string' },
        completed: { type: 'boolean' },
      },
      required: ['id', 'text', 'completed'],
    },
  },
})
```


### 3. (optional) sync with a backend
```ts
import { replicateRxCollection } from 'rxdb/plugins/replication'
const replicationState = replicateRxCollection({
  collection: db.todos,
  pull: { handler: myPullHandler },
  push: { handler: myPushHandler },
})
```

### 4. Wrap the RxDB collection with TanStack DB

```ts
import { createCollection } from '@tanstack/react-db'
import { rxdbCollectionOptions } from '@tanstack/rxdb-db-collection'

const todosCollection = createCollection(
  rxdbCollectionOptions({
    rxCollection: db.todos,
    startSync: true, // start ingesting RxDB data immediately
  })
)
```


Now `todosCollection` is a reactive TanStack DB collection driven by RxDB:

- Writes via `todosCollection.insert/update/delete` persist to RxDB.
- Direct writes in RxDB (or via replication) flow into the TanStack collection via change streams.



## Configuration Options

The `rxdbCollectionOptions` function accepts the following options:

### Required

- `rxCollection`: The underlying [RxDB collection](https://rxdb.info/rx-collection.html)

### Optional

- `id`: Unique identifier for the collection
- `schema`: Schema for validating items. RxDB already has schema validation but having additional validation on the TanStack DB side can help to unify error handling between different TanStack collections.
- `startSync`: Whether to start syncing immediately (default: true)
- `onInsert, onUpdate, onDelete`: Override default persistence handlers. By default, TanStack DB writes are persisted to RxDB using bulkUpsert, patch, and bulkRemove.
- `syncBatchSize`: The maximum number of documents fetched per batch during the initial sync from RxDB into TanStack DB (default: 1000). Larger values reduce round trips but use more memory; smaller values are lighter but may increase query calls. Note that this only affects the initial sync. Ongoing live updates are streamed one by one via RxDB's change feed.



## Syncing with Backends

Replication and sync in RxDB run independently of TanStack DB. You set up replication directly on your RxCollection using RxDB's replication plugins (for CouchDB, GraphQL, WebRTC, REST APIs, etc.).

When replication runs, it pulls and pushes changes to the backend and applies them to the RxDB collection. Since the TanStack DB integration subscribes to the RxDB change stream, any changes applied by replication are automatically reflected in your TanStack DB collection.

This separation of concerns means you configure replication entirely in RxDB, and TanStack DB automatically benefits: your TanStack collections always stay up to date with whatever sync strategy you choose.


## FAQ

### Do I still need RxDB schema indexes if I only query TanStack DB?

Usually not, at least for TanStack DB queries themselves. TanStack DB queries run entirely in memory, so RxDB schema indexes do not affect the performance of TanStack DB's live queries. However, RxDB indexes may still be important if:
- You run queries directly against RxDB (e.g. `rxCollection.find(...)`).
- Your replication setup uses filtered queries or selectors.
- You rely on RxDB to selectively load subsets of data instead of hydrating everything into memory.

### Is data duplicated between RxDB and TanStack DB?

Yes, intentionally. RxDB stores data durably on disk. TanStack DB stores data in memory for fast queries and reactivity. This duplication enables high-performance UI queries while retaining [local-first](https://rxdb.info/articles/local-first-future.html) persistence and sync.

### How does backend ↔ RxDB ↔ TanStack DB synchronization work?

Synchronization follows a clear separation of responsibilities between RxDB and TanStack DB.

**RxDB** is responsible for persistence and networking. It stores data durably using a local storage engine (IndexedDB, SQLite, etc.) and handles all replication logic. Replication is configured directly on the RxDB collection and runs independently of TanStack DB. RxDB pulls changes from the backend, applies them locally, resolves conflicts, and pushes local changes back to the backend.

**TanStack DB** sits on top as an in-memory, reactive query layer. It does not talk to the backend directly and does not participate in replication. Instead, it mirrors the current state of the RxDB collection in memory and provides fast live queries and optimistic mutations for the UI.

This design intentionally forms two independent loops:
- A durability and sync loop managed entirely by RxDB (backend to RxDB).
- A reactive UI loop managed by TanStack DB (RxDB change stream to in-memory collections to live queries).

## Learn More

- [RxDB Documentation](https://rxdb.info/overview.html)
- [RxDB Sync Engine](https://rxdb.info/replication.html)
- [Tanstack DB Live Queries](https://tanstack.com/db/latest/docs/guides/live-queries)

