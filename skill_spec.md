# TanStack DB — Skill Specification (Reviewed)

TanStack DB is a reactive client-side data store that provides normalized collections, sub-millisecond live queries via differential dataflow (d2ts), and instant optimistic mutations with automatic rollback. It supports multiple data sources (REST APIs via TanStack Query, sync engines like ElectricSQL/PowerSync/RxDB/TrailBase, and local storage) through a unified collection API with framework adapters for React, Vue, Svelte, Solid, and Angular.

## Domains

| Domain                       | Description                                                                                                                | Skills                |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| Collection Setup & Schema    | Creating and configuring typed collections from any data source, with schema validation and adapter-specific sync patterns | collection-setup      |
| Live Query Construction      | Building SQL-like reactive queries with expressions, joins, aggregations, and incremental view maintenance                 | live-queries          |
| Framework Integration        | Binding live queries to UI framework components using hooks, dependency tracking, Suspense, and pagination                 | framework-integration |
| Mutations & Optimistic State | Writing data with instant optimistic feedback, transaction lifecycles, and automatic rollback                              | mutations-optimistic  |
| Meta-Framework Integration   | Client-side preloading of collections in route loaders for TanStack Start, Next.js, Remix, etc.                            | meta-framework        |
| Custom Adapter Authoring     | Building custom collection adapters that implement the SyncConfig contract                                                 | custom-adapter        |
| Offline Transactions         | Offline-first transaction queueing with persistence, retry, and multi-tab coordination                                     | offline               |

## Skill Inventory

| Skill                 | Type        | Domain                       | What it covers                                                                                                                  | Failure modes |
| --------------------- | ----------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | :-----------: |
| collection-setup      | core        | Collection Setup & Schema    | createCollection, 7 adapter option creators, CollectionConfig, StandardSchema, lifecycle, sync modes, adapter-specific patterns |      10       |
| live-queries          | core        | Live Query Construction      | Query builder API, all operators, joins, aggregates, derived collections, IVM, $selected, predicate push-down                   |       8       |
| framework-integration | framework   | Framework Integration        | React/Vue/Svelte/Solid/Angular hooks, deps arrays, Suspense, infinite queries                                                   |       4       |
| mutations-optimistic  | core        | Mutations & Optimistic State | insert/update/delete, draft proxy, transactions, paced mutations, Pacer integration                                             |       8       |
| meta-framework        | composition | Meta-Framework Integration   | preload() in loaders, ssr: false, pre-created live query collections, route lifecycle                                           |       3       |
| custom-adapter        | core        | Custom Adapter Authoring     | SyncConfig, begin/write/commit/markReady, loadSubset, expression parsing                                                        |       3       |
| offline               | composition | Offline Transactions         | OfflineExecutor, storage adapters, retry, leader election, online detection                                                     |       3       |

## Failure Mode Inventory

### Collection Setup & Schema (10 failure modes)

| #   | Mistake                                               | Priority | Source     | Cross-skill? |
| --- | ----------------------------------------------------- | -------- | ---------- | ------------ |
| 1   | queryFn returning empty array deletes all data        | CRITICAL | docs       | —            |
| 2   | Not knowing which adapter to use                      | CRITICAL | maintainer | —            |
| 3   | Using async schema validation                         | HIGH     | source     | —            |
| 4   | getKey returning undefined                            | HIGH     | source     | —            |
| 5   | TInput not superset of TOutput with schema transforms | HIGH     | docs       | —            |
| 6   | Providing both explicit type param and schema         | MEDIUM   | docs       | —            |
| 7   | React Native missing crypto.randomUUID                | HIGH     | docs       | —            |
| 8   | Electric txid queried outside mutation transaction    | CRITICAL | docs       | —            |
| 9   | queryFn returning partial data without merging        | CRITICAL | docs       | —            |
| 10  | Direct writes overridden by next query sync           | MEDIUM   | docs       | —            |

### Live Query Construction (8 failure modes)

| #   | Mistake                                                      | Priority | Source     | Cross-skill? |
| --- | ------------------------------------------------------------ | -------- | ---------- | ------------ |
| 1   | Using === instead of eq() in where clauses                   | CRITICAL | source     | —            |
| 2   | Filtering/transforming data in JS instead of query operators | CRITICAL | maintainer | —            |
| 3   | Not using the full set of available query operators          | HIGH     | maintainer | —            |
| 4   | .distinct() without .select()                                | HIGH     | source     | —            |
| 5   | .having() without .groupBy()                                 | HIGH     | source     | —            |
| 6   | .limit()/.offset() without .orderBy()                        | HIGH     | source     | —            |
| 7   | Join condition using operator other than eq()                | HIGH     | source     | —            |
| 8   | Passing source directly instead of {alias: collection}       | MEDIUM   | source     | —            |

### Framework Integration (4 failure modes)

| #   | Mistake                                      | Priority | Source | Cross-skill? |
| --- | -------------------------------------------- | -------- | ------ | ------------ |
| 1   | Missing external values in deps array        | CRITICAL | docs   | —            |
| 2   | Reading Solid signals outside query function | HIGH     | docs   | —            |
| 3   | useLiveSuspenseQuery without Error Boundary  | HIGH     | docs   | —            |
| 4   | Svelte props not wrapped in getter functions | MEDIUM   | docs   | —            |

### Mutations & Optimistic State (8 failure modes)

| #   | Mistake                                                         | Priority | Source     | Cross-skill? |
| --- | --------------------------------------------------------------- | -------- | ---------- | ------------ |
| 1   | Passing object to update() instead of mutating draft            | CRITICAL | maintainer | —            |
| 2   | Hallucinating mutation API signatures                           | CRITICAL | maintainer | —            |
| 3   | onMutate callback returning a Promise                           | CRITICAL | source     | —            |
| 4   | insert/update/delete without handler or ambient transaction     | CRITICAL | source     | —            |
| 5   | .mutate() after transaction no longer pending                   | HIGH     | source     | —            |
| 6   | Attempting to change primary key via update                     | HIGH     | source     | —            |
| 7   | Inserting item with duplicate key                               | HIGH     | source     | —            |
| 8   | Not awaiting refetch after mutation in query collection handler | HIGH     | docs       | —            |

### Meta-Framework Integration (3 failure modes)

| #   | Mistake                                                              | Priority | Source   | Cross-skill? |
| --- | -------------------------------------------------------------------- | -------- | -------- | ------------ |
| 1   | Not preloading collections in route loaders                          | HIGH     | examples | —            |
| 2   | Not setting ssr: false on routes using collections                   | CRITICAL | examples | —            |
| 3   | Creating new collection instances inside loaders on every navigation | HIGH     | docs     | —            |

### Custom Adapter Authoring (3 failure modes)

| #   | Mistake                                         | Priority | Source | Cross-skill? |
| --- | ----------------------------------------------- | -------- | ------ | ------------ |
| 1   | Not calling markReady() in sync implementation  | CRITICAL | docs   | —            |
| 2   | Race condition: subscribing after initial fetch | HIGH     | docs   | —            |
| 3   | write() called without begin()                  | HIGH     | source | —            |

### Offline Transactions (3 failure modes)

| #   | Mistake                                               | Priority | Source     | Cross-skill? |
| --- | ----------------------------------------------------- | -------- | ---------- | ------------ |
| 1   | Using offline transactions when not needed            | HIGH     | maintainer | —            |
| 2   | Not handling NonRetriableError for permanent failures | HIGH     | source     | —            |
| 3   | Multiple tabs executing same queued transaction       | CRITICAL | source     | —            |

**Total: 39 failure modes (14 CRITICAL, 19 HIGH, 6 MEDIUM)**

## Key Maintainer Insights (not in docs)

1. **Always prefer query operators over JS** — Live queries are incrementally maintained via D2 differential dataflow. A `.where(eq(...))` only recomputes the delta on data changes, while `.filter()` in JS re-runs from scratch. This applies even for trivial transformations.

2. **The update API is Immer-style** — `collection.update(id, (draft) => { draft.title = "new" })` not `collection.update(id, { ...item, title: "new" })`. This is the single most common mutation API mistake AI agents make.

3. **Agents hallucinate mutation APIs** — The mutation surface has nuance (handler signatures, ambient transaction context, createOptimisticAction vs createTransaction). Agents generate plausible-looking but wrong code.

4. **Collection type selection matters** — Don't default to bare `createCollection` or `localOnlyCollectionOptions`. Each backend has a dedicated adapter that handles sync, handlers, and utilities correctly.

5. **localOnly is a valid prototyping strategy** — `localOnlyCollectionOptions` → real backend adapter is a clean upgrade path.

6. **Offline is hard — only when needed** — Don't steer users toward offline unless they need it. PowerSync/RxDB handle their own local persistence, which is different from offline transaction queuing.

7. **SSR is not supported yet** — Collections are client-side only. Routes using collections must set `ssr: false`. Preloading happens in client-side route loaders, not on the server.

8. **Transactions stack** — Concurrent transactions build optimistic state on top of each other. Use TanStack Pacer for sequential execution when ordering matters.

## Tensions

| Tension                                  | Skills                                  | Agent implication                                                                                          |
| ---------------------------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Simplicity vs. correctness in sync       | collection-setup ↔ custom-adapter       | Agents use localOnly or eager mode for everything; production needs adapter-specific patterns              |
| Optimistic speed vs. data consistency    | mutations-optimistic ↔ collection-setup | Agents apply optimistic updates without considering rollback UX or awaiting refetch                        |
| Query expressiveness vs. IVM constraints | live-queries ↔ framework-integration    | Agents write SQL-style queries that violate IVM constraints (equality joins only, orderBy for limit, etc.) |
| Offline complexity vs. app simplicity    | offline ↔ mutations-optimistic          | Agents add offline-transactions to apps that only need basic optimistic mutations                          |

## Cross-References

| From                  | To                    | Reason                                                                     |
| --------------------- | --------------------- | -------------------------------------------------------------------------- |
| framework-integration | meta-framework        | Hooks render data; loaders preload it. Both needed for production routing. |
| meta-framework        | framework-integration | Preloaded collections consumed by hooks; hook API informs what to preload. |
| collection-setup      | mutations-optimistic  | Mutation handlers configured at setup time, execute during mutations.      |
| mutations-optimistic  | collection-setup      | Handler signatures depend on adapter (Electric txid, Query refetch).       |
| live-queries          | collection-setup      | Queries reference collections; sync modes affect query behavior.           |
| custom-adapter        | collection-setup      | Custom adapters produce same CollectionConfig shape as built-in adapters.  |
| offline               | mutations-optimistic  | Offline wraps the same transaction/mutation model.                         |

## Subsystems & Reference Candidates

| Skill                 | Subsystems                                                                        | Reference candidates                                     |
| --------------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------- |
| collection-setup      | TanStack Query, ElectricSQL, PowerSync, RxDB, TrailBase, local-only, localStorage | Adapter configs with examples                            |
| live-queries          | —                                                                                 | Query operators (>20 distinct operators with signatures) |
| framework-integration | React, Vue, Svelte, Solid, Angular                                                | Per-framework hook patterns                              |
| mutations-optimistic  | —                                                                                 | Transaction API, draft proxy, paced mutations            |
| meta-framework        | —                                                                                 | —                                                        |
| custom-adapter        | —                                                                                 | SyncConfig contract, expression parsing helpers          |
| offline               | —                                                                                 | Storage adapters, retry policies, leader election        |

## Remaining Gaps

| Skill                | Question                                                                                 | Status |
| -------------------- | ---------------------------------------------------------------------------------------- | ------ |
| meta-framework       | Patterns for non-TanStack-Start frameworks (Next.js App Router, Remix, Nuxt, SvelteKit)? | open   |
| collection-setup     | Collection GC/disposal patterns in route-based SPAs?                                     | open   |
| live-queries         | Performance cliffs — at what complexity/data size do queries degrade?                    | open   |
| mutations-optimistic | Recommended pattern for temporary ID → server ID mapping?                                | open   |
| meta-framework       | Specific TanStack Router integration patterns for prefetching?                           | open   |
| offline              | Behavior of in-flight transactions when browser goes offline mid-persist?                | open   |

## Recommended Skill File Structure

- **Core skills:** collection-setup, live-queries, mutations-optimistic, custom-adapter
- **Framework skills:** framework-integration (per-framework references)
- **Composition skills:** meta-framework, offline
- **Reference files needed:**
  - collection-setup: per-adapter config references (7 adapters)
  - live-queries: operator reference (>20 operators)
  - framework-integration: per-framework hook references (5 frameworks)
  - custom-adapter: SyncConfig contract reference

### Monorepo skill placement

| Package                         | Skills                                                               |
| ------------------------------- | -------------------------------------------------------------------- |
| `packages/db`                   | collection-setup, live-queries, mutations-optimistic, custom-adapter |
| `packages/react-db`             | framework-integration (React)                                        |
| `packages/vue-db`               | framework-integration (Vue)                                          |
| `packages/svelte-db`            | framework-integration (Svelte)                                       |
| `packages/solid-db`             | framework-integration (Solid)                                        |
| `packages/angular-db`           | framework-integration (Angular)                                      |
| `packages/offline-transactions` | offline                                                              |
| Meta-framework                  | meta-framework (in `packages/db` or repo-level)                      |

## Composition Opportunities

| Library                          | Integration points                                    | Composition skill needed?                |
| -------------------------------- | ----------------------------------------------------- | ---------------------------------------- |
| TanStack Query                   | queryCollectionOptions wraps QueryObserver            | Built into collection-setup adapter refs |
| TanStack Router                  | Route loaders for collection preloading               | meta-framework skill                     |
| TanStack Start                   | Full-stack framework with ssr: false pattern          | meta-framework skill                     |
| ElectricSQL                      | Real-time sync via ShapeStream; txid tracking         | Built into collection-setup adapter refs |
| PowerSync                        | SQLite offline persistence; diff-trigger changes      | Built into collection-setup adapter refs |
| RxDB                             | Observable-driven sync; RxJS subscriptions            | Built into collection-setup adapter refs |
| TrailBase                        | Event stream sync; cursor-based pagination            | Built into collection-setup adapter refs |
| Zod / Valibot / ArkType / Effect | Schema validation via StandardSchema spec             | Built into collection-setup              |
| TanStack Table                   | Virtual table rendering of live query results         | Needs investigation                      |
| TanStack Pacer                   | Sequential transaction execution, debounced mutations | Built into mutations-optimistic          |
