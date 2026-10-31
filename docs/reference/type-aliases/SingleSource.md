---
id: SingleSource
title: SingleSource
---

```ts
type SingleSource<TSource> = IsUnion<keyof TSource & string> extends true ? never : TSource;
```

Defined in: [packages/db/src/query/builder/types.ts:149](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/types.ts#L149)

## Type Parameters

### TSource

`TSource` *extends* [`Source`](Source.md)
