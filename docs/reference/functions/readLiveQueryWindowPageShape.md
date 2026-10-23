---
id: readLiveQueryWindowPageShape
title: readLiveQueryWindowPageShape
---

```ts
function readLiveQueryWindowPageShape(config): LiveQueryWindowPageShape;
```

Defined in: [packages/db/src/live-query-window-binding.ts:43](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-binding.ts#L43)

Read an infinite-query config's page shape. `getNextPageParam` is rejected:
the hook widens an ordered live query and has no server cursor to advance.

## Parameters

### config

#### initialPageParam?

`number`

#### pageSize?

`number`

## Returns

[`LiveQueryWindowPageShape`](../interfaces/LiveQueryWindowPageShape.md)
