---
id: SchemaFromSource
title: SchemaFromSource
---

# Type Alias: SchemaFromSource\<T\>

```ts
type SchemaFromSource<T> = Prettify<{ [K in keyof T]: T[K] extends CollectionImpl<any, any, any, any, any> ? InferCollectionType<T[K]> : T[K] extends QueryBuilder<infer TContext> ? GetResult<TContext> : never }>;
```

Defined in: [packages/db/src/query/builder/types.ts:98](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/types.ts#L98)

SchemaFromSource - Converts a Source definition into a ContextSchema

This transforms the input to `from()` into the schema format used throughout
the query builder. For each alias in the source:
- Collections → their inferred TypeScript type
- Subqueries → their result type (what they would return if executed)

The `Prettify` wrapper ensures clean type display in IDEs.

## Type Parameters

### T

`T` *extends* [`Source`](Source.md)
