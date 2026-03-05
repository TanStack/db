---
name: db-core
description: >
  TanStack DB core concepts: createCollection with queryCollectionOptions,
  electricCollectionOptions, powerSyncCollectionOptions, rxdbCollectionOptions,
  trailbaseCollectionOptions, localOnlyCollectionOptions. Live queries via
  query builder (from, where, join, select, groupBy, orderBy, limit). Optimistic
  mutations with draft proxy (collection.insert, collection.update,
  collection.delete). createOptimisticAction, createTransaction,
  createPacedMutations. Entry point for all TanStack DB skills.
type: core
library: db
library_version: "0.5.30"
---

# TanStack DB — Core Concepts

TanStack DB is a reactive client-side data store. It loads data into typed
collections from any backend (REST APIs, sync engines, local storage), provides
sub-millisecond live queries via differential dataflow, and supports instant
optimistic mutations with automatic rollback.

In React projects, import from `@tanstack/react-db` — it re-exports everything
from `@tanstack/db` plus React hooks.

## Sub-Skills

| Need to...                                      | Read                                    |
| ----------------------------------------------- | --------------------------------------- |
| Create a collection, pick an adapter, add schema | db-core/collection-setup/SKILL.md       |
| Query data with where, join, groupBy, select     | db-core/live-queries/SKILL.md           |
| Insert, update, delete with optimistic UI        | db-core/mutations-optimistic/SKILL.md   |
| Build a custom sync adapter                      | db-core/custom-adapter/SKILL.md         |
| Preload collections in route loaders             | meta-framework/SKILL.md                 |
| Add offline transaction queueing                 | offline/SKILL.md (in @tanstack/offline-transactions) |

For framework-specific hooks:

| Framework | Read                         |
| --------- | ---------------------------- |
| React     | react-db/SKILL.md            |
| Vue       | vue-db/SKILL.md              |
| Svelte    | svelte-db/SKILL.md           |
| Solid     | solid-db/SKILL.md            |
| Angular   | angular-db/SKILL.md          |

## Quick Decision Tree

- Setting up for the first time? → db-core/collection-setup
- Building queries on collection data? → db-core/live-queries
- Writing data / handling optimistic state? → db-core/mutations-optimistic
- Using React hooks? → react-db
- Preloading in route loaders (Start, Next, Remix)? → meta-framework
- Building an adapter for a new backend? → db-core/custom-adapter
- Need offline transaction persistence? → offline

## Version

Targets @tanstack/db v0.5.30.
