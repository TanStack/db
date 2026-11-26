---
'@tanstack/solid-db': major
---

# Solid v2 migration

Migrates `@tanstack/solid-db` from Solid v1 to **Solid v2** (built and tested
against `solid-js@2.0.3`). This is a **breaking** release: the peer
dependencies are now `solid-js: ^2.0.0` and `@solidjs/web: ^2.0.0`.

## Breaking changes

### Solid v2

Code consuming `@tanstack/solid-db` runs on Solid v2 and follows its rules:

- `Suspense` → `Loading`, `ErrorBoundary` → `Errored`
- Store APIs import from `solid-js` (not `solid-js/store`)
- Read props and rows where they are used (JSX, a memo, an effect, a
  handler), never once in a component body

### Data reads no longer suspend

On Solid v1, reading the accessor suspended to the nearest `Suspense`
boundary until the query was ready. Now `query()` always returns the current
rows synchronously, including rows that synced before the collection is
ready (progressive sync, on-demand loading):

```tsx
const todosQuery = useLiveQuery((q) => q.from({ todos: todosCollection }))

// Rows render as they sync — no boundary required:
<For each={todosQuery()}>{(todo) => <li>{todo.text}</li>}</For>
```

Wrapping that read in a boundary no longer shows a fallback.

### New: `loaded`, the opt-in first-data gate

To wait for the first load, read `query.loaded()` inside a `<Loading>`
boundary. It throws `NotReadyError` until the query's first load has settled,
then returns the rows exactly like `query()`, so it feeds `<For>` directly:

```tsx
<Loading fallback={<div>Loading…</div>}>
  <For each={todosQuery.loaded()}>{(todo) => <li>{todo.text}</li>}</For>
</Loading>
```

While `query.loaded()` waits on a changed input's new collection, Solid 2
holds the rest of that update: `query()` in the same component keeps
returning the rows from before the change, and `isPending(() =>
query.loaded())` reports the wait.

### Errors reach `<Errored>` as an `Error`

Reading the accessor throws when the query cannot serve data: its first load
failed, or its collection crashed. The cause is thrown as is when it is an
`Error`, and otherwise wrapped in an `Error` whose `cause` is the reported
value. A failure that reports no cause at all is thrown as an `Error` that
names the Collection: `Collection "<id>" failed to load`. A sync problem after
the first load does not throw: the rows stay and the problem shows in
`query.health` and `query.isSyncError`.

## Unchanged API

`status`, `state`, `collection`, `isLoading`, `isReady`, `isIdle`,
`isLoadingError`, `isCrashed`, `isCleanedUp`, `isSyncError`, and `health`
remain on the accessor, as on Solid v1. Each flag is its own reactive value.

## Behavior notes

- Identical eq-filtered queries share one pooled live-query Collection and
  subscription; `collection` exposes its public view.
- A row keeps its identity by the live query's result key, never by its
  public `$key`: derived results such as `unionAll` can publish different rows
  that share one `$key` (#1825).
- A row is the Collection's own row behind a stable, read-only view: a nested
  getter stays live, a function field stays a function, and an own `__proto__`
  data field or a signed zero survives. A nested object is the Collection's
  object itself, as it is in the React, Vue and Svelte adapters, so update
  through the Collection. Writing to a row, freezing it or changing its
  prototype throws a `TypeError` in strict mode.
- Reactivity is per field, and it is created as fields are read in tracking
  scopes: a reader of one field is not re-run by a change to another, and a
  publication costs an unchanged row one comparison.
- The array `query()` returns is one object for the life of the query. A
  reader of the array, or of one of its slots, follows membership and order:
  it re-runs when rows join, leave or move, and not when a value changes.
