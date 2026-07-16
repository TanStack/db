---
id: getLiveQueryStatusFlags
title: getLiveQueryStatusFlags
---

# Function: getLiveQueryStatusFlags()

```ts
function getLiveQueryStatusFlags(status): LiveQueryStatusFlags;
```

Defined in: [packages/db/src/live-query-adapter.ts:58](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-adapter.ts#L58)

Derive the boolean status flags from a collection status. Adapters represent
a disabled query separately (with `isReady: true`); this covers the real
`CollectionStatus` values.

## Parameters

### status

[`CollectionStatus`](../type-aliases/CollectionStatus.md)

## Returns

[`LiveQueryStatusFlags`](../interfaces/LiveQueryStatusFlags.md)
