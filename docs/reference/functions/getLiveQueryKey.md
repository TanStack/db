---
id: getLiveQueryKey
title: getLiveQueryKey
---

```ts
function getLiveQueryKey(input): LiveQueryKey | undefined;
```

Defined in: [packages/db/src/live-query-adapter.ts:51](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-adapter.ts#L51)

The `queryKey` of a config-object query input, if it supplies one. An empty
key is absent, as it is for `getLiveQueryHash`, so a hook and a `DbClient`
preload agree on the query's identity.

## Parameters

### input

`unknown`

## Returns

[`LiveQueryKey`](../type-aliases/LiveQueryKey.md) \| `undefined`
