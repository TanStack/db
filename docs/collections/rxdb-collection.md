---
title: RxDB Collection
---

# RxDB Collection

RxDB collections provide seamless integration between TanStack DB and [RxDB](https://rxdb.info), enabling automatic synchronization between your in-memory TanStack DB collections and RxDB's local-first, offline-ready database.

## Overview

The `@tanstack/rxdb-db-collection` package allows you to create collections that:
- Automatically mirror the state of an underlying RxDB collection
- Reactively update when RxDB documents change
- Support optimistic mutations with rollback on error
- Provide persistence handlers to keep RxDB in sync with TanStack DB transactions
- Work with RxDB's [replication features](https://rxdb.info/replication.html) for offline-first and sync scenarios
- Use on of RxDB's [storage engines](https://rxdb.info/rx-storage.html).

## Installation

```bash
npm install @tanstack/rxdb-db-collection rxdb @tanstack/db
```

```ts
import { createCollection } from '@tanstack/db'
import { rxdbCollectionOptions } from '@tanstack/rxdb-db-collection'

// Assume you already have an RxDB collection instance:
const rxCollection = myDatabase.todos

const todosCollection = createCollection(
  rxdbCollectionOptions({
    rxCollection
  })
)
```
