---
id: BTreeIndexOptions
title: BTreeIndexOptions
---

# Interface: BTreeIndexOptions

Defined in: [packages/db/src/indexes/btree-index.ts:16](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/btree-index.ts#L16)

Options for Ordered index

## Properties

### compareFn()?

```ts
optional compareFn: (a, b) => number;
```

Defined in: [packages/db/src/indexes/btree-index.ts:17](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/btree-index.ts#L17)

#### Parameters

##### a

`any`

##### b

`any`

#### Returns

`number`

***

### compareOptions?

```ts
optional compareOptions: CompareOptions;
```

Defined in: [packages/db/src/indexes/btree-index.ts:18](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/btree-index.ts#L18)
