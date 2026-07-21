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
  alias?: string;
  collection: Collection;
  path: string[];
};
```

Defined in: [packages/db/src/query/ir.ts:332](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L332)

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
  `alias?`: `string`;
  `collection`: [`Collection`](../../../../interfaces/Collection.md);
  `path`: `string`[];
\}

The collection, its alias, and the path to the root field in this collection.
`alias` is the alias under which the resolved collection is referenced in the
query it was reached from (when the ref crosses into a joined source). It is
left undefined when the ref simply resolves to a field on the passed-in
`collection`, in which case the caller already knows the alias.
