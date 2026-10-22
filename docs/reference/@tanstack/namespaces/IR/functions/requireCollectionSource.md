---
id: requireCollectionSource
title: requireCollectionSource
---

## Call Signature

```ts
function requireCollectionSource(source): never;
```

Defined in: [packages/db/src/query/ir.ts:152](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L152)

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

Defined in: [packages/db/src/query/ir.ts:153](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L153)

A descriptor must bind to a DbClient before a Collection is required.

### Parameters

#### source

[`CollectionSourceRef`](../type-aliases/CollectionSourceRef.md)

### Returns

[`CollectionImpl`](../../../../classes/CollectionImpl.md)
