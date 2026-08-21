---
id: SingleSource
title: SingleSource
---

# Type Alias: SingleSource\<TSource\>

```ts
type SingleSource<TSource> = IsUnion<keyof TSource & string> extends true ? never : TSource;
```

Defined in: [packages/db/src/query/builder/types.ts:148](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/types.ts#L148)

## Type Parameters

### TSource

`TSource` *extends* [`Source`](Source.md)
