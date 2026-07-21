---
id: ElectricCollectionUtils
title: ElectricCollectionUtils
---

# Interface: ElectricCollectionUtils\<T\>

Defined in: [packages/electric-db-collection/src/electric.ts:574](https://github.com/TanStack/db/blob/main/packages/electric-db-collection/src/electric.ts#L574)

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

Defined in: [packages/electric-db-collection/src/electric.ts:578](https://github.com/TanStack/db/blob/main/packages/electric-db-collection/src/electric.ts#L578)

***

### awaitTxId

```ts
awaitTxId: AwaitTxIdFn;
```

Defined in: [packages/electric-db-collection/src/electric.ts:577](https://github.com/TanStack/db/blob/main/packages/electric-db-collection/src/electric.ts#L577)
