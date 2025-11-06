---
id: SubscribeChangesSnapshotOptions
title: SubscribeChangesSnapshotOptions
---

# Interface: SubscribeChangesSnapshotOptions

Defined in: packages/db/src/types.ts:669

## Extends

- `Omit`\<[`SubscribeChangesOptions`](../SubscribeChangesOptions.md), `"includeInitialState"`\>

## Properties

### limit?

```ts
optional limit: number;
```

Defined in: packages/db/src/types.ts:672

***

### orderBy?

```ts
optional orderBy: OrderBy;
```

Defined in: packages/db/src/types.ts:671

***

### whereExpression?

```ts
optional whereExpression: BasicExpression<boolean>;
```

Defined in: packages/db/src/types.ts:666

Pre-compiled expression for filtering changes

#### Inherited from

[`SubscribeChangesOptions`](../SubscribeChangesOptions.md).[`whereExpression`](../SubscribeChangesOptions.md#whereexpression)
