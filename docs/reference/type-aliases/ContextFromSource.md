---
id: ContextFromSource
title: ContextFromSource
---

# Type Alias: ContextFromSource\<TSource\>

```ts
type ContextFromSource<TSource> = object;
```

Defined in: [packages/db/src/query/builder/types.ts:151](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/types.ts#L151)

## Type Parameters

### TSource

`TSource` *extends* [`Source`](Source.md)

## Properties

### baseSchema

```ts
baseSchema: SchemaFromSource<TSource>;
```

Defined in: [packages/db/src/query/builder/types.ts:152](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/types.ts#L152)

***

### fromSourceName

```ts
fromSourceName: keyof TSource & string;
```

Defined in: [packages/db/src/query/builder/types.ts:154](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/types.ts#L154)

***

### hasJoins

```ts
hasJoins: false;
```

Defined in: [packages/db/src/query/builder/types.ts:155](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/types.ts#L155)

***

### schema

```ts
schema: SchemaFromSource<TSource>;
```

Defined in: [packages/db/src/query/builder/types.ts:153](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/types.ts#L153)
