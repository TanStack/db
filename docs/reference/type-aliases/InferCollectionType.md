---
id: InferCollectionType
title: InferCollectionType
---

# Type Alias: InferCollectionType\<T\>

```ts
type InferCollectionType<T> = T extends CollectionImpl<infer TOutput, any, any, any, any> ? TOutput : never;
```

Defined in: [packages/db/src/query/builder/types.ts:85](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/types.ts#L85)

InferCollectionType - Extracts the TypeScript type from a CollectionImpl

This helper ensures we get the same type that was used when creating the collection itself.
This can be an explicit type passed by the user or the schema output type.

## Type Parameters

### T

`T`
