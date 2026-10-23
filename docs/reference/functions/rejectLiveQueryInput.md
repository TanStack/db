---
id: rejectLiveQueryInput
title: rejectLiveQueryInput
---

```ts
function rejectLiveQueryInput(collections, rejection): never;
```

Defined in: [packages/db/src/live-query-options.ts:43](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-options.ts#L43)

Release the sync starts a rejected query input deferred, then rethrow its
rejection. A framework binding calls this at its render boundary, so a
render that throws anywhere after preparation leaves no source deferred and
a later reader can start it. As for a `DbClient` preload, the rejection wins
over a source whose resumed start fails; that source records its own
failure.

## Parameters

### collections

[`DeferredLiveQueryCollections`](../type-aliases/DeferredLiveQueryCollections.md) | `undefined`

### rejection

`unknown`

## Returns

`never`
