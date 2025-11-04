---
id: withChangeTracking
title: withChangeTracking
---

# Function: withChangeTracking()

```ts
function withChangeTracking<T>(target, callback): Record<string | symbol, unknown>;
```

Defined in: [packages/db/src/proxy.ts:895](https://github.com/TanStack/db/blob/main/packages/db/src/proxy.ts#L895)

Creates a proxy for an object, passes it to a callback function,
and returns the changes made by the callback

## Type Parameters

### T

`T` *extends* `object`

## Parameters

### target

`T`

The object to proxy

### callback

(`proxy`) => `void`

Function that receives the proxy and can make changes to it

## Returns

`Record`\<`string` \| `symbol`, `unknown`\>

The changes made to the object
