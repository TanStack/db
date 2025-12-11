---
id: IndexOptions
title: IndexOptions
---

# Interface: IndexOptions\<TIndexType\>

Defined in: [packages/db/src/indexes/index-options.ts:6](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/index-options.ts#L6)

Options for creating an index

## Type Parameters

### TIndexType

`TIndexType` *extends* [`IndexConstructor`](../type-aliases/IndexConstructor.md) = [`IndexConstructor`](../type-aliases/IndexConstructor.md)

## Properties

### indexType?

```ts
optional indexType: TIndexType;
```

Defined in: [packages/db/src/indexes/index-options.ts:12](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/index-options.ts#L12)

Index type to use (e.g., BasicIndex, BTreeIndex)

***

### name?

```ts
optional name: string;
```

Defined in: [packages/db/src/indexes/index-options.ts:10](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/index-options.ts#L10)

Optional name for the index

***

### options?

```ts
optional options: TIndexType extends (id, expr, name?, options?) => any ? O : never;
```

Defined in: [packages/db/src/indexes/index-options.ts:14](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/index-options.ts#L14)

Options passed to the index constructor
