---
id: getLiveQueryStatusFlags
title: getLiveQueryStatusFlags
---

```ts
function getLiveQueryStatusFlags(status, health?): LiveQueryStatusFlags;
```

Defined in: [packages/db/src/live-query-primitives.ts:87](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-primitives.ts#L87)

Derive the status flags from a collection status and its health tree. This is
the one place the `isSyncError` rule is written. Adapters represent a disabled
query separately (with `isReady: true`); this covers the real
`CollectionStatus` values.

## Parameters

### status

[`CollectionStatus`](../type-aliases/CollectionStatus.md)

### health?

[`HealthNode`](../interfaces/HealthNode.md)

## Returns

[`LiveQueryStatusFlags`](../interfaces/LiveQueryStatusFlags.md)
