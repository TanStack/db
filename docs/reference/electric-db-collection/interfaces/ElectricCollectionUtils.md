---
id: ElectricCollectionUtils
title: ElectricCollectionUtils
---

# Interface: ElectricCollectionUtils\<T\>

Defined in: [packages/electric-db-collection/src/electric.ts:552](https://github.com/TanStack/db/blob/main/packages/electric-db-collection/src/electric.ts#L552)

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

Defined in: [packages/electric-db-collection/src/electric.ts:556](https://github.com/TanStack/db/blob/main/packages/electric-db-collection/src/electric.ts#L556)

***

### awaitTxId

```ts
awaitTxId: AwaitTxIdFn;
```

Defined in: [packages/electric-db-collection/src/electric.ts:555](https://github.com/TanStack/db/blob/main/packages/electric-db-collection/src/electric.ts#L555)
