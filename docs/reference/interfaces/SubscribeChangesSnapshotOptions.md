---
id: SubscribeChangesSnapshotOptions
title: SubscribeChangesSnapshotOptions
---

# Interface: SubscribeChangesSnapshotOptions

Defined in: [packages/db/src/types.ts:669](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L669)

## Extends

- `Omit`\<[`SubscribeChangesOptions`](../SubscribeChangesOptions.md), `"includeInitialState"`\>

## Properties

### limit?

```ts
optional limit: number;
```

Defined in: [packages/db/src/types.ts:672](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L672)

***

### orderBy?

```ts
optional orderBy: OrderBy;
```

Defined in: [packages/db/src/types.ts:671](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L671)

***

### whereExpression?

```ts
optional whereExpression: BasicExpression<boolean>;
```

Defined in: [packages/db/src/types.ts:666](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L666)

Pre-compiled expression for filtering changes

#### Inherited from

[`SubscribeChangesOptions`](../SubscribeChangesOptions.md).[`whereExpression`](../SubscribeChangesOptions.md#whereexpression)
