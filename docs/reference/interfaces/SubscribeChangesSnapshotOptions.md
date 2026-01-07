---
id: SubscribeChangesSnapshotOptions
title: SubscribeChangesSnapshotOptions
---

# Interface: SubscribeChangesSnapshotOptions

Defined in: [packages/db/src/types.ts:785](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L785)

## Extends

- `Omit`\<[`SubscribeChangesOptions`](SubscribeChangesOptions.md), `"includeInitialState"`\>

## Properties

### limit?

```ts
optional limit: number;
```

Defined in: [packages/db/src/types.ts:790](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L790)

***

### orderBy?

```ts
optional orderBy: OrderBy;
```

Defined in: [packages/db/src/types.ts:789](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L789)

***

### whereExpression?

```ts
optional whereExpression: BasicExpression<boolean>;
```

Defined in: [packages/db/src/types.ts:782](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L782)

Pre-compiled expression for filtering changes

#### Inherited from

[`SubscribeChangesOptions`](SubscribeChangesOptions.md).[`whereExpression`](SubscribeChangesOptions.md#whereexpression)
