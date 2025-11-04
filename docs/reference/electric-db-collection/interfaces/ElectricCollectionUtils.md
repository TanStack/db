---
id: ElectricCollectionUtils
title: ElectricCollectionUtils
---

# Interface: ElectricCollectionUtils\<T\>

Defined in: [packages/electric-db-collection/src/electric.ts:237](https://github.com/TanStack/db/blob/main/packages/electric-db-collection/src/electric.ts#L237)

Electric collection utilities type

## Extends

- `UtilsRecord`

## Type Parameters

### T

`T` *extends* `Row`\<`unknown`\> = `Row`\<`unknown`\>

## Indexable

```ts
[key: string]: Fn
```

## Properties

### awaitMatch

```ts
awaitMatch: AwaitMatchFn<T>;
```

Defined in: [packages/electric-db-collection/src/electric.ts:240](https://github.com/TanStack/db/blob/main/packages/electric-db-collection/src/electric.ts#L240)

***

### awaitTxId

```ts
awaitTxId: AwaitTxIdFn;
```

Defined in: [packages/electric-db-collection/src/electric.ts:239](https://github.com/TanStack/db/blob/main/packages/electric-db-collection/src/electric.ts#L239)
