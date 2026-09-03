---
id: getQueryIdentity
title: getQueryIdentity
---

# Function: getQueryIdentity()

```ts
function getQueryIdentity(query): QueryIdentity;
```

Defined in: [packages/db/src/query/ir-stable-identity.ts:85](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir-stable-identity.ts#L85)

Returns the semantic identity of a structured query.

Logical conjunctions and disjunctions are associative, commutative, and
idempotent. Equality operands are commutative, while reversed inequalities
are normalized by inverting their operator. Order-sensitive clauses and
function arguments retain their original order.

## Parameters

### query

[`QueryIR`](../@tanstack/namespaces/IR/interfaces/QueryIR.md)

## Returns

[`QueryIdentity`](../type-aliases/QueryIdentity.md)
