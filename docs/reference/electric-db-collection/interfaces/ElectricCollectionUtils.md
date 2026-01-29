---
id: ElectricCollectionUtils
title: ElectricCollectionUtils
---

# Interface: ElectricCollectionUtils\<T\>

Defined in: [packages/electric-db-collection/src/electric.ts:492](https://github.com/TanStack/db/blob/main/packages/electric-db-collection/src/electric.ts#L492)

Electric collection utilities type

## Extends

- `UtilsRecord`

## Type Parameters

### T

`T` *extends* `Row`\<`unknown`\> = `Row`\<`unknown`\>

## Indexable

```ts
[key: string]: any
```

## Properties

### awaitMatch

```ts
awaitMatch: AwaitMatchFn<T>;
```

Defined in: [packages/electric-db-collection/src/electric.ts:496](https://github.com/TanStack/db/blob/main/packages/electric-db-collection/src/electric.ts#L496)

***

### awaitTxId

```ts
awaitTxId: AwaitTxIdFn;
```

Defined in: [packages/electric-db-collection/src/electric.ts:495](https://github.com/TanStack/db/blob/main/packages/electric-db-collection/src/electric.ts#L495)
