---
id: ContextFromSource
title: ContextFromSource
---

# Type Alias: ContextFromSource\<TSource\>

```ts
type ContextFromSource<TSource> = object;
```

Defined in: [packages/db/src/query/builder/types.ts:137](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/types.ts#L137)

## Type Parameters

### TSource

`TSource` *extends* [`Source`](Source.md)

## Properties

### baseSchema

```ts
baseSchema: SchemaFromSource<TSource>;
```

Defined in: [packages/db/src/query/builder/types.ts:138](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/types.ts#L138)

***

### fromSourceName

```ts
fromSourceName: keyof TSource & string;
```

Defined in: [packages/db/src/query/builder/types.ts:140](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/types.ts#L140)

***

### hasJoins

```ts
hasJoins: false;
```

Defined in: [packages/db/src/query/builder/types.ts:141](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/types.ts#L141)

***

### schema

```ts
schema: SchemaFromSource<TSource>;
```

Defined in: [packages/db/src/query/builder/types.ts:139](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/types.ts#L139)
