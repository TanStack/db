---
id: SubscribeChangesSnapshotOptions
title: SubscribeChangesSnapshotOptions
---

# Interface: SubscribeChangesSnapshotOptions

Defined in: [packages/db/src/types.ts:746](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L746)

## Extends

- `Omit`\<[`SubscribeChangesOptions`](SubscribeChangesOptions.md), `"includeInitialState"`\>

## Properties

### limit?

```ts
optional limit: number;
```

Defined in: [packages/db/src/types.ts:751](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L751)

***

### orderBy?

```ts
optional orderBy: OrderBy;
```

Defined in: [packages/db/src/types.ts:750](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L750)

***

### whereExpression?

```ts
optional whereExpression: BasicExpression<boolean>;
```

Defined in: [packages/db/src/types.ts:743](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L743)

Pre-compiled expression for filtering changes

#### Inherited from

[`SubscribeChangesOptions`](SubscribeChangesOptions.md).[`whereExpression`](SubscribeChangesOptions.md#whereexpression)
