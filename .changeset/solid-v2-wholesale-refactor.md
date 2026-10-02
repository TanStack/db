---
'@tanstack/solid-db': major
---

# Solid v2 RC migration + wholesale observer refactor

Migrates `@tanstack/solid-db` from Solid v1 to **Solid v2 RC** (developed
against `solid-js@2.0.0-rc.13`) and reworks the adapter to derive all Solid
state from the shared `LiveQueryObserver`'s wholesale snapshots. This is a
**breaking** release — the peer dependency is now
`solid-js: >=2.0.0-rc.0` and `@solidjs/web: >=2.0.0-rc.0`.

Ship this as a **prerelease** until `solid-js` 2.0 final is out.

## Breaking changes

### Solid v2 RC migration

Peer dependencies require Solid v2 RC. Code consuming `@tanstack/solid-db`
must be migrated to Solid v2:

- `Suspense` → `Loading` (from `@solidjs/web`)
- `ErrorBoundary` → `Errored` (from `@solidjs/web`)
- `createResource` → async `createMemo` (internal)
- `batch()` removed — v2 auto-batches
- Store APIs import from `solid-js` root (not `solid-js/store`)

### Removed accessor properties

The `data`, `isLoading`, `isIdle`, and `isCleanedUp` properties are removed.
`data` was a deprecated duplicate of calling the accessor; the removed flags
are derivable from `status`.

```diff
- query.data        // removed — use query()
- query.isLoading   // removed — use query.status === 'loading'
- query.isIdle      // removed — use query.status === 'idle'
- query.isCleanedUp // removed — use query.status === 'cleaned-up'
```

## Behavior changes

### Data reads never suspend; readiness is opt-in

`query()` now always returns the current rows synchronously — including rows
that synced before the collection is ready (progressive sync, on-demand
loading). Reading an errored query still throws the captured error for an
`<Errored>` boundary.

Suspense is opt-in through the new `readiness` accessor: reading
`query.readiness()` while the initial render is in flight throws
`NotReadyError` for a `<Loading>` boundary to catch. It settles at network
readiness or a permitted persisted fallback — the same gate as the React
adapter's suspense hook — so persisted data can reveal content before the
network answers.

```tsx
const todosQuery = useLiveQuery((q) => q.from({ todos: todosCollection }))

// Rows render as they sync — no boundary required:
<For each={todosQuery()}>{(todo) => <li>{todo.text}</li>}</For>

// Opt-in suspense:
<Loading fallback={<div>Loading…</div>}>
  {todosQuery.readiness() && (
    <For each={todosQuery()}>{(todo) => <li>{todo.text}</li>}</For>
  )}
</Loading>

// Revalidation progress (solid-js built-ins):
<Show when={isPending(() => todosQuery.readiness())}><Spinner /></Show>
```

### Wholesale observer mode

`useLiveQuery` now subscribes to the `LiveQueryObserver` in **wholesale**
mode instead of granular. The observer delivers wake-up notifies into a
snapshot signal; Solid state stays fully derived from the latest snapshot —
a keyed `createProjection` materializes rows with per-field granularity, a
memo derives status, and the `state` map syncs incrementally (only changed
keys notify). On-demand collections that relied on the granular adapter's
`includeInitialState: true` behavior must load initial data explicitly —
matching the React adapter's wholesale policy.

Row identity keeps the rule from #1825: store nodes are keyed by the live
Collection's **result keys** (stamped with a per-collection epoch), never by
a row's public `$key` — derived results such as `unionAll` can publish
different rows sharing one `$key`, and a replaced collection's rows never
adopt the previous collection's nodes.

## Retained API

`status` (`CollectionStatus | 'disabled'`), `isReady`, `isError`, the
persisted-readiness trio (`persistedStatus`, `isPersistedReady`,
`persistedError`), `state` (`ReactiveMap`), and `collection` remain on the
accessor, matching the React and Vue adapters.
