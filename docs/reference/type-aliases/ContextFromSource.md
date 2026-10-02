---
id: ContextFromSource
title: ContextFromSource
---

```ts
type ContextFromSource<TSource> = object;
```

Defined in: [packages/db/src/query/builder/types.ts:154](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/types.ts#L154)

## Type Parameters

### TSource

`TSource` *extends* [`Source`](Source.md)

## Properties

### baseSchema

```ts
baseSchema: SchemaFromSource<TSource>;
```

Defined in: [packages/db/src/query/builder/types.ts:155](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/types.ts#L155)

***

### fromSourceName

```ts
fromSourceName: keyof TSource & string;
```

Defined in: [packages/db/src/query/builder/types.ts:157](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/types.ts#L157)

***

### hasJoins

```ts
hasJoins: false;
```

Defined in: [packages/db/src/query/builder/types.ts:158](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/types.ts#L158)

***

### schema

```ts
schema: SchemaFromSource<TSource>;
```

Defined in: [packages/db/src/query/builder/types.ts:156](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/types.ts#L156)
