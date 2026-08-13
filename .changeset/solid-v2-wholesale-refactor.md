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

### Removed status flags and data property from accessor

The accessor no longer exposes `data`, `status`, `isLoading`, `isReady`,
`isIdle`, `isError`, or `isCleanedUp`. Loading and error states are handled
exclusively through `<Loading>` and `<Errored>` boundaries, with `isPending`
and `latest` helpers for finer control. The accessor surface is now just
`query()` (data), `query.state` (ReactiveMap), and `query.collection`.

```diff
- query.data        // removed — use query()
- query.status      // removed — use <Loading>/<Errored> boundaries
- query.isLoading   // removed — use isPending(query)
- query.isReady     // removed — wrap reads in <Loading>
- query.isError     // removed — wrap reads in <Errored>
+ query()           // data access (throws NotReadyError when loading)
+ query.state       // ReactiveMap<TKey, TResult>
+ query.collection  // underlying Collection
```

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

Benchmarks comparing the previous Solid v1 adapter (main branch, commit
`2c35b588`) against the new Solid v2 wholesale adapter. JSDOM, median of
5 iterations each. The v1 adapter is the pre-renderer-rework version that
was running in production before this MR.

### Initial All-Row Mount

| Rows  | v1 (main) | v2 wholesale | Result       |
| ----- | --------: | -----------: | ------------ |
| 10    |    2.35ms |       1.54ms | 1.53× faster |
| 1,000 |   18.75ms |      11.53ms | 1.63× faster |
| 10,000|  129.74ms |      73.35ms | 1.77× faster |

### Single-Row Update in All-Row Query

| Rows  | v1 (main) | v2 wholesale | Result       |
| ----- | --------: | -----------: | ------------ |
| 10    |    0.06ms |       0.03ms | 2.00× faster |
| 1,000 |    0.08ms |       0.02ms | 4.00× faster |
| 10,000|    0.08ms |       0.02ms | 4.00× faster |

### 10% Row Batch Update

| Rows  | v1 (main) | v2 wholesale | Result       |
| ----- | --------: | -----------: | ------------ |
| 10    |    0.07ms |       0.04ms | 1.75× faster |
| 1,000 |    9.59ms |       1.68ms | 5.71× faster |
| 10,000|   97.40ms |      24.00ms | 4.06× faster |

### Repeated Single-Row Updates (1000 rows × 200 commits)

| v1 (main) | v2 wholesale | Result       |
| --------: | -----------: | ------------ |
|    2.52ms |       2.60ms | 0.97× (par)  |

### findOne Update (1000 rows)

| v1 (main) | v2 wholesale | Result       |
| --------: | -----------: | ------------ |
|    0.01ms |       0.03ms | 0.33× slower |

### Remount After Update (1000 rows)

| v1 (main) | v2 wholesale | Result       |
| --------: | -----------: | ------------ |
|    3.13ms |       3.77ms | 0.83× slower |

**Summary**: The v2 wholesale adapter is **1.5–5.7× faster** than the v1
adapter for mount, single-row updates, and batch updates — the scenarios
that dominate real-world usage. findOne and remount are marginally slower
(sub-millisecond absolute difference). Repeated rapid-fire single-row
updates are on par.

The gains come from eliminating the v1 adapter's full-store-reset on every
change (replaced by Solid v2's keyed `reconcile`) and from the wholesale
observer's efficient snapshot caching.
