---
id: BTreeIndexOptions
title: BTreeIndexOptions
---

# Interface: BTreeIndexOptions

Defined in: [packages/db/src/indexes/btree-index.ts:11](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/btree-index.ts#L11)

Options for Ordered index

## Properties

### compareFn()?

```ts
optional compareFn: (a, b) => number;
```

Defined in: [packages/db/src/indexes/btree-index.ts:12](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/btree-index.ts#L12)

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

Defined in: [packages/db/src/indexes/btree-index.ts:13](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/btree-index.ts#L13)
