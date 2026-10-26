---
id: releaseDeferredOnReclaim
title: releaseDeferredOnReclaim
---

```ts
function releaseDeferredOnReclaim(liveQuery, deferredCollections): () => void | undefined;
```

Defined in: [packages/db/src/live-query-options.ts:92](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-options.ts#L92)

Release a render's deferred sync starts when the live query it built is
reclaimed. A render that commits releases them first, when it subscribes.
A render that never commits, because a sibling threw or it suspended, leaves
its live query unsubscribed until garbage collection cleans it up; that
cleanup releases the starts, so a direct reader's demand, made before or
after, then starts the sources. A live query that garbage collection never
reclaims, because its config disables GC or does not start its sync,
releases after the unsubscribed GC floor instead. Releases only the starts
deferred so far, not ones a later render of the same hook defers. Pass only
a live query the render built, and call the returned function when the
render commits, so a committed hook keeps no listener, timer, or copied
sources.

## Parameters

### liveQuery

`Pick`\<[`Collection`](../interfaces/Collection.md)\<`any`, `any`, `any`\>, `"once"` \| `"config"` \| `"status"`\>

### deferredCollections

[`DeferredLiveQueryCollections`](../type-aliases/DeferredLiveQueryCollections.md)

## Returns

() => `void` \| `undefined`
