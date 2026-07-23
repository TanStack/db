# SSR Alt Design: Scope-Aware Getters with Explicit Transfer

Status: Draft proposal  
Target: `@tanstack/db` core + framework adapters  
Replaces: prior high-ceremony SSR draft design

## Summary

This alt design keeps five core primitives:

1. `createDbScope`
2. `ProvideDbScope`
3. `useDbScope`
4. `defineCollection`
5. `defineLiveQuery`

It explicitly separates two concerns:

1. Lifecycle binding: pass `scope` to a getter.
2. Transfer intent: call `scope.include(collection)`.

## Review-Driven Updates

This revision addresses the recent review concerns:

1. Silent missing-scope bugs: add required-scope getter mode and strict hook behavior.
2. Memoization ambiguity: define stable cache key and miss/hit behavior.
3. QueryClient lifecycle ambiguity: factory execution contract is explicit.
4. Scope-threading risks: add strict runtime guard and optional scope hook.
5. Live query prune semantics: define hydration timing guarantee.
6. Sync resume gap: define v1 metadata shape and defer advanced policy knobs.
7. Undefined dehydrated state: define `DehydratedDbStateV1`.
8. RSC cleanup timing: define safe patterns and example guidance.

## API Surface

```ts
interface DbScope {
  include(collection: Collection<any, any, any>): void
  serialize(): DehydratedDbStateV1
  cleanup(): Promise<void>
}

declare function createDbScope(): DbScope

declare function useDbScope(): DbScope
declare function useOptionalDbScope(): DbScope | undefined

declare function ProvideDbScope(props: {
  scope?: DbScope
  state?: DehydratedDbStateV1
  children: React.ReactNode
}): JSX.Element
```

Hook semantics:

1. `useDbScope()` throws if no provider is active.
2. `useOptionalDbScope()` is for mixed SSR/CSR trees where provider presence is conditional.

## Getter APIs

### `defineCollection`

```ts
interface DefineGetterOptions {
  scope?: 'optional' | 'required'
}

type DefineGetterCallArgs<
  TParams extends object,
  TOptions extends DefineGetterOptions | undefined,
> = TOptions extends { scope: 'required' }
  ? [params: TParams, scope: DbScope]
  : [params: TParams, scope?: DbScope]

declare function defineCollection<
  TOptions extends CollectionConfig<any, any, any, any> & { id: string },
  TGetterOptions extends DefineGetterOptions | undefined = undefined,
>(
  getOptions: (scope?: DbScope) => TOptions,
  options?: TGetterOptions,
): TGetterOptions extends { scope: 'required' }
  ? (scope: DbScope) => InferCollectionFromOptions<TOptions>
  : (scope?: DbScope) => InferCollectionFromOptions<TOptions>

declare function defineCollection<
  TParams extends object,
  TOptions extends CollectionConfig<any, any, any, any> & { id: string },
  TGetterOptions extends DefineGetterOptions | undefined = undefined,
>(
  getOptions: (params: TParams, scope?: DbScope) => TOptions,
  options?: TGetterOptions,
): (
  ...args: DefineGetterCallArgs<TParams, TGetterOptions>
) => InferCollectionFromOptions<TOptions>
```

### `defineLiveQuery`

```ts
declare function defineLiveQuery<
  TOptions extends LiveQueryCollectionConfig<any, any> & { id: string },
  TGetterOptions extends DefineGetterOptions | undefined = undefined,
>(
  getOptions: (scope?: DbScope) => TOptions,
  options?: TGetterOptions,
): TGetterOptions extends { scope: 'required' }
  ? (scope: DbScope) => LiveQueryCollectionFromOptions<TOptions>
  : (scope?: DbScope) => LiveQueryCollectionFromOptions<TOptions>

declare function defineLiveQuery<
  TParams extends object,
  TOptions extends LiveQueryCollectionConfig<any, any> & { id: string },
  TGetterOptions extends DefineGetterOptions | undefined = undefined,
>(
  getOptions: (params: TParams, scope?: DbScope) => TOptions,
  options?: TGetterOptions,
): (
  ...args: DefineGetterCallArgs<TParams, TGetterOptions>
) => LiveQueryCollectionFromOptions<TOptions>
```

Behavior:

1. Parameterless getters avoid the `({}, scope)` pattern.
2. `scope: 'required'` causes runtime throw when scope is missing.
3. Type signature for required-scope getters requires a `scope` arg.
4. In dev mode, optional-scope getters called without scope while an active scope is detectable should emit a warning.

## Memoization Contract

Memoization is per getter function identity.

Key:

1. `scopeSlot`: scope instance identity, or global slot when no scope.
2. `paramsKey`: deterministic structural hash of params (see constraints below).
3. `getterId`: identity of the returned getter function.

Rules:

1. Cache key is `getterId + scopeSlot + paramsKey`.
2. `getOptions(...)` executes only on cache miss.
3. Cache hit returns the exact same collection/live-query instance.
4. In dev mode, if the same memo key resolves to a different `options.id`, throw.

Consequence:

1. Getters are safe to call repeatedly in render.
2. Factories that allocate resources (for example `QueryClient`) do not run on hits.

### Param Hashing Constraints

Params must be plain objects with deterministically hashable values. The structural hash is computed as follows:

1. Object keys are sorted lexicographically before hashing to ensure key-order independence.
2. Supported value types: `string`, `number`, `boolean`, `null`, `Date`, `BigInt`, plain objects, and arrays of supported types.
3. `Date` values are hashed by their numeric timestamp (`Date.getTime()`).
4. `BigInt` values are hashed by their string representation with a type prefix to avoid collision with numeric strings.
5. `undefined` values are treated as absent keys and excluded from the hash.
6. `Map`, `Set`, `RegExp`, class instances, functions, and `Symbol` are not supported as param values.
7. Cyclic references are not supported.
8. In dev mode, encountering an unsupported value type in params should throw with a descriptive error naming the offending key and type.
9. In production, unsupported values fall back to `String(value)`, which may produce collisions. This is intentional to avoid runtime cost; the dev-mode check is the guardrail.

This ensures all environments and adapters produce identical cache keys for the same logical params.

Each value type is hashed with a unique type prefix (for example `s:` for strings, `n:` for numbers, `d:` for dates, `bi:` for bigints). This means new types can be added to the supported set in future versions without changing hashes produced by existing types. The supported type list is not user-extensible; changes require a library update.

> **TODO**: Arrays are listed as supported above but the hashing details need more thought. Array params are likely common (for example a list of ids or tag filters). Open questions: should array order be significant for the hash? Should sparse arrays be normalized? Should nested arrays be supported or restricted to a single level? Resolve before implementation.

## Scope vs Transfer Semantics

1. Passing `scope` binds instance lifecycle to request scope.
2. Passing `scope` does not imply transfer.
3. `scope.include(collection)` opts a collection into snapshot transfer.
4. `useLiveQuery(...)` tracks live-query usage for `ssr.serializes`, but does not call `include(...)` on source collections.

## Scope Placement Strategies

Two placement strategies are supported. The choice depends on framework capabilities.

### Strategy 1: Single Root Scope (Preferred)

One scope per request, shared across all loaders, serialized once by the root component during SSR render.

Flow:

1. Create `dbScope` once per request (router creation, middleware, or request context).
2. Pass `dbScope` to all loaders via framework context.
3. Each loader uses `dbScope` to create collections, preload, and call `include(...)`.
4. After all loaders complete, the server begins rendering the component tree.
5. Root component calls `dbScope.serialize()` and renders `<ProvideDbScope state={dbState}>`.
6. Cleanup runs after render via middleware `finally` or router teardown.

Benefits:

1. Collection instances are shared across loaders via memoization (same scope, same params = same instance).
2. No duplicate data loading for collections used by multiple routes.
3. Single `ProvideDbScope` at the root; no nesting needed.
4. Clean mental model: one scope = one request = one serialized payload.

Requirement:

1. The framework must allow passing a live scope object to the root component during SSR render.
2. All matched loaders must complete before the root component renders (true for TanStack Start and React Router SSR).

Use when: TanStack Start (via router context).

### Strategy 2: Per-Loader Scope with Merge

Each loader creates its own scope, serializes independently, and its route component provides a `ProvideDbScope`. Nested providers merge state on the client.

Flow:

1. Each loader creates its own `dbScope`.
2. Loader preloads, calls `include(...)`, serializes, and cleans up in `finally`.
3. Each route component renders `<ProvideDbScope state={dbState}>`.
4. Nested `ProvideDbScope` components merge their state into the parent scope on the client.

Benefits:

1. Each loader is self-contained with clear ownership of create, serialize, cleanup.
2. No coordination required between parallel loaders.
3. Works in frameworks where scope objects cannot be passed from loaders to components (the only serializable output is `dbState`).

Tradeoff:

1. Collections used by multiple loaders are separate instances (different scopes), so data may be fetched more than once on the server.
2. Multiple `ProvideDbScope` providers in the component tree.

Use when: React Router / Remix (parallel loaders, serializable boundary), Next.js (per-page or per-server-component scope).

## ProvideDbScope Nesting and Merge

When `ProvideDbScope` is nested inside another `ProvideDbScope`, the inner provider's state merges into the scope visible to its descendants.

```tsx
<ProvideDbScope state={parentDbState}>
  {/* useDbScope() here sees parentDbState */}
  <ProvideDbScope state={childDbState}>
    {/* useDbScope() here sees parentDbState + childDbState merged */}
    <View />
  </ProvideDbScope>
</ProvideDbScope>
```

Merge rules:

1. Collection snapshots merge by `id`. On conflict, the entry with the later `generatedAt` timestamp wins. If timestamps are equal, the child entry wins.
2. Live query payloads merge by `id`. On conflict, the entry with the later `updatedAt` timestamp wins. If timestamps are equal, the child entry wins.
3. The merged scope is a new client-side scope. Getter memoization uses the nearest scope identity.
4. Merge happens at provider mount time. It is not reactive to parent state changes after mount.

Freshness rationale:

1. During initial SSR, all loaders for a request run at roughly the same time, so timestamps are nearly identical and tree position (child wins) is the effective tiebreaker.
2. During client-side route transitions, a child route loader may run later than the parent's cached data. Timestamp comparison ensures the fresher payload is not overwritten by stale cached parent data.
3. `generatedAt` on `DehydratedDbStateV1` and `updatedAt` on individual live query entries provide the freshness signal. Both are set at `serialize()` time.

When nesting is not needed:

1. Single root scope strategy uses one `ProvideDbScope` at the root. No merge required.
2. Next.js App Router typically has one `ProvideDbScope` per page server component. No nesting.

When nesting is expected:

1. React Router / Remix with per-loader scopes and nested routes.
2. Any layout where a parent route and child route each provide their own `dbState`.

## Dehydrated State Shape

```ts
interface DehydratedDbStateV1 {
  version: 1
  generatedAt: number
  collections: Array<{
    id: string
    rows: ReadonlyArray<unknown>
    meta?: unknown
  }>
  liveQueries: Array<{
    id: string
    data: unknown
    updatedAt: number
  }>
}
```

Notes:

1. Only JSON-serializable data is allowed.
2. `meta` is optional sync metadata for resume-capable collections.

## Live Query Serialization and Pruning

`ssr: { serializes: true }` marks live query result transfer candidates.

At `scope.serialize()`:

1. Build `includedCollectionIds` from `scope.include(...)`.
2. Gather used or preloaded live queries with `ssr.serializes: true`.
3. Compute each candidate's dependency collection ids.
4. Skip candidate if all dependencies are covered by included collection snapshots.
5. Otherwise include the live query payload.

Hydration timing guarantee:

1. `ProvideDbScope` applies transferred collection snapshots and live query payloads before first descendant render.
2. Derived live queries (for example `.findOne()`) are available from hydrated sources on initial client render.

## Sync Metadata and Resume

V1 behavior:

1. Collection snapshots may include optional `meta`.
2. If collection implementation supports resume from `meta`, it may resume.
3. If metadata is missing or incompatible, collection should restart from truncate/reload.

Out of scope for this doc:

1. Detailed `onIncompatibleSyncState` policy matrix.
2. Multi-backend sync adapters and migration tooling.

Those are a follow-up design phase.

## Scope Lifecycle and Cleanup

Rules:

1. A scope should be serialized once for a given response payload boundary.
2. `cleanup()` should run only after the framework is done using scope-owned resources.
3. In RSC render flows, do not rely on `finally` around `return <JSX/>` when passing live `scope` object unless framework guarantees post-render finalization hooks.

Cleanup by strategy:

1. Single root scope: cleanup runs in middleware `finally` or router teardown, after the full response is sent.
2. Per-loader scope: cleanup runs in each loader's own `finally` block, after `serialize()`.

Safe RSC default:

1. Compute `const dbState = scope.serialize()` before returning JSX.
2. Pass `state` to `ProvideDbScope`.
3. Cleanup in `finally`.

## Framework Integration Guidance

### TanStack Start (single root scope)

1. Create `dbScope` in `createRouter()` alongside `QueryClient`.
2. Pass `dbScope` through router context so all loaders access it via `context.dbScope`.
3. Each loader uses the shared scope: creates collections, preloads, calls `include(...)`.
4. Loaders return application data only (no `dbState`).
5. Root component calls `dbScope.serialize()` during render and provides `<ProvideDbScope state={dbState}>`.
6. Middleware `finally` handles cleanup after the response is complete.

This is the preferred pattern because TanStack Start creates a fresh router per request and makes router context available to both loaders and components.

### React Router and Remix (per-loader scope with merge)

1. Each loader creates its own `dbScope`, preloads, serializes, and cleans up.
2. Each route component wraps its subtree in `<ProvideDbScope state={dbState}>`.
3. Nested providers merge state so child routes contribute additional data.

Per-loader scope is recommended because React Router loaders run in parallel and each must return serializable data independently. A shared scope would require a coordination mechanism that the framework does not provide.

### Next.js App Router RSC (per-page scope)

1. Each page server component creates its own `dbScope`.
2. Serialize before returning JSX for safe cleanup timing.
3. One `ProvideDbScope` per page.

A single root scope is not viable because RSC layouts are cached across navigations and are not re-executed per request. There is no per-request root entry point that can create and share a scope.

### Next.js Pages Router (per-page scope)

1. `getServerSideProps` creates `dbScope`, preloads, serializes, and cleans up.
2. Page component receives `dbState` as a prop and renders `<ProvideDbScope state={dbState}>`.

Single entry point per page, so scope placement is straightforward.

## Backwards Compatibility

1. Existing non-SSR global collection usage remains valid.
2. SSR support is additive through `createDbScope` + `ProvideDbScope`.
3. Prior experimental APIs from draft PR are superseded by this surface.

## Non-Goals (V1)

1. Streaming-partial SSR state commits across multiple flush checkpoints.
2. Advanced sync-state compatibility policies.
3. Automatic ambient-scope inference on server via AsyncLocalStorage.

## Testing Plan

1. Getter memoization hit/miss behavior and deterministic param hashing.
2. Scope isolation across concurrent requests.
3. Required-scope getter runtime/type behavior.
4. Include-only transfer semantics for collections.
5. Live-query candidate pruning correctness and order independence.
6. Hydration timing guarantee for derived live queries.
7. Cleanup behavior across framework adapter integration tests.
8. Nested `ProvideDbScope` merge: child overrides parent by id.
9. Nested `ProvideDbScope` merge: `useDbScope()` returns merged scope.
10. Single root scope: shared memoization across loaders using same scope.
11. Single root scope: serialize captures all loaders' contributions.
12. Param hash canonicalization: key order independence (`{ a, b }` equals `{ b, a }`).
13. Param hash canonicalization: `undefined` values excluded from hash.
14. Param hash: `Date` hashed by timestamp, `BigInt` hashed with type prefix.
15. Param hash: dev-mode throw on unsupported types (`Map`, `Set`, functions, `Symbol`, cyclic references).
16. Param hash: nested objects and arrays produce stable keys.
17. Param hash: type prefixes prevent cross-type collisions (for example `"1"` vs `1` vs `1n`).
18. Merge freshness: entry with later timestamp wins over tree-position default.
19. Merge freshness: equal timestamps fall back to child-wins.
20. Merge freshness: client-side route transition with stale parent cache does not overwrite fresher child data.
