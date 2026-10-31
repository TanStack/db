---
id: LoadSubsetFn
title: LoadSubsetFn
---

```ts
type LoadSubsetFn = (options) => true | Promise<void>;
```

Defined in: [packages/db/src/types.ts:400](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L400)

Loads one subset. A Collection subscription installs its logical owner
before calling this function. A synchronous throw fails the load but keeps
that owner; releasing the owner still calls `unloadSubset`, if provided,
for the failed load. Make that handler safe after partial setup. A successful
implementation must await or return every receipt from the sync
`commit()` calls that establish the loaded subset. A result describes only
the exact `options` passed to this call.

When a sync adapter refetches loaded subsets without a new `loadSubset`
call, it either keeps each served ordered prefix whole (see
`LoadSubsetOptions`), or calls `invalidateLoadedSubsets()` once the
refetched rows apply. Refetching each ordered page alone keeps neither
promise: a row that now sorts between two served pages is in neither
result, and the loader receives no change that would request it.

## Parameters

### options

[`LoadSubsetOptions`](LoadSubsetOptions.md)

## Returns

`true` \| `Promise`\<`void`\>
