# SSR Design: Request and Process Scoped Collections with Cross-Framework Hydration

Status: Draft proposal
Target: `@tanstack/db` core + framework adapters (`@tanstack/react-db` first)
Related: issue #545, draft PR #709

## Problem Statement

The previous SSR proposal hydrated `useLiveQuery` results by query id, but did not fully address server isolation:

1. SSR queries can capture module-scoped collection instances.
2. Query-backed collections can share module-scoped `QueryClient` instances.
3. Server module state can survive across requests.
4. Result: request data leakage risk.

At the same time, some data should intentionally be process-cached for fast responses (for example, store catalog data).

We need a design that:

1. Uses request scope by default for correctness.
2. Allows process-scoped collections intentionally for safe shared caches.
3. Supports query hydration and optional collection hydration.
4. Works across Next.js, TanStack Start, and React Router / Remix.
5. Shares implementation in core so all framework adapters follow the same behavior.

## Goals

1. Make request-scoped server collections the default SSR pattern.
2. Support intentional process-scoped collections for cacheable non-request data.
3. Keep query-result hydration (`prefetchLiveQuery`) for small payloads and fast first paint.
4. Support explicit live query serialization that skips collection used-marking for that query.
5. Add optional collection snapshot serialization/hydration.
6. Include sync metadata in snapshots so resumable sync engines can continue from hydrated state.
7. Define fallback behavior for non-resumable sync engines using truncate-and-restart.
8. Keep API TanStack-like: explicit, composable, type-safe, no implicit global request state.

## Non-Goals

1. Full streaming/Suspense SSR in v1.
2. Automatic serialization of all collections.
3. Implicit framework-specific request context resolution inside core.

## Design Principles

1. Correctness by default: request scope is the default.
2. Explicit escape hatch: process scope must be intentional and declared.
3. One snapshot API for all collection types, including live query collections.
4. Collection serialization is opt-in and allowlisted.
5. Core owns SSR data model and lifecycle; adapters own framework integration ergonomics.

## Proposed Architecture

### 1. Scope Model: `request` and `process`

Every server collection used in SSR has an explicit scope:

1. `request`: unique instance per request, cleaned up at request end.
2. `process`: shared instance across requests in the same process/runtime.

`request` is default when not declared.

`process` is for data that is safe to share (for example, public catalog data). It should not depend on per-user auth or request-local headers.

Recommended process-scope use cases:

1. Public product catalog and static merchandising data.
2. Read-mostly lookup tables with long cache lifetimes.
3. Data that is explicitly safe to share across users.

### 1.1 Process Scope via Server Globals

Process scope can be implemented as server globals for convenience.

Proposed convenience pattern:

```ts
// app/db/server-shared.ts
import { createDbSharedEnvironment } from '@tanstack/db/ssr'

const DB_SHARED_ENV_KEY = Symbol.for(`@tanstack/db/ssr-shared-env`)
const globalStore = globalThis as Record<PropertyKey, unknown>

export const sharedDbEnv = (globalStore[DB_SHARED_ENV_KEY] ??=
  createDbSharedEnvironment()) as ReturnType<typeof createDbSharedEnvironment>
```

This should be supported as a first-class path for process-scoped collections.

Bundling/runtime caveats:

1. Scope is per JS runtime realm, not globally shared across all server machines.
2. Different processes/workers/isolates each get their own process cache.
3. In serverless/edge, warm instance reuse determines cache persistence.
4. Module duplication can break module-level singletons; `globalThis + Symbol.for` avoids duplication within one realm.
5. Different runtime entry points (for example middleware runtime vs app server runtime) may not share a realm, so process scope should be treated as best-effort shared cache, not distributed cache.

Design implication:

1. Keep explicit `DbSharedEnvironment` injection for deterministic integration tests and advanced setups.
2. Provide official helper for global-backed shared env to keep app ergonomics simple.

### 2. Core SSR Primitives in `@tanstack/db`

Add framework-agnostic SSR APIs in core (illustrative names):

```ts
// @tanstack/db/ssr
type ServerCollectionScope = `request` | `process`

export interface DbSharedEnvironment {
  getOrCreate<T>(key: string, factory: () => T): T
}

export interface DbRequestScope<TCollections extends CollectionMap> {
  readonly id: string
  readonly collections: TCollections
  readonly collectionScopes: Partial<
    Record<keyof TCollections, ServerCollectionScope>
  >
  readonly prefetchedQueries: Map<string, DehydratedQueryRecord>
  cleanup(): Promise<void>
}

export interface CreateDbRequestScopeOptions<
  TCollections extends CollectionMap,
> {
  shared?: DbSharedEnvironment
  createCollections: (ctx: { shared: DbSharedEnvironment }) => TCollections
  collectionScopes?: Partial<Record<keyof TCollections, ServerCollectionScope>>
  cleanupCollections?: (collections: TCollections) => Promise<void> | void
}

export function createDbSharedEnvironment(): DbSharedEnvironment

export function createDbRequestScope<TCollections extends CollectionMap>(
  options: CreateDbRequestScopeOptions<TCollections>,
): DbRequestScope<TCollections>
```

Lifecycle behavior:

1. `scope.cleanup()` cleans up `request` collections by default.
2. `process` collections are not cleaned up per request.
3. Custom `cleanupCollections` can override default behavior.

### 3. Request Scope Query Prefetch

```ts
export interface PrefetchDbQueryOptions<
  TCollections extends CollectionMap,
  TContext extends Context,
> {
  id: string
  query: (args: {
    q: InitialQueryBuilder
    collections: TCollections
  }) => QueryBuilder<TContext>
  transform?: (rows: Array<GetResult<TContext>>) => unknown
  ssr?: {
    explicitlySerialized?: boolean // default false
  }
}

export async function prefetchDbQuery<
  TCollections extends CollectionMap,
  TContext extends Context,
>(
  scope: DbRequestScope<TCollections>,
  options: PrefetchDbQueryOptions<TCollections, TContext>,
): Promise<void>
```

Important difference from the draft PR:

1. Prefetch query receives request scope collections explicitly.
2. This avoids hidden module singleton capture in server prefetch paths.

### 3.1 Explicit Query Serialization Mode

When `ssr.explicitlySerialized` is `true` on a prefetched live query:

1. Query result is marked for dehydration by query id.
2. Source collections referenced by that query are not auto-marked used.
3. This avoids duplicate payloads (query result + same collection snapshots) unless collections are include-listed explicitly.

### 4. Dehydrated State Format

Use a versioned payload:

```ts
export interface DehydratedDbStateV1 {
  version: 1
  queries: Record<
    string,
    {
      data: unknown
      timestamp: number
    }
  >
  collections?: Record<
    string,
    {
      snapshot: CollectionSnapshot<unknown>
      timestamp: number
      scope: `request` | `process`
    }
  >
}
```

### 5. Optional Collection Serialization

Add explicit options to `dehydrateDbScope`:

```ts
export type CollectionSelector<TCollections extends CollectionMap> =
  | Array<keyof TCollections>
  | ((entry: {
      name: keyof TCollections
      collection: TCollections[keyof TCollections]
      scope: `request` | `process`
    }) => boolean)

export interface DehydrateDbScopeOptions<TCollections extends CollectionMap> {
  includeQueries?: boolean // default true
  includeCollections?:
    | false
    | {
        include: CollectionSelector<TCollections>
        awaitReady?: boolean // default false
        includeSyncState?: boolean // default true
        transform?: Partial<
          Record<
            keyof TCollections,
            (
              snapshot: CollectionSnapshot<unknown>,
            ) => CollectionSnapshot<unknown>
          >
        >
      }
}
```

Behavior:

1. Default is query-only dehydration.
2. Collection dehydration is opt-in and allowlisted.
3. `include` can filter by name and scope.
4. `includeSyncState` controls whether snapshot sync metadata is serialized.
5. `includeQueries: true` serializes prefetched queries, including queries with `ssr.explicitlySerialized: true`.
6. Explicit query serialization does not imply collection snapshot serialization.

### 6. Snapshot API for Collections and Live Query Collections

Because live query collections are collections, we keep a single API:

```ts
interface CollectionSnapshot<T, TSyncState = unknown> {
  rows: Array<T>
  metadata?: {
    exportedAt: number
    syncState?: TSyncState
    syncStateVersion?: number | string
  }
}

interface Collection<T, TKey, TUtils> {
  exportSnapshot(options?: {
    includeSyncState?: boolean // default true
  }): CollectionSnapshot<T>

  importSnapshot(
    snapshot: CollectionSnapshot<T>,
    options?: {
      replace?: boolean // default true
      applySyncState?: `resume-if-possible` | `ignore` | `require-resume`
      onIncompatibleSyncState?: `truncate` | `ignore` | `throw` // default truncate
    },
  ): { resumed: boolean }
}
```

`importSnapshot` requirements:

1. Writes to synced/base state, not optimistic layer.
2. Does not trigger persistence handlers.
3. Emits normal reactive updates.
4. Works for base collections and live query collections.

### 7. Sync Metadata and Resume Semantics

Add optional hooks for sync adapters:

```ts
interface SyncConfig<T, TKey> {
  exportSyncState?: () => unknown
  importSyncState?: (state: unknown) => { resumed: boolean }
}
```

Import behavior:

1. If `importSyncState` is present and accepts metadata, sync can resume from hydrated position.
2. If metadata is missing or incompatible and `onIncompatibleSyncState` is `truncate`, a truncate-style restart is triggered before fresh sync.
3. If sync metadata is unsupported, adapters should behave as non-resumable and follow restart policy.

Truncate restart intent:

1. Clear potentially stale hydrated rows.
2. Rebuild from authoritative upstream sync path.
3. Keep behavior deterministic across adapters.

### 8. Framework Adapter Layer

React adapter (`@tanstack/react-db`) wraps the core primitives:

```ts
// server
createServerContext(...)
prefetchLiveQuery(...)
dehydrate(...)

// client
HydrationBoundary
useHydratedQuery(id)
useLiveQuery({ id, query, ssr: { explicitlySerialized: true } })
useHydrateCollections(...)
```

`useLiveQuery` behavior when a server scope exists:

1. Default mode auto-marks scope collections used by the query graph.
2. `ssr.explicitlySerialized: true` marks only the live query id for dehydration and skips collection used-marking for that query.

Other adapters (Solid/Vue/Svelte) use the same core SSR primitives and provide framework-idiomatic boundary/hydration wrappers only.

No framework should re-implement dehydration, snapshot format, or resume semantics.

## Request Lifecycle

Server:

1. Build request scope with request and optional process collections.
2. Prefetch query ids against scope collections and mark explicit-query serialization where needed.
3. Optionally dehydrate collection snapshots for used/include-listed collections.
4. Render with dehydrated state.
5. Cleanup request scope in `finally`.

Client:

1. Build client collections.
2. Provide dehydrated payload via framework boundary/provider.
3. Hydrate query ids for `useLiveQuery({ id })`.
4. Optionally apply collection snapshots.
5. Resume sync if sync metadata is compatible; otherwise restart based on policy.

## App Collection Factory Pattern

Recommended pattern:

```ts
// app/db/createServerCollections.ts
export function createServerCollections(ctx: {
  request: RequestLike
  shared: DbSharedEnvironment
}) {
  const sharedQueryClient = ctx.shared.getOrCreate(
    `catalog-query-client`,
    () => new QueryClient(),
  )
  const catalogCollection = ctx.shared.getOrCreate(`catalog-collection`, () =>
    createCollection(...),
  )

  const requestQueryClient = new QueryClient()
  const accountCollection = createCollection(...)

  return {
    catalog: catalogCollection, // process
    account: accountCollection, // request
  }
}
```

Then bind scopes explicitly in request creation:

```ts
const scope = createDbRequestScope({
  shared: sharedEnv,
  createCollections: ({ shared }) =>
    createServerCollections({ request, shared }),
  collectionScopes: {
    catalog: `process`,
    account: `request`,
  },
})
```

## Framework Example Docs

Detailed example docs are included next to this design doc:

1. `SSR_NEXTJS_EXAMPLE.md`
2. `SSR_TANSTACK_START_EXAMPLE.md`
3. `SSR_REACT_ROUTER_REMIX_EXAMPLE.md`

Each example demonstrates:

1. Mixed `request` and `process` scope usage.
2. Query dehydration and optional collection snapshot dehydration.
3. Sync metadata resume behavior with truncate fallback.

## Backwards Compatibility

1. Keep draft-style `prefetchLiveQuery(serverContext, { id, query })` for one cycle.
2. Mark it as compatibility mode, with docs warning about singleton capture risk.
3. Add dev warnings when collection scope is unknown in server prefetch paths.
4. Move official docs and examples to explicit scope APIs immediately.

## Security and Payload Controls

1. Collection serialization defaults to disabled.
2. Serialization requires explicit allowlisting.
3. Recommend redaction transforms for sensitive fields.
4. Include per-route payload budgeting guidance.
5. Encourage process scope only for non-sensitive shareable data.

## Failure and Cleanup Semantics

1. Scope cleanup runs in `finally`.
2. Cleanup failures are aggregated and logged in dev.
3. Prefetch failures fail request by default unless framework route chooses partial fallback.
4. `truncate` policy clears and restarts sync when resume metadata is incompatible.
5. `throw` policy fails early when resume metadata is incompatible.
6. `ignore` policy keeps hydrated rows until normal sync overwrites them.

## Testing Plan

### Unit Tests (core)

1. Scope map correctness (`request` default, `process` explicit).
2. Request cleanup does not dispose process collections.
3. Snapshot export/import includes rows and optional sync metadata.
4. Resume path (`importSyncState` success) and truncate fallback path.
5. Live query collection snapshot parity with base collections.
6. `ssr.explicitlySerialized` queries skip collection used-marking.

### Integration Tests (react-db)

1. Query hydration by id with mixed scope collections.
2. Collection snapshot hydration path.
3. Two-request isolation test for request collections.
4. Positive test for process-scoped catalog sharing with no request leakage.
5. Framework-style tests for Next.js, Start, and React Router loader pipelines.
6. Explicit live query serialization avoids duplicate collection dehydration.

### Regression Test for Existing Leak Class

1. Request A: user 1, prefetch query key `['projects']`.
2. Request B: user 2, same query key.
3. Request scope pattern must never serve A data in B.
4. A deliberate singleton fixture should still demonstrate leak risk (guardrail test).

## Rollout Plan

### Phase 1

1. Land request/process scope model and query dehydration APIs in core.
2. React adapter integration for query hydration.
3. Publish migration docs for collection factory + explicit scope declaration.

### Phase 2

1. Land `exportSnapshot` / `importSnapshot` in core collection API.
2. Land sync metadata resume hooks plus truncate fallback semantics.
3. Enable optional collection snapshot dehydration/hydration in React adapter.

### Phase 3

1. Adapter parity for Solid/Vue/Svelte.
2. Add full framework example suites and e2e matrices.

## Open Questions

1. Should `replace` remain default for `importSnapshot`, or should merge be default?
2. Should strict JSON mode be opt-in or default in production builds?
3. How long should compatibility mode remain before deprecation warning escalation?
4. Should process scope include optional TTL/invalidation helpers in core?

## Summary

The design shifts SSR from "query hydration over implicit global collections" to "explicitly scoped server collections with shared core hydration semantics." It preserves request safety by default, allows intentional process-level cache patterns, and uses one snapshot contract for both collections and live query collections, including sync resume metadata and truncate fallback for non-resumable engines.
