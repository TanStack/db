---
id: resumeDeferredLiveQueryCollections
title: resumeDeferredLiveQueryCollections
---

```ts
function resumeDeferredLiveQueryCollections(collections, reportSourceErrors): void;
```

Defined in: [packages/db/src/live-query-options.ts:117](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-options.ts#L117)

Release every deferred source, then report the first startup failure.

## Parameters

### collections

[`DeferredLiveQueryCollections`](../type-aliases/DeferredLiveQueryCollections.md)

### reportSourceErrors

`boolean` = `false`

## Returns

`void`
