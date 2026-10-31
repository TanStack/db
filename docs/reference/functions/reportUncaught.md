---
id: reportUncaught
title: reportUncaught
---

```ts
function reportUncaught(error): void;
```

Defined in: [packages/db/src/utils/callbacks.ts:18](https://github.com/TanStack/db/blob/main/packages/db/src/utils/callbacks.ts#L18)

Report an adapter contract breach, such as an `unloadSubset` that throws,
without changing the caller's result. The error surfaces as uncaught.

## Parameters

### error

`unknown`

## Returns

`void`
