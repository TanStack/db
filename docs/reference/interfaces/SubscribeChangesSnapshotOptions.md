---
id: SubscribeChangesSnapshotOptions
title: SubscribeChangesSnapshotOptions
---

# Interface: SubscribeChangesSnapshotOptions

Defined in: [packages/db/src/types.ts:727](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L727)

## Extends

- `Omit`\<[`SubscribeChangesOptions`](../SubscribeChangesOptions.md), `"includeInitialState"`\>

## Properties

### limit?

```ts
optional limit: number;
```

Defined in: [packages/db/src/types.ts:730](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L730)

***

### orderBy?

```ts
optional orderBy: OrderBy;
```

Defined in: [packages/db/src/types.ts:729](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L729)

***

### whereExpression?

```ts
optional whereExpression: BasicExpression<boolean>;
```

Defined in: [packages/db/src/types.ts:724](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L724)

Pre-compiled expression for filtering changes

#### Inherited from

[`SubscribeChangesOptions`](../SubscribeChangesOptions.md).[`whereExpression`](../SubscribeChangesOptions.md#whereexpression)
