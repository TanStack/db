---
id: trackSnapshot
title: trackSnapshot
---

## Call Signature

```ts
function trackSnapshot<O extends AnyObserver>(observer: O): SnapshotOf<O>
```

Defined in: [external-source.ts](https://github.com/TanStack/db/blob/main/packages/solid-db/src/external-source.ts)

Read a LiveQueryObserver snapshot with automatic Solid dependency tracking. Requires `enableSolidDBExternalSource` to have been called first.

### Parameters

#### observer

An object with `getSnapshot()` and `subscribe(listener)` (any `LiveQueryObserver`).

### Returns

The observer's current snapshot. Inside a Solid compute (memo, effect, component), the observer is registered as a dependency so the compute re-runs when the observer notifies. Outside a tracking scope, this is equivalent to `observer.getSnapshot()`.

### Examples

```ts
enableSolidDBExternalSource()

const snapshot = createMemo(() => trackSnapshot(observer))
snapshot().data // ordered rows
snapshot().status // CollectionStatus
```
