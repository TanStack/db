---
id: createArrayChangeProxy
title: createArrayChangeProxy
---

# Function: createArrayChangeProxy()

```ts
function createArrayChangeProxy<T>(targets): object;
```

Defined in: [packages/db/src/proxy.ts:1130](https://github.com/TanStack/db/blob/main/packages/db/src/proxy.ts#L1130)

Creates proxies for an array of objects and tracks changes to each

## Type Parameters

### T

`T` *extends* `object`

## Parameters

### targets

`T`[]

Array of objects to proxy

## Returns

`object`

An object containing the array of proxies and a function to get all changes

### getChanges()

```ts
getChanges: () => Record<string | symbol, unknown>[];
```

#### Returns

`Record`\<`string` \| `symbol`, `unknown`\>[]

### proxies

```ts
proxies: T[];
```
