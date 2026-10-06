---
id: withFlatChangeTracking
title: withFlatChangeTracking
---

```ts
function withFlatChangeTracking<T>(
   targets, 
   callback, 
   asArray): Record<string, unknown>[] | undefined;
```

Defined in: [packages/db/src/proxy.ts:856](https://github.com/TanStack/db/blob/main/packages/db/src/proxy.ts#L856)

Change tracking for flat rows without proxies. A draft is a shallow copy,
and its changes are the fields that differ from the row afterwards under
the same equality the draft proxy uses for primitives. Returns undefined
when any row has a nested object, a getter, a symbol key, or a class
prototype, so the caller falls back to the proxy.

## Type Parameters

### T

`T` *extends* `object`

## Parameters

### targets

`T`[]

### callback

(`drafts`) => `void`

### asArray

`boolean`

## Returns

`Record`\<`string`, `unknown`\>[] \| `undefined`
