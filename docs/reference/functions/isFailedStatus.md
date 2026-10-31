---
id: isFailedStatus
title: isFailedStatus
---

```ts
function isFailedStatus(status): boolean;
```

Defined in: [packages/db/src/live-query-primitives.ts:51](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-primitives.ts#L51)

`error` and `crashed` end a sync run before it can serve its result.

## Parameters

### status

[`CollectionStatus`](../type-aliases/CollectionStatus.md)

## Returns

`boolean`
