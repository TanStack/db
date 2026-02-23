---
id: followRef
title: followRef
---

# Function: followRef()

```ts
function followRef(
   query, 
   ref, 
   collection): 
  | void
  | {
  collection: Collection;
  path: string[];
};
```

Defined in: packages/db/src/query/ir.ts:213

Follows the given reference in a query
until its finds the root field the reference points to.

## Parameters

### query

[`QueryIR`](../interfaces/QueryIR.md)

### ref

[`PropRef`](../classes/PropRef.md)\<`any`\>

### collection

[`Collection`](../../../../interfaces/Collection.md)

## Returns

  \| `void`
  \| \{
  `collection`: [`Collection`](../../../../interfaces/Collection.md);
  `path`: `string`[];
\}

The collection, its alias, and the path to the root field in this collection
