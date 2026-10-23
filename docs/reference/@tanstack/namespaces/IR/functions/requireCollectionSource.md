---
id: requireCollectionSource
title: requireCollectionSource
---

## Call Signature

```ts
function requireCollectionSource(source): never;
```

Defined in: [packages/db/src/query/ir.ts:143](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L143)

A descriptor must bind to a DbClient before a Collection is required.

### Parameters

#### source

[`DescriptorRef`](../classes/DescriptorRef.md)

### Returns

`never`

## Call Signature

```ts
function requireCollectionSource(source): CollectionImpl;
```

Defined in: [packages/db/src/query/ir.ts:144](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L144)

A descriptor must bind to a DbClient before a Collection is required.

### Parameters

#### source

[`CollectionSourceRef`](../type-aliases/CollectionSourceRef.md)

### Returns

[`CollectionImpl`](../../../../classes/CollectionImpl.md)
