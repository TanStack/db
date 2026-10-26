---
id: rejectLiveQueryInput
title: rejectLiveQueryInput
---

```ts
function rejectLiveQueryInput(collections, rejection): never;
```

Defined in: [packages/db/src/live-query-options.ts:66](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-options.ts#L66)

Release the sync starts a rejected query input deferred, then rethrow its
rejection. A framework hook calls this around its own render work, so a
query the hook rejects leaves no source deferred and a later reader can
start it. A render that throws after the hook returns, such as in a sibling
hook, is not a rejection of this input: like any render that never commits,
it releases its deferral through `releaseDeferredOnReclaim` when garbage
collection reclaims its live query. As for a
`DbClient` preload, the rejection wins over a source whose resumed start
fails; that source records its own failure.

## Parameters

### collections

[`DeferredLiveQueryCollections`](../type-aliases/DeferredLiveQueryCollections.md) | `undefined`

### rejection

`unknown`

## Returns

`never`
