---
id: getLiveQueryStatusFlags
title: getLiveQueryStatusFlags
---

```ts
function getLiveQueryStatusFlags(status): LiveQueryStatusFlags;
```

Defined in: [packages/db/src/live-query-primitives.ts:67](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-primitives.ts#L67)

Derive the boolean status flags from a collection status. Adapters represent
a disabled query separately (with `isReady: true`); this covers the real
`CollectionStatus` values.

## Parameters

### status

[`CollectionStatus`](../type-aliases/CollectionStatus.md)

## Returns

[`LiveQueryStatusFlags`](../interfaces/LiveQueryStatusFlags.md)
