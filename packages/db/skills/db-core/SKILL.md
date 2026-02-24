---
name: db-core
description: >
  Reactive client store with normalized collections, sub-millisecond live
  queries via differential dataflow, and instant optimistic mutations.
  Covers createCollection, query builder (from/where/join/select/groupBy/
  orderBy/limit), operators (eq/gt/lt/like/inArray), aggregates (count/sum/
  avg/min/max), createTransaction, createOptimisticAction, sync adapters.
  Framework-agnostic core for @tanstack/db.
type: core
library: db
library_version: "0.5.29"
source_repository: "https://github.com/TanStack/db"
---

# TanStack DB — Core Concepts

TanStack DB is a reactive client-side data store that normalizes data into
typed collections, provides sub-millisecond live queries powered by
differential dataflow (d2ts), and gives instant optimistic mutations with
automatic rollback. It connects to any backend through sync adapters
(TanStack Query, ElectricSQL, PowerSync, RxDB, TrailBase) or runs purely
local.

## Sub-Skills

| Need to... | Read |
|------------|------|
| Create and configure collections from any data source | db-core/collection-setup/SKILL.md |
| Build reactive queries with filters, joins, aggregations | db-core/live-queries/SKILL.md |
| Write data with optimistic updates and transactions | db-core/mutations-optimistic/SKILL.md |
| Configure sync, offline support, or build a custom adapter | db-core/sync-connectivity/SKILL.md |

## Quick Decision Tree

- Creating a collection or choosing which adapter to use? → db-core/collection-setup
- Querying, filtering, joining, or aggregating collection data? → db-core/live-queries
- Inserting, updating, or deleting items? → db-core/mutations-optimistic
- Configuring sync modes, offline, or building a custom adapter? → db-core/sync-connectivity
- Wiring queries into React components? → react-db/SKILL.md
- Wiring queries into Vue/Svelte/Solid/Angular? → [framework]-db/SKILL.md

## Architecture

Data flows in one direction:

1. **Optimistic state** — mutations apply instantly to the local collection
2. **Persist** — mutation handler sends changes to the backend
3. **Sync** — backend confirms and streams updated state back
4. **Reconcile** — optimistic state is replaced by confirmed server state

Live queries subscribe to collection changes and incrementally recompute
results via d2ts differential dataflow. A single-row update in a sorted
100k-item collection takes ~0.7ms (M1 Pro).

## Version

Targets @tanstack/db v0.5.29.
