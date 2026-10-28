# Candidate: the source health channel and live-query health tree

> **Superseded (2026-10-16).** The error surface was redesigned: status
> `crashed`, node `failureReason`/`error`, `fail()`, `reload()`, and
> `collection.health`. Read `error-surface/README.md` and `error-surface/RULES.md`,
> the shipped `docs/guides/error-handling.md`, and
> `packages/db/src/query/live/ARCHITECTURE.md` laws 14, 16, and 17.

Status: superseded candidate design, version 1. It came from a Field Lab
design-grammar run. The shipped design differs; read `PLAN.md`, the shipped
guides, and `packages/db/src/query/live/ARCHITECTURE.md` laws 16 and 17.

## Success standard (frozen, user-confirmed)

- H1 After the first ready, a sync failure is metadata. Status stays `ready`;
  data stays, even if increasingly stale.
- H2 Before the first ready, the gate is unchanged: a final failure is
  `markError`, reaches every consumer, and readiness waits reject.
- H3 The framework never heals or retries. Health reports what the source last
  said; only the source clears its failure by reporting healthy sync again.
- H4 A live query carries its sources' health, through joins, includes, and
  nested live queries.
- H5 Hooks expose health without changing data, `isReady`, or `status`. No
  flicker; Suspense does not throw after ready.
- H6 (open) A subset load for new demand that fails after ready is decided
  per request: it affects the requesting query, not the source.
- H7 One adapter API reports post-ready failures, replacing today's mix of
  ready-to-`error` transitions and adapter utilities.
- H8 query-db's `utils.lastError`, `isError`, and `errorCount` keep working.
- H9 An Effect hears about health changes after ready instead of being
  disposed.
- H10 A persisted collection keeps serving local rows when upstream sync fails
  after ready; health says upstream is degraded.
- H11 `useLiveQuery` returns an `health` structure describing the tree of
  collections it depends on. It always has the same shape, shows whether each
  node is in error, and carries detailed error info when in error, so apps
  can parse it.

Prior law (frozen earlier): a source either keeps trying (loading), becomes
ready, or reports a final error for its sync attempt; the framework never
heals an attempt; recovery is app-level (`cleanup()` then `preload()`).

## Source trace (current code)

- Status is the only propagated channel: live queries handle sources'
  `status:change` (`db/src/query/live/collection-config-builder.ts:1104`);
  hooks derive `isError` from status (`react-db/src/useLiveQuery.ts`).
- Electric (`electric.ts:2628, 2708`) and PowerSync (`powersync.ts:826`)
  switch a ready collection to `error` after ready; PowerSync then heals with
  `markReady` (`powersync.ts:813`).
- query-db exposes `utils.lastError`, `isError`, `errorCount`, reset after a
  successful result (`query-db-collection/src/query.ts:325-332`).
- Hooks already expose a parallel metadata channel for persistence:
  `persistedStatus`, `persistedError` (`react-db/src/useLiveQuery.ts`).
- A live query's direct sources come from `extractCollectionSources(query)`
  (`collection-config-builder.ts:197`); a source can itself be a live-query
  Collection.

## The candidate

### Two independent axes

- **Gate (`status`)**: `idle | loading | ready | error | cleaned-up`. Decided
  only by the initial sync of an attempt. Unchanged from today except that
  `error` is final for the attempt.
- **Health**: `healthy | error`, plus error info. Meaningful after the first
  ready. Only the source changes it.

### Adapter API (sync function params)

```ts nocheck
sync: ({ begin, write, commit, markReady, markError, reportError, reportHealthy }) => { ... }
```

- `markError(error)` before the first ready: the final initial failure (gate).
- `reportError(error)` after the first ready: health becomes `error` with this
  cause. Status and rows do not change.
- `reportHealthy()`: the source has synced successfully again; health becomes
  `healthy`.
- `markError(error)` after the first ready is forwarded to `reportError(error)`
  with a development warning, so existing adapters keep working while they
  migrate.
- Calling `markReady()` after `markError()` in one attempt throws (contract
  violation).

### Collection surface

```ts nocheck
collection.health // { isError: boolean, error: CollectionErrorInfo | null }
collection.on('health:change', (event) => { ... })

type CollectionErrorInfo = {
  phase: 'initial' | 'sync' | 'request'
  name: string
  message: string
  cause: unknown
  at: number // epoch milliseconds
}
```

`phase: 'initial'` mirrors a gate `error`; `phase: 'sync'` is a post-ready
health report; `phase: 'request'` is a subset load failure (H6).

### The health tree

Every live-query Collection exposes `health`, and every framework hook returns
it beside `data`:

```ts
type HealthNode = {
  collectionId: string
  kind: 'source' | 'live-query'
  status: CollectionStatus          // the node's gate
  isError: boolean                  // this node: gate error, health error, or request error
  hasErrors: boolean                // this node or any descendant
  error: CollectionErrorInfo | null // detail when isError
  sources: Array<HealthNode>     // dependencies; [] for a base source
}
```

- The root is the live query itself. Its `sources` are the query's
  collections in query order (`from`, then joins, then includes), each
  recursing through nested live queries.
- The shape is fixed by the query: every dependency is present whether or not
  it is in error. A collection reached by two paths appears once per path.
- Nodes mirror their collections in the same update as the change.
- A post-ready request failure (H6) sets `error` with `phase: 'request'` on
  the live-query node that issued the request. The source stays healthy.
- `isError` on the hook result keeps its current meaning: the gate is
  `error`. `health.hasErrors` reports anything anywhere in the tree.

### Effects

`createEffect({ onSourceHealth?: (health: HealthNode) => void })`. After
the first ready a health change calls it; the Effect is not disposed. Before
the first ready, a gate error still disposes the Effect through
`onSourceError`.

### Adapters

- Electric and PowerSync replace post-ready `markError` with `reportError` and
  call `reportHealthy` after their next successful sync. PowerSync's
  `markReady` recovery becomes `reportHealthy`.
- query-db keeps `utils.lastError/isError/errorCount` and also calls
  `reportError`/`reportHealthy`; it no longer calls `markReady` from `error`.
- Persisted collections: local storage failures stay on `persistedError`;
  upstream failures after ready are the collection's health.

### Recovery

App-level only. `cleanup()` then `preload()` starts a fresh attempt and resets
health to `healthy`.

## Model check

`SourceHealth.tla` checks stable shape, mirroring through a nested live query,
only-the-source-clears, gate independence after ready, and that a gate error
is explained by a tree node. Five weakened designs each produce their
counterexample. The model has two sources and one nested live query; it does
not cover a collection reached by two paths.
