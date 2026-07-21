---
id: ContextFromUnionSource
title: ContextFromUnionSource
---

# Type Alias: ContextFromUnionSource\<TSource\>

```ts
type ContextFromUnionSource<TSource> = IsUnion<keyof TSource & string> extends true ? object : ContextFromSource<TSource>;
```

Defined in: [packages/db/src/query/builder/types.ts:144](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/types.ts#L144)

## Type Parameters

### TSource

`TSource` *extends* [`Source`](Source.md)
