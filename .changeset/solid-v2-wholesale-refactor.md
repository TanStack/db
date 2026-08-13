---
'@tanstack/solid-db': major
---

# Solid v2 RC migration + wholesale observer refactor

Migrates `@tanstack/solid-db` from Solid v1 to **Solid v2 RC** (`solid-js@2.0.0-rc.0`) and reworks the adapter to use the shared `LiveQueryObserver` in wholesale mode. This is a **breaking** release — the peer dependency is now `solid-js: >=2.0.0-rc.0` and `@solidjs/web: >=2.0.0-rc.0`.

## Breaking changes

### Solid v2 RC migration

Peer dependencies require Solid v2 RC. Code consuming `@tanstack/solid-db` must be migrated to Solid v2:

- `Suspense` → `Loading` (from `@solidjs/web`)
- `ErrorBoundary` → `Errored` (from `@solidjs/web`)
- `createResource` → async `createMemo` (internal; `useLiveQuery` now throws `NotReadyError` for `<Loading>` and the captured error for `<Errored>`)
- `createEffect` → split `createRenderEffect` (internal)
- `batch()` removed — v2 auto-batches
- `createStore`/`reconcile` imported from `solid-js` root (not `solid-js/store`)
- `reconcile(value, { key, merge })` → `reconcile(value, key | null)`
- Store setter uses draft callback form
- `ownedWrite: true` on status signal (written from observer callbacks)

### Data accessor throws during loading

Reading the accessor result (`query()`) while the collection is not yet ready
now throws `NotReadyError` (caught by `<Loading>`). Previously, data reads
during loading or revalidation returned stale or empty arrays synchronously.
Consumers must wrap data reads in a `<Loading>` boundary or check
`query.isReady` / `query.status` before reading.

### Wholesale observer mode

`useLiveQuery` now subscribes to the `LiveQueryObserver` in **wholesale** mode instead of granular. The observer delivers wake-up notifies; Solid's keyed `reconcile(rows, '$key')` handles the per-field diff that preserves fine-grained row reactivity.

On-demand collections that relied on the granular adapter's `includeInitialState: true` behavior must ensure initial data is loaded explicitly — matching the React adapter's wholesale policy.

The manual delta-patching layer (~160 lines: `rowIndex`, `syncRows`, `patchArrayChanges`, `patchSingleResultChanges`, `patchStoreRow`, `syncDataFromCollection`) has been removed. `useLiveQuery` adapter source went from 698 to 537 lines.

## New features

### `isPending` and `latest` helpers

The v2 migration unlocks Solid's built-in async helpers on the accessor result:

- `isPending(query)` — returns `true` while an unrevealed value change is in flight (e.g. during revalidation when a new collection is loading).
- `latest(query)` — returns the last resolved value, skipping the `<Loading>` boundary during revalidation (useful for stale-while-revalidate UIs).

```tsx
import { isPending, latest } from 'solid-js'
import { useLiveQuery } from '@tanstack/solid-db'

const query = useLiveQuery((q) => q.from({ todos: todosCollection }))

// Show a spinner refetching indicator during revalidation:
<Show when={isPending(query)}>
  <Spinner />
</Show>

// Render stale data immediately during revalidation (no Loading flash):
<For each={latest(query)}>{(todo) => <li>{todo.text}</li>}</For>
```

These work because `useLiveQuery` now uses async `createMemo` whose previous
value is held in place until the new value resolves — the v2 reactive graph
contract `isPending` and `latest` read from.

### External-source bridge (opt-in)

New `enableSolidDBExternalSource()` and `trackSnapshot(observer)` exports. Uses Solid v2's `enableExternalSource` API to bridge `LiveQueryObserver` snapshots into Solid's tracking graph:

```tsx
import { enableSolidDBExternalSource, trackSnapshot } from '@tanstack/solid-db'

// Call once at app startup:
enableSolidDBExternalSource()

// trackSnapshot() inside any Solid compute auto-subscribes:
const snapshot = createMemo(() => trackSnapshot(observer))
```

Without the bridge, `useLiveQuery` handles subscription internally as before.

## Performance

The renderer rework + wholesale refactor together improve render performance by up to 4x by eliminating redundant granular patching and leveraging Solid v2's batched updates.
