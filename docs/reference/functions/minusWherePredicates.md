---
id: minusWherePredicates
title: minusWherePredicates
---

# Function: minusWherePredicates()

```ts
function minusWherePredicates(fromPredicate, subtractPredicate): 
  | BasicExpression<boolean>
  | null;
```

Defined in: [packages/db/src/query/predicate-utils.ts:340](https://github.com/TanStack/db/blob/main/packages/db/src/query/predicate-utils.ts#L340)

Compute the difference between two where predicates: `fromPredicate AND NOT(subtractPredicate)`.
Returns the simplified predicate, or null if the difference cannot be simplified
(in which case the caller should fetch the full fromPredicate).

## Parameters

### fromPredicate

The predicate to subtract from

[`BasicExpression`](../@tanstack/namespaces/IR/type-aliases/BasicExpression.md)\<`boolean`\> | `undefined`

### subtractPredicate

The predicate to subtract

[`BasicExpression`](../@tanstack/namespaces/IR/type-aliases/BasicExpression.md)\<`boolean`\> | `undefined`

## Returns

  \| [`BasicExpression`](../@tanstack/namespaces/IR/type-aliases/BasicExpression.md)\<`boolean`\>
  \| `null`

The simplified difference, or null if cannot be simplified

## Examples

```ts
// Range difference
minusWherePredicates(
  gt(ref('age'), val(10)),      // age > 10
  gt(ref('age'), val(20))       // age > 20
) // → age > 10 AND age <= 20
```

```ts
// Set difference
minusWherePredicates(
  inOp(ref('status'), ['A', 'B', 'C', 'D']),  // status IN ['A','B','C','D']
  inOp(ref('status'), ['B', 'C'])             // status IN ['B','C']
) // → status IN ['A', 'D']
```

```ts
// Common conditions
minusWherePredicates(
  and(gt(ref('age'), val(10)), eq(ref('status'), val('active'))),  // age > 10 AND status = 'active'
  and(gt(ref('age'), val(20)), eq(ref('status'), val('active')))   // age > 20 AND status = 'active'
) // → age > 10 AND age <= 20 AND status = 'active'
```

```ts
// Complete overlap - empty result
minusWherePredicates(
  gt(ref('age'), val(20)),     // age > 20
  gt(ref('age'), val(10))      // age > 10
) // → {type: 'val', value: false} (empty set)
```
