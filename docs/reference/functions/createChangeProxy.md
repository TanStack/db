---
id: createChangeProxy
title: createChangeProxy
---

# Function: createChangeProxy()

```ts
function createChangeProxy<T>(target, parent?): object;
```

Defined in: [packages/db/src/proxy.ts:451](https://github.com/TanStack/db/blob/main/packages/db/src/proxy.ts#L451)

Creates a proxy that tracks changes to the target object

## Type Parameters

### T

`T` *extends* `Record`\<`string` \| `symbol`, `any`\>

## Parameters

### target

`T`

The object to proxy

### parent?

`ChangeParent`

Optional parent information

## Returns

`object`

An object containing the proxy and a function to get the changes

### getChanges()

```ts
getChanges: () => Record<string | symbol, any>;
```

#### Returns

`Record`\<`string` \| `symbol`, `any`\>

### proxy

```ts
proxy: T;
```
