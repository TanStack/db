---
id: bindLiveQueryWindow
title: bindLiveQueryWindow
---

```ts
function bindLiveQueryWindow(
   previous, 
   update, 
   uncommitted?): LiveQueryWindowBinding;
```

Defined in: [packages/db/src/live-query-window-binding.ts:111](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-binding.ts#L111)

Bind an infinite-query update. Returns `previous` when it still serves the
update; otherwise returns a new binding whose controller the adapter
subscribes and later disposes.

`uncommitted` is a binding built by an earlier update that never took
effect, such as a React render that did not commit. When it answers this
update, its window collection is reused instead of compiling another.

## Parameters

### previous

[`LiveQueryWindowBinding`](../interfaces/LiveQueryWindowBinding.md) | `null`

### update

[`LiveQueryWindowUpdate`](../interfaces/LiveQueryWindowUpdate.md)

### uncommitted?

[`LiveQueryWindowBinding`](../interfaces/LiveQueryWindowBinding.md) | `null`

## Returns

[`LiveQueryWindowBinding`](../interfaces/LiveQueryWindowBinding.md)
