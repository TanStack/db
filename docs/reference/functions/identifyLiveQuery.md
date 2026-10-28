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

Defined in: [packages/db/src/live-query-adapter.ts:138](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-adapter.ts#L138)

Identify a prepared query for a binding that compares query identity. The
identity throws `UnhashableQueryIRError` for IR without a stable identity,
then the query's sources claim their Collection IDs. The binding's render
boundary releases the sync starts a rejected render deferred; see
`rejectLiveQueryInput`.

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
