---
id: SubscribeChangesSnapshotOptions
title: SubscribeChangesSnapshotOptions
---

# Interface: SubscribeChangesSnapshotOptions

Defined in: [packages/db/src/types.ts:708](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L708)

## Extends

- `Omit`\<[`SubscribeChangesOptions`](../SubscribeChangesOptions.md), `"includeInitialState"`\>

## Properties

### limit?

```ts
optional limit: number;
```

Defined in: [packages/db/src/types.ts:711](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L711)

***

### orderBy?

```ts
optional orderBy: OrderBy;
```

Defined in: [packages/db/src/types.ts:710](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L710)

***

### whereExpression?

```ts
optional whereExpression: BasicExpression<boolean>;
```

Defined in: [packages/db/src/types.ts:705](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L705)

Pre-compiled expression for filtering changes

#### Inherited from

[`SubscribeChangesOptions`](../SubscribeChangesOptions.md).[`whereExpression`](../SubscribeChangesOptions.md#whereexpression)
