---
id: identifyLiveQuery
title: identifyLiveQuery
---

```ts
function identifyLiveQuery<TIdentity>(
   preparedValue, 
   scope, 
   identify): TIdentity;
```

Defined in: [packages/db/src/live-query-adapter.ts:141](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-adapter.ts#L141)

Identify a prepared query for a binding that compares query identity. The
identity throws `UnhashableQueryIRError` for IR without a stable identity,
then the query's sources claim their Collection IDs. Either rejection
releases the sync starts the preparation deferred, so a later reader, such
as another hook over the same Collection, can still start those sources.

## Type Parameters

### TIdentity

`TIdentity` = `unknown`

## Parameters

### preparedValue

`unknown`

### scope

[`LiveQueryIdentityScope`](../interfaces/LiveQueryIdentityScope.md)

### identify

(`preparedValue`) => `TIdentity`

## Returns

`TIdentity`
