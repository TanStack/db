---
id: claimLiveQuerySourceIds
title: claimLiveQuerySourceIds
---

```ts
function claimLiveQuerySourceIds(
   claims, 
   sources, 
   client, 
   bindingName): void;
```

Defined in: [packages/db/src/live-query-adapter.ts:99](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-adapter.ts#L99)

Record a query's sources, or throw before recording any.

## Parameters

### claims

[`LiveQuerySourceIdClaims`](../type-aliases/LiveQuerySourceIdClaims.md)

### sources

readonly `object`[]

### client

[`DbClient`](../classes/DbClient.md) | `undefined`

### bindingName

`string`

## Returns

`void`
