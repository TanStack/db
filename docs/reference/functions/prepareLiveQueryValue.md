---
id: prepareLiveQueryValue
title: prepareLiveQueryValue
---

```ts
function prepareLiveQueryValue(
   value, 
   dbClient, 
   deferredCollections?): unknown;
```

Defined in: [packages/db/src/live-query-options.ts:112](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-options.ts#L112)

Bind a query input's descriptor sources to `dbClient` and invoke its query
callback. Sources materialized for a render defer their sync start into
`deferredCollections`; a preparation that throws releases them, so a later
reader can still start those sources.

## Parameters

### value

`unknown`

### dbClient

[`DbClient`](../classes/DbClient.md) | `undefined`

### deferredCollections?

[`DeferredLiveQueryCollections`](../type-aliases/DeferredLiveQueryCollections.md)

## Returns

`unknown`
