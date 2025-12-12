---
id: SubscribeChangesSnapshotOptions
title: SubscribeChangesSnapshotOptions
---

# Interface: SubscribeChangesSnapshotOptions

Defined in: [packages/db/src/types.ts:769](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L769)

## Extends

- `Omit`\<[`SubscribeChangesOptions`](SubscribeChangesOptions.md), `"includeInitialState"`\>

## Properties

### limit?

```ts
optional limit: number;
```

Defined in: [packages/db/src/types.ts:774](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L774)

***

### orderBy?

```ts
optional orderBy: OrderBy;
```

Defined in: [packages/db/src/types.ts:773](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L773)

***

### whereExpression?

```ts
optional whereExpression: BasicExpression<boolean>;
```

Defined in: [packages/db/src/types.ts:766](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L766)

Pre-compiled expression for filtering changes

#### Inherited from

[`SubscribeChangesOptions`](SubscribeChangesOptions.md).[`whereExpression`](SubscribeChangesOptions.md#whereexpression)
